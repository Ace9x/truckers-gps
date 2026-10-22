-- Undo the driver's last arrive/depart within 60 s (fat-finger / false geofence). Deliveries (last drop departed) can't be undone by the driver.
create or replace function public.driver_stop_undo(p_id uuid) returns public.loads language plpgsql security definer set search_path = '' as $$
declare l public.loads; s jsonb; st jsonb; i int; n int; best int := null; bestk text; bestt timestamptz := null; t timestamptz;
begin
  select * into l from public.loads where id = p_id and driver = (select auth.uid()) for update;
  if not found then raise exception 'not your load'; end if;
  if l.status = 'delivered' then raise exception 'delivered loads can''t be undone — message dispatch'; end if;
  s := l.stops; n := jsonb_array_length(s);
  for i in 0 .. n - 1 loop
    if s->i ? 'departed_at' then t := (s->i->>'departed_at')::timestamptz; if bestt is null or t > bestt then bestt := t; best := i; bestk := 'departed'; end if; end if;
    if s->i ? 'arrived_at' then t := (s->i->>'arrived_at')::timestamptz; if bestt is null or t > bestt then bestt := t; best := i; bestk := 'arrived'; end if; end if;
  end loop;
  if best is null then raise exception 'nothing to undo'; end if;
  if bestt < now() - interval '60 seconds' then raise exception 'undo is only possible within 60 seconds'; end if;
  st := s->best; st := st - (bestk || '_at') - (bestk || '_ll'); if bestk = 'departed' then st := st - 'pod'; end if;
  s := jsonb_set(s, array[best::text], st);
  update public.loads set stops = s, updated_at = now(), stage = case when bestk = 'arrived' then (case when best = 0 then null else 'to_stop_' || (best + 1) end) else 'at_stop_' || (best + 1) end
  where id = p_id returning * into l;
  insert into public.load_events (load_id, actor, kind, body) values (p_id, (select auth.uid()), 'stage', jsonb_build_object('stop', best, 'event', 'undo_' || bestk, 'stage', l.stage));
  return l;
end $$;
revoke all on function public.driver_stop_undo(uuid) from public, anon; grant execute on function public.driver_stop_undo(uuid) to authenticated;
