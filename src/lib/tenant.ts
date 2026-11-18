import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TenantRole = "dg_admin" | "sender";
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

export async function requireTenant(supabase: SupabaseClient, userId: string, requested?: string) {
  const ctx = await loadContext(supabase, userId, requested);
  if (!ctx.current) redirect("/app");
  return { ...ctx, current: ctx.current };
}

export async function requireAdminTenant(supabase: SupabaseClient, userId: string, requested?: string) {
  const ctx = await requireTenant(supabase, userId, requested);
  if (ctx.current.role !== "dg_admin") redirect("/app");
  return ctx;
}
