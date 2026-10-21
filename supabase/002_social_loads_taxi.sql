-- ===== friendships =====
create table public.friendships (
  id bigint generated always as identity primary key,
  requester uuid not null references auth.users on delete cascade default auth.uid(),
  addressee uuid not null references auth.users on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','blocked')),
  blocked_by uuid references auth.users on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (requester <> addressee));
create unique index friendships_pair_uidx on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index friendships_addressee_idx on public.friendships (addressee);
create index friendships_requester_idx on public.friendships (requester);
alter table public.friendships enable row level security;
create or replace function public.are_friends(a uuid, b uuid) returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.friendships f where f.status = 'accepted' and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a))) $$;
create policy fr_read on public.friendships for select to authenticated using ((select auth.uid()) in (requester, addressee));
create policy fr_request on public.friendships for insert to authenticated with check (requester = (select auth.uid()) and status = 'pending' and blocked_by is null);
create policy fr_delete on public.friendships for delete to authenticated using ((select auth.uid()) in (requester, addressee) and (status <> 'blocked' or blocked_by = (select auth.uid())));
-- accept / block via RPC (prevents a requester accepting their own request)
create or replace function public.respond_friend(p_id bigint, p_action text) returns public.friendships language plpgsql security definer set search_path = '' as $$
declare f public.friendships; me uuid := (select auth.uid());
begin
  select * into f from public.friendships where id = p_id and me in (requester, addressee);
  if not found then raise exception 'not found'; end if;
  if p_action = 'accept' then
    if f.addressee <> me or f.status <> 'pending' then raise exception 'cannot accept'; end if;
    update public.friendships set status = 'accepted', updated_at = now() where id = p_id returning * into f;
  elsif p_action = 'block' then
    update public.friendships set status = 'blocked', blocked_by = me, updated_at = now() where id = p_id returning * into f;
  else raise exception 'bad action'; end if;
  return f;
end $$;
create or replace function public.find_user(p_query text) returns table (id uuid, display_name text, username text, role text) language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.username, p.role from public.profiles p join auth.users u on u.id = p.id
  where (select auth.uid()) is not null and (lower(u.email) = lower(trim(p_query)) or p.username = lower(trim(p_query))) limit 5 $$;

-- ===== live locations (friends-only) =====
create table public.live_locations (
  user_id uuid primary key references auth.users on delete cascade default auth.uid(),
  lat double precision not null, lng double precision not null, heading real, speed_mph real,
  sharing boolean not null default true, updated_at timestamptz not null default now());
alter table public.live_locations enable row level security;
create policy ll_read on public.live_locations for select to authenticated
  using (user_id = (select auth.uid()) or (sharing and public.are_friends((select auth.uid()), user_id)));
create policy ll_write on public.live_locations for insert to authenticated with check (user_id = (select auth.uid()));
create policy ll_update on public.live_locations for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy ll_delete on public.live_locations for delete to authenticated using (user_id = (select auth.uid()));

-- ===== shared routes (friends-only) =====
create table public.shared_routes (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users on delete cascade default auth.uid(),
  name text, geometry jsonb not null, stops jsonb not null default '[]'::jsonb, eta timestamptz,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index shared_routes_owner_idx on public.shared_routes (owner) where active;
alter table public.shared_routes enable row level security;
create policy sr_read on public.shared_routes for select to authenticated using (owner = (select auth.uid()) or public.are_friends((select auth.uid()), owner));
create policy sr_write on public.shared_routes for all to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

-- ===== loads (dispatcher -> driver) =====
create table public.loads (
  id uuid primary key default gen_random_uuid(),
  dispatcher uuid not null references auth.users on delete cascade default auth.uid(),
  driver uuid references auth.users on delete set null,
  ref text, commodity text, weight_lb int, notes text,
  pickup_address text not null, pickup_lat double precision, pickup_lng double precision, pickup_at timestamptz,
  dropoff_address text not null, dropoff_lat double precision, dropoff_lng double precision, dropoff_at timestamptz,
  rate_usd numeric(10,2) check (rate_usd >= 0),
  status text not null default 'offered' check (status in ('offered','accepted','declined','in_transit','delivered','cancelled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index loads_driver_idx on public.loads (driver, status);
create index loads_dispatcher_idx on public.loads (dispatcher, created_at desc);
alter table public.loads enable row level security;
create policy loads_read on public.loads for select to authenticated using ((select auth.uid()) in (dispatcher, driver) or (select public.is_admin()));
create policy loads_insert on public.loads for insert to authenticated with check (dispatcher = (select auth.uid()) and status = 'offered'
  and (select public.my_role()) in ('dispatcher','admin'));
create policy loads_dispatcher_update on public.loads for update to authenticated using (dispatcher = (select auth.uid())) with check (dispatcher = (select auth.uid()));
create policy loads_dispatcher_delete on public.loads for delete to authenticated using (dispatcher = (select auth.uid()));
-- driver status transitions only through RPC
create or replace function public.driver_update_load(p_id uuid, p_status text) returns public.loads language plpgsql security definer set search_path = '' as $$
declare l public.loads;
begin
  select * into l from public.loads where id = p_id and driver = (select auth.uid());
  if not found then raise exception 'not your load'; end if;
  if not ((l.status = 'offered' and p_status in ('accepted','declined')) or (l.status = 'accepted' and p_status = 'in_transit')
       or (l.status = 'in_transit' and p_status = 'delivered')) then raise exception 'invalid transition % -> %', l.status, p_status; end if;
  update public.loads set status = p_status, updated_at = now() where id = p_id returning * into l;
  return l;
end $$;

-- ===== taxi bookings (Rocapulco Supreme) =====
create or replace function public.taxi_fare(p_miles numeric, p_minutes numeric, p_flat text default null) returns numeric language sql immutable set search_path = '' as $$
  select case when p_flat = 'JFK' then 50.00 when p_flat = 'LGA' then 55.00
              else round(greatest(8.00, 3.50 + 2.50 * coalesce(p_miles,0) + 0.40 * coalesce(p_minutes,0)), 2) end $$;
create table public.taxi_bookings (
  id uuid primary key default gen_random_uuid(),
  rider uuid references auth.users on delete set null default auth.uid(),
  rider_name text, rider_phone text,
  pickup_address text not null, pickup_lat double precision, pickup_lng double precision,
  dropoff_address text not null, dropoff_lat double precision, dropoff_lng double precision,
  est_miles numeric(7,2), est_minutes numeric(7,1), flat_rate text check (flat_rate in ('JFK','LGA')),
  fare_estimate numeric(8,2) generated always as (public.taxi_fare(est_miles, est_minutes, flat_rate)) stored,
  payment_method text not null default 'cash' check (payment_method in ('cash','card','zelle','venmo')),
  status text not null default 'requested' check (status in ('requested','assigned','en_route','arrived','in_progress','completed','cancelled_rider','cancelled_driver')),
  assigned_driver uuid references auth.users on delete set null,
  scheduled_for timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index taxi_status_idx on public.taxi_bookings (status, created_at desc);
create index taxi_rider_idx on public.taxi_bookings (rider);
create index taxi_driver_idx on public.taxi_bookings (assigned_driver);
alter table public.taxi_bookings enable row level security;
create policy tb_read on public.taxi_bookings for select to authenticated using (rider = (select auth.uid()) or assigned_driver = (select auth.uid())
  or (select public.my_role()) in ('dispatcher','admin'));
create policy tb_insert on public.taxi_bookings for insert to authenticated with check (rider = (select auth.uid()) and status = 'requested' and assigned_driver is null);
create policy tb_rider_cancel on public.taxi_bookings for update to authenticated using (rider = (select auth.uid()) and status in ('requested','assigned'))
  with check (rider = (select auth.uid()) and status in ('requested','cancelled_rider'));
create policy tb_dispatch_update on public.taxi_bookings for update to authenticated using ((select public.my_role()) in ('dispatcher','admin'))
  with check ((select public.my_role()) in ('dispatcher','admin'));
create policy tb_driver_update on public.taxi_bookings for update to authenticated using (assigned_driver = (select auth.uid()))
  with check (assigned_driver = (select auth.uid()) and status in ('en_route','arrived','in_progress','completed','cancelled_driver'));

-- updated_at triggers
create or replace function public.touch() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at = now(); return new; end $$;
create trigger t_profiles before update on public.profiles for each row execute function public.touch();
create trigger t_friend before update on public.friendships for each row execute function public.touch();
create trigger t_routes before update on public.shared_routes for each row execute function public.touch();
create trigger t_loads before update on public.loads for each row execute function public.touch();
create trigger t_taxi before update on public.taxi_bookings for each row execute function public.touch();

-- realtime
alter publication supabase_realtime add table public.loads, public.taxi_bookings, public.hazards, public.live_locations, public.friendships;

-- auto-expire job (every 10 min) + purge old rows after 7 days
create or replace function public.expire_hazards() returns void language sql security definer set search_path = '' as $$
  update public.hazards set status = 'expired' where status = 'active' and expires_at <= now();
  delete from public.hazards where expires_at < now() - interval '7 days';
  delete from public.live_locations where updated_at < now() - interval '1 day';
$$;

-- lock down function execution to signed-in users
revoke execute on function public.vote_hazard(text,text), public.report_hazard_abuse(text,text), public.respond_friend(bigint,text),
  public.find_user(text), public.driver_update_load(uuid,text), public.expire_hazards() from public, anon;
grant execute on function public.vote_hazard(text,text), public.report_hazard_abuse(text,text), public.respond_friend(bigint,text),
  public.find_user(text), public.driver_update_load(uuid,text) to authenticated;
select cron.schedule('expire-hazards', '*/10 * * * *', 'select public.expire_hazards()');
