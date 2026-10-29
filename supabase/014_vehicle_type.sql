-- Vehicle type required for a load (car / van / reefervan / box / semi); null = any.
alter table public.loads add column if not exists vehicle text check (vehicle in ('car','van','reefervan','box','semi'));
