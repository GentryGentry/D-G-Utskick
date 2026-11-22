-- "Slutprodukt" data model (docs/SLUTPRODUKT.md, "Gör redan nu"). Data model and access rules only, no new features.
-- Requires 0005 (board_viewer) to be committed first.

-- ---------------------------------------------------------------------------------------------
-- 1. Roles. board_viewer is a member but NOT staff. Until now every policy asked "is a member?",
--    which would silently give board_viewer all write rights. Writes now require staff.
-- ---------------------------------------------------------------------------------------------
create function private.is_staff(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
                 where m.tenant_id = t and m.user_id = auth.uid() and m.role in ('sender', 'dg_admin'))
$$;

create function private.assert_staff(t uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_staff(t) then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function private.can_send(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_staff(t) and private.is_aal2()
$$;

revoke all on function private.is_staff(uuid), private.assert_staff(uuid) from public, anon;
grant execute on function private.is_staff(uuid), private.assert_staff(uuid) to authenticated, service_role;

-- Policies: reading history stays "member" (board_viewer included). Everything else needs staff.
drop policy subscribers_select on public.subscribers;
create policy subscribers_select on public.subscribers for select to authenticated using (private.is_staff(tenant_id));

drop policy tags_select on public.tags; drop policy tags_insert on public.tags;
drop policy tags_update on public.tags; drop policy tags_delete on public.tags;
create policy tags_select on public.tags for select to authenticated using (private.is_staff(tenant_id));
create policy tags_insert on public.tags for insert to authenticated with check (private.is_staff(tenant_id));
create policy tags_update on public.tags for update to authenticated
  using (private.is_staff(tenant_id)) with check (private.is_staff(tenant_id));
create policy tags_delete on public.tags for delete to authenticated using (private.is_staff(tenant_id));

drop policy subscriber_tags_select on public.subscriber_tags; drop policy subscriber_tags_insert on public.subscriber_tags;
drop policy subscriber_tags_delete on public.subscriber_tags;
create policy subscriber_tags_select on public.subscriber_tags for select to authenticated using (private.is_staff(tenant_id));
create policy subscriber_tags_insert on public.subscriber_tags for insert to authenticated with check (private.is_staff(tenant_id));
create policy subscriber_tags_delete on public.subscriber_tags for delete to authenticated using (private.is_staff(tenant_id));

drop policy campaigns_insert on public.campaigns; drop policy campaigns_update on public.campaigns;
drop policy campaigns_delete on public.campaigns;
create policy campaigns_insert on public.campaigns for insert to authenticated
  with check (private.is_staff(tenant_id) and created_by = auth.uid());
create policy campaigns_update on public.campaigns for update to authenticated
  using (private.is_staff(tenant_id) and status = 'draft') with check (private.is_staff(tenant_id) and status = 'draft');
create policy campaigns_delete on public.campaigns for delete to authenticated
  using (private.is_staff(tenant_id) and status = 'draft');

drop policy suppressions_select on public.suppressions;
create policy suppressions_select on public.suppressions for select to authenticated using (private.is_staff(tenant_id));

-- ---------------------------------------------------------------------------------------------
-- 2. subscribers: apartment, source, confirmed_at.
--    `name` already exists as first_name (DECISIONS D-022), so no duplicate column is added.
-- ---------------------------------------------------------------------------------------------
alter table public.subscribers
  add column apartment text check (apartment is null or (char_length(apartment) between 1 and 20 and apartment !~ '[\r\n\t]')),
  add column source text not null default 'manual' check (source in ('import', 'form', 'manual')),
  add column confirmed_at timestamptz;  -- when the PERSON confirmed by link (double opt-in); null for import/manual
create index subscribers_tenant_apartment_idx on public.subscribers (tenant_id, apartment) where apartment is not null;

-- Apartment numbers are the key when someone moves out, so " lgh  a12 " and "LGH A12" must be the same value.
create or replace function private.subscribers_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.email := normalize(lower(btrim(new.email)), NFC);
  new.apartment := nullif(upper(regexp_replace(btrim(new.apartment), '\s+', ' ', 'g')), '');
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. campaigns: archive fields. Only a sent campaign can be public. Users cannot set these
--    (no column grants); a later function will, so the archive can change without touching the send log.
--    RULE FOR MILESTONE 3: campaigns.html / text_body hold the BODY ONLY. Footer and unsubscribe link
--    (which is per recipient) are added when each mail is rendered, never stored here.
-- ---------------------------------------------------------------------------------------------
alter table public.campaigns
  add column archive_visible boolean not null default false,
  add column archive_published_at timestamptz,
  add column slug text check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  add constraint campaigns_archive_consistent check
    (not archive_visible or (status = 'sent' and slug is not null and archive_published_at is not null));
create unique index campaigns_tenant_slug_key on public.campaigns (tenant_id, slug) where slug is not null;
comment on column public.campaigns.html is 'Body only. No footer, no unsubscribe link (see SLUTPRODUKT.md).';
comment on column public.campaigns.text_body is 'Body only. No footer, no unsubscribe link (see SLUTPRODUKT.md).';

-- ---------------------------------------------------------------------------------------------
-- 4. campaign_recipients.opened: a boolean and nothing else. It is per-person data, so it must never
--    be readable through the API: select is now granted per column and `opened` is left out.
-- ---------------------------------------------------------------------------------------------
alter table public.campaign_recipients add column opened boolean not null default false;
revoke select on public.campaign_recipients from authenticated;
grant select (id, tenant_id, campaign_id, subscriber_id, status, provider_message_id, attempts, claimed_at, updated_at)
  on public.campaign_recipients to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. subscription_requests: sign-up queue for the public form (F4).
--    Written only by the server (service role) and later by definer functions. Staff may read requests
--    that have been confirmed by the person; unconfirmed ones (anyone can type anyone's address) stay hidden.
-- ---------------------------------------------------------------------------------------------
create type public.subscription_request_status as enum ('pending_confirmation', 'pending_approval', 'approved', 'rejected');

create table public.subscription_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+$'),
  name text check (name is null or (char_length(name) <= 100 and name !~ '[\r\n]')),
  apartment text check (apartment is null or (char_length(apartment) between 1 and 20 and apartment !~ '[\r\n\t]')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),  -- SHA-256 of the link token; the token itself is never stored
  status public.subscription_request_status not null default 'pending_confirmation',
  confirmed_at timestamptz,  -- addition to the spec: the consent record (D-023)
  created_at timestamptz not null default now(),
  constraint subscription_requests_confirmed_consistent check ((status = 'pending_confirmation') = (confirmed_at is null))
);
create unique index subscription_requests_open_key on public.subscription_requests (tenant_id, email)
  where status in ('pending_confirmation', 'pending_approval');
create index on public.subscription_requests (tenant_id, status, created_at);

create function private.subscription_requests_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.email := normalize(lower(btrim(new.email)), NFC);
  new.name := nullif(btrim(new.name), '');
  new.apartment := nullif(upper(regexp_replace(btrim(new.apartment), '\s+', ' ', 'g')), '');
  return new;
end $$;
create trigger subscription_requests_before_write before insert or update on public.subscription_requests
  for each row execute function private.subscription_requests_before_write();

alter table public.subscription_requests enable row level security;
revoke all on public.subscription_requests from anon, authenticated;
grant all on public.subscription_requests to service_role;
grant select on public.subscription_requests to authenticated;
create policy subscription_requests_select on public.subscription_requests for select to authenticated
  using (private.is_staff(tenant_id) and status <> 'pending_confirmation');

-- ---------------------------------------------------------------------------------------------
-- 6. Functions from milestone 2 now require staff instead of any member (and import marks its source).
-- ---------------------------------------------------------------------------------------------
create or replace function public.add_subscriber(p_tenant uuid, p_email text, p_first_name text, p_email_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_email text := normalize(lower(btrim(p_email)), NFC);
begin
  perform private.assert_staff(p_tenant);
  if p_email_hash !~ '^[0-9a-f]{64}$' then raise exception 'bad_hash' using errcode = '22023'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+$' or char_length(v_email) > 254 then raise exception 'invalid_email' using errcode = '22023'; end if;
  if exists (select 1 from public.suppressions where tenant_id = p_tenant and email_hash = p_email_hash) then
    raise exception 'suppressed' using errcode = 'P0001';
  end if;
  begin
    insert into public.subscribers (tenant_id, email, first_name, email_hash)
    values (p_tenant, v_email, nullif(regexp_replace(left(btrim(p_first_name), 100), '[\r\n]+', ' ', 'g'), ''), p_email_hash)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'duplicate' using errcode = 'P0001';
  end;
  perform private.audit(p_tenant, 'subscriber.added', v_id::text);
  return v_id;
end $$;

create or replace function public.update_subscriber(p_id uuid, p_first_name text, p_email text, p_email_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_t uuid; v_status public.subscriber_status; v_old_hash text;
  v_email text := normalize(lower(btrim(p_email)), NFC);
begin
  select tenant_id, status, email_hash into v_t, v_status, v_old_hash from public.subscribers where id = p_id;
  -- Same error for "does not exist" and "not yours": no probing of other tenants' ids.
  if v_t is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.assert_staff(v_t);
  if p_email_hash !~ '^[0-9a-f]{64}$' then raise exception 'bad_hash' using errcode = '22023'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+$' or char_length(v_email) > 254 then raise exception 'invalid_email' using errcode = '22023'; end if;
  if p_email_hash <> v_old_hash then
    -- Changing the address of someone who opted out would launder their status onto a new address.
    if v_status not in ('active', 'inactive') then raise exception 'status_locked' using errcode = 'P0001'; end if;
    if exists (select 1 from public.suppressions where tenant_id = v_t and email_hash = p_email_hash) then
      raise exception 'suppressed' using errcode = 'P0001';
    end if;
  end if;
  begin
    update public.subscribers
       set email = v_email, email_hash = p_email_hash,
           first_name = nullif(regexp_replace(left(btrim(p_first_name), 100), '[\r\n]+', ' ', 'g'), '')
     where id = p_id;
  exception when unique_violation then
    raise exception 'duplicate' using errcode = 'P0001';
  end;
  perform private.audit(v_t, 'subscriber.updated', p_id::text);
end $$;

create or replace function public.set_subscriber_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t uuid; v_status public.subscriber_status;
begin
  select tenant_id, status into v_t, v_status from public.subscribers where id = p_id;
  if v_t is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.assert_staff(v_t);
  if v_status not in ('active', 'inactive') then raise exception 'status_locked' using errcode = 'P0001'; end if;
  update public.subscribers set status = case when p_active then 'active'::public.subscriber_status else 'inactive'::public.subscriber_status end where id = p_id;
  perform private.audit(v_t, case when p_active then 'subscriber.activated' else 'subscriber.deactivated' end, p_id::text);
end $$;

create or replace function public.delete_subscriber(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t uuid; v_hash text;
begin
  select tenant_id, email_hash into v_t, v_hash from public.subscribers where id = p_id;
  if v_t is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.assert_staff(v_t);
  insert into public.suppressions (tenant_id, email_hash, reason) values (v_t, v_hash, 'deleted') on conflict do nothing;
  delete from public.subscribers where id = p_id;
  perform private.audit(v_t, 'subscriber.deleted', p_id::text);
end $$;

create or replace function public.log_list_export(p_tenant uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_staff(p_tenant);
  perform private.audit(p_tenant, 'list.exported', null);
end $$;

create or replace function public.import_subscribers(p_tenant uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_total int; v_valid int; v_supp int; v_new int;
begin
  perform private.assert_admin(p_tenant);
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'rows_must_be_array' using errcode = '22023'; end if;
  v_total := jsonb_array_length(p_rows);
  if v_total > 5000 then raise exception 'too_many_rows' using errcode = '22023'; end if;

  drop table if exists pg_temp._imp;
  create temp table _imp on commit drop as
  select distinct on (h) email, first_name, h, tags from (
    select normalize(lower(btrim(r ->> 'email')), NFC) as email,
           nullif(regexp_replace(left(btrim(r ->> 'first_name'), 100), '[\r\n]+', ' ', 'g'), '') as first_name,
           r ->> 'hash' as h,
           case when jsonb_typeof(r -> 'tags') = 'array' then r -> 'tags' else '[]'::jsonb end as tags
      from jsonb_array_elements(p_rows) r
  ) x
  where email ~ '^[^@\s]+@[^@\s]+$' and char_length(email) <= 254 and h ~ '^[0-9a-f]{64}$'
  order by h;
  select count(*) into v_valid from pg_temp._imp;

  delete from pg_temp._imp i using public.suppressions s where s.tenant_id = p_tenant and s.email_hash = i.h;
  get diagnostics v_supp = row_count;

  with ins as (
    insert into public.subscribers (tenant_id, email, first_name, email_hash, source)
    select p_tenant, email, first_name, h, 'import' from pg_temp._imp
    on conflict do nothing returning 1
  ) select count(*) into v_new from ins;

  insert into public.tags (tenant_id, name)
  select distinct p_tenant, btrim(e.t) from pg_temp._imp i
    cross join lateral jsonb_array_elements_text(i.tags) with ordinality as e(t, ord)
   where e.ord <= 10 and char_length(btrim(e.t)) between 1 and 60
  on conflict do nothing;

  insert into public.subscriber_tags (tenant_id, subscriber_id, tag_id)
  select distinct p_tenant, s.id, tg.id from pg_temp._imp i
    cross join lateral jsonb_array_elements_text(i.tags) with ordinality as e(t, ord)
    join public.subscribers s on s.tenant_id = p_tenant and s.email_hash = i.h
    join public.tags tg on tg.tenant_id = p_tenant and tg.name = btrim(e.t)
   where e.ord <= 10
  on conflict do nothing;

  perform private.audit(p_tenant, 'subscribers.imported', format('inserted=%s suppressed=%s', v_new, v_supp));
  return jsonb_build_object('received', v_total, 'unique_valid', v_valid, 'suppressed', v_supp,
                            'inserted', v_new, 'existing', v_valid - v_supp - v_new);
end $$;

drop function private.assert_member(uuid);
