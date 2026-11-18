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
  it("has a sane number of policies to mutate", async () => expect((await policies()).length).toBeGreaterThanOrEqual(20));

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

  it("is green again after all restores", async () => expect(await runIsolationChecks()).toEqual([]));
});
