-- D&G Utskick: schema. All tables live in public; helpers live in private.
create extension if not exists pgcrypto;
create schema if not exists private;

create type public.member_role as enum ('dg_admin', 'sender');
create type public.subscriber_status as enum ('active', 'unsubscribed', 'bounced', 'complained');
create type public.campaign_status as enum ('draft', 'queued', 'sending', 'sent', 'cancelled', 'failed');
-- 'sending' and 'unknown' are additions to the original model, see DECISIONS D-002.
create type public.recipient_status as enum
  ('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'unknown');

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}$'),
  sender_name text not null check (char_length(sender_name) between 1 and 120 and sender_name !~ '[\r\n]'),
  reply_to text not null check (reply_to ~ '^[^@\s]+@[^@\s]+$'),
  footer_text text not null default '',
  daily_send_limit integer not null default 100 check (daily_send_limit >= 0),
  retention_days integer not null default 30 check (retention_days between 1 and 365),
  created_at timestamptz not null default now()
);

create table public.memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  role public.member_role not null,
  primary key (user_id, tenant_id)
);
create index on public.memberships (tenant_id);

create table public.subscribers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+$'),
  first_name text check (first_name is null or (char_length(first_name) <= 100 and first_name !~ '[\r\n]')),
  status public.subscriber_status not null default 'active',
  created_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  unique (id, tenant_id)
);
create unique index subscribers_tenant_email_key on public.subscribers (tenant_id, email);

-- Normalise e-mail on write. Must match src/lib/email.ts (trim, lowercase, NFC).
create function private.subscribers_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.email := normalize(lower(btrim(new.email)), NFC);
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end $$;
create trigger subscribers_before_write before insert or update on public.subscribers
  for each row execute function private.subscribers_before_write();

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  unique (tenant_id, name),
  unique (id, tenant_id)
);

-- Composite FKs: a link row can never join a subscriber and a tag from different tenants.
create table public.subscriber_tags (
  tenant_id uuid not null,
  subscriber_id uuid not null,
  tag_id uuid not null,
  primary key (subscriber_id, tag_id),
  foreign key (subscriber_id, tenant_id) references public.subscribers (id, tenant_id) on delete cascade,
  foreign key (tag_id, tenant_id) references public.tags (id, tenant_id) on delete cascade
);
create index on public.subscriber_tags (tenant_id);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  subject text not null default '' check (char_length(subject) <= 200 and subject !~ '[\r\n]'),
  body_json jsonb not null default '{}'::jsonb,
  html text,
  text_body text,
  status public.campaign_status not null default 'draft',
  idempotency_key uuid not null default gen_random_uuid(),
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  recipient_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (tenant_id, idempotency_key)
);
create index on public.campaigns (tenant_id, created_at desc);

create table public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  campaign_id uuid not null,
  subscriber_id uuid,
  status public.recipient_status not null default 'queued',
  provider_message_id text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (campaign_id, tenant_id) references public.campaigns (id, tenant_id) on delete cascade,
  -- History survives hard deletion of a subscriber without pointing at a person (PG15+ column list).
  foreign key (subscriber_id, tenant_id) references public.subscribers (id, tenant_id) on delete set null (subscriber_id),
  unique (campaign_id, subscriber_id)
);
create index on public.campaign_recipients (tenant_id);
create index on public.campaign_recipients (campaign_id, status);
create index on public.campaign_recipients (provider_message_id);

create table public.suppressions (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email_hash text not null,  -- HMAC-SHA256 hex, see DECISIONS D-004
  reason text not null check (reason in ('unsubscribed', 'bounced', 'complained', 'deleted', 'manual')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, email_hash)
);

create table public.provider_events (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants (id) on delete cascade,  -- null until mapped
  provider text not null,
  raw_payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid,
  action text not null,
  target text,
  created_at timestamptz not null default now()
);
create index on public.audit_log (tenant_id, created_at desc);
