-- Live-game records are accessed only by the Penina server.
create table if not exists public.penina_live_records (
 path text primary key,
 payload text not null,
 topic text not null,
 expires_at timestamptz not null default (now() + interval '4 hours'),
 created_at timestamptz not null default now()
);
create index if not exists penina_live_path_prefix on public.penina_live_records(path text_pattern_ops);
create index if not exists penina_live_expiry on public.penina_live_records(expires_at);
alter table public.penina_live_records enable row level security;
revoke all on public.penina_live_records from anon, authenticated;
grant select, insert, delete on public.penina_live_records to service_role;
create or replace function public.penina_live_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 -- Only an empty refresh hint is public, never initials, answers, or keys.
 perform realtime.send('{}'::jsonb, 'changed', new.topic, false);
 return new;
end;
$$;
revoke all on function public.penina_live_notify() from public, anon, authenticated;
drop trigger if exists penina_live_notify_insert on public.penina_live_records;
create trigger penina_live_notify_insert after insert on public.penina_live_records
for each row execute function public.penina_live_notify();
