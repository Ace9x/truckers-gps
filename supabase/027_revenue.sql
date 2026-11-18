-- Driver deals and dispatch leads. Drivers are never charged to use RigRoute.
-- Guests may insert a lead or a listing inquiry, and may not read those rows back.
-- Partner and featured rows are readable only when they are meant to be shown.

create table if not exists public.rr_dispatch_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  phone text not null,
  email text not null,
  mc_dot text,
  equipment text not null,
  home_base text,
  lanes text,
  constraint rr_dispatch_leads_name_chk check (char_length(btrim(name)) between 1 and 80),
  constraint rr_dispatch_leads_phone_chk check (char_length(btrim(phone)) between 7 and 40),
  constraint rr_dispatch_leads_email_chk check (position('@' in email) > 1 and char_length(email) <= 120),
  constraint rr_dispatch_leads_mc_chk check (mc_dot is null or char_length(mc_dot) <= 40),
  constraint rr_dispatch_leads_eq_chk check (equipment in ('dry van', 'reefer', 'flatbed', 'box truck', 'hotshot')),
  constraint rr_dispatch_leads_base_chk check (home_base is null or char_length(home_base) <= 120),
  constraint rr_dispatch_leads_lanes_chk check (lanes is null or char_length(lanes) <= 400)
);
alter table public.rr_dispatch_leads enable row level security;
revoke all on table public.rr_dispatch_leads from public, anon, authenticated;
grant insert on table public.rr_dispatch_leads to anon, authenticated;
drop policy if exists rr_dispatch_leads_insert on public.rr_dispatch_leads;
create policy rr_dispatch_leads_insert on public.rr_dispatch_leads
  for insert to anon, authenticated with check (true);

create table if not exists public.rr_listing_inquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  business text not null,
  phone text,
  email text not null,
  kind text,
  city text,
  note text,
  constraint rr_listing_inq_name_chk check (char_length(btrim(name)) between 1 and 80),
  constraint rr_listing_inq_biz_chk check (char_length(btrim(business)) between 1 and 120),
  constraint rr_listing_inq_phone_chk check (phone is null or char_length(btrim(phone)) between 7 and 40),
  constraint rr_listing_inq_email_chk check (position('@' in email) > 1 and char_length(email) <= 120),
  constraint rr_listing_inq_kind_chk check (kind is null or char_length(kind) <= 80),
  constraint rr_listing_inq_city_chk check (city is null or char_length(city) <= 80),
  constraint rr_listing_inq_note_chk check (note is null or char_length(note) <= 500)
);
alter table public.rr_listing_inquiries enable row level security;
revoke all on table public.rr_listing_inquiries from public, anon, authenticated;
grant insert on table public.rr_listing_inquiries to anon, authenticated;
drop policy if exists rr_listing_inquiries_insert on public.rr_listing_inquiries;
create policy rr_listing_inquiries_insert on public.rr_listing_inquiries
  for insert to anon, authenticated with check (true);

create table if not exists public.rr_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  blurb text,
  url text,
  logo_url text,
  active boolean not null default false,
  sort int not null default 0,
  constraint rr_partners_cat_chk check (category in ('fuel', 'insurance', 'eld', 'factoring'))
);
alter table public.rr_partners enable row level security;
revoke all on table public.rr_partners from public, anon, authenticated;
grant select on table public.rr_partners to anon, authenticated;
drop policy if exists rr_partners_read on public.rr_partners;
create policy rr_partners_read on public.rr_partners
  for select to anon, authenticated using (active = true);

insert into public.rr_partners (name, category, blurb, url, logo_url, active, sort)
select * from (values
  ('Fuel card placeholder', 'fuel', 'Placeholder. Not a live offer.', null, null, false, 10),
  ('Insurance quote placeholder', 'insurance', 'Placeholder. Not a live offer.', null, null, false, 20),
  ('ELD placeholder', 'eld', 'Placeholder. Not a live offer.', null, null, false, 30),
  ('Factoring placeholder', 'factoring', 'Placeholder. Not a live offer.', null, null, false, 40)
) as v(name, category, blurb, url, logo_url, active, sort)
where not exists (select 1 from public.rr_partners p where p.name = v.name);

create table if not exists public.rr_featured_listings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text,
  lat double precision,
  lng double precision,
  phone text,
  url text,
  active boolean not null default false,
  expires_at timestamptz
);
alter table public.rr_featured_listings enable row level security;
revoke all on table public.rr_featured_listings from public, anon, authenticated;
grant select on table public.rr_featured_listings to anon, authenticated;
drop policy if exists rr_featured_read on public.rr_featured_listings;
create policy rr_featured_read on public.rr_featured_listings
  for select to anon, authenticated
  using (active = true and (expires_at is null or expires_at > now()));
