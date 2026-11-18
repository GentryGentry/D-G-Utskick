-- Milestone 2: address list management. All writes to subscribers go through the functions below,
-- so consent rules (suppression, locked statuses) cannot be bypassed with direct API calls.

do $$ begin
  if exists (select 1 from public.subscribers) then
    raise exception 'public.subscribers already has rows without email_hash. This is a dev-only database: run "truncate public.tenants cascade;" and seed again, then re-run this migration.';
  end if;
end $$;

-- email_hash = HMAC computed by the application (key never reaches the database), see DECISIONS D-004/D-016.
alter table public.subscribers add column email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$');
create unique index subscribers_tenant_hash_key on public.subscribers (tenant_id, email_hash);

-- No direct writes to subscribers any more (select stays, protected by RLS).
revoke insert, update, delete on public.subscribers from authenticated;
drop policy subscribers_insert on public.subscribers;
drop policy subscribers_update on public.subscribers;
drop policy subscribers_delete on public.subscribers;

create function private.audit(t uuid, a text, tgt text default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (tenant_id, user_id, action, target) values (t, auth.uid(), a, tgt)
$$;

create function private.assert_member(t uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_member(t) then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create function private.assert_admin(t uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role(t, 'dg_admin') then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
create function public.add_subscriber(p_tenant uuid, p_email text, p_first_name text, p_email_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_email text := normalize(lower(btrim(p_email)), NFC);
begin
  perform private.assert_member(p_tenant);
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

create function public.update_subscriber(p_id uuid, p_first_name text, p_email text, p_email_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_t uuid; v_status public.subscriber_status; v_old_hash text;
  v_email text := normalize(lower(btrim(p_email)), NFC);
begin
  select tenant_id, status, email_hash into v_t, v_status, v_old_hash from public.subscribers where id = p_id;
  -- Same error for "does not exist" and "not yours": no probing of other tenants' ids.
  if v_t is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.assert_member(v_t);
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

-- Users may only toggle active <-> inactive. Opt-outs, bounces and complaints are never reversible by a user.
create function public.set_subscriber_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t uuid; v_status public.subscriber_status;
begin
  select tenant_id, status into v_t, v_status from public.subscribers where id = p_id;
  if v_t is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.assert_member(v_t);
  if v_status not in ('active', 'inactive') then raise exception 'status_locked' using errcode = 'P0001'; end if;
  update public.subscribers set status = case when p_active then 'active'::public.subscriber_status else 'inactive'::public.subscriber_status end where id = p_id;
  perform private.audit(v_t, case when p_active then 'subscriber.activated' else 'subscriber.deactivated' end, p_id::text);
end $$;

-- "Ta bort adress": hard delete, but remember the opt-out hash so a later import cannot re-add the person.
create function public.delete_subscriber(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t uuid; v_hash text;
begin
  select tenant_id, email_hash into v_t, v_hash from public.subscribers where id = p_id;
  if v_t is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.assert_member(v_t);
  insert into public.suppressions (tenant_id, email_hash, reason) values (v_t, v_hash, 'deleted') on conflict do nothing;
  delete from public.subscribers where id = p_id;
  perform private.audit(v_t, 'subscriber.deleted', p_id::text);
end $$;

-- "Radera helt på begäran": D&G only. Removes the person AND every trace of the hash. No hash is kept.
create function public.erase_person(p_tenant uuid, p_email text, p_email_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := normalize(lower(btrim(p_email)), NFC);
  n_sub int; n_sup int; n_ev int;
begin
  perform private.assert_admin(p_tenant);
  if p_email_hash !~ '^[0-9a-f]{64}$' then raise exception 'bad_hash' using errcode = '22023'; end if;
  delete from public.subscribers where tenant_id = p_tenant and (email = v_email or email_hash = p_email_hash);
  get diagnostics n_sub = row_count;
  delete from public.suppressions where tenant_id = p_tenant and email_hash = p_email_hash;
  get diagnostics n_sup = row_count;
  delete from public.provider_events where tenant_id = p_tenant and raw_payload::text ilike '%' || v_email || '%';
  get diagnostics n_ev = row_count;
  perform private.audit(p_tenant, 'person.erased', null);  -- deliberately no identifier
  return jsonb_build_object('subscribers', n_sub, 'suppressions', n_sup, 'events', n_ev);
end $$;

create function public.import_preview(p_tenant uuid, p_hashes text[])
returns table (h text, kind text) language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin(p_tenant);
  if coalesce(array_length(p_hashes, 1), 0) > 5000 then raise exception 'too_many_rows' using errcode = '22023'; end if;
  return query
    select s.email_hash, 'suppressed'::text from public.suppressions s where s.tenant_id = p_tenant and s.email_hash = any (p_hashes)
    union all
    select s.email_hash, 'existing'::text from public.subscribers s where s.tenant_id = p_tenant and s.email_hash = any (p_hashes);
end $$;

-- Rows: [{email, first_name, tags: [..], hash}]. Never reactivates anyone: existing rows keep their status.
-- Tags are added to existing, non-suppressed addresses too.
create function public.import_subscribers(p_tenant uuid, p_rows jsonb)
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
    insert into public.subscribers (tenant_id, email, first_name, email_hash)
    select p_tenant, email, first_name, h from pg_temp._imp
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

create function public.log_list_export(p_tenant uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_member(p_tenant);
  perform private.audit(p_tenant, 'list.exported', null);
end $$;

-- Execute rights: nobody by default (Supabase grants to anon on new functions), then authenticated only.
revoke all on function
  public.add_subscriber(uuid, text, text, text), public.update_subscriber(uuid, text, text, text),
  public.set_subscriber_active(uuid, boolean), public.delete_subscriber(uuid),
  public.erase_person(uuid, text, text), public.import_preview(uuid, text[]),
  public.import_subscribers(uuid, jsonb), public.log_list_export(uuid),
  private.audit(uuid, text, text), private.assert_member(uuid), private.assert_admin(uuid)
  from public, anon, authenticated;
grant execute on function
  public.add_subscriber(uuid, text, text, text), public.update_subscriber(uuid, text, text, text),
  public.set_subscriber_active(uuid, boolean), public.delete_subscriber(uuid),
  public.erase_person(uuid, text, text), public.import_preview(uuid, text[]),
  public.import_subscribers(uuid, jsonb), public.log_list_export(uuid)
  to authenticated, service_role;
grant execute on function private.audit(uuid, text, text), private.assert_member(uuid), private.assert_admin(uuid)
  to authenticated, service_role;
