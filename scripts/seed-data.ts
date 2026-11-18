// Fictional data only (example.com / example.org / .test). Deterministic.
import type { ClientBase } from "pg";
import { subscriberHash } from "../src/lib/suppression";

export const FIRST_NAMES = ["Anna", "Bo", "Cecilia", "David", "Elin", "Fredrik", "Gunnel", "Hugo", "Ida", "Johan"];

export type SeedUsers = { admin: string; senderAlfa: string; senderBeta: string; senderNone: string };

export const TENANTS = {
  alfa: { name: "Brf Testgården Alfa", slug: "alfa", reply_to: "styrelsen@alfa.test", limit: 500, count: 120 },
  beta: { name: "Brf Provbacken Beta", slug: "beta", reply_to: "styrelsen@beta.test", limit: 100, count: 40 },
} as const;

export async function seedData(db: ClientBase, users: SeedUsers, masterKey: string) {
  const ids: Record<string, string> = {};
  for (const [slug, t] of Object.entries(TENANTS)) {
    const r = await db.query(
      `insert into tenants (name, slug, sender_name, reply_to, footer_text, daily_send_limit)
       values ($1,$2,$1,$3,'Du får detta mejl som boende i föreningen.',$4) returning id`,
      [t.name, t.slug, t.reply_to, t.limit]);
    ids[slug] = r.rows[0].id;
  }
  await db.query(`insert into memberships values ($1,$2,'dg_admin'),($1,$3,'dg_admin'),($4,$2,'sender'),($5,$3,'sender')`,
    [users.admin, ids.alfa, ids.beta, users.senderAlfa, users.senderBeta]);

  for (const [slug, t] of Object.entries(TENANTS)) {
    const tid = ids[slug];
    const tagIds: Record<string, string> = {};
    for (const name of ["trapphus-a", "trapphus-b", "styrelse"]) {
      tagIds[name] = (await db.query(`insert into tags (tenant_id,name) values ($1,$2) returning id`, [tid, name])).rows[0].id;
    }
    const subs: string[] = [];
    for (let i = 1; i <= t.count; i++) {
      // fixed status traps: 3 unsubscribed, 2 bounced, 1 complained
      const status = i <= 3 ? "unsubscribed" : i <= 5 ? "bounced" : i === 6 ? "complained" : "active";
      const email = `boende${String(i).padStart(3, "0")}@${slug}.example.com`;
      subs.push((await db.query(`insert into subscribers (tenant_id,email,first_name,status,email_hash) values ($1,$2,$3,$4,$5) returning id`,
        [tid, email, FIRST_NAMES[i % FIRST_NAMES.length], status, subscriberHash(masterKey, tid, email)])).rows[0].id);
    }
    // same address in both tenants, plus-address, unicode domain
    for (const e of ["shared@example.com", "anna+post@example.com", "åsa@bostäder.example.org"]) {
      subs.push((await db.query(`insert into subscribers (tenant_id,email,first_name,email_hash) values ($1,$2,'Test',$3) returning id`,
        [tid, e, subscriberHash(masterKey, tid, e)])).rows[0].id);
    }
    for (let i = 0; i < subs.length; i++) {
      const tag = i % 2 ? "trapphus-a" : "trapphus-b";
      await db.query(`insert into subscriber_tags values ($1,$2,$3)`, [tid, subs[i], tagIds[tag]]);
    }
    for (let i = 1; i <= 5; i++) {
      await db.query(`insert into suppressions (tenant_id,email_hash,reason) values ($1,$2,'unsubscribed')`,
        [tid, subscriberHash(masterKey, tid, `avregistrerad${i}@${slug}.example.com`)]);
    }
    const sender = slug === "alfa" ? users.senderAlfa : users.senderBeta;
    const sent = (await db.query(
      `insert into campaigns (tenant_id,subject,status,created_by,approved_by,approved_at,sent_at,recipient_count)
       values ($1,$2,'sent',$3,$3,now(),now(),5) returning id`, [tid, `Skickat utskick ${slug}`, sender])).rows[0].id;
    for (let i = 0; i < 5; i++) {
      await db.query(`insert into campaign_recipients (tenant_id,campaign_id,subscriber_id,status,provider_message_id) values ($1,$2,$3,'delivered',$4)`,
        [tid, sent, subs[10 + i], `fake-msg-${slug}-${i}`]);
    }
    await db.query(`insert into campaigns (tenant_id,subject,created_by) values ($1,$2,$3)`, [tid, `Utkast ${slug}`, sender]);
    await db.query(`insert into audit_log (tenant_id,user_id,action,target) values ($1,$2,'campaign.sent',$3)`, [tid, sender, sent]);
    await db.query(`insert into provider_events (tenant_id,provider,raw_payload) values ($1,'console','{"fake":true}')`, [tid]);
  }
  return ids;
}
