import Link from "next/link";
import { logout } from "../login/actions";
import { requireFullAuth } from "@/lib/auth";
import { canManage, loadContext } from "@/lib/tenant";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant } = await searchParams;
  const { supabase, user } = await requireFullAuth();
  const { tenants, current, isAdmin } = await loadContext(supabase, user.id, tenant);
  const q = current ? `?tenant=${current.id}` : "";
  return (
    <>
      <h1>Utskick</h1>
      {current ? (
        <>
          <p>Förening: <strong>{tenants.length > 1 ? tenants.map((t) => (
            <span key={t.id}>{t.id === current.id ? <strong>{t.name}</strong> : <Link href={`/app?tenant=${t.id}`}>{t.name}</Link>}{" "}</span>
          )) : current.name}</strong></p>
          <ul className="nav">
            <li>{canManage(current.role) ? <Link href={`/app/list${q}`}>Adresslista</Link> : <>Adresslista <span className="muted">(inte för din roll)</span></>}</li>
            <li>Skriv utskick <span className="muted">(kommer senare)</span></li>
            <li>Historik <span className="muted">(kommer senare)</span></li>
            {isAdmin && <li><Link href={`/admin${q}`}>D&amp;G administration</Link></li>}
          </ul>
        </>
      ) : <p className="error">Ditt konto är inte kopplat till någon förening. Kontakta D&amp;G.</p>}
      <form action={logout}><button className="link" type="submit">Logga ut</button></form>
    </>
  );
}
