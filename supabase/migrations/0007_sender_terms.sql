-- D-031: a sender (utskickare) must accept a one-sentence condition before the address list can be used,
-- and again whenever the text changes. dg_admin is not affected. board_viewer cannot write anyway.
--
-- Both tables are closed to the API (RLS on, no grants, no policies). Everything goes through the
-- SECURITY DEFINER functions below, the same pattern as subscribers (D-017). D&G reads the
-- acceptances in the Supabase Table Editor.

-- ---------------------------------------------------------------------------------------------
-- 1. The texts. One row per version. A text is never edited: a new wording is a new version,
--    so it is always possible to show exactly which words someone accepted.
-- ---------------------------------------------------------------------------------------------
create table public.sender_terms (
  version integer primary key check (version > 0),
  body text not null check (char_length(body) between 10 and 2000),
  created_at timestamptz not null default now()
);

insert into public.sender_terms (version, body) values (1,
  'Jag lägger bara in e-postadresser som den boende själv har lämnat till föreningen för att få föreningens utskick. '
  'Jag lägger inte in adresser från andra listor eller register, och inte grannars adresser som de inte själva har lämnat.');

create function private.sender_terms_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'sender_terms is append-only: add a new version instead of changing or removing one';
end $$;
create trigger sender_terms_no_update before update or delete on public.sender_terms
  for each row execute function private.sender_terms_immutable();

-- ---------------------------------------------------------------------------------------------
-- 2. Who accepted what, when. user_id has no foreign key on purpose (like audit_log): the record
--    must survive if the account is later deleted. Append-only, same trigger as audit_log.
-- ---------------------------------------------------------------------------------------------
create table public.terms_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  terms_version integer not null references public.sender_terms (version),
  accepted_at timestamptz not null default now(),
  unique (user_id, tenant_id, terms_version)
);
create trigger terms_acceptances_no_update before update or delete on public.terms_acceptances
  for each row execute function private.audit_log_immutable();

alter table public.sender_terms enable row level security;
alter table public.terms_acceptances enable row level security;
revoke all on public.sender_terms, public.terms_acceptances from anon, authenticated;
grant all on public.sender_terms, public.terms_acceptances to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. The gate.
-- ---------------------------------------------------------------------------------------------
create function private.current_terms_version() returns integer
language sql stable security definer set search_path = '' as $$
  select max(version) from public.sender_terms
$$;

-- True when the caller may put addresses into tenant t as far as the terms are concerned:
-- dg_admin always; anyone else only with an acceptance of the CURRENT version for THIS tenant.
create function private.terms_ok(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role(t, 'dg_admin')
      or private.current_terms_version() is null
      or exists (select 1 from public.terms_acceptances a
                  where a.user_id = auth.uid() and a.tenant_id = t
                    and a.terms_version = private.current_terms_version())
$$;

create function private.assert_terms(t uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.terms_ok(t) then raise exception 'terms_not_accepted' using errcode = 'P0001'; end if;
end $$;

-- What the app needs to decide whether to show the terms page.
create function public.sender_terms_status(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v int := private.current_terms_version();
begin
  if not private.is_member(p_tenant) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'version', v,
    'body', (select body from public.sender_terms where version = v),
    'needs_acceptance', private.is_staff(p_tenant) and not private.terms_ok(p_tenant));
end $$;

-- p_version is the version the user was shown. If the text changed in between, the click does not count.
-- Requires a completed two-step login, so the record proves it was the account holder.
create function public.accept_sender_terms(p_tenant uuid, p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_staff(p_tenant);
  if not private.is_aal2() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_version is distinct from private.current_terms_version() then
    raise exception 'terms_outdated' using errcode = 'P0001';
  end if;
  if private.has_role(p_tenant, 'dg_admin') then return; end if;  -- admin is not asked; nothing to record
  insert into public.terms_acceptances (user_id, tenant_id, terms_version)
  values (auth.uid(), p_tenant, p_version) on conflict do nothing;
  perform private.audit(p_tenant, 'terms.accepted', 'v' || p_version);
end $$;

revoke all on function private.current_terms_version(), private.terms_ok(uuid), private.assert_terms(uuid),
  public.sender_terms_status(uuid), public.accept_sender_terms(uuid, integer) from public, anon, authenticated;
grant execute on function private.current_terms_version(), private.terms_ok(uuid), private.assert_terms(uuid),
  public.sender_terms_status(uuid), public.accept_sender_terms(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. Adding an address, or changing one, now also requires accepted terms. Deactivating and
--    removing do not: they only ever reduce who gets mail. Bodies are otherwise unchanged from 0006.
-- ---------------------------------------------------------------------------------------------
create or replace function public.add_subscriber(p_tenant uuid, p_email text, p_first_name text, p_email_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_email text := normalize(lower(btrim(p_email)), NFC);
begin
  perform private.assert_staff(p_tenant);
  perform private.assert_terms(p_tenant);
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
  perform private.assert_terms(v_t);
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
