-- Row Level Security. Default deny; every grant below is deliberate.

-- Helpers (SECURITY DEFINER so they can read memberships without recursing into its policies).
create function private.is_member(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.tenant_id = t and m.user_id = auth.uid())
$$;

create function private.has_role(t uuid, r public.member_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
                 where m.tenant_id = t and m.user_id = auth.uid() and m.role = r)
$$;

create function private.is_aal2() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- Sending requires membership AND a completed two-step verification (TOTP).
-- D-011: required for dg_admin as well, stricter than the build instruction.
create function private.can_send(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_member(t) and private.is_aal2()
$$;

revoke all on function private.is_member(uuid), private.has_role(uuid, public.member_role),
  private.is_aal2(), private.can_send(uuid) from public;
grant usage on schema private to authenticated, service_role;
grant execute on function private.is_member(uuid), private.has_role(uuid, public.member_role),
  private.is_aal2(), private.can_send(uuid) to authenticated, service_role;

-- Privileges: start from nothing for the API roles.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.subscribers enable row level security;
alter table public.tags enable row level security;
alter table public.subscriber_tags enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.suppressions enable row level security;
alter table public.provider_events enable row level security;
alter table public.audit_log enable row level security;

-- tenants: members read; only dg_admin edits settings. No insert/delete via API.
grant select on public.tenants to authenticated;
grant update (name, sender_name, reply_to, footer_text, daily_send_limit, retention_days) on public.tenants to authenticated;
create policy tenants_select on public.tenants for select to authenticated
  using (private.is_member(id));
create policy tenants_update on public.tenants for update to authenticated
  using (private.has_role(id, 'dg_admin')) with check (private.has_role(id, 'dg_admin'));

-- memberships: read own, or all of a tenant you administer. Never writable via API (no self-escalation).
grant select on public.memberships to authenticated;
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or private.has_role(tenant_id, 'dg_admin'));

-- subscribers
grant select, insert, delete on public.subscribers to authenticated;
grant update (email, first_name, status) on public.subscribers to authenticated;
create policy subscribers_select on public.subscribers for select to authenticated using (private.is_member(tenant_id));
create policy subscribers_insert on public.subscribers for insert to authenticated with check (private.is_member(tenant_id));
create policy subscribers_update on public.subscribers for update to authenticated
  using (private.is_member(tenant_id)) with check (private.is_member(tenant_id));
create policy subscribers_delete on public.subscribers for delete to authenticated using (private.is_member(tenant_id));

-- tags
grant select, insert, delete on public.tags to authenticated;
grant update (name) on public.tags to authenticated;
create policy tags_select on public.tags for select to authenticated using (private.is_member(tenant_id));
create policy tags_insert on public.tags for insert to authenticated with check (private.is_member(tenant_id));
create policy tags_update on public.tags for update to authenticated
  using (private.is_member(tenant_id)) with check (private.is_member(tenant_id));
create policy tags_delete on public.tags for delete to authenticated using (private.is_member(tenant_id));

-- subscriber_tags
grant select, insert, delete on public.subscriber_tags to authenticated;
create policy subscriber_tags_select on public.subscriber_tags for select to authenticated using (private.is_member(tenant_id));
create policy subscriber_tags_insert on public.subscriber_tags for insert to authenticated with check (private.is_member(tenant_id));
create policy subscriber_tags_delete on public.subscriber_tags for delete to authenticated using (private.is_member(tenant_id));

-- campaigns: users only touch drafts. Status changes (queue/send/cancel) happen in M4 via
-- SECURITY DEFINER functions that call private.can_send(). A user cannot set status directly.
grant select, delete on public.campaigns to authenticated;
grant insert (tenant_id, subject, body_json, html, text_body, idempotency_key, created_by) on public.campaigns to authenticated;
grant update (subject, body_json, html, text_body) on public.campaigns to authenticated;
create policy campaigns_select on public.campaigns for select to authenticated using (private.is_member(tenant_id));
create policy campaigns_insert on public.campaigns for insert to authenticated
  with check (private.is_member(tenant_id) and created_by = auth.uid());
create policy campaigns_update on public.campaigns for update to authenticated
  using (private.is_member(tenant_id) and status = 'draft')
  with check (private.is_member(tenant_id) and status = 'draft');
create policy campaigns_delete on public.campaigns for delete to authenticated
  using (private.is_member(tenant_id) and status = 'draft');

-- read-only for members; written by service role / definer functions only
grant select on public.campaign_recipients to authenticated;
create policy campaign_recipients_select on public.campaign_recipients for select to authenticated
  using (private.is_member(tenant_id));

grant select on public.suppressions to authenticated;
create policy suppressions_select on public.suppressions for select to authenticated
  using (private.is_member(tenant_id));

-- audit_log: append-only, readable by dg_admin only. Written by service role.
grant select on public.audit_log to authenticated;
create policy audit_log_select on public.audit_log for select to authenticated
  using (private.has_role(tenant_id, 'dg_admin'));
create or replace function private.audit_log_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_setting('dg.allow_audit_purge', true) = 'on' then
    return coalesce(old, new);  -- reserved for tenant deletion in M6, set locally in that function only
  end if;
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();

-- provider_events: no grants, no policies. Service role only.
