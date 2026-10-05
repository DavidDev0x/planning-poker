-- Planning Poker — esquema do banco (Supabase / Postgres)
-- Cole este script em: Supabase → SQL Editor → New query → Run

create table if not exists public.rooms (
  id          text primary key,
  state       jsonb       not null,
  version     integer     not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists rooms_updated_at_idx on public.rooms (updated_at);

-- Segurança: RLS ativado e NENHUMA política pública.
-- O navegador (chave anon/publishable) não consegue ler nem gravar a tabela;
-- somente as funções da Vercel, usando a chave service_role/secret, têm acesso.
-- Isso garante que os votos fiquem ocultos até a revelação.
alter table public.rooms enable row level security;

revoke all on table public.rooms from anon, authenticated;

-- Opcional: limpeza de salas sem atividade há mais de 7 dias.
-- (A aplicação já faz essa limpeza automaticamente ao criar novas salas.)
create or replace function public.delete_stale_rooms()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rooms where updated_at < now() - interval '7 days';
$$;

revoke execute on function public.delete_stale_rooms() from anon, authenticated, public;
