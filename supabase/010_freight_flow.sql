-- RigRoute freight flow: multi-stop loads with per-stop arrive/depart timestamps, POD required to complete a drop,
-- detention, reefer temps, messages and documents as load_events, dispatcher address book.
alter table public.loads add column if not exists stops jsonb not null default '[]'::jsonb,
  add column if not exists stage text, add column if not exists reefer jsonb, add column if not exists pod jsonb,
  add column if not exists detention jsonb not null default '{"free_min":120,"rate_hr":50}'::jsonb;

create table if not exists public.load_events (
  id bigserial primary key, load_id uuid not null references public.loads on delete cascade,
  actor uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('stage','temp','message','doc','note')), body jsonb not null default '{}'::jsonb,
  lat double precision, lng double precision, t timestamptz not null default now(),
  constraint load_events_size check (pg_column_size(body) < 900000));
create index if not exists load_events_load_idx on public.load_events (load_id, t);
alter table public.load_events enable row level security;
create or replace function public.is_load_party(p_load uuid) returns boolean language sql stable security definer set search_path = '' as
  $$ select exists (select 1 from public.loads l where l.id = p_load and (select auth.uid()) in (l.dispatcher, l.driver)) $$;
create policy load_events_read on public.load_events for select to authenticated using (public.is_load_party(load_id));
create policy load_events_insert on public.load_events for insert to authenticated
  with check (actor = (select auth.uid()) and kind in ('temp','message','doc','note') and public.is_load_party(load_id));
alter publication supabase_realtime add table public.load_events;

create table if not exists public.address_book (
  id uuid primary key default gen_random_uuid(), owner uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(name) between 1 and 120), address text not null check (length(address) between 3 and 300),
  lat double precision, lng double precision, notes text check (length(notes) <= 1000), created_at timestamptz not null default now());
create index if not exists address_book_owner_idx on public.address_book (owner, name);
alter table public.address_book enable row level security;
create policy address_book_own on public.address_book for all to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

-- Accept/decline/start stay here; 'delivered' only via driver_stop_event (needs POD).
create or replace function public.driver_update_load(p_id uuid, p_status text) returns public.loads language plpgsql security definer set search_path = '' as $$
declare l public.loads;
begin
  select * into l from public.loads where id = p_id and driver = (select auth.uid());
  if not found then raise exception 'not your load'; end if;
  if not ((l.status = 'offered' and p_status in ('accepted','declined')) or (l.status = 'accepted' and p_status = 'in_transit')) then
    raise exception 'invalid transition % -> % (deliveries need proof of delivery)', l.status, p_status; end if;
  update public.loads set status = p_status, updated_at = now() where id = p_id returning * into l;
  return l;
end $$;

-- Driver arrives at / departs the next stop, in order. Departing a drop requires POD (photo, signature, receiver name, pieces).
create or replace function public.driver_stop_event(p_id uuid, p_idx int, p_event text, p_lat double precision default null, p_lng double precision default null, p_pod jsonb default null)
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
revoke all on function public.driver_stop_event(uuid,int,text,double precision,double precision,jsonb) from public, anon;
grant execute on function public.driver_stop_event(uuid,int,text,double precision,double precision,jsonb) to authenticated;
