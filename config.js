// Where the planner's data lives. Leave `api` empty for the local preview (npm run dev).
// Production: 'https://<project-ref>.supabase.co/functions/v1/littleone'
window.LL_CONFIG = { api: /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '' : 'https://reuxmpfbntfvfhayswge.supabase.co/functions/v1/littleone' };
