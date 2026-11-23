import Link from "next/link";
import { requireFullAuth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { friendly, NOTICE } from "@/lib/messages";
import { addSubscriberAction, deleteSubscriberAction, setActiveAction } from "./actions";

const PAGE = 50;
const STATUS: Record<string, string> = { active: "Aktiv", inactive: "Avaktiverad", unsubscribed: "Avregistrerad", bounced: "Studsade", complained: "Klagomål" };

export default async function ListPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, user } = await requireFullAuth();
  const { current } = await requireTenant(supabase, user.id, sp.tenant);
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? "").trim().slice(0, 100);

  let query = supabase.from("subscribers").select("id,email,first_name,status", { count: "exact" })
    .eq("tenant_id", current.id).order("email").range((page - 1) * PAGE, page * PAGE - 1);
  if (q) query = query.ilike("email", `%${q.replace(/[\\%_]/g, "\\$&")}%`);
  if (sp.tag) {
    const { data: links } = await supabase.from("subscriber_tags").select("subscriber_id").eq("tag_id", sp.tag).limit(5000);
    query = query.in("id", (links ?? []).map((l) => l.subscriber_id));
  }
  const { data: subs, count } = await query;
  const ids = (subs ?? []).map((s) => s.id);
  const [{ data: tags }, { data: links }, { count: activeCount }] = await Promise.all([
    supabase.from("tags").select("id,name").eq("tenant_id", current.id).order("name"),
    ids.length ? supabase.from("subscriber_tags").select("subscriber_id,tag_id").in("subscriber_id", ids) : Promise.resolve({ data: [] as any[] }),
    supabase.from("subscribers").select("id", { count: "exact", head: true }).eq("tenant_id", current.id).eq("status", "active"),
  ]);
  const tagName = new Map((tags ?? []).map((t) => [t.id, t.name]));
  const tagsOf = (id: string) => (links ?? []).filter((l: any) => l.subscriber_id === id).map((l: any) => tagName.get(l.tag_id)).filter(Boolean).join(", ");
  const base = `tenant=${current.id}`;
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));

  return (
    <>
      <nav className="top"><Link href={`/app?${base}`}>← Start</Link></nav>
      <h1>Adresslista: {current.name}</h1>
      <p className="muted">{activeCount ?? 0} aktiva adresser, {count ?? 0} träffar i vyn.</p>
      {sp.msg && NOTICE[sp.msg] && <p className="notice" role="status">{NOTICE[sp.msg]}</p>}
      {sp.err && <p className="error" role="alert">{friendly(sp.err)}</p>}

      <fieldset>
        <legend>Lägg till adress</legend>
        <form action={addSubscriberAction}>
          <input type="hidden" name="tenant" value={current.id} />
          <label htmlFor="email">E-post</label><input id="email" name="email" type="email" required />
          <label htmlFor="first_name">Förnamn (valfritt)</label><input id="first_name" name="first_name" maxLength={100} />
          <label htmlFor="tags">Taggar (valfritt, komma mellan)</label><input id="tags" name="tags" />
          <button type="submit">Lägg till</button>
        </form>
      </fieldset>

      <form method="get" className="row">
        <input type="hidden" name="tenant" value={current.id} />
        <input name="q" defaultValue={q} placeholder="Sök e-post" aria-label="Sök e-post" style={{ maxWidth: "16rem" }} />
        <select name="tag" defaultValue={sp.tag ?? ""} aria-label="Tagg" style={{ padding: ".7rem" }}>
          <option value="">Alla taggar</option>
          {(tags ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="small" type="submit">Visa</button>
        <a href={`/app/list/export?${base}`}>Exportera CSV</a>
      </form>

      <table>
        <thead><tr><th>E-post</th><th>Namn</th><th>Taggar</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {(subs ?? []).map((s) => (
            <tr key={s.id}>
              <td>{s.email}</td><td>{s.first_name ?? ""}</td><td>{tagsOf(s.id)}</td>
              <td><span className={`badge ${s.status === "active" ? "ok" : ""}`}>{STATUS[s.status] ?? s.status}</span></td>
              <td>
                <div className="row">
                  <Link href={`/app/list/${s.id}?${base}`}>Redigera</Link>
                  {(s.status === "active" || s.status === "inactive") && (
                    <form action={setActiveAction}>
                      <input type="hidden" name="tenant" value={current.id} /><input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="active" value={s.status === "active" ? "false" : "true"} />
                      <button className="small secondary" type="submit">{s.status === "active" ? "Avaktivera" : "Aktivera"}</button>
                    </form>
                  )}
                  <details>
                    <summary>Ta bort</summary>
                    <p className="muted">Adressen tas bort för alltid och kan inte läggas till igen av misstag. Vill personen bli helt raderad, kontakta D&amp;G.</p>
                    <form action={deleteSubscriberAction}>
                      <input type="hidden" name="tenant" value={current.id} /><input type="hidden" name="id" value={s.id} />
                      <button className="small danger" type="submit">Ja, ta bort</button>
                    </form>
                  </details>
                </div>
              </td>
            </tr>
          ))}
          {!subs?.length && <tr><td colSpan={5} className="muted">Inga adresser att visa.</td></tr>}
        </tbody>
      </table>
      {pages > 1 && (
        <p className="row">
          {page > 1 && <Link href={`/app/list?${base}&page=${page - 1}&q=${encodeURIComponent(q)}&tag=${sp.tag ?? ""}`}>← Föregående</Link>}
          <span className="muted">Sida {page} av {pages}</span>
          {page < pages && <Link href={`/app/list?${base}&page=${page + 1}&q=${encodeURIComponent(q)}&tag=${sp.tag ?? ""}`}>Nästa →</Link>}
        </p>
      )}
    </>
  );
}
