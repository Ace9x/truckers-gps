-- Driver-reported truck parking (open / some / full, timestamped) and shared facility notes (gate code, entrance, overnight parking).
create table if not exists public.parking_reports (
  id bigserial primary key, poi text not null check (length(poi) <= 80), name text check (length(name) <= 160),
  lat double precision not null, lng double precision not null, status text not null check (status in ('open','some','full')),
  reporter uuid not null default auth.uid() references auth.users on delete cascade, t timestamptz not null default now());
create index if not exists parking_reports_poi_idx on public.parking_reports (poi, t desc);
alter table public.parking_reports enable row level security;
create policy parking_read on public.parking_reports for select to anon, authenticated using (true);
create or replace function public.report_parking(p_poi text, p_name text, p_lat double precision, p_lng double precision, p_status text) returns public.parking_reports
language plpgsql security definer set search_path = '' as $$
declare r public.parking_reports;
begin
  if (select auth.uid()) is null then raise exception 'sign in to report parking'; end if;
  if exists (select 1 from public.parking_reports where poi = p_poi and reporter = (select auth.uid()) and t > now() - interval '15 minutes') then raise exception 'you reported this lot in the last 15 minutes'; end if;
  if (select count(*) from public.parking_reports where reporter = (select auth.uid()) and t > now() - interval '1 hour') >= 12 then raise exception 'too many parking reports this hour'; end if;
  insert into public.parking_reports (poi, name, lat, lng, status) values (p_poi, left(p_name, 160), p_lat, p_lng, p_status) returning * into r; return r;
end $$;
revoke all on function public.report_parking(text,text,double precision,double precision,text) from public, anon;
grant execute on function public.report_parking(text,text,double precision,double precision,text) to authenticated;

create table if not exists public.facility_notes (
  key text not null check (length(key) <= 40), author uuid not null default auth.uid() references auth.users on delete cascade,
  name text check (length(name) <= 160), lat double precision, lng double precision,
  gate_code text check (length(gate_code) <= 40), entrance text check (length(entrance) <= 400), overnight text not null default 'unknown' check (overnight in ('yes','no','unknown')),
  notes text check (length(notes) <= 1000), updated_at timestamptz not null default now(), primary key (key, author));
alter table public.facility_notes enable row level security;
create policy facility_read on public.facility_notes for select to authenticated using (true);
create policy facility_write on public.facility_notes for all to authenticated using (author = (select auth.uid())) with check (author = (select auth.uid()));
create policy parking_delete_own on public.parking_reports for delete to authenticated using (reporter = (select auth.uid()));
