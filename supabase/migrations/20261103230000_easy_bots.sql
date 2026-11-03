-- Easy bots: they plan like normal bots, then make beginner mistakes.
alter table public.games drop constraint if exists games_bot_skill_check;
alter table public.games add constraint games_bot_skill_check check (bot_skill in ('easy', 'normal', 'hard'));
