drop policy if exists fleets_delete on public.fleets; create policy fleets_delete on public.fleets for delete to authenticated using (owner = (select auth.uid()));
