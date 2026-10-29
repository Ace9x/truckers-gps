-- Fleets: owner / dispatcher / driver roles, invite codes, contacts, invoices, HOS snapshots, pickup PIN on cloud loads.
create table if not exists public.fleets (id uuid primary key default gen_random_uuid(), name text not null check (length(name) between 2 and 80), owner uuid not null references auth.users(id) on delete cascade, created_at timestamptz default now());
create table if not exists public.fleet_members (fleet uuid references public.fleets(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade, role text not null check (role in ('owner','dispatcher','driver')), unit text, joined_at timestamptz default now(), primary key (fleet, user_id));
create table if not exists public.fleet_invites (code text primary key, fleet uuid not null references public.fleets(id) on delete cascade, role text not null check (role in ('dispatcher','driver')), created_by uuid not null default auth.uid(), expires_at timestamptz not null default now() + interval '7 days', used_by uuid, used_at timestamptz, created_at timestamptz default now());
create table if not exists public.fleet_contacts (id uuid primary key default gen_random_uuid(), fleet uuid not null references public.fleets(id) on delete cascade, kind text not null check (kind in ('customer','broker','shipper','receiver')), name text not null, company text, phone text, email text, mc text, notes text, created_at timestamptz default now());
create table if not exists public.fleet_invoices (id uuid primary key default gen_random_uuid(), fleet uuid not null references public.fleets(id) on delete cascade, number text not null, customer uuid references public.fleet_contacts(id) on delete set null, load_ids uuid[] not null, lines jsonb not null, total numeric not null, status text not null default 'open' check (status in ('open','sent','paid','void')), created_by uuid default auth.uid(), created_at timestamptz default now(), paid_at timestamptz, unique (fleet, number));
create table if not exists public.driver_hos (user_id uuid primary key references auth.users(id) on delete cascade, status text, drive_left_min int, window_left_min int, cycle_left_min int, updated_at timestamptz default now());
alter table public.loads add column if not exists fleet uuid references public.fleets(id) on delete set null;
alter table public.loads add column if not exists pin_hash text;
alter table public.loads add column if not exists customer uuid references public.fleet_contacts(id) on delete set null;
alter table public.loads add column if not exists invoice uuid references public.fleet_invoices(id) on delete set null;
create index if not exists loads_fleet_idx on public.loads(fleet);

create or replace function public.fleet_role(p_fleet uuid) returns text language sql stable security definer set search_path = '' as
$$ select role from public.fleet_members where fleet = p_fleet and user_id = (select auth.uid()) $$;
create or replace function public.is_fleet_staff(p_fleet uuid) returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.fleet_members where fleet = p_fleet and user_id = (select auth.uid()) and role in ('owner','dispatcher')) $$;
-- staff can see a driver's location/HOS only if that driver is in one of their fleets
create or replace function public.staff_sees_driver(p_user uuid) returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.fleet_members s join public.fleet_members d on d.fleet = s.fleet where s.user_id = (select auth.uid()) and s.role in ('owner','dispatcher') and d.user_id = p_user and d.role = 'driver') $$;

create or replace function public.create_fleet(p_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare f uuid; begin
  if (select auth.uid()) is null then raise exception 'sign in first'; end if;
  if (select count(*) from public.fleets where owner = (select auth.uid())) >= 3 then raise exception 'max 3 fleets per owner'; end if;
  insert into public.fleets(name, owner) values (trim(p_name), (select auth.uid())) returning id into f;
  insert into public.fleet_members(fleet, user_id, role) values (f, (select auth.uid()), 'owner');
  update public.profiles set role = 'dispatcher' where id = (select auth.uid()) and coalesce(role, 'driver') not in ('dispatcher','admin');
  return f; end $$;

create or replace function public.create_fleet_invite(p_fleet uuid, p_role text) returns text language plpgsql security definer set search_path = '' as $$
declare r text := public.fleet_role(p_fleet); c text; begin
  if r is null or r = 'driver' then raise exception 'not allowed'; end if;
  if p_role = 'dispatcher' and r <> 'owner' then raise exception 'only the owner can invite dispatchers'; end if;
  if p_role not in ('driver','dispatcher') then raise exception 'bad role'; end if;
  c := upper(substr(translate(encode(extensions.gen_random_bytes(8), 'base64'), '+/=0O1Il', ''), 1, 8));
  insert into public.fleet_invites(code, fleet, role) values (c, p_fleet, p_role); return c; end $$;

create or replace function public.join_fleet(p_code text, p_unit text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.fleet_invites; begin
  if (select auth.uid()) is null then raise exception 'sign in first'; end if;
  select * into i from public.fleet_invites where code = upper(trim(p_code)) for update;
  if i.code is null or i.used_by is not null or i.expires_at < now() then raise exception 'invite code invalid or expired'; end if;
  insert into public.fleet_members(fleet, user_id, role, unit) values (i.fleet, (select auth.uid()), i.role, nullif(trim(p_unit), '')) on conflict (fleet, user_id) do update set role = excluded.role, unit = coalesce(excluded.unit, public.fleet_members.unit);
  update public.fleet_invites set used_by = (select auth.uid()), used_at = now() where code = i.code;
  if i.role = 'dispatcher' then update public.profiles set role = 'dispatcher' where id = (select auth.uid()) and coalesce(role,'driver') <> 'admin'; end if;
  return jsonb_build_object('fleet', i.fleet, 'role', i.role, 'name', (select name from public.fleets where id = i.fleet)); end $$;

-- verify pickup PIN server-side, then mark loaded
create or replace function public.load_pin_ok(p_id uuid, p_pin text) returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.loads l where l.id = p_id and (select auth.uid()) = l.driver and (l.pin_hash is null or l.pin_hash = encode(extensions.digest('rr-pin:' || l.id::text || ':' || trim(p_pin), 'sha256'), 'hex'))) $$;

alter table public.fleets enable row level security; alter table public.fleet_members enable row level security; alter table public.fleet_invites enable row level security;
alter table public.fleet_contacts enable row level security; alter table public.fleet_invoices enable row level security; alter table public.driver_hos enable row level security;
drop policy if exists fleets_read on public.fleets; create policy fleets_read on public.fleets for select to authenticated using (public.fleet_role(id) is not null);
drop policy if exists fleets_update on public.fleets; create policy fleets_update on public.fleets for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
drop policy if exists fm_read on public.fleet_members; create policy fm_read on public.fleet_members for select to authenticated using (public.fleet_role(fleet) is not null);
drop policy if exists fm_owner_write on public.fleet_members; create policy fm_owner_write on public.fleet_members for update to authenticated using (public.fleet_role(fleet) = 'owner' or (public.is_fleet_staff(fleet) and role = 'driver')) with check (public.fleet_role(fleet) = 'owner' or (public.is_fleet_staff(fleet) and role = 'driver'));
drop policy if exists fm_remove on public.fleet_members; create policy fm_remove on public.fleet_members for delete to authenticated using ((public.fleet_role(fleet) = 'owner' and role <> 'owner') or user_id = (select auth.uid()) and role <> 'owner');
drop policy if exists fi_read on public.fleet_invites; create policy fi_read on public.fleet_invites for select to authenticated using (public.is_fleet_staff(fleet));
drop policy if exists fi_revoke on public.fleet_invites; create policy fi_revoke on public.fleet_invites for delete to authenticated using (public.is_fleet_staff(fleet) and used_by is null);
drop policy if exists fc_all on public.fleet_contacts; create policy fc_all on public.fleet_contacts for all to authenticated using (public.is_fleet_staff(fleet)) with check (public.is_fleet_staff(fleet));
drop policy if exists finv_read on public.fleet_invoices; create policy finv_read on public.fleet_invoices for select to authenticated using (public.is_fleet_staff(fleet));
drop policy if exists finv_write on public.fleet_invoices; create policy finv_write on public.fleet_invoices for insert to authenticated with check (public.is_fleet_staff(fleet) and created_by = (select auth.uid()));
drop policy if exists finv_update on public.fleet_invoices; create policy finv_update on public.fleet_invoices for update to authenticated using (public.fleet_role(fleet) = 'owner' or (public.is_fleet_staff(fleet) and status <> 'paid')) with check (public.is_fleet_staff(fleet));
drop policy if exists finv_delete on public.fleet_invoices; create policy finv_delete on public.fleet_invoices for delete to authenticated using (public.fleet_role(fleet) = 'owner');
drop policy if exists hos_own on public.driver_hos; create policy hos_own on public.driver_hos for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists hos_staff on public.driver_hos; create policy hos_staff on public.driver_hos for select to authenticated using (public.staff_sees_driver(user_id));
drop policy if exists ll_fleet_read on public.live_locations; create policy ll_fleet_read on public.live_locations for select to authenticated using (sharing and public.staff_sees_driver(user_id));
-- loads: fleet staff see/manage fleet loads; fleet loads only to drivers in that fleet
drop policy if exists loads_fleet_read on public.loads; create policy loads_fleet_read on public.loads for select to authenticated using (fleet is not null and public.is_fleet_staff(fleet));
drop policy if exists loads_fleet_update on public.loads; create policy loads_fleet_update on public.loads for update to authenticated using (fleet is not null and public.is_fleet_staff(fleet)) with check (fleet is not null and public.is_fleet_staff(fleet) and (driver is null or exists (select 1 from public.fleet_members m where m.fleet = loads.fleet and m.user_id = loads.driver)));
drop policy if exists loads_fleet_check on public.loads; create policy loads_fleet_check on public.loads as restrictive for insert to authenticated with check (fleet is null or (public.is_fleet_staff(fleet) and (driver is null or exists (select 1 from public.fleet_members m where m.fleet = loads.fleet and m.user_id = loads.driver))));
create or replace function public.is_load_party(p_load uuid) returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.loads l where l.id = p_load and ((select auth.uid()) in (l.dispatcher, l.driver) or (l.fleet is not null and public.is_fleet_staff(l.fleet)))) $$;
grant execute on function public.create_fleet(text), public.create_fleet_invite(uuid, text), public.join_fleet(text, text), public.load_pin_ok(uuid, text) to authenticated;

-- pickup PIN gates departing the first pickup (= Loaded) on account loads
drop function if exists public.driver_stop_event(uuid, int, text, double precision, double precision, jsonb);
create or replace function public.driver_stop_event(p_id uuid, p_idx int, p_event text, p_lat double precision default null, p_lng double precision default null, p_pod jsonb default null, p_pin text default null)
returns public.loads language plpgsql security definer set search_path = '' as $$
declare l public.loads; s jsonb; st jsonb; nxt int; n int; now_t text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select * into l from public.loads where id = p_id and driver = (select auth.uid()) for update;
  if not found then raise exception 'not your load'; end if;
  if l.status not in ('accepted','in_transit') then raise exception 'load is %', l.status; end if;
  s := l.stops;
  if jsonb_array_length(s) = 0 then
    s := jsonb_build_array(jsonb_build_object('kind','pickup','address',l.pickup_address,'lat',l.pickup_lat,'lng',l.pickup_lng,'appt',l.pickup_at),
                           jsonb_build_object('kind','drop','address',l.dropoff_address,'lat',l.dropoff_lat,'lng',l.dropoff_lng,'appt',l.dropoff_at)); end if;
  n := jsonb_array_length(s);
  select min(i) into nxt from generate_series(0, n - 1) i where s->i->>'departed_at' is null;
  if nxt is null then raise exception 'all stops done'; end if;
  if p_idx <> nxt then raise exception 'stops must be done in order (next is stop %)', nxt + 1; end if;
  st := s->p_idx;
  if p_event = 'arrive' then
    if st ? 'arrived_at' then raise exception 'already arrived'; end if;
    st := st || jsonb_build_object('arrived_at', now_t, 'arrived_ll', jsonb_build_array(p_lng, p_lat));
  elsif p_event = 'depart' then
    if not st ? 'arrived_at' then raise exception 'arrive first'; end if;
    if st->>'kind' = 'pickup' and p_idx = 0 and l.pin_hash is not null and (p_pin is null or l.pin_hash <> encode(extensions.digest('rr-pin:' || l.id::text || ':' || trim(p_pin), 'sha256'), 'hex')) then
      raise exception 'pickup PIN does not match — get the 4-digit PIN from the shipper'; end if;
    if st->>'kind' = 'drop' then
      if p_pod is null or coalesce(p_pod->>'name','') = '' or coalesce(p_pod->>'signature','') not like 'data:image/%' or coalesce(p_pod->>'photo','') not like 'data:image/%'
         or (p_pod->>'pieces') is null or (p_pod->>'pieces') !~ '^\d+$' then raise exception 'proof of delivery needs photo, signature, receiver name and piece count'; end if;
      st := st || jsonb_build_object('pod', p_pod - 'photo' - 'signature');
      insert into public.load_events (load_id, actor, kind, body, lat, lng) values (p_id, (select auth.uid()), 'doc', jsonb_build_object('type','pod','stop',p_idx,'name','POD stop ' || (p_idx + 1),'data',p_pod->>'photo','signature',p_pod->>'signature','receiver',p_pod->>'name','pieces',(p_pod->>'pieces')::int,'damage',p_pod->>'damage'), p_lat, p_lng);
    end if;
    st := st || jsonb_build_object('departed_at', now_t, 'departed_ll', jsonb_build_array(p_lng, p_lat));
  else raise exception 'event must be arrive or depart'; end if;
  s := jsonb_set(s, array[p_idx::text], st);
  update public.loads set stops = s, updated_at = now(),
    status = case when p_event = 'depart' and p_idx = n - 1 then 'delivered' else 'in_transit' end,
    stage = case when p_event = 'depart' and p_idx = n - 1 then 'delivered' when p_event = 'arrive' then 'at_stop_' || (p_idx + 1) else 'to_stop_' || (p_idx + 2) end,
    pod = case when p_event = 'depart' and st->>'kind' = 'drop' then st->'pod' else pod end
  where id = p_id returning * into l;
  insert into public.load_events (load_id, actor, kind, body, lat, lng) values (p_id, (select auth.uid()), 'stage', jsonb_build_object('stop', p_idx, 'event', p_event, 'kind', st->>'kind', 'stage', l.stage), p_lat, p_lng);
  return l;
end $$;
grant execute on function public.driver_stop_event(uuid, int, text, double precision, double precision, jsonb, text) to authenticated;
