import { afterAll, describe, expect, it } from "vitest";
import { normalizeEmail } from "../../src/lib/email";
import { admin, pool, rejects } from "./helpers";
import { MASTER_KEY, USERS } from "./fixtures";
import { as } from "./helpers";
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

describe("slutprodukt data model", () => {
  const T = async (slug: string) => admin(async (c) => (await c.query(`select id from tenants where slug=$1`, [slug])).rows[0].id as string);
  const ins = (c: any, t: string, email: string, extra = "", extraVals: unknown[] = []) =>
    c.query(`insert into subscribers (tenant_id,email,email_hash${extra ? "," + extra.split("=")[0] : ""}) values ($1,$2,$3${extra ? ",$4" : ""}) returning *`, [t, email, H(t, email), ...extraVals]);

  it("normalises apartment numbers so a move-out matches however it was typed", async () => {
    await tx(async (c) => {
      const t = await T("alfa");
      expect((await ins(c, t, "a1@example.com", "apartment=x", ["  lgh   a12 "])).rows[0].apartment).toBe("LGH A12");
      expect((await ins(c, t, "a2@example.com", "apartment=x", ["   "])).rows[0].apartment).toBeNull();
      expect((await ins(c, t, "a3@example.com", "apartment=x", ["1001"])).rows[0].apartment).toBe("1001");
      expect(await rejects(c, `insert into subscribers (tenant_id,email,email_hash,apartment) values ($1,'a4@example.com',$2,$3)`, [t, H(t, "a4@example.com"), "1".repeat(21)])).toBe(true);
    });
  });
  it("source defaults to manual and only accepts the three allowed values", async () => {
    await tx(async (c) => {
      const t = await T("alfa");
      expect((await ins(c, t, "s1@example.com")).rows[0].source).toBe("manual");
      expect((await ins(c, t, "s2@example.com", "source=x", ["form"])).rows[0].source).toBe("form");
      expect(await rejects(c, `insert into subscribers (tenant_id,email,email_hash,source) values ($1,'s3@example.com',$2,'bogus')`, [t, H(t, "s3@example.com")])).toBe(true);
    });
  });
  it("seeded addresses carry apartments (two per apartment) and some have none", async () => {
    const r = await admin(async (c) => (await c.query(`select count(*) filter (where apartment is null) none, count(distinct apartment) apts from subscribers where tenant_id=(select id from tenants where slug='alfa')`)).rows[0]);
    expect(Number(r.apts)).toBe(50);
    expect(Number(r.none)).toBeGreaterThan(0);
  });

  it("archive: only a sent campaign with slug and publish time can be visible; slug format and uniqueness per tenant", async () => {
    await tx(async (c) => {
      const [a, b] = [await T("alfa"), await T("beta")];
      const sent = (await c.query(`select id from campaigns where tenant_id=$1 and status='sent'`, [a])).rows[0].id;
      const draft = (await c.query(`select id from campaigns where tenant_id=$1 and status='draft'`, [a])).rows[0].id;
      expect(await rejects(c, `update campaigns set archive_visible=true where id=$1`, [sent])).toBe(true);                         // no slug/time
      expect(await rejects(c, `update campaigns set archive_visible=true, slug='x', archive_published_at=now() where id=$1`, [draft])).toBe(true); // not sent
      expect(await rejects(c, `update campaigns set slug='Bad Slug!' where id=$1`, [sent])).toBe(true);
      expect(await rejects(c, `update campaigns set archive_visible=true, slug='var-info', archive_published_at=now() where id=$1`, [sent])).toBe(false);
      const sentB = (await c.query(`select id from campaigns where tenant_id=$1 and status='sent'`, [b])).rows[0].id;
      expect(await rejects(c, `update campaigns set slug='var-info' where id=$1`, [sentB])).toBe(false);   // same slug, other tenant: fine
      const second = (await c.query(`insert into campaigns (tenant_id,subject,status) values ($1,'y','sent') returning id`, [a])).rows[0].id;
      expect(await rejects(c, `update campaigns set slug='var-info' where id=$1`, [second])).toBe(true);    // same slug, same tenant: refused
    });
  });
  it("campaigns.archive_visible defaults to false", async () => {
    const n = await admin(async (c) => Number((await c.query(`select count(*) n from campaigns where archive_visible`)).rows[0].n));
    expect(n).toBe(0);
  });

  it("campaign_recipients.opened is a plain boolean defaulting to false, with no companion columns", async () => {
    const cols = await admin(async (c) => (await c.query(`select column_name, data_type, column_default from information_schema.columns where table_name='campaign_recipients' and table_schema='public'`)).rows);
    expect(cols.find((x: any) => x.column_name === "opened")).toMatchObject({ data_type: "boolean", column_default: "false" });
    expect(cols.map((x: any) => x.column_name).filter((n: string) => /ip|agent|opened_at|browser/.test(n))).toEqual([]);
    const n = await admin(async (c) => Number((await c.query(`select count(*) n from campaign_recipients where opened`)).rows[0].n));
    expect(n).toBe(0);
  });

  describe("subscription_requests", () => {
    const req = (c: any, t: string, email: string, status = "pending_confirmation", confirmed: string | null = null, tok = "b") =>
      c.query(`insert into subscription_requests (tenant_id,email,name,apartment,token_hash,status,confirmed_at) values ($1,$2,'Namn',' lgh 5 ',$3,$4,$5) returning *`, [t, email, tok.repeat(64).slice(0, 64), status, confirmed]);
    it("normalises e-mail and apartment, defaults to pending_confirmation", async () => {
      await tx(async (c) => {
        const t = await T("alfa");
        const r = (await req(c, t, "  NY.Person@Example.com ")).rows[0];
        expect(r).toMatchObject({ email: "ny.person@example.com", apartment: "LGH 5", status: "pending_confirmation", confirmed_at: null });
      });
    });
    it("stores only a SHA-256-shaped token hash, unique", async () => {
      await tx(async (c) => {
        const t = await T("alfa");
        expect(await rejects(c, `insert into subscription_requests (tenant_id,email,token_hash) values ($1,'x@example.com','plain-token')`, [t])).toBe(true);
        await req(c, t, "t1@example.com", "pending_confirmation", null, "c");
        expect(await rejects(c, `insert into subscription_requests (tenant_id,email,token_hash) values ($1,'t2@example.com',$2)`, [t, "c".repeat(64)])).toBe(true);
      });
    });
    it("keeps the consent record honest: confirmed_at is set exactly when the person has confirmed", async () => {
      await tx(async (c) => {
        const t = await T("alfa");
        expect(await rejects(c, `insert into subscription_requests (tenant_id,email,token_hash,status) values ($1,'k1@example.com',$2,'approved')`, [t, "d".repeat(64)])).toBe(true);
        expect(await rejects(c, `insert into subscription_requests (tenant_id,email,token_hash,confirmed_at) values ($1,'k2@example.com',$2,now())`, [t, "e".repeat(64)])).toBe(true);
        expect(await rejects(c, `insert into subscription_requests (tenant_id,email,token_hash,status,confirmed_at) values ($1,'k3@example.com',$2,'pending_approval',now())`, [t, "f".repeat(64)])).toBe(false);
      });
    });
    it("allows only one open request per address and tenant, but a new one after a rejection", async () => {
      await tx(async (c) => {
        const t = await T("alfa"), b = await T("beta");
        await req(c, t, "dup@example.com", "pending_approval", new Date().toISOString(), "1");
        expect(await rejects(c, `insert into subscription_requests (tenant_id,email,token_hash) values ($1,' DUP@example.com',$2)`, [t, "2".repeat(64)])).toBe(true);
        expect(await rejects(c, `insert into subscription_requests (tenant_id,email,token_hash) values ($1,'dup@example.com',$2)`, [b, "3".repeat(64)])).toBe(false);
        await c.query(`update subscription_requests set status='rejected' where tenant_id=$1 and email='dup@example.com'`, [t]);
        expect(await rejects(c, `insert into subscription_requests (tenant_id,email,token_hash) values ($1,'dup@example.com',$2)`, [t, "4".repeat(64)])).toBe(false);
      });
    });
    it("rejects malformed addresses and header injection", async () => {
      await tx(async (c) => {
        const t = await T("alfa");
        for (const bad of ["foo@", "@bar", "a@example.com\r\nBcc: x@y.z"])
          expect(await rejects(c, `insert into subscription_requests (tenant_id,email,token_hash) values ($1,$2,$3)`, [t, bad, "9".repeat(64)]), bad).toBe(true);
        expect(await rejects(c, `insert into subscription_requests (tenant_id,email,name,token_hash) values ($1,'ok@example.com',E'A\\nB',$2)`, [t, "8".repeat(64)])).toBe(true);
      });
    });
  });
});

describe("function behaviour after the role change", () => {
  it("rows added by add_subscriber are source=manual, rows from import_subscribers are source=import", async () => {
    const t = await admin(async (c) => (await c.query(`select id from tenants where slug='alfa'`)).rows[0].id as string);
    await as({ sub: USERS.senderAlfa, aal: "aal2" }, async (q) => {
      await q.query(`select public.add_subscriber($1,'src-manual@example.com','x',$2)`, [t, H(t, "src-manual@example.com")]);
      expect((await q.query(`select source from subscribers where email='src-manual@example.com'`)).rows[0].source).toBe("manual");
    });
    await as({ sub: USERS.admin, aal: "aal2" }, async (q) => {
      await q.query(`select public.import_subscribers($1,$2::jsonb)`, [t, JSON.stringify([{ email: "src-import@example.com", hash: H(t, "src-import@example.com"), tags: [] }])]);
      expect((await q.query(`select source, confirmed_at from subscribers where email='src-import@example.com'`)).rows[0]).toEqual({ source: "import", confirmed_at: null });
    });
  });
});
