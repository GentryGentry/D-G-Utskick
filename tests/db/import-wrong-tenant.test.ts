// Regression for the manual test 11 report (23 Nov): the Alfa fixture was imported while the admin
// page had silently defaulted to Beta. This pins down what the database does in that case, so the
// diagnosis is proven and not guessed: Alfa is untouched, and Beta gets the Alfa rows as new, active
// addresses, because Beta has no suppression for them. The database is right; the guard belongs in the app.
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { decodeCsvBytes, parseSubscriberCsv } from "../../src/lib/csv";
import { normalizeEmail } from "../../src/lib/email";
import { subscriberHash } from "../../src/lib/suppression";
import { MASTER_KEY, USERS } from "./fixtures";
import { admin, as, pool } from "./helpers";

afterAll(() => pool.end());
const ADM = { sub: USERS.admin, aal: "aal2" as const };
const tenant = async (slug: string) => admin(async (c) => (await c.query(`select id from tenants where slug=$1`, [slug])).rows[0].id as string);

function fixtureRows(t: string) {
  const parsed = parseSubscriberCsv(decodeCsvBytes(readFileSync("tests/fixtures/import-alfa-excel-1252.csv")));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.analysis.rows.map((r) => ({ email: normalizeEmail(r.email), first_name: r.first_name, tags: r.tags, hash: subscriberHash(MASTER_KEY, t, r.email) }));
}
const statusOf = async (q: any, t: string, email: string) =>
  (await q.query(`select status, first_name from subscribers where tenant_id=$1 and email=$2`, [t, email])).rows[0] ?? null;

describe("importing the Alfa fixture", () => {
  it("into Alfa: boende001 stays unsubscribed, the two suppressed addresses are skipped", async () => {
    const alfa = await tenant("alfa");
    await as(ADM, async (q) => {
      const r = (await q.query(`select public.import_subscribers($1,$2::jsonb) r`, [alfa, JSON.stringify(fixtureRows(alfa))])).rows[0].r;
      // åsa@bostäder.example.org is already in the seed, so the database sees 4 new and 3 existing.
      // (The file alone has 5 "new"; docs/SEED-PLAN.md counts from the file, not from the database.)
      expect(r).toMatchObject({ inserted: 4, existing: 3, suppressed: 2 });
      expect(await statusOf(q, alfa, "boende001@alfa.example.com")).toMatchObject({ status: "unsubscribed" });
      expect(await statusOf(q, alfa, "avregistrerad1@alfa.example.com")).toBeNull();
      expect(await statusOf(q, alfa, "avregistrerad2@alfa.example.com")).toBeNull();
    });
  });
  it("into Beta by mistake: reproduces the screenshot exactly and leaves Alfa untouched", async () => {
    const [alfa, beta] = [await tenant("alfa"), await tenant("beta")];
    await as(ADM, async (q) => {
      await q.query(`select public.import_subscribers($1,$2::jsonb)`, [beta, JSON.stringify(fixtureRows(beta))]);
      expect(await statusOf(q, beta, "boende001@alfa.example.com")).toEqual({ status: "active", first_name: "Anna" });
      expect(await statusOf(q, beta, "avregistrerad1@alfa.example.com")).toEqual({ status: "active", first_name: "Spökad" });
      expect(await statusOf(q, alfa, "boende001@alfa.example.com")).toMatchObject({ status: "unsubscribed" });
      expect(await statusOf(q, alfa, "avregistrerad1@alfa.example.com")).toBeNull();
    });
  });
});
