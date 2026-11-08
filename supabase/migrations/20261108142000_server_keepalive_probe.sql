-- Read-only, anonymous REST probe used by the GitHub Actions activity heartbeat.
-- It returns no user or application data and performs no table writes.
create or replace function public.server_keepalive_probe()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select jsonb_build_object(
    'ok', true,
    'database_time', transaction_timestamp()
  );
$function$;

revoke all on function public.server_keepalive_probe() from public;
revoke all on function public.server_keepalive_probe() from anon, authenticated;
grant execute on function public.server_keepalive_probe() to anon;

-- Ensure PostgREST can see the newly-created RPC immediately.
notify pgrst, 'reload schema';
