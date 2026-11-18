import { afterAll, describe, expect, it } from "vitest";
import { normalizeEmail } from "../../src/lib/email";
import { admin, pool, rejects } from "./helpers";
import { MASTER_KEY } from "./fixtures";
import { subscriberHash } from "../../src/lib/suppression";
const H = (t: string, e: string) => subscriberHash(MASTER_KEY, t, e);

afterAll(() => pool.end());
const tx = async <T>(fn: (c: any) => Promise<T>) => admin(async (c) => { await c.query("begin"); try { return await fn(c); } finally { await c.query("rollback"); } });

describe("seed data is fictional", () => {
  it("only uses reserved example domains", async () => {
    const rows = await admin(async (c) => (await c.query(`select email from subscribers`)).rows);
    expect(rows.length).toBe(166);
    const bad = rows.filter((r) => !/@([a-z0-9äåö.-]+\.)?(example\.com|example\.org|[a-z]+\.test)$/.test(r.email));
    expect(bad).toEqual([]);
  });
  it("contains the planned traps", async () => {
    const r = await admin(async (c) => (await c.query(
      `select count(*) filter (where status='unsubscribed') u, count(*) filter (where status='bounced') b,
              count(*) filter (where status='complained') k, count(*) filter (where email='shared@example.com') shared
       from subscribers`)).rows[0]);
    expect(r).toMatchObject({ u: "6", b: "4", k: "2", shared: "2" });
  });
  it("stores suppression hashes, never plain addresses", async () => {
    const r = await admin(async (c) => (await c.query(`select email_hash from suppressions`)).rows);
    expect(r.length).toBe(10);
    for (const x of r) expect(x.email_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("e-mail normalisation", () => {
  it.each(["  Boende@Example.COM ", "Åsa@example.com", "x+Tag@EXAMPLE.org"])("SQL trigger matches TypeScript for %j", async (raw) => {
    const sql = await tx(async (c) => {
      const t = (await c.query(`select id from tenants where slug='alfa'`)).rows[0].id;
      return (await c.query(`insert into subscribers (tenant_id,email,email_hash) values ($1,$2,$3) returning email`, [t, raw, H(t, raw)])).rows[0].email;
    });
    expect(sql).toBe(normalizeEmail(raw));
  });
  it("rejects duplicates that differ only by case/whitespace", async () => {
    await tx(async (c) => {
      const t = (await c.query(`select id from tenants where slug='alfa'`)).rows[0].id;
      await c.query(`insert into subscribers (tenant_id,email,email_hash) values ($1,'dup@example.com',$2)`, [t, H(t, "dup@example.com")]);
      expect(await rejects(c, `insert into subscribers (tenant_id,email,email_hash) values ($1,' DUP@Example.com ',$2)`, [t, H(t, "other@example.com")])).toBe(true);
    });
  });
  it("allows the same address in two tenants", async () => {
    const n = await admin(async (c) => Number((await c.query(`select count(distinct tenant_id) n from subscribers where email='shared@example.com'`)).rows[0].n));
    expect(n).toBe(2);
  });
  it("rejects header injection and malformed addresses at the database", async () => {
    await tx(async (c) => {
      const t = (await c.query(`select id from tenants where slug='alfa'`)).rows[0].id;
      for (const bad of ["a@example.com\r\nBcc: x@y.z", "foo@", "@bar", ""])
        expect(await rejects(c, `insert into subscribers (tenant_id,email,email_hash) values ($1,$2,$3)`, [t, bad, H(t, "x@example.com")]), JSON.stringify(bad)).toBe(true);
      expect(await rejects(c, `insert into campaigns (tenant_id,subject) values ($1,E'Hej\\nBcc: x@y.z')`, [t])).toBe(true);
    });
  });
});

describe("data lifecycle", () => {
  it("hard-deleting a subscriber keeps campaign history but removes the link to the person", async () => {
    await tx(async (c) => {
      const row = (await c.query(`select cr.id, cr.subscriber_id from campaign_recipients cr limit 1`)).rows[0];
      await c.query(`delete from subscribers where id=$1`, [row.subscriber_id]);
      const after = (await c.query(`select subscriber_id, tenant_id, status from campaign_recipients where id=$1`, [row.id])).rows[0];
      expect(after.subscriber_id).toBeNull();
      expect(after.tenant_id).toBeTruthy();
      expect(after.status).toBe("delivered");
    });
  });
  it("a recipient row is unique per campaign and subscriber", async () => {
    await tx(async (c) => {
      const r = (await c.query(`select campaign_id, subscriber_id, tenant_id from campaign_recipients limit 1`)).rows[0];
      expect(await rejects(c, `insert into campaign_recipients (tenant_id,campaign_id,subscriber_id) values ($1,$2,$3)`, [r.tenant_id, r.campaign_id, r.subscriber_id])).toBe(true);
    });
  });
  it("audit_log is append-only even for the table owner", async () => {
    await tx(async (c) => {
      expect(await rejects(c, `update audit_log set action='x'`)).toBe(true);
      expect(await rejects(c, `delete from audit_log`)).toBe(true);
    });
  });
});
