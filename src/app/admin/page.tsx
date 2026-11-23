import Link from "next/link";
import { requireFullAuth } from "@/lib/auth";
import { loadContext } from "@/lib/tenant";
import { adminTenantsOf } from "@/lib/roles";
import { chooseAdminTenant } from "@/lib/import-guard";
import { redirect } from "next/navigation";

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant } = await searchParams;
  const { supabase, user } = await requireFullAuth();
  const { tenants, current, isAdmin } = await loadContext(supabase, user.id, tenant);
  if (!isAdmin || !current) redirect("/app");
  const admins = adminTenantsOf(tenants);
  const cur = chooseAdminTenant(admins, tenant);
  if (!cur) return (
    <>
      <nav className="top"><Link href="/app">← Start</Link></nav>
      <h1>D&amp;G administration</h1>
      <p><strong>Välj förening först.</strong> Allt du gör här (import, radering) gäller bara den förening du väljer.</p>
      <ul className="nav">{admins.map((t) => <li key={t.id}><Link href={`/admin?tenant=${t.id}`}>{t.name}</Link></li>)}</ul>
    </>
  );
  return (
    <>
      <nav className="top"><Link href={`/app?tenant=${cur.id}`}>← Start</Link></nav>
      <h1>D&amp;G administration: {cur.name}</h1>
      {admins.length > 1 && <p>Byt förening: {admins.filter((t) => t.id !== cur.id).map((t) => <span key={t.id}><Link href={`/admin?tenant=${t.id}`}>{t.name}</Link>{" "}</span>)}</p>}
      <ul className="nav">
        <li><Link href={`/admin/import?tenant=${cur.id}`}>Importera adresser (CSV)</Link></li>
        <li><Link href={`/admin/erase?tenant=${cur.id}`}>Radera en person helt (på begäran)</Link></li>
      </ul>
    </>
  );
}
