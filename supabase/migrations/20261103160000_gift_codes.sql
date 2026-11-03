-- Gift codes: the owner makes codes for friends and testers; redeeming one unlocks the full game for that account.
-- Codes can be single-use or shared (e.g. 20 uses for a tester group), have a note, and can be switched off.

-- ---------------------------------------------------------------- admins
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;  -- no policies: only security definer functions read it
insert into public.app_admins (user_id) values ('4a296231-ff5c-4f09-bcd2-a70b5079802a') on conflict do nothing;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins where user_id = (select auth.uid()));
$$;
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------- codes
create table if not exists public.gift_codes (
  code text primary key check (code ~ '^FT-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  max_uses integer not null default 1 check (max_uses between 1 and 1000),
  uses integer not null default 0,
  note text not null default '' check (length(note) <= 80),
  disabled boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.gift_codes enable row level security;  -- no policies: codes are never readable directly

create table if not exists public.gift_redemptions (
  id bigint generated always as identity primary key,
  code text not null references public.gift_codes (code) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (code, user_id)
);
alter table public.gift_redemptions enable row level security;
create index if not exists gift_redemptions_user_idx on public.gift_redemptions (user_id);

alter table public.purchases drop constraint if exists purchases_source_check;
alter table public.purchases add constraint purchases_source_check check (source in ('stripe', 'grant', 'code'));
alter table public.purchases add column if not exists gift_code text;

-- ---------------------------------------------------------------- redeem
-- Wrong guesses are logged (and returned as a result, not raised, so the log isn't rolled back).
create table if not exists public.gift_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.gift_attempts enable row level security;
create index if not exists gift_attempts_user_idx on public.gift_attempts (user_id, created_at);

create or replace function public.redeem_gift_code(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  g public.gift_codes;
  v_tries int;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  -- Accept "FT-ABCD-EFGH", "ftabcdefgh", "ABCD EFGH"…
  if v_code ~ '^FT[A-Z0-9]{8}$' then v_code := substr(v_code, 3); end if;
  if v_code !~ '^[A-Z0-9]{8}$' then raise exception 'That code doesn''t look right. Codes look like FT-ABCD-1234.'; end if;
  v_code := 'FT-' || substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);

  -- Slow down guessing: at most 10 wrong tries per account per hour (counted in a small log).
  select count(*) into v_tries from public.gift_attempts where user_id = v_uid and created_at > now() - interval '1 hour';
  if v_tries >= 10 then raise exception 'Too many tries. Wait a bit and try again.'; end if;

  if exists (select 1 from public.purchases where user_id = v_uid and product = 'full_game') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select * into g from public.gift_codes where code = v_code for update;
  if not found or g.disabled then
    insert into public.gift_attempts (user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'error', 'That code doesn''t exist or was switched off.');
  end if;
  if g.uses >= g.max_uses then raise exception 'That code has been used up.'; end if;

  insert into public.purchases (user_id, product, source, gift_code) values (v_uid, 'full_game', 'code', v_code)
    on conflict (user_id, product) do nothing;
  insert into public.gift_redemptions (code, user_id) values (v_code, v_uid) on conflict do nothing;
  update public.gift_codes set uses = uses + 1 where code = v_code;
  return jsonb_build_object('ok', true, 'already', false);
end $$;

revoke execute on function public.redeem_gift_code(text) from public, anon;
grant execute on function public.redeem_gift_code(text) to authenticated;

-- ---------------------------------------------------------------- admin tools
create or replace function public.admin_create_gift_codes(p_count integer default 1, p_uses integer default 1, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no 0/O, 1/I
  v_out jsonb := '[]'::jsonb;
  v_code text;
  i int; j int;
begin
  if not public.is_admin() then raise exception 'Only the game owner can make codes'; end if;
  p_count := greatest(1, least(50, coalesce(p_count, 1)));
  p_uses := greatest(1, least(1000, coalesce(p_uses, 1)));
  for i in 1..p_count loop
    loop
      v_code := 'FT-';
      for j in 1..8 loop
        v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
        if j = 4 then v_code := v_code || '-'; end if;
      end loop;
      begin
        insert into public.gift_codes (code, max_uses, note, created_by) values (v_code, p_uses, left(trim(coalesce(p_note, '')), 80), v_uid);
        exit;
      exception when unique_violation then null;  -- astronomically rare: try another
      end;
    end loop;
    v_out := v_out || to_jsonb(v_code);
  end loop;
  return v_out;
end $$;

create or replace function public.admin_list_gift_codes()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only the game owner can see codes'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', c.code, 'uses', c.uses, 'max_uses', c.max_uses, 'note', c.note,
                                        'disabled', c.disabled, 'created_at', c.created_at,
                                        'players', coalesce((select jsonb_agg(distinct pl.player_name) from public.gift_redemptions r
                                                             join public.players pl on pl.user_id = r.user_id where r.code = c.code), '[]'::jsonb))
                     order by c.created_at desc)
    from (select * from public.gift_codes order by created_at desc limit 200) c), '[]'::jsonb);
end $$;

create or replace function public.admin_set_gift_code(p_code text, p_disabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only the game owner can change codes'; end if;
  update public.gift_codes set disabled = coalesce(p_disabled, true) where code = upper(trim(p_code));
end $$;

revoke execute on function public.admin_create_gift_codes(integer, integer, text) from public, anon;
revoke execute on function public.admin_list_gift_codes() from public, anon;
revoke execute on function public.admin_set_gift_code(text, boolean) from public, anon;
grant execute on function public.admin_create_gift_codes(integer, integer, text) to authenticated;
grant execute on function public.admin_list_gift_codes() to authenticated;
grant execute on function public.admin_set_gift_code(text, boolean) to authenticated;

-- ---------------------------------------------------------------- my_access also says whether you're the owner
create or replace function public.my_access()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_owned boolean; v_used int; s jsonb;
begin
  select value into s from public.app_settings where key = 'paywall';
  if v_uid is null then return jsonb_build_object('signed_in', false, 'owned', false, 'free_left', 1, 'admin', false, 'paywall', coalesce(s, '{}'::jsonb)); end if;
  select exists (select 1 from public.purchases where user_id = v_uid and product = 'full_game') into v_owned;
  select count(distinct p.game_id) into v_used from public.players p join public.games g on g.id = p.game_id where p.user_id = v_uid and g.mode = 'live';
  return jsonb_build_object('signed_in', true, 'owned', v_owned, 'free_left', greatest(0, 1 - v_used), 'admin', public.is_admin(),
                            'paywall', coalesce(s, '{}'::jsonb));
end $$;
