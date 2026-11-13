-- The Little List: shared planner storage.
-- Everything goes through the `littleone` edge function (service role).
-- RLS is on with no policies, so the public API keys can read nothing.

create table if not exists public.ll_entries (
  id          text primary key,
  kind        text not null,              -- 'item' | 'product' | 'idea' | future kinds
  data        jsonb not null default '{}'::jsonb,
  created_by  text,
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists ll_entries_kind_idx on public.ll_entries (kind) where deleted_at is null;

create table if not exists public.ll_auth_failures (
  id       bigint generated always as identity primary key,
  ip_hash  text not null,
  at       timestamptz not null default now()
);
create index if not exists ll_auth_failures_idx on public.ll_auth_failures (ip_hash, at);

alter table public.ll_entries enable row level security;
alter table public.ll_auth_failures enable row level security;
revoke all on public.ll_entries, public.ll_auth_failures from anon, authenticated;

-- Private bucket for photos and files added on the Ideas page.
insert into storage.buckets (id, name, public, file_size_limit)
values ('littleone', 'littleone', false, 10485760)
on conflict (id) do nothing;

-- Starter content from the original planner page.
insert into public.ll_entries (id, kind, data, created_by, created_at) values
('pram-avi', 'product', '{"category":"Jogging prams","name":"Avi Spin","brand":"Cybex","feature":"A swivel front wheel for errands locks for a run. Air-filled tyres and a handlebar brake suit mixed routes.","specs":{"Front wheel":"Lockable swivel","Pram weight":"12.5 kg","Folded size":"87 × 58.5 × 30 cm","Newborn walks":"Chelino specifies Cot S or a compatible infant seat for newborn walks. Confirm the local model before buying.","Jogging readiness":"Confirm the minimum running age, seat configuration and developmental requirements in the manual for the South African model before jogging."},"offers":[{"shop":"Precious Cargo","price":9999,"old":14999,"link":"https://www.preciouscargo.co.za/products/cybex-avi-spin"},{"shop":"Chelino","price":9999.99,"old":14999.99,"link":"https://www.chelino.co.za/products/cybex-avi-spin-stroller"}],"source":"https://www.cybex-online.com/en/row/p/10103546.html","image":"assets/avi.webp","checked":"2026-11-08","fav":false}'::jsonb, 'starter', now() + interval '0 milliseconds'),
('pram-urban', 'product', '{"category":"Jogging prams","name":"Urban Glide 3","brand":"Thule","feature":"A swivel front wheel makes shop turns easier. Lock it on a run and use the twist brake on descents.","specs":{"Front wheel":"Lockable swivel","Pram weight":"11.9 kg","Folded size":"88 × 58 × 31 cm","Newborn walks":"Walk from birth with the compatible bassinet, sold separately. Thule SA lists it at R6,999.","Jogging readiness":"Thule advises at least 6 months in the stroller seat and a paediatrician’s advice before age one."},"offers":[{"shop":"Thule Store","price":19999,"link":"https://thulestore.co.za/thule-urban-glide-3-mb-ug3mb"},{"shop":"A-Zee Baby’s World","price":19999,"link":"https://azbaby.co.za/products/thule-urban-glide-3-black"}],"source":"https://www.thule.com/en-za/strollers/jogging-strollers/thule-urban-glide-3-_-10101991","image":"assets/urban.webp","checked":"2026-11-08","fav":false}'::jsonb, 'starter', now() + interval '1 milliseconds'),
('pram-glide', 'product', '{"category":"Jogging prams","name":"Glide 3","brand":"Thule","feature":"A fixed front wheel and large rear wheels favour straight-line running. Try tight shop turns before choosing it for everyday use.","specs":{"Front wheel":"Fixed front wheel","Pram weight":"11 kg","Folded size":"88 × 58 × 31 cm","Newborn walks":"For newborn walks, add a compatible Thule bassinet or a compatible infant seat with the required adaptor.","Jogging readiness":"Thule advises at least 6 months in the stroller seat and a paediatrician’s advice before age one."},"offers":[{"shop":"Precious Cargo","price":16999,"link":"https://www.preciouscargo.co.za/products/thule-glide"},{"shop":"Thule Store","price":16999,"link":"https://thulestore.co.za/thule-glide-3-stroller-10101970"}],"source":"https://www.thule.com/en-za/strollers/jogging-strollers/thule-glide-3-_-10101970","image":"assets/glide.webp","checked":"2026-11-08","fav":false}'::jsonb, 'starter', now() + interval '2 milliseconds'),
('start-0', 'item', '{"group":0,"name":"Rear-facing car seat","note":"Test the installation in the RAV4 with both front seats in your usual positions.","done":false}'::jsonb, 'starter', now() + interval '10 milliseconds'),
('start-1', 'item', '{"group":0,"name":"Cot or bedside crib","note":"Choose a firm, flat, snug-fitting mattress and fitted sheets.","done":false}'::jsonb, 'starter', now() + interval '11 milliseconds'),
('start-2', 'item', '{"group":0,"name":"Nappies and changing supplies","note":"Start with a small supply, wipes or cotton wool, and a washable changing mat.","done":false}'::jsonb, 'starter', now() + interval '12 milliseconds'),
('start-3', 'item', '{"group":0,"name":"Winter clothes","note":"Start with babygrows, vests and light layers for a Pretoria winter.","done":false}'::jsonb, 'starter', now() + interval '13 milliseconds'),
('start-4', 'item', '{"group":0,"name":"Feeding supplies","note":"Choose a starter setup around your feeding plan. For bottle feeds, include cleaning and sterilising equipment.","done":false}'::jsonb, 'starter', now() + interval '14 milliseconds'),
('start-5', 'item', '{"group":0,"name":"Bathing basics","note":"Set aside a towel, washcloths and a practical place to wash baby.","done":false}'::jsonb, 'starter', now() + interval '15 milliseconds'),
('start-6', 'item', '{"group":1,"name":"Everyday pram and jogger","note":"Compare the full newborn walking setup, later running use and fit in the boot.","done":false}'::jsonb, 'starter', now() + interval '16 milliseconds'),
('start-7', 'item', '{"group":1,"name":"Nursery chair","note":"Try feeding and getting up with both arms occupied.","done":false}'::jsonb, 'starter', now() + interval '17 milliseconds'),
('start-8', 'item', '{"group":1,"name":"Baby carrier","note":"Try the fit on both of you and read the instructions for newborn use.","done":false}'::jsonb, 'starter', now() + interval '18 milliseconds'),
('start-9', 'item', '{"group":1,"name":"Baby monitor","note":"Decide which rooms you need to hear from and test the range.","done":false}'::jsonb, 'starter', now() + interval '19 milliseconds'),
('start-10', 'item', '{"group":2,"name":"Bulk nappies and extra bottles","note":"Buy more once you know which size or bottle works.","done":false}'::jsonb, 'starter', now() + interval '20 milliseconds'),
('start-11', 'item', '{"group":2,"name":"Bottle warmer","note":"Revisit if warming bottles regularly becomes part of your routine.","done":false}'::jsonb, 'starter', now() + interval '21 milliseconds'),
('start-12', 'item', '{"group":2,"name":"Bouncer","note":"Try a borrowed one first if you find you want one.","done":false}'::jsonb, 'starter', now() + interval '22 milliseconds'),
('start-13', 'item', '{"group":2,"name":"Second pram","note":"Revisit after you know your running routes and how often you take baby along.","done":false}'::jsonb, 'starter', now() + interval '23 milliseconds'),
('start-14', 'item', '{"group":3,"name":"High chair and feeding utensils","note":"Revisit as you prepare for solids.","done":false}'::jsonb, 'starter', now() + interval '24 milliseconds'),
('start-15', 'item', '{"group":3,"name":"Stair gates and cupboard locks","note":"Measure your stairs and review hazards before baby becomes mobile.","done":false}'::jsonb, 'starter', now() + interval '25 milliseconds'),
('start-16', 'item', '{"group":3,"name":"Travel cot","note":"Revisit when an overnight stay is on the calendar.","done":false}'::jsonb, 'starter', now() + interval '26 milliseconds')
on conflict (id) do nothing;
