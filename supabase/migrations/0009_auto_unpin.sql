-- Auto-unpin when an entry is no longer active.
create or replace function public.memories_auto_unpin()
returns trigger
language plpgsql as $$
begin
  if new.status is distinct from 'active' then
    new.pinned := false;
  end if;
  return new;
end;
$$;

drop trigger if exists memories_auto_unpin_trg on public.memories;
create trigger memories_auto_unpin_trg
  before update on public.memories
  for each row
  execute function public.memories_auto_unpin();