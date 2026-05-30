-- AuditPro / Audit SaaS schema (Supabase Postgres)
-- Run this in Supabase SQL Editor.

create extension if not exists "pgcrypto";

-- Users
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password text not null,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  role text not null default 'user' check (role in ('user', 'admin')),
  audit_count integer not null default 0,
  -- JavaScript Date#getMonth() is 0-11, so store 0-11 here.
  audit_reset_month integer not null default ((extract(month from now())::int) - 1),
  email_verified boolean not null default false,
  email_verify_token text,
  email_verify_expires timestamptz,
  password_reset_token text,
  password_reset_expires timestamptz,
  created_at timestamptz not null default now()
);

-- Audits
create table if not exists public.audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  url text not null,
  seo_score integer,
  results jsonb,
  ai_insights text,
  created_at timestamptz not null default now()
);
-- For existing projects where `audits` already exists, ensure this column is present.
alter table public.audits add column if not exists ai_insights text;
create index if not exists audits_user_id_idx on public.audits(user_id);
create index if not exists audits_created_at_idx on public.audits(created_at desc);

-- Scheduled audits
create table if not exists public.scheduled_audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  url text not null,
  frequency text not null default 'weekly' check (frequency in ('daily', 'weekly', 'monthly')),
  is_active boolean not null default true,
  last_run timestamptz,
  next_run timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists scheduled_audits_user_id_idx on public.scheduled_audits(user_id);
create index if not exists scheduled_audits_next_run_idx on public.scheduled_audits(next_run);

-- API keys (for API v1 endpoints)
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  key_hash text not null unique,
  name text not null default 'Default',
  last_used timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists api_keys_user_id_idx on public.api_keys(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security (RLS)
--
-- The backend can enforce RLS by using the anon key plus a JWT that is signed
-- with your Supabase project's JWT secret and includes:
--   { sub: <user_uuid>, role: 'authenticated', aud: 'authenticated' }
--
-- When using SUPABASE_SERVICE_ROLE_KEY, RLS is bypassed (server-side only).
--
-- Enable RLS
alter table public.users enable row level security;
alter table public.audits enable row level security;
alter table public.scheduled_audits enable row level security;
alter table public.api_keys enable row level security;

-- Users: a user can read/update/delete only themselves
drop policy if exists "users_select_own" on public.users;
create policy "users_select_own" on public.users
for select
to authenticated
using (id = auth.uid());

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "users_delete_own" on public.users;
create policy "users_delete_own" on public.users
for delete
to authenticated
using (id = auth.uid());

-- Audits: a user can CRUD only their own rows
drop policy if exists "audits_select_own" on public.audits;
create policy "audits_select_own" on public.audits
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "audits_insert_own" on public.audits;
create policy "audits_insert_own" on public.audits
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "audits_update_own" on public.audits;
create policy "audits_update_own" on public.audits
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "audits_delete_own" on public.audits;
create policy "audits_delete_own" on public.audits
for delete
to authenticated
using (user_id = auth.uid());

-- Scheduled audits: a user can CRUD only their own rows
drop policy if exists "scheduled_select_own" on public.scheduled_audits;
create policy "scheduled_select_own" on public.scheduled_audits
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "scheduled_insert_own" on public.scheduled_audits;
create policy "scheduled_insert_own" on public.scheduled_audits
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "scheduled_update_own" on public.scheduled_audits;
create policy "scheduled_update_own" on public.scheduled_audits
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "scheduled_delete_own" on public.scheduled_audits;
create policy "scheduled_delete_own" on public.scheduled_audits
for delete
to authenticated
using (user_id = auth.uid());

-- API keys: a user can manage only their own keys
drop policy if exists "api_keys_select_own" on public.api_keys;
create policy "api_keys_select_own" on public.api_keys
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "api_keys_insert_own" on public.api_keys;
create policy "api_keys_insert_own" on public.api_keys
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "api_keys_update_own" on public.api_keys;
create policy "api_keys_update_own" on public.api_keys
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "api_keys_delete_own" on public.api_keys;
create policy "api_keys_delete_own" on public.api_keys
for delete
to authenticated
using (user_id = auth.uid());
