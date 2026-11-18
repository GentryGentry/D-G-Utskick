import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { seedData } from "../../scripts/seed-data";
import { MASTER_KEY, USERS } from "./fixtures";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL missing. Run `npm run test:db`, which starts a local Postgres.");
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await db.query("drop schema if exists public cascade; drop schema if exists private cascade; drop schema if exists auth cascade; create schema public;");
    await db.query(readFileSync(join(__dirname, "supabase-shim.sql"), "utf8"));
    const dir = join(__dirname, "../../supabase/migrations");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await db.query(readFileSync(join(dir, f), "utf8"));
    for (const [k, id] of Object.entries(USERS)) await db.query(`insert into auth.users (id,email) values ($1,$2)`, [id, `${k}@example.com`]);
    await seedData(db, USERS, MASTER_KEY);
  } finally { await db.end(); }
}
