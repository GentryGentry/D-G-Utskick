"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(_prev: { error?: string } | undefined, form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Fyll i e-post och lösenord." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // One generic message: never reveal whether the address exists.
  if (error) return { error: "Fel e-post eller lösenord." };
  redirect("/mfa");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
