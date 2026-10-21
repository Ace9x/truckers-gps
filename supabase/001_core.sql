create extension if not exists pg_cron;

-- ===== profiles =====
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  role text not null default 'driver' check (role in ('driver','dispatcher','rider','admin')),
  display_name text, username text unique, avatar text, mood text,
  truck jsonb not null default '{}'::jsonb,          -- height_ft, weight_lb, length_ft, axles, hazmat ...
  points int not null default 0, stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.profiles enable row level security;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin') $$;
create or replace function public.my_role() returns text language sql stable security definer set search_path = '' as
$$ select role from public.profiles where id = (select auth.uid()) $$;
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()) and role in ('driver','dispatcher','rider'));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and (role = (select public.my_role()) or (select public.is_admin())));
-- auto-create profile on signup (role from signup metadata, never admin)
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)),
          case when new.raw_user_meta_data->>'role' in ('driver','dispatcher','rider') then new.raw_user_meta_data->>'role' else 'driver' end)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ===== hazards + moderation =====
create table public.hazards (
  id text primary key default gen_random_uuid()::text,
  reporter uuid references auth.users on delete set null default auth.uid(),
  type text not null check (char_length(type) <= 40),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  note text check (char_length(note) <= 500),
  poi text, price numeric(6,3), key text, val boolean,
  confirmations int not null default 0, dismissals int not null default 0, abuse_reports int not null default 0,
  status text not null default 'active' check (status in ('active','hidden','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours');
create index hazards_geo_idx on public.hazards (lat, lng) where status = 'active';
create index hazards_expires_idx on public.hazards (expires_at);
create index hazards_reporter_idx on public.hazards (reporter);
alter table public.hazards enable row level security;
create policy hazards_read on public.hazards for select to anon, authenticated using (status = 'active' and expires_at > now());
create policy hazards_read_own on public.hazards for select to authenticated using (reporter = (select auth.uid()) or (select public.is_admin()));
create policy hazards_insert on public.hazards for insert to authenticated
  with check (reporter = (select auth.uid()) and status = 'active' and confirmations = 0 and dismissals = 0 and abuse_reports = 0
              and expires_at <= now() + interval '7 days');
create policy hazards_delete on public.hazards for delete to authenticated using (reporter = (select auth.uid()) or (select public.is_admin()));
create policy hazards_admin_update on public.hazards for update to authenticated using ((select public.is_admin()));

create table public.hazard_votes (
  hazard_id text references public.hazards on delete cascade, user_id uuid references auth.users on delete cascade default auth.uid(),
  dir text not null check (dir in ('up','down')), created_at timestamptz not null default now(), primary key (hazard_id, user_id));
create index hazard_votes_user_idx on public.hazard_votes (user_id);
alter table public.hazard_votes enable row level security;
create policy hv_own_read on public.hazard_votes for select to authenticated using (user_id = (select auth.uid()));

create table public.hazard_abuse_reports (
  hazard_id text references public.hazards on delete cascade, user_id uuid references auth.users on delete cascade default auth.uid(),
  reason text check (char_length(reason) <= 300), created_at timestamptz not null default now(), primary key (hazard_id, user_id));
create index har_user_idx on public.hazard_abuse_reports (user_id);
alter table public.hazard_abuse_reports enable row level security;
create policy har_read on public.hazard_abuse_reports for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

create table public.point_events (id bigserial primary key, user_id uuid references auth.users on delete cascade default auth.uid(),
  pts int not null check (pts between -100 and 100), why text, created_at timestamptz not null default now());
create index point_events_user_idx on public.point_events (user_id, created_at);
alter table public.point_events enable row level security;
create policy pe_read on public.point_events for select to authenticated using (true);
create policy pe_insert on public.point_events for insert to authenticated with check (user_id = (select auth.uid()) and pts between 0 and 50);
create view public.weekly_points with (security_invoker = on) as
  select to_char(date_trunc('week', e.created_at), 'YYYY-MM-DD') as week, coalesce(p.display_name,'Driver') as name, sum(e.pts)::int as points
  from public.point_events e join public.profiles p on p.id = e.user_id group by 1, 2;

-- confirm / dismiss: confirmations extend life, 3+ net dismissals hide it
create or replace function public.vote_hazard(p_hazard_id text, p_dir text) returns public.hazards language plpgsql security definer set search_path = '' as $$
declare h public.hazards;
begin
  if (select auth.uid()) is null then raise exception 'sign in required'; end if;
  if p_dir not in ('up','down') then raise exception 'bad dir'; end if;
  select * into h from public.hazards where id = p_hazard_id and status = 'active' and expires_at > now();
  if not found then raise exception 'hazard not found'; end if;
  if h.reporter = (select auth.uid()) then return h; end if;
  insert into public.hazard_votes (hazard_id, user_id, dir) values (p_hazard_id, (select auth.uid()), p_dir)
    on conflict (hazard_id, user_id) do update set dir = excluded.dir, created_at = now();
  update public.hazards set
    confirmations = (select count(*) from public.hazard_votes v where v.hazard_id = p_hazard_id and v.dir = 'up'),
    dismissals    = (select count(*) from public.hazard_votes v where v.hazard_id = p_hazard_id and v.dir = 'down'),
    expires_at = case when p_dir = 'up' then least(greatest(expires_at, now() + interval '1 hour'), created_at + interval '24 hours') else expires_at end
  where id = p_hazard_id returning * into h;
  if h.dismissals >= 3 and h.dismissals > h.confirmations then update public.hazards set status = 'hidden' where id = p_hazard_id returning * into h; end if;
  if p_dir = 'up' and h.reporter is not null then insert into public.point_events (user_id, pts, why) values (h.reporter, 15, 'report confirmed'); end if;
  return h;
end $$;
create or replace function public.report_hazard_abuse(p_hazard_id text, p_reason text default null) returns void language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if (select auth.uid()) is null then raise exception 'sign in required'; end if;
  insert into public.hazard_abuse_reports (hazard_id, user_id, reason) values (p_hazard_id, (select auth.uid()), left(p_reason, 300)) on conflict do nothing;
  select count(*) into n from public.hazard_abuse_reports where hazard_id = p_hazard_id;
  update public.hazards set abuse_reports = n, status = case when n >= 3 then 'hidden' else status end where id = p_hazard_id;
end $$;
-- rate limit: max 20 hazards per user per hour
create or replace function public.hazard_rate_limit() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.hazards where reporter = new.reporter and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too many reports, try again later'; end if;
  return new;
end $$;
create trigger hazards_rate_limit before insert on public.hazards for each row execute function public.hazard_rate_limit();
