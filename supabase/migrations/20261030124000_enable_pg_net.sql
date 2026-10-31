-- HTTP calls from the database: used to call the game function on a schedule (daily mode deadlines).
create extension if not exists pg_net with schema extensions;
