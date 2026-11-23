import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManage, loadContext, termsPending } from "@/lib/tenant";
import { toCsv } from "@/lib/csv";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!user || aal?.currentLevel !== "aal2") return new NextResponse("Unauthorized", { status: 401 });
  const { current } = await loadContext(supabase, user.id, req.nextUrl.searchParams.get("tenant") ?? undefined);
  if (!current || !canManage(current.role)) return new NextResponse("Forbidden", { status: 403 });
  if (await termsPending(supabase, current)) return NextResponse.redirect(new URL(`/app/villkor?tenant=${current.id}`, req.url));

  const subs: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("subscribers").select("id,email,first_name,status").eq("tenant_id", current.id).order("email").range(from, from + 999);
    if (error) return new NextResponse("Error", { status: 500 });
    subs.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const { data: tags } = await supabase.from("tags").select("id,name").eq("tenant_id", current.id);
  const links: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("subscriber_tags").select("subscriber_id,tag_id").eq("tenant_id", current.id).range(from, from + 999);
    links.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const name = new Map((tags ?? []).map((t) => [t.id, t.name]));
  const bySub = new Map<string, string[]>();
  for (const l of links) bySub.set(l.subscriber_id, [...(bySub.get(l.subscriber_id) ?? []), name.get(l.tag_id) ?? ""]);

  await supabase.rpc("log_list_export", { p_tenant: current.id });
  const csv = toCsv([["email", "förnamn", "taggar", "status"], ...subs.map((s) => [s.email, s.first_name ?? "", (bySub.get(s.id) ?? []).join(", "), s.status])]);
  return new NextResponse(csv, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="adresslista-${current.id.slice(0, 8)}.csv"`,
    "Cache-Control": "no-store",
  } });
}
