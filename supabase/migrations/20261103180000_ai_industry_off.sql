-- The AI industry is switched off for now (it has nothing special yet). Running AI games keep going;
-- no new game can start as AI. To switch it back on: update app_settings set value = '[]' where key = 'industries_off';
insert into public.app_settings (key, value) values ('industries_off', '["ai"]'::jsonb) on conflict (key) do nothing;

create or replace function public._industry_allowed() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.industry is distinct from old.industry)
     and exists (select 1 from public.app_settings where key = 'industries_off' and value ? new.industry) then
    raise exception 'That industry is switched off for now. Pick Chocolate or Weed.';
  end if;
  return new;
end $$;
revoke execute on function public._industry_allowed() from public, anon, authenticated;

drop trigger if exists games_industry_allowed on public.games;
create trigger games_industry_allowed before insert or update of industry on public.games
  for each row execute function public._industry_allowed();
