select cron.schedule(
  'mml-daily-freshdesk-sync',
  '15 * * * *',
  $$
  select net.http_post(
    url := 'https://mml-internal.lovable.app/api/public/hooks/freshdesk-sync',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4cWJwbWdzdGRha2lzc2ZyZHdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNjQ5NzcsImV4cCI6MjA5Nzg0MDk3N30.N4Dlyxwq5fWz5XFP_jS98gNwkQ-aftipIB-yOuoe-tw"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
