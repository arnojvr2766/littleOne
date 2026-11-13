-- Daily price check: a scheduled job asks the littleone function to re-read shop prices.
-- Three runs each morning (South African time 06:00, 06:40, 07:20) cover every saved
-- option, about a dozen per run.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('littleone-pricewatch', '0,40 4 * * *', $$
  select net.http_post(
    url := 'https://reuxmpfbntfvfhayswge.supabase.co/functions/v1/littleone?action=pricewatch',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"limit":12}'::jsonb,
    timeout_milliseconds := 120000);
$$);
select cron.schedule('littleone-pricewatch-late', '20 5 * * *', $$
  select net.http_post(
    url := 'https://reuxmpfbntfvfhayswge.supabase.co/functions/v1/littleone?action=pricewatch',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"limit":12}'::jsonb,
    timeout_milliseconds := 120000);
$$);
