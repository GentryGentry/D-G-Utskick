import Link from "next/link";
import { requireFullAuth } from "@/lib/auth";
import { requireAdminTenant } from "@/lib/tenant";
import ImportForm from "./ImportForm";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant } = await searchParams;
  const { supabase, user } = await requireFullAuth();
  const { current } = await requireAdminTenant(supabase, user.id, tenant);
  return (
    <>
      <nav className="top"><Link href={`/admin?tenant=${current.id}`}>← Administration</Link></nav>
      <h1>Importera adresser till {current.name}</h1>
      <p className="muted">CSV-fil med kolumnerna <code>email</code> (obligatorisk), <code>förnamn</code> och <code>taggar</code> (valfria). Semikolon eller komma fungerar. Du får en förhandsgranskning innan något sparas. Redan avregistrerade eller borttagna adresser läggs aldrig till igen, och befintliga adresser ändras inte.</p>
      <ImportForm tenant={current.id} tenantName={current.name} />
    </>
  );
}
