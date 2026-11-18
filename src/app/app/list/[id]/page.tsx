import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFullAuth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { friendly } from "@/lib/messages";
import { updateSubscriberAction } from "../actions";

export default async function EditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { supabase, user } = await requireFullAuth();
  const { current } = await requireTenant(supabase, user.id, sp.tenant);
  const { data: s } = await supabase.from("subscribers").select("id,email,first_name,status").eq("id", id).eq("tenant_id", current.id).maybeSingle();
  if (!s) notFound();
  const { data: links } = await supabase.from("subscriber_tags").select("tag_id").eq("subscriber_id", id);
  const { data: tags } = await supabase.from("tags").select("id,name").eq("tenant_id", current.id);
  const names = new Map((tags ?? []).map((t) => [t.id, t.name]));
  const locked = !(s.status === "active" || s.status === "inactive");
  return (
    <>
      <nav className="top"><Link href={`/app/list?tenant=${current.id}`}>← Adresslistan</Link></nav>
      <h1>Redigera adress</h1>
      {sp.err && <p className="error" role="alert">{friendly(sp.err)}</p>}
      {locked && <p className="muted">Den här personen har avregistrerat sig eller studsat. E-postadressen kan inte ändras.</p>}
      <form action={updateSubscriberAction}>
        <input type="hidden" name="tenant" value={current.id} /><input type="hidden" name="id" value={s.id} />
        <label htmlFor="email">E-post</label>
        {locked ? <><input type="hidden" name="email" value={s.email} /><input id="email" value={s.email} disabled /></> : <input id="email" name="email" type="email" defaultValue={s.email} required />}
        <label htmlFor="first_name">Förnamn</label><input id="first_name" name="first_name" defaultValue={s.first_name ?? ""} maxLength={100} />
        <label htmlFor="tags">Taggar (komma mellan)</label>
        <input id="tags" name="tags" defaultValue={(links ?? []).map((l) => names.get(l.tag_id)).filter(Boolean).join(", ")} />
        <button type="submit">Spara</button>
      </form>
    </>
  );
}
