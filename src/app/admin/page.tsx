import Link from "next/link";
import { requireFullAuth } from "@/lib/auth";
import { loadContext } from "@/lib/tenant";
import { redirect } from "next/navigation";

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant } = await searchParams;
  const { supabase, user } = await requireFullAuth();
  const { tenants, current, isAdmin } = await loadContext(supabase, user.id, tenant);
  if (!isAdmin || !current) redirect("/app");
  const admins = tenants.filter((t) => t.role === "dg_admin");
  const cur = admins.find((t) => t.id === current.id) ?? admins[0];
  return (
    <>
      <nav className="top"><Link href={`/app?tenant=${cur.id}`}>← Start</Link></nav>
      <h1>D&amp;G administration</h1>
      <p>Förening: {admins.map((t) => <span key={t.id}>{t.id === cur.id ? <strong>{t.name}</strong> : <Link href={`/admin?tenant=${t.id}`}>{t.name}</Link>}{" "}</span>)}</p>
      <ul className="nav">
        <li><Link href={`/admin/import?tenant=${cur.id}`}>Importera adresser (CSV)</Link></li>
        <li><Link href={`/admin/erase?tenant=${cur.id}`}>Radera en person helt (på begäran)</Link></li>
      </ul>
    </>
  );
}
