import "server-only";
import { redirect } from "next/navigation";
import { destinationFor } from "./auth-state";
import { createClient } from "./supabase/server";

/** Use in every protected server component/action. The proxy is only a first line of defence. */
export async function requireFullAuth() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser(); // validates the JWT with Supabase
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const dest = destinationFor(!!user, aal?.currentLevel);
  if (dest !== "ok") redirect(dest);
  return { supabase, user: user! };
}
