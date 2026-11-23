// Proves the isolation suite has teeth: weaken the database in every way we can think of and
// require the suite to go red. Each mutation is restored afterwards.
import { afterAll, describe, expect, it } from "vitest";
import { admin, pool } from "./helpers";
import { runIsolationChecks } from "./isolation-checks";

type Pol = { tablename: string; policyname: string; cmd: string; roles: string; qual: string | null; with_check: string | null };
const roles = (r: string) => r.replace(/[{}]/g, "");
const create = (p: Pol) =>
  `create policy "${p.policyname}" on public.${p.tablename} as permissive for ${p.cmd.toLowerCase()} to ${roles(p.roles)}` +
  (p.qual ? ` using (${p.qual})` : "") + (p.with_check ? ` with check (${p.with_check})` : "");

async function policies(): Promise<Pol[]> {
  return admin(async (c) => (await c.query(
    `select tablename, policyname, cmd, roles::text as roles, qual, with_check from pg_policies where schemaname='public'`)).rows);
}
const exec = (sql: string) => admin((c) => c.query(sql));

afterAll(() => pool.end());

describe("baseline", () => {
  it("is green before any mutation", async () => expect(await runIsolationChecks()).toEqual([]));
});

describe("every policy matters", () => {
  it("has a sane number of policies to mutate", async () => expect((await policies()).length).toBeGreaterThanOrEqual(15));

  it("DROPPING any single policy turns the suite red", async () => {
    const survivors: string[] = [];
    for (const p of await policies()) {
      await exec(`drop policy "${p.policyname}" on public.${p.tablename}`);
      try { if ((await runIsolationChecks()).length === 0) survivors.push(`${p.tablename}.${p.policyname}`); }
      finally { await exec(create(p)); }
    }
    expect(survivors, "dropping these policies went unnoticed").toEqual([]);
  });

  it("making any single policy permissive (using true) turns the suite red", async () => {
    const survivors: string[] = [];
    for (const p of await policies()) {
      const permissive = `create policy "${p.policyname}" on public.${p.tablename} as permissive for ${p.cmd.toLowerCase()} to ${roles(p.roles)}` +
        (p.cmd === "INSERT" ? ` with check (true)` : p.cmd === "SELECT" || p.cmd === "DELETE" ? ` using (true)` : ` using (true) with check (true)`);
      await exec(`drop policy "${p.policyname}" on public.${p.tablename}`);
      await exec(permissive);
      try { if ((await runIsolationChecks()).length === 0) survivors.push(`${p.tablename}.${p.policyname}`); }
      finally { await exec(`drop policy "${p.policyname}" on public.${p.tablename}`); await exec(create(p)); }
    }
    expect(survivors, "permissive versions of these policies went unnoticed").toEqual([]);
  });

  it("DISABLING RLS on any table turns the suite red", async () => {
    const tables = (await policies()).map((p) => p.tablename).filter((t, i, a) => a.indexOf(t) === i);
    const survivors: string[] = [];
    for (const t of tables) {
      await exec(`alter table public.${t} disable row level security`);
      try { if ((await runIsolationChecks()).length === 0) survivors.push(t); }
      finally { await exec(`alter table public.${t} enable row level security`); }
    }
    expect(survivors).toEqual([]);
  });

  it("neutralising any guard or helper function turns the suite red", async () => {
    const survivors: string[] = [];
    const targets: [string, string][] = [
      ["private.assert_staff(uuid)", "returns void language plpgsql as $$ begin end $$"],
      ["private.is_staff(uuid)", "returns boolean language sql as $$ select true $$"],
      ["private.assert_admin(uuid)", "returns void language plpgsql as $$ begin end $$"],
      ["private.is_member(uuid)", "returns boolean language sql as $$ select true $$"],
      ["private.has_role(uuid, public.member_role)", "returns boolean language sql as $$ select true $$"],
      ["private.is_aal2()", "returns boolean language sql as $$ select true $$"],
      ["private.assert_terms(uuid)", "returns void language plpgsql as $$ begin end $$"],
      ["private.terms_ok(uuid)", "returns boolean language sql as $$ select true $$"],
    ];
    for (const [sig, body] of targets) {
      const oid = await admin(async (c) => (await c.query(`select pg_get_functiondef('${sig}'::regprocedure) d`)).rows[0].d as string);
      const name = sig.slice(0, sig.indexOf("("));
      const args = sig.slice(sig.indexOf("("));
      const argList = args === "(uuid)" ? "(t uuid)" : args === "()" ? "()" : "(t uuid, r public.member_role)";
      await exec(`create or replace function ${name}${argList} ${body}`);
      try { if ((await runIsolationChecks()).length === 0) survivors.push(sig); }
      finally { await exec(oid); }
    }
    expect(survivors, "these guards could be removed unnoticed").toEqual([]);
  });

  it("exposing opened (per-person data) through the API turns the suite red", async () => {
    await exec(`grant select (opened) on public.campaign_recipients to authenticated`);
    try { expect((await runIsolationChecks()).length).toBeGreaterThan(0); }
    finally { await exec(`revoke select (opened) on public.campaign_recipients from authenticated`); }
  });

  it("letting users write archive fields or sign-up requests turns the suite red", async () => {
    for (const [grant, revoke] of [
      [`grant update (archive_visible) on public.campaigns to authenticated`, `revoke update (archive_visible) on public.campaigns from authenticated`],
      [`grant insert, update on public.subscription_requests to authenticated`, `revoke insert, update on public.subscription_requests from authenticated`],
    ]) {
      await exec(grant);
      try { expect((await runIsolationChecks()).length, grant).toBeGreaterThan(0); } finally { await exec(revoke); }
    }
  });

  it("granting direct write access on subscribers turns the suite red", async () => {
    await exec(`grant insert, update, delete on public.subscribers to authenticated`);
    try { expect((await runIsolationChecks()).length).toBeGreaterThan(0); }
    finally { await exec(`revoke insert, update, delete on public.subscribers from authenticated`); }
  });

  it("granting execute on admin functions to anon turns the suite red", async () => {
    await exec(`grant execute on function public.add_subscriber(uuid,text,text,text), public.delete_subscriber(uuid) to anon`);
    try { expect((await runIsolationChecks()).length).toBeGreaterThan(0); }
    finally { await exec(`revoke execute on function public.add_subscriber(uuid,text,text,text), public.delete_subscriber(uuid) from anon, public`); }
  });

  it("is green again after all restores", async () => expect(await runIsolationChecks()).toEqual([]));
});
