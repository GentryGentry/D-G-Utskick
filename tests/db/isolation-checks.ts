import { MASTER_KEY, USERS } from "./fixtures";
import { subscriberHash } from "../../src/lib/suppression";
import { admin, as, rejects } from "./helpers";

/** Runs every isolation/permission check. Returns a list of failed check names (empty = all good).
 *  Mutation tests call this too and require it to come back NON-empty after a policy is weakened. */
export async function runIsolationChecks(): Promise<string[]> {
  const failures: string[] = [];
  const ok = (name: string, cond: boolean) => { if (!cond) failures.push(name); };

  const ids = await admin(async (c) => {
    const t = Object.fromEntries((await c.query(`select slug,id from tenants`)).rows.map((r) => [r.slug, r.id]));
    const one = async (sql: string, p: unknown[]) => (await c.query(sql, p)).rows[0]?.id as string;
    return {
      alfa: t.alfa as string, beta: t.beta as string,
      subA: await one(`select id from subscribers where tenant_id=$1 limit 1`, [t.alfa]),
      subB: await one(`select id from subscribers where tenant_id=$1 limit 1`, [t.beta]),
      tagB: await one(`select id from tags where tenant_id=$1 limit 1`, [t.beta]),
      tagA: await one(`select id from tags where tenant_id=$1 limit 1`, [t.alfa]),
      sentA: await one(`select id from campaigns where tenant_id=$1 and status='sent'`, [t.alfa]),
      sentB: await one(`select id from campaigns where tenant_id=$1 and status='sent'`, [t.beta]),
      draftA: await one(`select id from campaigns where tenant_id=$1 and status='draft'`, [t.alfa]),
      draftB: await one(`select id from campaigns where tenant_id=$1 and status='draft'`, [t.beta]),
    };
  });

  const A = { sub: USERS.senderAlfa, aal: "aal2" as const };
  const None = { sub: USERS.senderNone, aal: "aal2" as const };
  const Adm = { sub: USERS.admin, aal: "aal2" as const };
  const count = async (q: any, sql: string, p: unknown[] = []) => Number((await q.query(sql, p)).rows[0].n);
  const tables = ["subscribers", "tags", "subscriber_tags", "campaigns", "campaign_recipients", "suppressions", "memberships"];

  // ---- reads ----
  await as(A, async (q) => {
    for (const t of tables) {
      ok(`${t}: sender-alfa sees nothing of beta`, (await count(q, `select count(*) n from ${t} where tenant_id=$1`, [ids.beta])) === 0);
      ok(`${t}: sender-alfa sees only alfa rows`, (await count(q, `select count(*) n from ${t} where tenant_id<>$1`, [ids.alfa])) === 0);
      ok(`${t}: sender-alfa CAN see own rows`, (await count(q, `select count(*) n from ${t} where tenant_id=$1`, [ids.alfa])) > 0);
    }
    ok("tenants: sender-alfa sees only alfa", (await count(q, `select count(*) n from tenants where id<>$1`, [ids.alfa])) === 0);
    ok("tenants: sender-alfa sees alfa", (await count(q, `select count(*) n from tenants where id=$1`, [ids.alfa])) === 1);
    ok("memberships: sender sees only own membership", (await count(q, `select count(*) n from memberships where user_id<>$1`, [USERS.senderAlfa])) === 0);
    ok("audit_log: sender sees none", (await count(q, `select count(*) n from audit_log`)) === 0);
    ok("provider_events: not readable by sender", await rejects(q, `select 1 from provider_events`));
  });
  await as(None, async (q) => {
    for (const t of [...tables, "tenants", "audit_log"]) ok(`${t}: non-member sees nothing`, (await count(q, `select count(*) n from ${t}`)) === 0);
    ok("non-member cannot add_subscriber", await rejects(q, `select public.add_subscriber($1,'a@example.com','x',$2)`, [ids.alfa, "0".repeat(64)]));
  });
  await as({ role: "anon" }, async (q) => {
    for (const t of [...tables, "tenants", "audit_log", "provider_events"]) ok(`${t}: anon denied`, await rejects(q, `select 1 from ${t}`));
    ok("anon cannot call add_subscriber", await rejects(q, `select public.add_subscriber($1,'a@example.com','x',$2)`, [ids.alfa, "0".repeat(64)]));
    ok("anon cannot call delete_subscriber", await rejects(q, `select public.delete_subscriber($1)`, [ids.subA]));
  });
  await as(Adm, async (q) => {
    ok("audit_log: admin sees both tenants", (await count(q, `select count(distinct tenant_id) n from audit_log`)) === 2);
    ok("memberships: admin sees tenant members", (await count(q, `select count(*) n from memberships where tenant_id=$1`, [ids.alfa])) === 2);
  });

  // ---- writes across tenants ----
  await as(A, async (q) => {
    // Direct writes to subscribers are not possible for anyone (all writes go through functions).
    ok("subscribers: direct insert (own tenant) rejected", await rejects(q, `insert into subscribers (tenant_id,email,email_hash) values ($1,'x@example.com',$2)`, [ids.alfa, "0".repeat(64)]));
    ok("subscribers: direct insert (other tenant) rejected", await rejects(q, `insert into subscribers (tenant_id,email,email_hash) values ($1,'x@example.com',$2)`, [ids.beta, "0".repeat(64)]));
    ok("subscribers: direct update rejected", await rejects(q, `update subscribers set first_name='x' where id=$1`, [ids.subA]));
    ok("subscribers: direct status change rejected", await rejects(q, `update subscribers set status='active' where tenant_id=$1`, [ids.alfa]));
    ok("subscribers: direct delete rejected", await rejects(q, `delete from subscribers where id=$1`, [ids.subA]));
    ok("subscribers: unqualified delete rejected", await rejects(q, `delete from subscribers`));
    // Functions are guarded: other tenant's data, admin-only operations
    const hB = subscriberHash(MASTER_KEY, ids.beta, "probe@example.com");
    ok("add_subscriber into beta rejected", await rejects(q, `select public.add_subscriber($1,'probe@example.com','x',$2)`, [ids.beta, hB]));
    ok("update_subscriber on beta row rejected", await rejects(q, `select public.update_subscriber($1,'x','probe@example.com',$2)`, [ids.subB, hB]));
    ok("set_subscriber_active on beta row rejected", await rejects(q, `select public.set_subscriber_active($1,false)`, [ids.subB]));
    ok("delete_subscriber on beta row rejected", await rejects(q, `select public.delete_subscriber($1)`, [ids.subB]));
    ok("update_subscriber on a random id looks identical to a foreign id", await rejects(q, `select public.update_subscriber(gen_random_uuid(),'x','probe@example.com',$1)`, [hB]));
    ok("log_list_export for beta rejected", await rejects(q, `select public.log_list_export($1)`, [ids.beta]));
    ok("import_subscribers denied to a sender (admin only)", await rejects(q, `select public.import_subscribers($1,'[]'::jsonb)`, [ids.alfa]));
    ok("import_preview denied to a sender (admin only)", await rejects(q, `select * from public.import_preview($1,array[]::text[])`, [ids.alfa]));
    ok("erase_person denied to a sender (admin only)", await rejects(q, `select public.erase_person($1,'a@example.com',$2)`, [ids.alfa, hB]));
    ok("tags: insert into beta rejected", await rejects(q, `insert into tags (tenant_id,name) values ($1,'x')`, [ids.beta]));
    ok("tags: delete beta tag affects 0", (await q.query(`delete from tags where id=$1`, [ids.tagB])).rowCount === 0);
    ok("subscriber_tags: insert into beta rejected", await rejects(q, `insert into subscriber_tags values ($1,$2,$3)`, [ids.beta, ids.subB, ids.tagB]));
    ok("campaigns: insert into beta rejected", await rejects(q, `insert into campaigns (tenant_id,subject,created_by) values ($1,'x',$2)`, [ids.beta, USERS.senderAlfa]));
    ok("campaigns: update beta draft affects 0", (await q.query(`update campaigns set subject='x' where id=$1`, [ids.draftB])).rowCount === 0);
    ok("campaigns: delete beta draft affects 0", (await q.query(`delete from campaigns where id=$1`, [ids.draftB])).rowCount === 0);
    ok("tenants: update beta affects 0", (await q.query(`update tenants set name='x' where id=$1`, [ids.beta])).rowCount === 0);
    ok("memberships: self-escalation in beta rejected", await rejects(q, `insert into memberships values ($1,$2,'dg_admin')`, [USERS.senderAlfa, ids.beta]));
    ok("memberships: role change rejected", await rejects(q, `update memberships set role='dg_admin' where user_id=$1`, [USERS.senderAlfa]));
    for (const t of ["campaign_recipients", "suppressions"]) {
      ok(`${t}: sender cannot insert`, await rejects(q, `insert into ${t} (tenant_id) values ($1)`, [ids.alfa]));
      ok(`${t}: sender cannot delete`, await rejects(q, `delete from ${t}`));
    }
    ok("audit_log: insert rejected", await rejects(q, `insert into audit_log (tenant_id,action) values ($1,'x')`, [ids.alfa]));
  });

  // ---- own-tenant behaviour (positive) ----
  await as(A, async (q) => {
    const hNew = subscriberHash(MASTER_KEY, ids.alfa, "new@example.com");
    ok("add_subscriber works in own tenant", !(await rejects(q, `select public.add_subscriber($1,'new@example.com','Ny',$2)`, [ids.alfa, hNew])));
    ok("update_subscriber works in own tenant", !(await rejects(q, `select public.update_subscriber($1,'Nytt namn',(select email from subscribers where id=$1),(select email_hash from subscribers where id=$1))`, [ids.subA])));
    ok("set_subscriber_active works in own tenant", !(await rejects(q, `select public.set_subscriber_active($1,false)`, [ids.subA])));
    ok("log_list_export works in own tenant", !(await rejects(q, `select public.log_list_export($1)`, [ids.alfa])));
    ok("delete_subscriber works in own tenant", !(await rejects(q, `select public.delete_subscriber($1)`, [ids.subA])));
    ok("campaigns: sender can edit own draft", (await q.query(`update campaigns set subject='ny' where id=$1`, [ids.draftA])).rowCount === 1);
    ok("campaigns: sender can create draft", !(await rejects(q, `insert into campaigns (tenant_id,subject,created_by) values ($1,'x',$2)`, [ids.alfa, USERS.senderAlfa])));
    ok("campaigns: cannot attribute draft to someone else", await rejects(q, `insert into campaigns (tenant_id,subject,created_by) values ($1,'x',$2)`, [ids.alfa, USERS.admin]));
    ok("campaigns: cannot insert as sent", await rejects(q, `insert into campaigns (tenant_id,subject,status,created_by) values ($1,'x','sent',$2)`, [ids.alfa, USERS.senderAlfa]));
    ok("campaigns: cannot set status directly", await rejects(q, `update campaigns set status='queued' where id=$1`, [ids.draftA]));
    ok("campaigns: sent campaign is immutable", (await q.query(`update campaigns set subject='x' where id=$1`, [ids.sentA])).rowCount === 0);
    ok("campaigns: sent campaign cannot be deleted", (await q.query(`delete from campaigns where id=$1`, [ids.sentA])).rowCount === 0);
    ok("tenants: sender cannot edit settings", (await q.query(`update tenants set daily_send_limit=99999 where id=$1`, [ids.alfa])).rowCount === 0);
  });
  await as(Adm, async (q) => {
    ok("import_preview works for dg_admin", !(await rejects(q, `select * from public.import_preview($1,array[]::text[])`, [ids.alfa])));
    ok("tenants: dg_admin can edit settings", (await q.query(`update tenants set footer_text='ny' where id=$1`, [ids.alfa])).rowCount === 1);
    ok("audit_log: admin cannot update", await rejects(q, `update audit_log set action='x'`));
    ok("audit_log: admin cannot delete", await rejects(q, `delete from audit_log`));
  });

  // Unqualified writes: no WHERE means the SELECT policy is not consulted, so the write policies
  // themselves must confine the statement to the user's own tenant.
  const own = await admin(async (c) => {
    const n = async (t: string) => Number((await c.query(`select count(*) n from ${t} where tenant_id=$1`, [ids.alfa])).rows[0].n);
    return { subscribers: await n("subscribers"), tags: await n("tags"), subscriber_tags: await n("subscriber_tags"),
             draftsA: Number((await c.query(`select count(*) n from campaigns where tenant_id=$1 and status='draft'`, [ids.alfa])).rows[0].n) };
  });
  await as(A, async (q) => {
    ok("tags: unqualified update stays in own tenant", (await q.query(`update tags set name=gen_random_uuid()::text`)).rowCount === own.tags);
    ok("campaigns: unqualified update only touches own drafts", (await q.query(`update campaigns set subject='x'`)).rowCount === own.draftsA);
    ok("tenants: unqualified update by sender affects 0", (await q.query(`update tenants set name=name`)).rowCount === 0);
  });
  for (const [t, expected] of [["tags", own.tags], ["subscriber_tags", own.subscriber_tags], ["campaigns", own.draftsA]] as const) {
    await as(A, async (q) => {
      ok(`${t}: unqualified delete stays in own tenant`, (await q.query(`delete from ${t}`)).rowCount === expected);
    });
  }
  await as(A, async (q) => {
    ok("tags: sender can insert in alfa", !(await rejects(q, `insert into tags (tenant_id,name) values ($1,'ny-tagg')`, [ids.alfa])));
    ok("tags: sender can rename in alfa", (await q.query(`update tags set name='omdöpt' where id=$1`, [ids.tagA])).rowCount === 1);
    ok("tags: sender can delete in alfa", (await q.query(`delete from tags where id=$1`, [ids.tagA])).rowCount === 1);
    ok("subscriber_tags: sender can link in alfa", !(await rejects(q,
      `insert into subscriber_tags select tenant_id, $1, id from tags where tenant_id=$2 limit 1 on conflict do nothing`, [ids.subA, ids.alfa])));
    ok("subscriber_tags: sender can unlink in alfa", (await q.query(`delete from subscriber_tags where subscriber_id=$1`, [ids.subA])).rowCount! >= 1);
    ok("campaigns: sender can delete own draft", (await q.query(`delete from campaigns where id=$1`, [ids.draftA])).rowCount === 1);
  });

  // ---- sending gate (TOTP) ----
  const canSend = async (actor: any, t: string) => as(actor, async (q) => (await q.query(`select private.can_send($1) ok`, [t])).rows[0].ok as boolean);
  ok("can_send: aal1 denied", (await canSend({ sub: USERS.senderAlfa, aal: "aal1" }, ids.alfa)) === false);
  ok("can_send: aal2 member allowed", (await canSend(A, ids.alfa)) === true);
  ok("can_send: aal2 member of other tenant denied", (await canSend(A, ids.beta)) === false);
  ok("can_send: aal2 non-member denied", (await canSend(None, ids.alfa)) === false);

  // ---- structural ----
  await admin(async (c) => {
    const rows = (await c.query(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
                                  where n.nspname='public' and c.relkind='r'`)).rows;
    for (const r of rows) ok(`RLS enabled on ${r.relname}`, r.relrowsecurity === true);
    ok("at least 10 tables inspected", rows.length >= 10);
    // Layer 1 of 2: no SECURITY DEFINER function may be executable by anon (the guards inside are layer 2).
    const fns = (await c.query(`select p.proname, n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                                where n.nspname in ('public','private') and p.prosecdef`)).rows;
    ok("at least 10 definer functions inspected", fns.length >= 10);
    for (const f of (await c.query(`select p.proname, n.nspname, has_function_privilege('anon', p.oid, 'execute') as anon_exec
                                    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                                    where n.nspname in ('public','private') and p.prosecdef`)).rows)
      ok(`anon has no execute on ${f.nspname}.${f.proname}`, f.anon_exec === false);
    await c.query("begin");
    ok("FK: subscriber_tags cross-tenant rejected", await rejects(c, `insert into subscriber_tags values ($1,$2,$3)`, [ids.alfa, ids.subB, ids.tagA]));
    ok("FK: campaign_recipients cross-tenant rejected", await rejects(c, `insert into campaign_recipients (tenant_id,campaign_id,subscriber_id) values ($1,$2,$3)`, [ids.alfa, ids.sentA, ids.subB]));
    await c.query("rollback");
  });
  return failures;
}
