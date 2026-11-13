# The Little List

Our shared baby planner: compare the big purchases, tick off the checklist, track shop prices and drop in ideas (notes, links, photos).

- **Frontend:** plain HTML, CSS and JavaScript. No build step. All paths are relative, so it works under any sub-path (for example `/littleOne/`).
- **Backend:** one Supabase Edge Function (`supabase/functions/littleone`) in front of Postgres and a private storage bucket.
- **Access:** a shared family passcode. The function swaps it for a signed token that the browser keeps for 400 days. Eight wrong tries from one address in 15 minutes locks that address out.

## How data is stored

Everything is an *entry* in `ll_entries`: `{ id, kind, data }`, where `data` is JSON.

| kind | what it is | main fields in `data` |
| --- | --- | --- |
| `item` | checklist row | `group`, `name`, `note`, `done` |
| `product` | something to compare | `category`, `name`, `brand`, `feature`, `specs`, `offers[]`, `photo`/`image`, `fav` |
| `idea` | note, link or photos | `text`, `files[]` (`path`, `name`, `type`) |

New kinds of content only need a new `kind`; no schema change. Uploaded files live in the private `littleone` bucket and are served through short-lived signed links.

The tables have row level security on with no policies, so the public Supabase keys can read nothing. Only the function (service role) touches the data.

## Setup

1. **Database:** run `supabase/migrations/20261113070000_littleone.sql` on the Supabase project.
2. **Function:** deploy `supabase/functions/littleone` with JWT verification **off** (it does its own passcode check), and set the secret `LITTLEONE_PASSCODE`.
3. **Config:** put the function URL in `config.js`: `https://<project-ref>.supabase.co/functions/v1/littleone`.
4. **Hosting:** import this repo in Vercel (framework preset: *Other*, no build command).
5. **Sub-path on the main site:** in the main site's `vercel.json`, before its catch-all rewrite:
   ```json
   "rewrites": [{ "source": "/littleOne/:path*", "destination": "https://<littleone-project>.vercel.app/:path*" }]
   ```

## Local preview

```
npm run dev
```

Opens on http://localhost:5173 with an in-memory copy of the API. The passcode is `baby` and data resets on restart.

## Daily price check

`?action=pricewatch` on the function re-reads the price and stock of saved options from a fixed list of shops (Precious Cargo, Noola, Chelino, Mopani, Orms). It needs no passcode because it returns only counts, and it refuses to run more than once every 30 minutes. `supabase/migrations/20261113090000_pricewatch.sql` schedules it three times each morning. When a price falls, the offer keeps `dropFrom` and `dropAt`, and the app shows a "Price dropped" badge.
