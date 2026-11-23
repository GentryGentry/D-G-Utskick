import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chooseAdminTenant } from "./import-guard";

export type TenantRole = "dg_admin" | "sender" | "board_viewer";
export const canManage = (role: TenantRole) => role === "dg_admin" || role === "sender";
export type TenantCtx = { id: string; name: string; role: TenantRole };

/** Memberships come back through RLS, so this only ever lists the user's own associations. */
export async function loadContext(supabase: SupabaseClient, userId: string, requested?: string) {
  const { data } = await supabase.from("memberships").select("tenant_id, role, tenants(id, name)").eq("user_id", userId);
  const tenants: TenantCtx[] = (data ?? []).flatMap((m: any) => {
    const t = Array.isArray(m.tenants) ? m.tenants[0] : m.tenants;
    return t ? [{ id: t.id as string, name: t.name as string, role: m.role as TenantRole }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name, "sv"));
  const current = tenants.find((t) => t.id === requested) ?? tenants[0] ?? null;
  return { tenants, current, isAdmin: tenants.some((t) => t.role === "dg_admin") };
}

/** Pages and actions that change or list addresses. A board_viewer is a member but not staff (D-024). */
export async function requireTenant(supabase: SupabaseClient, userId: string, requested?: string) {
  const ctx = await loadContext(supabase, userId, requested);
  if (!ctx.current || !canManage(ctx.current.role)) redirect("/app");
  return { ...ctx, current: ctx.current };
}

/** Admin pages never fall back to "the first association": with several, the admin must choose (import-guard.ts). */
export async function requireAdminTenant(supabase: SupabaseClient, userId: string, requested?: string) {
  const ctx = await loadContext(supabase, userId, requested);
  const admins = ctx.tenants.filter((t) => t.role === "dg_admin");
  if (!admins.length) redirect("/app");
  const current = chooseAdminTenant(admins, requested);
  if (!current) redirect("/admin");
  return { ...ctx, admins, current };
}
