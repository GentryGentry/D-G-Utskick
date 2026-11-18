import { logout } from "../login/actions";
import { requireFullAuth } from "@/lib/auth";

export default async function Dashboard() {
  const { supabase } = await requireFullAuth();
  // RLS decides what comes back: only the user's own associations.
  const { data: tenants } = await supabase.from("tenants").select("id,name").order("name");
  return (
    <>
      <h1>Utskick</h1>
      {tenants?.length ? <p>Förening: <strong>{tenants.map((t) => t.name).join(", ")}</strong></p>
        : <p className="error">Ditt konto är inte kopplat till någon förening. Kontakta D&amp;G.</p>}
      <ul className="nav">
        <li>Adresslista <span className="muted">(kommer i nästa steg)</span></li>
        <li>Skriv utskick <span className="muted">(kommer senare)</span></li>
        <li>Historik <span className="muted">(kommer senare)</span></li>
      </ul>
      <form action={logout}><button className="link" type="submit">Logga ut</button></form>
    </>
  );
}
