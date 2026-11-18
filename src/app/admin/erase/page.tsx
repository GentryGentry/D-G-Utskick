import Link from "next/link";
import { requireFullAuth } from "@/lib/auth";
import { requireAdminTenant } from "@/lib/tenant";
import EraseForm from "./EraseForm";

export default async function ErasePage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant } = await searchParams;
  const { supabase, user } = await requireFullAuth();
  const { current } = await requireAdminTenant(supabase, user.id, tenant);
  return (
    <>
      <nav className="top"><Link href={`/admin?tenant=${current.id}`}>← Administration</Link></nav>
      <h1>Radera en person helt</h1>
      <p>Förening: <strong>{current.name}</strong></p>
      <p className="muted">Används när en person begär att bli raderad. Adressen tas bort ur listan, <strong>även spärrnoteringen</strong> om personen tidigare avregistrerat sig, och leverantörshändelser som innehåller adressen. Därefter kan adressen läggas till igen, så använd det bara på begäran. Händelsen loggas utan adress.</p>
      <EraseForm tenant={current.id} />
    </>
  );
}
