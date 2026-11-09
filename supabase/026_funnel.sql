-- Anonymous funnel counts. Inserts go through funnel_ping (random device id + event name only).
-- Reads go through funnel_stats, which only an admin can call.
create table if not exists public.funnel_events (
  device_id text not null,
  event text not null,
  day date not null default ((now() at time zone 'utc')::date),
  primary key (device_id, event),
  constraint funnel_events_event_chk check (event in ('wizard_done', 'first_trip', 'install', 'day7'))
);
alter table public.funnel_events enable row level security;
revoke all on table public.funnel_events from public, anon, authenticated;

create or replace function public.funnel_ping(p_id text, p_event text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_id is null or length(p_id) < 8 or length(p_id) > 80 then return; end if;
  if p_event not in ('wizard_done', 'first_trip', 'install', 'day7') then return; end if;
  insert into public.funnel_events(device_id, event, day)
  values (p_id, p_event, (now() at time zone 'utc')::date)
  on conflict do nothing;
end;
$$;

revoke all on function public.funnel_ping(text, text) from public;
grant execute on function public.funnel_ping(text, text) to anon, authenticated;

create or replace function public.funnel_stats()
returns table(event text, n bigint)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.is_rr_admin() then raise exception 'admin only'; end if;
  return query
    select e.event, count(*)::bigint
    from public.funnel_events e
    group by e.event
    order by e.event;
end;
$$;

revoke all on function public.funnel_stats() from public;
grant execute on function public.funnel_stats() to anon, authenticated;
