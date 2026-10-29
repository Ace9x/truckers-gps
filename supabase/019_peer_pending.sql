-- 019: friend-request names: peer_profiles also covers pending (not blocked) friendships
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
    or exists (select 1 from public.friendships f where f.status <> 'blocked'
               and ((f.requester = (select auth.uid()) and f.addressee = p.id) or (f.addressee = (select auth.uid()) and f.requester = p.id))))
  limit 500 $$;
