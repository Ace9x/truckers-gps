-- Guest (no-account) shared hazards through one sanitized RPC. No anon insert/update/delete on public.hazards itself.
create table if not exists public.hazard_guest_log (device text not null, ip text not null, at timestamptz not null default now());
create index if not exists hgl_dev on public.hazard_guest_log (device, at); create index if not exists hgl_ip on public.hazard_guest_log (ip, at);
alter table public.hazard_guest_log enable row level security; -- no policies: only the definer function touches it
revoke all on public.hazard_guest_log from anon, authenticated;

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
  if found then update public.hazards set confirmations = confirmations + 1, expires_at = greatest(expires_at, now() + make_interval(hours => ttl)) where id = h.id returning * into h;
    return json_build_object('id', h.id, 'dedup', true, 'expires_at', h.expires_at); end if;
  insert into public.hazards(reporter, type, lat, lng, note, expires_at)
    values (null, p_type, round(p_lat::numeric, 5), round(p_lng::numeric, 5), nullif(left(regexp_replace(coalesce(p_note, ''), '[<>]', '', 'g'), 140), ''), now() + make_interval(hours => ttl)) returning * into h;
  return json_build_object('id', h.id, 'dedup', false, 'expires_at', h.expires_at, 'created_at', h.created_at);
end $$;
revoke all on function public.guest_report_hazard(text, text, double precision, double precision, text) from public;
grant execute on function public.guest_report_hazard(text, text, double precision, double precision, text) to anon, authenticated;

-- ask-rigroute: check the limit first, count only successful AI answers
create or replace function public.ai_left(p_id text, p_max int default 20) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select n from public.ai_usage where device_id = p_id and day = (now() at time zone 'utc')::date), 0) < p_max $$;
revoke all on function public.ai_left(text, int) from public, anon, authenticated;
