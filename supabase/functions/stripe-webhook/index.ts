// Friendly Takeovers — Stripe webhook.
// Stripe calls this after a payment on the "full game" payment link. The link carries the buyer's account id as
// client_reference_id; a paid checkout session unlocks the full game for that account (table purchases).
// The webhook's signing secret lives only in the edge function secrets as STRIPE_WEBHOOK_SECRET.

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

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  const raw = await req.text();
  if (!secret || !(await verify(raw, req.headers.get("stripe-signature") ?? "", secret))) return new Response("Bad signature", { status: 400 });

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try { event = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
  const s = event.data?.object ?? {};
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return new Response("ignored");
  if (s.payment_status !== "paid") return new Response("not paid yet");

  const userId = String(s.client_reference_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return new Response("no account on this payment", { status: 200 });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { error } = await admin.from("purchases").upsert(
    { user_id: userId, product: "full_game", source: "stripe", stripe_session: String(s.id ?? ""), amount: Number(s.amount_total ?? 0), currency: String(s.currency ?? "") },
    { onConflict: "user_id,product", ignoreDuplicates: true },
  );
  if (error) return new Response("database error: " + error.message, { status: 500 });  // Stripe retries
  return new Response("ok");
});
