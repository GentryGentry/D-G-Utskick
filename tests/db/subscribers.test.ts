import { afterAll, describe, expect, it } from "vitest";
import { subscriberHash } from "../../src/lib/suppression";
import { MASTER_KEY, USERS } from "./fixtures";
import { admin, as, pool, rejects } from "./helpers";

afterAll(() => pool.end());
const A = { sub: USERS.senderAlfa, aal: "aal2" as const };
const ADM = { sub: USERS.admin, aal: "aal2" as const };
const tenant = async (slug: string) => admin(async (c) => (await c.query(`select id from tenants where slug=$1`, [slug])).rows[0].id as string);
const H = (t: string, e: string) => subscriberHash(MASTER_KEY, t, e);
const errOf = async (q: any, sql: string, p: unknown[] = []) => { await q.query("savepoint e"); try { await q.query(sql, p); await q.query("release savepoint e"); return null; } catch (e: any) { await q.query("rollback to savepoint e"); return e.message as string; } };

describe("add_subscriber", () => {
  it("adds, normalises, and writes an audit row without the address", async () => {
    const t = await tenant("alfa");
    await as(A, async (q) => {
      const id = (await q.query(`select public.add_subscriber($1,'  Ny.Person@Example.COM ','Ny',$2) id`, [t, H(t, "ny.person@example.com")])).rows[0].id;
      const row = (await q.query(`select email,status,first_name from subscribers where id=$1`, [id])).rows[0];
      expect(row).toEqual({ email: "ny.person@example.com", status: "active", first_name: "Ny" });
    });
    await as(ADM, async (q) => {
      const rows = (await q.query(`select action,target from audit_log where tenant_id=$1`, [t])).rows;
      expect(JSON.stringify(rows)).not.toContain("@");
    });
  });
  it("rejects duplicates (case-insensitive), invalid addresses and malformed hashes", async () => {
    const t = await tenant("alfa");
    await as(A, async (q) => {
      expect(await errOf(q, `select public.add_subscriber($1,' BOENDE010@ALFA.example.com ','x',$2)`, [t, H(t, "boende010@alfa.example.com")])).toBe("duplicate");
      expect(await errOf(q, `select public.add_subscriber($1,'foo@','x',$2)`, [t, H(t, "foo@")])).toBe("invalid_email");
      expect(await errOf(q, `select public.add_subscriber($1,E'a@example.com\\nBcc: x@y.z','x',$2)`, [t, H(t, "a@example.com")])).toBe("invalid_email");
      expect(await errOf(q, `select public.add_subscriber($1,'ok@example.com','x','nothex')`, [t])).toBe("bad_hash");
    });
  });
  it("refuses an address that is in suppressions", async () => {
    const t = await tenant("alfa");
    await as(A, async (q) => {
      expect(await errOf(q, `select public.add_subscriber($1,'avregistrerad1@alfa.example.com','x',$2)`, [t, H(t, "avregistrerad1@alfa.example.com")])).toBe("suppressed");
    });
  });
  it("the same suppression hash does not block the same address in another tenant", async () => {
    const b = await tenant("beta");
    await as({ sub: USERS.senderBeta, aal: "aal2" }, async (q) => {
      expect(await errOf(q, `select public.add_subscriber($1,'avregistrerad1@alfa.example.com','x',$2)`, [b, H(b, "avregistrerad1@alfa.example.com")])).toBeNull();
    });
  });
  it("strips line breaks from the first name", async () => {
    const t = await tenant("alfa");
    await as(A, async (q) => {
      const id = (await q.query(`select public.add_subscriber($1,'nl@example.com',E'Anna\\r\\nBcc: x',$2) id`, [t, H(t, "nl@example.com")])).rows[0].id;
      expect((await q.query(`select first_name from subscribers where id=$1`, [id])).rows[0].first_name).not.toMatch(/[\r\n]/);
    });
  });
});

describe("status rules", () => {
  const find = async (status: string, slug = "alfa") => admin(async (c) => (await c.query(
    `select s.id from subscribers s join tenants t on t.id=s.tenant_id where t.slug=$1 and s.status=$2 limit 1`, [slug, status])).rows[0].id as string);

  it("a sender can deactivate and reactivate an active address", async () => {
    const id = await find("active");
    await as(A, async (q) => {
      await q.query(`select public.set_subscriber_active($1,false)`, [id]);
      expect((await q.query(`select status from subscribers where id=$1`, [id])).rows[0].status).toBe("inactive");
      await q.query(`select public.set_subscriber_active($1,true)`, [id]);
      expect((await q.query(`select status from subscribers where id=$1`, [id])).rows[0].status).toBe("active");
    });
  });
  it.each(["unsubscribed", "bounced", "complained"])("a sender can NEVER reactivate a %s address", async (st) => {
    const id = await find(st);
    await as(A, async (q) => {
      expect(await errOf(q, `select public.set_subscriber_active($1,true)`, [id])).toBe("status_locked");
      expect(await errOf(q, `select public.set_subscriber_active($1,false)`, [id])).toBe("status_locked");
    });
    await as(ADM, async (q) => expect(await errOf(q, `select public.set_subscriber_active($1,true)`, [id])).toBe("status_locked"));
  });
  it("changing the address of an unsubscribed person is refused, a name change is fine", async () => {
    const id = await find("unsubscribed");
    const t = await tenant("alfa");
    await as(A, async (q) => {
      expect(await errOf(q, `select public.update_subscriber($1,'x','another@example.com',$2)`, [id, H(t, "another@example.com")])).toBe("status_locked");
      const cur = (await q.query(`select email,email_hash from subscribers where id=$1`, [id])).rows[0];
      expect(await errOf(q, `select public.update_subscriber($1,'Nytt namn',$2,$3)`, [id, cur.email, cur.email_hash])).toBeNull();
    });
  });
  it("editing an active address to a suppressed or already-present one is refused", async () => {
    const id = await find("active");
    const t = await tenant("alfa");
    await as(A, async (q) => {
      expect(await errOf(q, `select public.update_subscriber($1,'x','avregistrerad2@alfa.example.com',$2)`, [id, H(t, "avregistrerad2@alfa.example.com")])).toBe("suppressed");
      expect(await errOf(q, `select public.update_subscriber($1,'x','boende050@alfa.example.com',$2)`, [id, H(t, "boende050@alfa.example.com")])).toBe("duplicate");
      expect(await errOf(q, `select public.update_subscriber($1,'x','fresh@example.com',$2)`, [id, H(t, "fresh@example.com")])).toBeNull();
    });
  });
});

describe("delete_subscriber (Ta bort adress)", () => {
  it("removes the person, keeps an opt-out hash, keeps history without a person link", async () => {
    const t = await tenant("alfa");
    await as(A, async (q) => {
      const r = (await q.query(`select s.id, s.email_hash from campaign_recipients cr join subscribers s on s.id=cr.subscriber_id where cr.tenant_id=$1 limit 1`, [t])).rows[0];
      await q.query(`select public.delete_subscriber($1)`, [r.id]);
      expect((await q.query(`select count(*) n from subscribers where id=$1`, [r.id])).rows[0].n).toBe("0");
      expect((await q.query(`select reason from suppressions where tenant_id=$1 and email_hash=$2`, [t, r.email_hash])).rows[0].reason).toBe("deleted");
      expect((await q.query(`select count(*) n from campaign_recipients where tenant_id=$1 and subscriber_id is null`, [t])).rows[0].n).toBe("1");
    });
  });
  it("after deleting, the same address cannot be added again", async () => {
    const t = await tenant("alfa");
    await as(A, async (q) => {
      const r = (await q.query(`select id,email,email_hash from subscribers where tenant_id=$1 and status='active' limit 1`, [t])).rows[0];
      await q.query(`select public.delete_subscriber($1)`, [r.id]);
      expect(await errOf(q, `select public.add_subscriber($1,$2,'x',$3)`, [t, r.email, r.email_hash])).toBe("suppressed");
    });
  });
});

describe("erase_person (Radera helt på begäran)", () => {
  it("removes subscriber, suppression hash and provider events; keeps no identifier anywhere", async () => {
    const t = await tenant("alfa");
    const email = "avregistrerad3@alfa.example.com";
    await admin(async (c) => { await c.query("begin");
      try {
        await c.query(`insert into provider_events (tenant_id,provider,raw_payload) values ($1,'ses',$2)`, [t, JSON.stringify({ bounce: { to: email } })]);
        await c.query(`insert into subscribers (tenant_id,email,email_hash,status) values ($1,$2,$3,'unsubscribed')`, [t, email, H(t, email)]);
        await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: USERS.admin, aal: "aal2" })]);
        await c.query(`set local role authenticated`);
        const res = (await c.query(`select public.erase_person($1,$2,$3) r`, [t, ` ${email.toUpperCase()} `, H(t, email)])).rows[0].r;
        expect(res).toEqual({ subscribers: 1, suppressions: 1, events: 1 });
        await c.query(`reset role`);
        expect((await c.query(`select count(*) n from suppressions where tenant_id=$1 and email_hash=$2`, [t, H(t, email)])).rows[0].n).toBe("0");
        expect((await c.query(`select count(*) n from provider_events where raw_payload::text ilike '%avregistrerad3%'`)).rows[0].n).toBe("0");
        const audit = (await c.query(`select action,target from audit_log where action='person.erased'`)).rows;
        expect(audit).toHaveLength(1);
        expect(JSON.stringify(audit)).not.toMatch(/avregistrerad|@/);
      } finally { await c.query("rollback"); }
    });
  });
  it("after full erasure the address can be added again (no hash kept)", async () => {
    const t = await tenant("alfa");
    const email = "avregistrerad4@alfa.example.com";
    await as(ADM, async (q) => {
      await q.query(`select public.erase_person($1,$2,$3)`, [t, email, H(t, email)]);
      expect(await errOf(q, `select public.add_subscriber($1,$2,'x',$3)`, [t, email, H(t, email)])).toBeNull();
    });
  });
  it("only touches the named tenant", async () => {
    const [a, b] = [await tenant("alfa"), await tenant("beta")];
    await as(ADM, async (q) => {
      await q.query(`select public.erase_person($1,'shared@example.com',$2)`, [a, H(a, "shared@example.com")]);
      expect((await q.query(`select count(*) n from subscribers where tenant_id=$1 and email='shared@example.com'`, [b])).rows[0].n).toBe("1");
      expect((await q.query(`select count(*) n from subscribers where tenant_id=$1 and email='shared@example.com'`, [a])).rows[0].n).toBe("0");
    });
  });
});

describe("import", () => {
  const row = (t: string, email: string, extra: object = {}) => ({ email, first_name: null, tags: [], hash: H(t, email), ...extra });

  it("inserts new, skips existing and suppressed, never reactivates, adds tags, is idempotent", async () => {
    const t = await tenant("alfa");
    const rows = [
      row(t, "import1@example.com", { first_name: "Ida", tags: ["nyboende", "trapphus-a"] }),
      row(t, "IMPORT2@example.com ", { tags: ["nyboende"] }),
      row(t, "boende001@alfa.example.com", { tags: ["extra"] }),           // existing and unsubscribed
      row(t, "avregistrerad1@alfa.example.com", { tags: ["spokad"] }),     // suppressed
      { email: "foo@", first_name: null, tags: [], hash: "0".repeat(64) }, // invalid
      row(t, "import1@example.com"),                                       // duplicate in file
    ];
    rows[1].hash = H(t, "import2@example.com");
    await as(ADM, async (q) => {
      const r1 = (await q.query(`select public.import_subscribers($1,$2::jsonb) r`, [t, JSON.stringify(rows)])).rows[0].r;
      expect(r1).toEqual({ received: 6, unique_valid: 4, suppressed: 1, inserted: 2, existing: 1 });
      expect((await q.query(`select status from subscribers where tenant_id=$1 and email='boende001@alfa.example.com'`, [t])).rows[0].status).toBe("unsubscribed");
      expect((await q.query(`select count(*) n from subscribers where tenant_id=$1 and email='avregistrerad1@alfa.example.com'`, [t])).rows[0].n).toBe("0");
      const tags = (await q.query(`select tg.name from subscriber_tags st join tags tg on tg.id=st.tag_id join subscribers s on s.id=st.subscriber_id where s.tenant_id=$1 and s.email='import1@example.com' order by 1`, [t])).rows.map((x: any) => x.name);
      expect(tags).toEqual(["nyboende", "trapphus-a"]);
      expect((await q.query(`select count(*) n from tags where tenant_id=$1 and name='spokad'`, [t])).rows[0].n).toBe("0");
      const r2 = (await q.query(`select public.import_subscribers($1,$2::jsonb) r`, [t, JSON.stringify(rows)])).rows[0].r;
      expect(r2).toMatchObject({ inserted: 0, existing: 3, suppressed: 1 });
    });
  });
  it("ignores a client-supplied hash that is malformed instead of importing the row", async () => {
    const t = await tenant("alfa");
    await as(ADM, async (q) => {
      const r = (await q.query(`select public.import_subscribers($1,$2::jsonb) r`, [t, JSON.stringify([{ email: "x@example.com", hash: "short" }])])).rows[0].r;
      expect(r).toMatchObject({ inserted: 0, unique_valid: 0 });
    });
  });
  it("rejects more than 5000 rows, non-array input, and caps tags per row at 10", async () => {
    const t = await tenant("alfa");
    await as(ADM, async (q) => {
      expect(await errOf(q, `select public.import_subscribers($1,$2::jsonb)`, [t, JSON.stringify(Array.from({ length: 5001 }, (_, i) => row(t, `u${i}@example.com`)))])).toBe("too_many_rows");
      expect(await errOf(q, `select public.import_subscribers($1,'{"a":1}'::jsonb)`, [t])).toBe("rows_must_be_array");
      const tags = Array.from({ length: 15 }, (_, i) => `t${i}`);
      await q.query(`select public.import_subscribers($1,$2::jsonb)`, [t, JSON.stringify([row(t, "manytags@example.com", { tags })])]);
      expect((await q.query(`select count(*) n from subscriber_tags st join subscribers s on s.id=st.subscriber_id where s.email='manytags@example.com'`)).rows[0].n).toBe("10");
    });
  });
  it("preview reports existing and suppressed hashes, suppression wins in the app", async () => {
    const t = await tenant("alfa");
    await as(ADM, async (q) => {
      const hs = [H(t, "boende001@alfa.example.com"), H(t, "avregistrerad1@alfa.example.com"), H(t, "nobody@example.com")];
      const r = (await q.query(`select h, kind from public.import_preview($1,$2::text[])`, [t, hs])).rows;
      expect(r).toEqual(expect.arrayContaining([{ h: hs[0], kind: "existing" }, { h: hs[1], kind: "suppressed" }]));
      expect(r.find((x: any) => x.h === hs[2])).toBeUndefined();
    });
  });
});

describe("audit trail hygiene", () => {
  it("no audit row contains an e-mail address after a busy session", async () => {
    const t = await tenant("alfa");
    await as(ADM, async (q) => {
      await q.query(`select public.import_subscribers($1,$2::jsonb)`, [t, JSON.stringify([{ email: "audit@example.com", hash: H(t, "audit@example.com"), tags: [] }])]);
      await q.query(`select public.log_list_export($1)`, [t]);
      const rows = (await q.query(`select action, target from audit_log`)).rows;
      expect(rows.length).toBeGreaterThan(2);
      expect(JSON.stringify(rows)).not.toContain("@");
    });
  });
});
