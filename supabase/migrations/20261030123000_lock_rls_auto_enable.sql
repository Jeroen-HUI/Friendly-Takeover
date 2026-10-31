-- rls_auto_enable is an event-trigger function (it turns on RLS for new tables). It never needs to be called over the API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
