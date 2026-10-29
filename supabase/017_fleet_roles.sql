-- owner-operators drive and dispatch: fleet staff rights come from fleet_members, not profiles.role
create or replace function public.create_fleet(p_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare f uuid; begin
  if (select auth.uid()) is null then raise exception 'sign in first'; end if;
  if (select count(*) from public.fleets where owner = (select auth.uid())) >= 3 then raise exception 'max 3 fleets per owner'; end if;
  insert into public.fleets(name, owner) values (trim(p_name), (select auth.uid())) returning id into f;
  insert into public.fleet_members(fleet, user_id, role) values (f, (select auth.uid()), 'owner');
  return f; end $$;

create or replace function public.join_fleet(p_code text, p_unit text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.fleet_invites; begin
  if (select auth.uid()) is null then raise exception 'sign in first'; end if;
  select * into i from public.fleet_invites where code = upper(trim(p_code)) for update;
  if i.code is null or i.used_by is not null or i.expires_at < now() then raise exception 'invite code invalid or expired'; end if;
  insert into public.fleet_members(fleet, user_id, role, unit) values (i.fleet, (select auth.uid()), i.role, nullif(trim(p_unit), '')) on conflict (fleet, user_id) do update set role = excluded.role, unit = coalesce(excluded.unit, public.fleet_members.unit);
  update public.fleet_invites set used_by = (select auth.uid()), used_at = now() where code = i.code;
  return jsonb_build_object('fleet', i.fleet, 'role', i.role, 'name', (select name from public.fleets where id = i.fleet)); end $$;

drop policy if exists loads_fleet_insert on public.loads; create policy loads_fleet_insert on public.loads for insert to authenticated with check (dispatcher = (select auth.uid()) and status = 'offered' and fleet is not null and public.is_fleet_staff(fleet));
