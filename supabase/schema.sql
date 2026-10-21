-- Supabase schema for TruckNav accounts, community reports, points. Run in SQL editor, then put url + anon key in js/config.js.
create table if not exists profiles (id uuid primary key references auth.users on delete cascade, name text, avatar text, mood text, points int default 0, stats jsonb default '{}', updated_at timestamptz default now());
create table if not exists reports (id text primary key, user_id uuid references auth.users default auth.uid(), type text not null, lat double precision not null, lon double precision not null, note text, t timestamptz default now(), up int default 0, down int default 0);
create table if not exists report_votes (report_id text references reports on delete cascade, user_id uuid default auth.uid(), dir text check (dir in ('up','down')), primary key (report_id, user_id));
create table if not exists point_events (id bigserial primary key, user_id uuid default auth.uid(), pts int, why text, t timestamptz default now());
create or replace view weekly_points as select to_char(date_trunc('week', e.t), 'YYYY-MM-DD') as week, p.name, sum(e.pts)::int as points from point_events e join profiles p on p.id = e.user_id group by 1, 2;
alter table profiles enable row level security; alter table reports enable row level security; alter table report_votes enable row level security; alter table point_events enable row level security;
create policy "read profiles" on profiles for select using (true); create policy "own profile" on profiles for all using (auth.uid() = id);
create policy "read reports" on reports for select using (true); create policy "add reports" on reports for insert with check (auth.uid() = user_id);
create policy "own votes" on report_votes for all using (auth.uid() = user_id); create policy "own points" on point_events for insert with check (auth.uid() = user_id);
create or replace function vote_report(report_id text, dir text) returns void language plpgsql security definer as $$
begin
  if exists (select 1 from reports r where r.id = report_id and r.user_id = auth.uid()) then return; end if; -- can't confirm your own report
  insert into report_votes values (report_id, auth.uid(), dir) on conflict (report_id, user_id) do update set dir = excluded.dir;
  update reports set up = (select count(*) from report_votes v where v.report_id = reports.id and v.dir = 'up'), down = (select count(*) from report_votes v where v.report_id = reports.id and v.dir = 'down') where id = report_id;
  if dir = 'up' then insert into point_events (user_id, pts, why) select user_id, 15, 'report confirmed' from reports where id = report_id; end if;
end $$;

-- v2.3: driver fuel prices + amenity confirmations ride on reports
alter table reports add column if not exists poi text, add column if not exists price numeric(6,3), add column if not exists key text, add column if not exists val boolean;
