create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('mml-daily-snapshot-sync') where exists (
  select 1 from cron.job where jobname = 'mml-daily-snapshot-sync'
);

select cron.schedule(
  'mml-daily-snapshot-sync',
  '0 2 * * *',
  $$
  select net.http_post(
    url := 'https://mml-internal.lovable.app/api/public/hooks/mcp-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4cWJwbWdzdGRha2lzc2ZyZHdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNjQ5NzcsImV4cCI6MjA5Nzg0MDk3N30.N4Dlyxwq5fWz5XFP_jS98gNwkQ-aftipIB-yOuoe-tw'
    ),
    body := '{}'::jsonb
  );
  $$
);
