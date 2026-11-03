-- Two weed CEOs: Smooth Operator (laundering) and Enforcer (goon raids). Outside weed they play as Visionary.
alter table public.players drop constraint if exists players_trait_check;
alter table public.players add constraint players_trait_check check (trait in ('ruthless', 'visionary', 'influencer', 'pennyPincher', 'smoothOperator', 'enforcer'));
