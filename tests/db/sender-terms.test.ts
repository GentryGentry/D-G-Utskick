// D-031: the record of who accepted the sender terms must be trustworthy, so it cannot be edited afterwards.
import { afterAll, describe, expect, it } from "vitest";
import { USERS } from "./fixtures";
import { admin, as, pool, rejects } from "./helpers";

afterAll(() => pool.end());
const tenant = async (slug: string) => admin(async (c) => (await c.query(`select id from tenants where slug=$1`, [slug])).rows[0].id as string);
const fresh = { sub: USERS.senderAlfa, aal: "aal2" as const,
  setup: `set local dg.allow_audit_purge = 'on'; delete from terms_acceptances where user_id = '${USERS.senderAlfa}'` };

describe("sender terms", () => {
  it("version 1 exists and is the text Allen approved in principle", async () => {
    const t = await tenant("alfa");
    await as({ sub: USERS.senderAlfa, aal: "aal2" }, async (q) => {
      const s = (await q.query(`select public.sender_terms_status($1) s`, [t])).rows[0].s;
      expect(s.version).toBe(1);
      expect(s.body).toMatch(/den boende själv har lämnat/);
      expect(s.needs_acceptance).toBe(false);
    });
  });

  it("accepting stores user, association, version and time, and writes an audit row without personal data", async () => {
    const t = await tenant("alfa");
    await as(fresh, async (q) => {
      await q.query(`select public.accept_sender_terms($1,1)`, [t]);
      await q.query(`select public.accept_sender_terms($1,1)`, [t]); // a double click is harmless
      await q.query("reset role");
      const rows = (await q.query(`select user_id, tenant_id, terms_version, accepted_at from terms_acceptances where user_id=$1`, [USERS.senderAlfa])).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: USERS.senderAlfa, tenant_id: t, terms_version: 1 });
      expect(rows[0].accepted_at).toBeInstanceOf(Date);
      const audit = (await q.query(`select action, target from audit_log where tenant_id=$1 and action='terms.accepted'`, [t])).rows;
      expect(audit.length).toBeGreaterThanOrEqual(1);
      expect(audit[0].target).toBe("v1");
    });
  });

  it("an acceptance in Alfa does not count in Beta", async () => {
    await admin(async (c) => {
      const n = Number((await c.query(`select count(*) n from terms_acceptances a join tenants t on t.id=a.tenant_id where a.user_id=$1 and t.slug='beta'`, [USERS.senderAlfa])).rows[0].n);
      expect(n).toBe(0);
    });
  });

  it("neither the texts nor the acceptances can be changed or removed, even by the table owner", async () => {
    await admin(async (c) => {
      await c.query("begin");
      try {
        expect(await rejects(c, `update sender_terms set body='Något annat än det som godkändes.' where version=1`)).toBe(true);
        expect(await rejects(c, `delete from sender_terms where version=1`)).toBe(true);
        expect(await rejects(c, `update terms_acceptances set accepted_at=now() - interval '1 year'`)).toBe(true);
        expect(await rejects(c, `delete from terms_acceptances`)).toBe(true);
      } finally { await c.query("rollback"); }
    });
  });
});
