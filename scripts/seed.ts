// Seeds two FICTIONAL associations into a DEV Supabase project.
// Needs: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL (direct Postgres connection to the same dev project).
// Refuses to run unless SEED_I_KNOW_THIS_IS_DEV=yes. Passwords are random and written only to .seed-credentials.local.json (gitignored).
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { seedData, type SeedUsers } from "./seed-data";

async function main() {
  if (process.env.SEED_I_KNOW_THIS_IS_DEV !== "yes") throw new Error("Set SEED_I_KNOW_THIS_IS_DEV=yes to confirm this is a development project.");
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed with NODE_ENV=production.");
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, dbUrl = process.env.DATABASE_URL;
  if (!url || !key || !dbUrl) throw new Error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or DATABASE_URL.");

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const wanted = { admin: "admin@dg.example.org", senderAlfa: "sender-alfa@example.com", senderBeta: "sender-beta@example.com", senderNone: "sender-ingen@example.com" };

  // 1. Fail fast: prove the database connection BEFORE touching Supabase Auth.
  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  const created: string[] = [];
  try {
    // 2. Refuse if already seeded (never overwrite or delete anything that looks real).
    const exists = await db.query(`select count(*)::int n from tenants where slug in ('alfa','beta')`);
    if (exists.rows[0].n > 0) throw new Error("Already seeded (tenants alfa/beta exist). Reset the dev project instead of seeding twice.");

    // 3. Remove leftover fictional users from an earlier half-finished attempt (exact fictional addresses only).
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) throw new Error(`Could not list users: ${listErr.message}`);
    for (const u of list.users) if (u.email && Object.values(wanted).includes(u.email)) await admin.auth.admin.deleteUser(u.id);

    const ids = {} as Record<keyof SeedUsers, string>;
    const creds: Record<string, string> = {};
    for (const [k, email] of Object.entries(wanted)) {
      const password = randomBytes(18).toString("base64url");
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error(`Could not create ${k}: ${error?.message}`);
      ids[k as keyof SeedUsers] = data.user.id; creds[email] = password; created.push(data.user.id);
    }
    await db.query("begin");
    try { await seedData(db, ids); await db.query("commit"); } catch (e) { await db.query("rollback"); throw e; }
    writeFileSync(".seed-credentials.local.json", JSON.stringify(creds, null, 2), { mode: 0o600 });
  } catch (e) {
    for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => {}); // leave nothing half-done
    throw e;
  } finally { await db.end(); }
  console.log("Seeded 2 associations and 4 users. Credentials: .seed-credentials.local.json");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
