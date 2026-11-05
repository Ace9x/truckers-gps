-- 025: guest votes on hazard pins (still there / gone). One vote per device per pin, no voting on your own pin, rate limits.
create table if not exists public.hazard_guest_owner (hazard_id text primary key references public.hazards(id) on delete cascade, device_hash text not null);
alter table public.hazard_guest_owner enable row level security; revoke all on public.hazard_guest_owner from anon, authenticated;
create table if not exists public.hazard_guest_votes (hazard_id text not null references public.hazards(id) on delete cascade, device_hash text not null, ip text not null, dir text not null check (dir in ('up','down')), at timestamptz not null default now(), primary key (hazard_id, device_hash));
create index if not exists hgv_dev on public.hazard_guest_votes (device_hash, at); create index if not exists hgv_ip on public.hazard_guest_votes (ip, at);
alter table public.hazard_guest_votes enable row level security; revoke all on public.hazard_guest_votes from anon, authenticated;

create or replace function public.guest_report_hazard(p_device text, p_type text, p_lat double precision, p_lng double precision, p_note text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare ttl int; v_ip text; h public.hazards; hdrs json;
begin
  if p_device is null or p_device !~ '^[A-Za-z0-9-]{8,64}$' then raise exception 'bad device'; end if;
  ttl := case p_type when 'police' then 4 when 'hazard' then 4 when 'ice' then 6 when 'wind' then 6 when 'chains' then 12
    when 'weigh_open' then 3 when 'weigh_closed' then 3 when 'parking_open' then 3 when 'parking_some' then 3 when 'parking_full' then 3
    when 'closed' then 24 when 'clearance' then 24 when 'notrucks' then 24 when 'weight' then 24 else null end;
  if ttl is null then raise exception 'bad type'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 or (p_lat = 0 and p_lng = 0) then raise exception 'bad location'; end if;
  begin hdrs := current_setting('request.headers', true)::json; exception when others then hdrs := null; end;
  v_ip := md5('rr-guest|' || coalesce(split_part(hdrs->>'x-forwarded-for', ',', 1), hdrs->>'cf-connecting-ip', 'none'));
  delete from public.hazard_guest_log where at < now() - interval '2 days';
  if (select count(*) from public.hazard_guest_log where device = p_device and at > now() - interval '1 hour') >= 5
     or (select count(*) from public.hazard_guest_log where ip = v_ip and at > now() - interval '1 hour') >= 15 then raise exception 'rate limited: try again later'; end if;
  if (select count(*) from public.hazard_guest_log where device = p_device and at > now() - interval '1 day') >= 20
     or (select count(*) from public.hazard_guest_log where ip = v_ip and at > now() - interval '1 day') >= 60 then raise exception 'rate limited: daily limit'; end if;
  -- dedupe: same type within ~150 m that is still active -> confirm it instead of making a new pin
  select * into h from public.hazards where type = p_type and status = 'active' and expires_at > now()
    and abs(lat - p_lat) * 111320 < 150 and abs(lng - p_lng) * 111320 * cos(radians(p_lat)) < 150 order by created_at desc limit 1;
  insert into public.hazard_guest_log(device, ip) values (p_device, v_ip);
  if h.id is not null and (exists (select 1 from public.hazard_guest_owner where hazard_id = h.id and device_hash = md5('rr-dev|' || p_device))
      or exists (select 1 from public.hazard_guest_votes where hazard_id = h.id and device_hash = md5('rr-dev|' || p_device))) then
    return json_build_object('id', h.id, 'dedup', true, 'expires_at', h.expires_at); end if; -- your own / already-voted pin: no self-confirm
  if h.id is not null then insert into public.hazard_guest_votes(hazard_id, device_hash, ip, dir) values (h.id, md5('rr-dev|' || p_device), v_ip, 'up') on conflict do nothing;
    update public.hazards set confirmations = confirmations + 1, expires_at = greatest(expires_at, now() + make_interval(hours => ttl)) where id = h.id returning * into h;
    return json_build_object('id', h.id, 'dedup', true, 'expires_at', h.expires_at); end if;
  insert into public.hazards(reporter, type, lat, lng, note, expires_at)
    values (null, p_type, round(p_lat::numeric, 5), round(p_lng::numeric, 5), nullif(left(regexp_replace(coalesce(p_note, ''), '[<>]', '', 'g'), 140), ''), now() + make_interval(hours => ttl)) returning * into h;
  insert into public.hazard_guest_owner(hazard_id, device_hash) values (h.id, md5('rr-dev|' || p_device)) on conflict do nothing;
  return json_build_object('id', h.id, 'dedup', false, 'expires_at', h.expires_at, 'created_at', h.created_at);
end $$;

create or replace function public.guest_vote_hazard(p_device text, p_hazard_id text, p_dir text)
returns json language plpgsql security definer set search_path = '' as $$
declare dh text; v_ip text; hdrs json; h public.hazards; downs int;
begin
  if p_device is null or p_device !~ '^[A-Za-z0-9-]{8,64}$' then raise exception 'bad device'; end if;
  if p_dir not in ('up', 'down') then raise exception 'bad vote'; end if;
  dh := md5('rr-dev|' || p_device);
  begin hdrs := current_setting('request.headers', true)::json; exception when others then hdrs := null; end;
  v_ip := md5('rr-guest|' || coalesce(split_part(hdrs->>'x-forwarded-for', ',', 1), hdrs->>'cf-connecting-ip', 'none'));
  select * into h from public.hazards where id = p_hazard_id and status = 'active' and expires_at > now();
  if h.id is null then raise exception 'pin not found or already gone'; end if;
  if exists (select 1 from public.hazard_guest_owner where hazard_id = h.id and device_hash = dh) then raise exception 'you cannot vote on your own pin'; end if;
  if exists (select 1 from public.hazard_guest_votes where hazard_id = h.id and device_hash = dh) then raise exception 'you already voted on this pin'; end if;
  delete from public.hazard_guest_votes where at < now() - interval '3 days';
  if (select count(*) from public.hazard_guest_votes where device_hash = dh and at > now() - interval '1 hour') >= 30
     or (select count(*) from public.hazard_guest_votes where ip = v_ip and at > now() - interval '1 hour') >= 90 then raise exception 'rate limited: try again later'; end if;
  insert into public.hazard_guest_votes(hazard_id, device_hash, ip, dir) values (h.id, dh, v_ip, p_dir);
  if p_dir = 'up' then
    -- still there: push expiry out 1 hour, never past 24 h after it was first reported
    update public.hazards set confirmations = confirmations + 1, expires_at = least(greatest(expires_at, now() + interval '1 hour'), created_at + interval '24 hours') where id = h.id returning * into h;
  else
    select count(*) into downs from public.hazard_guest_votes where hazard_id = h.id and dir = 'down';
    update public.hazards set dismissals = dismissals + 1, status = case when downs >= 2 then 'hidden' else status end where id = h.id returning * into h;
  end if;
  return json_build_object('up', h.confirmations, 'down', h.dismissals, 'hidden', h.status <> 'active', 'expires_at', h.expires_at);
end $$;
revoke all on function public.guest_vote_hazard(text, text, text) from public;
grant execute on function public.guest_vote_hazard(text, text, text) to anon, authenticated;
