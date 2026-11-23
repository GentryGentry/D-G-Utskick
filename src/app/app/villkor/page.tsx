import Link from "next/link";
import { redirect } from "next/navigation";
import { requireFullAuth } from "@/lib/auth";
import { loadContext, loadTermsStatus } from "@/lib/tenant";
import { mustAcceptTerms } from "@/lib/roles";
import { friendly } from "@/lib/messages";
import { acceptTermsAction } from "./actions";

/** One-time condition for the sender role (D-031). Shown again only when the text gets a new version. */
export default async function TermsPage({ searchParams }: { searchParams: Promise<{ tenant?: string; err?: string }> }) {
  const sp = await searchParams;
  const { supabase, user } = await requireFullAuth();
  const { current } = await loadContext(supabase, user.id, sp.tenant);
  if (!current) redirect("/app");
  const status = await loadTermsStatus(supabase, current.id);
  if (!mustAcceptTerms(current.role, status)) redirect(`/app/list?tenant=${current.id}`);
  return (
    <>
      <nav className="top"><Link href={`/app?tenant=${current.id}`}>← Start</Link></nav>
      <h1>Innan du använder adresslistan</h1>
      <p>Du är utskickare för <strong>{current.name}</strong>. Det betyder att du själv lägger in, ändrar och tar bort adresser. Därför ber vi dig bekräfta en sak, en gång.</p>
      {status?.body ? (
        <form action={acceptTermsAction}>
          <input type="hidden" name="tenant" value={current.id} />
          <input type="hidden" name="version" value={status.version ?? ""} />
          <blockquote className="terms">{status.body}</blockquote>
          <label className="check">
            <input type="checkbox" name="confirm" value="yes" required />
            Jag har läst och godkänner villkoret ovan.
          </label>
          {sp.err && <p className="error" role="alert">{friendly(sp.err)}</p>}
          <button type="submit">Godkänn</button>
          <p className="muted">Vi sparar att du godkände, när, och vilken version av texten (version {status.version}). Ändras texten får du godkänna den nya.</p>
        </form>
      ) : <p className="error" role="alert">Villkoren kunde inte hämtas. Försök igen, eller kontakta D&amp;G.</p>}
    </>
  );
}
