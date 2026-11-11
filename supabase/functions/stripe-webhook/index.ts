// Friendly Takeover — Stripe webhook.
// Stripe calls this after a payment on the "full game" payment link. The link carries the buyer's account id as
// client_reference_id; a paid checkout session unlocks the full game for that account (table purchases).
// A full refund (charge.refunded) removes the unlock again.
// Every event acted on is logged in payment_events, so a payment that arrived without an account can be granted by hand.
// The webhook's signing secret lives only in the edge function secrets as STRIPE_WEBHOOK_SECRET.
// Stripe events to send here: checkout.session.completed, checkout.session.async_payment_succeeded, charge.refunded.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const enc = new TextEncoder();

/** Checks Stripe's signature header (t=...,v1=...) against the raw body, within 5 minutes. */
async function verify(raw: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)).filter((p) => p.length === 2)) as Record<string, string>;
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${raw}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time compare against every v1 signature (Stripe sends more than one while a secret is being rolled).
  return sigs.some((s) => s.length === hex.length && [...s].reduce((a, ch, i) => a | (ch.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

const str = (v: unknown, max = 200) => (typeof v === "string" && v ? v.slice(0, max) : null);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  const raw = await req.text();
  if (!secret || !(await verify(raw, req.headers.get("stripe-signature") ?? "", secret))) return new Response("Bad signature", { status: 400 });

  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try { event = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
  const s = event.data?.object ?? {};
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // The log is a record for the owner; a failure to write it never blocks the unlock (Stripe retries on a 500 anyway).
  const log = async (row: Record<string, unknown>) => {
    const { error } = await admin.from("payment_events").upsert({ event_id: str(event.id), event_type: String(event.type), ...row }, { onConflict: "event_id", ignoreDuplicates: true });
    if (error) console.error("payment_events:", error.message);
  };

  // ------------------------------------------------------------ a payment
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    if (s.payment_status !== "paid") return new Response("not paid yet");
    const userId = String(s.client_reference_id ?? "");
    const intent = str(s.payment_intent), session = str(s.id), amount = Number(s.amount_total ?? 0) || 0, currency = str(s.currency, 8);
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
      // Paid, but we can't tell which account: keep the email so the owner can find the buyer and unlock by hand.
      const email = str((s.customer_details as Record<string, unknown> | undefined)?.email ?? s.customer_email, 320);
      await log({ status: "no_account", stripe_session: session, payment_intent: intent, email, amount, currency });
      console.error("payment without an account:", session);
      return new Response("no account on this payment", { status: 200 });
    }
    const { error } = await admin.from("purchases").upsert(
      { user_id: userId, product: "full_game", source: "stripe", stripe_session: session, amount, currency: currency ?? "", payment_intent: intent },
      { onConflict: "user_id,product", ignoreDuplicates: true },
    );
    if (error) return new Response("database error: " + error.message, { status: 500 });  // Stripe retries
    await log({ status: "unlocked", user_id: userId, stripe_session: session, payment_intent: intent, amount, currency });
    return new Response("ok");
  }

  // ------------------------------------------------------------ a refund
  if (event.type === "charge.refunded") {
    if (s.refunded !== true) return new Response("partial refund: nothing to do");  // only a full refund removes the game
    const intent = str(s.payment_intent), amount = Number(s.amount_refunded ?? 0) || 0, currency = str(s.currency, 8);
    if (!intent) { await log({ status: "refund_unmatched", amount, currency }); return new Response("no payment on this refund"); }
    const { data: gone, error } = await admin.from("purchases").delete().eq("payment_intent", intent).eq("source", "stripe").select("user_id");
    if (error) return new Response("database error: " + error.message, { status: 500 });  // Stripe retries
    await log({ status: gone?.length ? "refunded" : "refund_unmatched", user_id: gone?.[0]?.user_id ?? null, payment_intent: intent, amount, currency });
    return new Response("ok");
  }

  return new Response("ignored");
});
