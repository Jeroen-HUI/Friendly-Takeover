-- Online games can be topped up with bots, and players can leave a lobby.

alter table public.games
  add column if not exists bot_count int not null default 0 check (bot_count between 0 and 6),
  add column if not exists bot_skill text not null default 'normal' check (bot_skill in ('normal', 'hard'));

drop function if exists public.update_game_settings(uuid, text, text, text, int, int);

create or replace function public.update_game_settings(
  p_game_id uuid,
  p_industry text,
  p_difficulty text,
  p_mode text,
  p_rounds int,
  p_round_seconds int,
  p_bot_count int default 0,
  p_bot_skill text default 'normal'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.games
  set industry = p_industry, difficulty = p_difficulty, mode = p_mode, rounds = p_rounds,
      round_seconds = p_round_seconds, bot_count = p_bot_count, bot_skill = p_bot_skill
  where id = p_game_id and host_user_id = (select auth.uid()) and status = 'lobby';
  if not found then
    raise exception 'Only the host can change settings before the game starts';
  end if;
end;
$$;

-- Leave a game that hasn't started. If the host leaves, the lobby closes for everyone.
create or replace function public.leave_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if exists (select 1 from public.games where id = p_game_id and host_user_id = v_uid and status = 'lobby') then
    delete from public.games where id = p_game_id;
    return;
  end if;
  delete from public.players p
  using public.games g
  where p.game_id = p_game_id and p.user_id = v_uid and g.id = p.game_id and g.status = 'lobby';
end;
$$;

revoke execute on function public.update_game_settings(uuid, text, text, text, int, int, int, text) from public, anon;
revoke execute on function public.leave_game(uuid) from public, anon;
grant execute on function public.update_game_settings(uuid, text, text, text, int, int, int, text) to authenticated;
grant execute on function public.leave_game(uuid) to authenticated;
