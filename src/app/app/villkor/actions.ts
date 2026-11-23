"use server";
import { redirect } from "next/navigation";
import { requireFullAuth } from "@/lib/auth";
import { loadContext } from "@/lib/tenant";

/** D-031. The database checks role, two-step login and that the version is still the current one. */
export async function acceptTermsAction(form: FormData) {
  const { supabase, user } = await requireFullAuth();
  const { current } = await loadContext(supabase, user.id, String(form.get("tenant") ?? ""));
  if (!current) redirect("/app");
  const again = (err: string) => redirect(`/app/villkor?tenant=${current.id}&err=${encodeURIComponent(err)}`);
  // The tick box is required in the browser too, but the browser is never trusted.
  if (form.get("confirm") !== "yes") return again("terms_unchecked");
  const version = Number(form.get("version"));
  const { error } = await supabase.rpc("accept_sender_terms", { p_tenant: current.id, p_version: Number.isInteger(version) ? version : -1 });
  if (error) return again(error.message);
  redirect(`/app/list?tenant=${current.id}&msg=terms_accepted`);
}
