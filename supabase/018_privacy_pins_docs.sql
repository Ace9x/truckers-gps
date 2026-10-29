-- 018: profiles privacy, fleet-shared pickup PINs, per-load document storage
-- 1) profiles: own row only (admins all). Others get minimal fields via peer_profiles().
drop policy if exists profiles_read on public.profiles;
create policy profiles_read_own on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create or replace function public.peer_profiles(p_ids uuid[])
returns table (id uuid, display_name text, username text, vehicle text, unit text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.username, p.truck->>'vehicle',
         (select m.unit from public.fleet_members m join public.fleet_members me on me.fleet = m.fleet
            where m.user_id = p.id and me.user_id = (select auth.uid()) limit 1)
  from public.profiles p
  where p.id = any(p_ids) and (select auth.uid()) is not null and (
       p.id = (select auth.uid())
    or exists (select 1 from public.fleet_members a join public.fleet_members b on a.fleet = b.fleet
               where a.user_id = (select auth.uid()) and b.user_id = p.id)
    or exists (select 1 from public.loads l where (l.dispatcher = (select auth.uid()) and l.driver = p.id)
                                             or (l.driver = (select auth.uid()) and l.dispatcher = p.id))
    or public.are_friends((select auth.uid()), p.id))
  limit 500 $$;
revoke all on function public.peer_profiles(uuid[]) from public, anon;
grant execute on function public.peer_profiles(uuid[]) to authenticated;

-- 2) pickup PINs readable by the load's dispatcher and fleet staff only (never the driver row)
create table if not exists public.load_pins (
  load_id uuid primary key references public.loads on delete cascade,
  pin text not null check (pin ~ '^[0-9]{4,6}$'),
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now());
alter table public.load_pins enable row level security;
create or replace function public.is_load_staff(p_load uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.loads l where l.id = p_load and
    (l.dispatcher = (select auth.uid()) or (l.fleet is not null and public.is_fleet_staff(l.fleet)))) $$;
create policy lp_read on public.load_pins for select to authenticated using (public.is_load_staff(load_id));
create policy lp_write on public.load_pins for insert to authenticated with check (public.is_load_staff(load_id) and created_by = (select auth.uid()));
create policy lp_update on public.load_pins for update to authenticated using (public.is_load_staff(load_id)) with check (public.is_load_staff(load_id));
create policy lp_delete on public.load_pins for delete to authenticated using (public.is_load_staff(load_id));

-- 3) per-load documents: private bucket, path <load_id>/<kind>-<ts>.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('load-docs', 'load-docs', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create or replace function public.load_doc_party(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v uuid; begin
  begin v := (split_part(p_name, '/', 1))::uuid; exception when others then return false; end;
  return public.is_load_party(v); end $$;
create or replace function public.load_doc_staff(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v uuid; begin
  begin v := (split_part(p_name, '/', 1))::uuid; exception when others then return false; end;
  return public.is_load_staff(v); end $$;
create policy ld_read on storage.objects for select to authenticated using (bucket_id = 'load-docs' and public.load_doc_party(name));
create policy ld_insert on storage.objects for insert to authenticated with check (bucket_id = 'load-docs' and public.load_doc_party(name)
  and split_part(name, '/', 2) ~ '^(bol|ratecon|pod|other)-[0-9]+\.(pdf|jpg|jpeg|png|webp)$');
create policy ld_delete on storage.objects for delete to authenticated using (bucket_id = 'load-docs' and public.load_doc_staff(name));
