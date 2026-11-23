import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chooseAdminTenant } from "./import-guard";
import { adminTenantsOf, canManage, mustAcceptTerms, type TenantRole, type TermsStatus } from "./roles";

export { canManage, type TenantRole };
export type TenantCtx = { id: string; name: string; role: TenantRole };

/** Memberships come back through RLS, so this only ever lists the user's own associations. */
export async function loadContext(supabase: SupabaseClient, userId: string, requested?: string) {
  const { data } = await supabase.from("memberships").select("tenant_id, role, tenants(id, name)").eq("user_id", userId);
  const tenants: TenantCtx[] = (data ?? []).flatMap((m: any) => {
    const t = Array.isArray(m.tenants) ? m.tenants[0] : m.tenants;
    return t ? [{ id: t.id as string, name: t.name as string, role: m.role as TenantRole }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name, "sv"));
  const current = tenants.find((t) => t.id === requested) ?? tenants[0] ?? null;
  return { tenants, current, isAdmin: adminTenantsOf(tenants).length > 0 };
}

export async function loadTermsStatus(supabase: SupabaseClient, tenantId: string): Promise<TermsStatus | null> {
  const { data, error } = await supabase.rpc("sender_terms_status", { p_tenant: tenantId });
  return error ? null : (data as TermsStatus);
}

/** True when this user must accept the terms in this association before using the list (D-031). */
export async function termsPending(supabase: SupabaseClient, ctx: TenantCtx): Promise<boolean> {
  if (ctx.role !== "sender") return false;
  return mustAcceptTerms(ctx.role, await loadTermsStatus(supabase, ctx.id));
}

/** Pages and actions that change or list addresses. A board_viewer is a member but not staff (D-024). */
export async function requireTenant(supabase: SupabaseClient, userId: string, requested?: string) {
  const ctx = await loadContext(supabase, userId, requested);
  if (!ctx.current || !canManage(ctx.current.role)) redirect("/app");
  // A sender who has not accepted the current terms sees nothing of the list until they do.
  // The database enforces the same rule for adding and changing addresses (private.assert_terms).
  if (await termsPending(supabase, ctx.current)) redirect(`/app/villkor?tenant=${ctx.current.id}`);
  return { ...ctx, current: ctx.current };
}

/** Admin pages never fall back to "the first association": with several, the admin must choose (import-guard.ts). */
export async function requireAdminTenant(supabase: SupabaseClient, userId: string, requested?: string) {
  const ctx = await loadContext(supabase, userId, requested);
  const admins = adminTenantsOf(ctx.tenants);
  if (!admins.length) redirect("/app");
  const current = chooseAdminTenant(admins, requested);
  if (!current) redirect("/admin");
  return { ...ctx, admins, current };
}
