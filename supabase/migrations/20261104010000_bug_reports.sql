-- Bug reports typed in the game ("Report a bug" in the beta note and the menu).
-- Anyone may send one (guests too); only the owner can read them, in the admin panel or the Supabase table editor.
create table if not exists public.bug_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(body) between 3 and 2000),
  contact text check (char_length(contact) <= 120),
  context jsonb not null default '{}'::jsonb,
  done boolean not null default false
);
alter table public.bug_reports enable row level security;  -- no policies: only the functions below touch it
create index if not exists bug_reports_created_idx on public.bug_reports (created_at desc);

create or replace function public.report_bug(p_body text, p_contact text default null, p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) < 3 then raise exception 'Tell us a bit more about the bug.'; end if;
  -- Light spam guard: 5 per account per 10 minutes, and 60 per 10 minutes in total.
  if v_uid is not null and (select count(*) from public.bug_reports where user_id = v_uid and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'You sent a few reports already. Try again in a few minutes.';
  end if;
  if (select count(*) from public.bug_reports where created_at > now() - interval '10 minutes') >= 60 then
    raise exception 'Lots of reports right now. Try again in a few minutes.';
  end if;
  insert into public.bug_reports (user_id, body, contact, context)
  values (v_uid, left(v_body, 2000), nullif(left(btrim(coalesce(p_contact, '')), 120), ''),
          case when jsonb_typeof(p_context) = 'object' and length(p_context::text) <= 4000 then p_context else '{}'::jsonb end);
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.report_bug(text, text, jsonb) from public;
grant execute on function public.report_bug(text, text, jsonb) to anon, authenticated;

create or replace function public.admin_list_bug_reports()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only the game owner can see bug reports'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', b.id, 'created_at', b.created_at, 'body', b.body, 'contact', b.contact,
                                        'context', b.context, 'done', b.done,
                                        'name', (select p.name from public.profiles p where p.user_id = b.user_id))
                     order by b.done, b.created_at desc)
    from (select * from public.bug_reports order by created_at desc limit 200) b), '[]'::jsonb);
end $$;

create or replace function public.admin_set_bug_done(p_id bigint, p_done boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only the game owner can change bug reports'; end if;
  update public.bug_reports set done = coalesce(p_done, true) where id = p_id;
end $$;

revoke execute on function public.admin_list_bug_reports() from public, anon;
revoke execute on function public.admin_set_bug_done(bigint, boolean) from public, anon;
grant execute on function public.admin_list_bug_reports() to authenticated;
grant execute on function public.admin_set_bug_done(bigint, boolean) to authenticated;
