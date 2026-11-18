"use server";
import { redirect } from "next/navigation";
import { requireFullAuth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { friendly } from "@/lib/messages";
import { isValidEmail } from "@/lib/email";
import { requireEnv } from "@/lib/env";
import { subscriberHash } from "@/lib/suppression";

const back = (tenant: string, key: "msg" | "err", value: string) =>
  redirect(`/app/list?tenant=${encodeURIComponent(tenant)}&${key}=${encodeURIComponent(value)}`);

function parseTags(raw: string): string[] {
  return [...new Set(raw.split(/[,;|]/).map((t) => t.trim()).filter((t) => t.length > 0 && t.length <= 60))].slice(0, 10);
}

/** Make the tag set of one subscriber equal to `wanted`. RLS limits this to the user's own tenant. */
async function syncTags(supabase: any, tenantId: string, subscriberId: string, wanted: string[]) {
  if (wanted.length) await supabase.from("tags").upsert(wanted.map((name) => ({ tenant_id: tenantId, name })), { onConflict: "tenant_id,name", ignoreDuplicates: true });
  const { data: tagRows } = await supabase.from("tags").select("id,name").eq("tenant_id", tenantId);
  const byName = new Map<string, string>((tagRows ?? []).map((t: any) => [t.name, t.id]));
  const { data: current } = await supabase.from("subscriber_tags").select("tag_id").eq("subscriber_id", subscriberId);
  const have = new Set((current ?? []).map((r: any) => r.tag_id));
  const want = new Set(wanted.map((n) => byName.get(n)).filter(Boolean) as string[]);
  const toAdd = [...want].filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !want.has(id as string));
  if (toAdd.length) await supabase.from("subscriber_tags").insert(toAdd.map((tag_id) => ({ tenant_id: tenantId, subscriber_id: subscriberId, tag_id })));
  if (toRemove.length) await supabase.from("subscriber_tags").delete().eq("subscriber_id", subscriberId).in("tag_id", toRemove);
}

export async function addSubscriberAction(form: FormData) {
  const { supabase, user } = await requireFullAuth();
  const { current } = await requireTenant(supabase, user.id, String(form.get("tenant") ?? ""));
  const email = String(form.get("email") ?? "");
  if (!isValidEmail(email)) return back(current.id, "err", "invalid_email");
  const hash = subscriberHash(requireEnv("SUPPRESSION_HMAC_MASTER_KEY"), current.id, email);
  const { data, error } = await supabase.rpc("add_subscriber", { p_tenant: current.id, p_email: email, p_first_name: String(form.get("first_name") ?? ""), p_email_hash: hash });
  if (error) return back(current.id, "err", error.message);
  await syncTags(supabase, current.id, data as string, parseTags(String(form.get("tags") ?? "")));
  back(current.id, "msg", "added");
}

export async function updateSubscriberAction(form: FormData) {
  const { supabase, user } = await requireFullAuth();
  const { current } = await requireTenant(supabase, user.id, String(form.get("tenant") ?? ""));
  const id = String(form.get("id") ?? "");
  const email = String(form.get("email") ?? "");
  if (!isValidEmail(email)) return redirect(`/app/list/${id}?tenant=${current.id}&err=invalid_email`);
  const hash = subscriberHash(requireEnv("SUPPRESSION_HMAC_MASTER_KEY"), current.id, email);
  const { error } = await supabase.rpc("update_subscriber", { p_id: id, p_first_name: String(form.get("first_name") ?? ""), p_email: email, p_email_hash: hash });
  if (error) return redirect(`/app/list/${id}?tenant=${current.id}&err=${encodeURIComponent(error.message)}`);
  await syncTags(supabase, current.id, id, parseTags(String(form.get("tags") ?? "")));
  back(current.id, "msg", "updated");
}

export async function setActiveAction(form: FormData) {
  const { supabase, user } = await requireFullAuth();
  const { current } = await requireTenant(supabase, user.id, String(form.get("tenant") ?? ""));
  const active = form.get("active") === "true";
  const { error } = await supabase.rpc("set_subscriber_active", { p_id: String(form.get("id") ?? ""), p_active: active });
  if (error) return back(current.id, "err", error.message);
  back(current.id, "msg", active ? "activated" : "deactivated");
}

export async function deleteSubscriberAction(form: FormData) {
  const { supabase, user } = await requireFullAuth();
  const { current } = await requireTenant(supabase, user.id, String(form.get("tenant") ?? ""));
  const { error } = await supabase.rpc("delete_subscriber", { p_id: String(form.get("id") ?? "") });
  if (error) return back(current.id, "err", error.message);
  back(current.id, "msg", "deleted");
}
