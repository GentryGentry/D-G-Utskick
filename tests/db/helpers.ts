import pg from "pg";

export const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });

/** `setup` runs as the database owner inside the same (rolled-back) transaction, before switching role.
 *  Used to put the database in a state for one check only, e.g. "this sender has not accepted the terms". */
export type Actor = { sub?: string; aal?: "aal1" | "aal2"; role?: "authenticated" | "anon"; setup?: string };

/** Run fn inside a transaction as the given API role/JWT. Always rolls back. */
export async function as<T>(actor: Actor, fn: (q: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    if (actor.setup) await c.query(actor.setup);
    await c.query(`set local role ${actor.role ?? "authenticated"}`);
    const claims = actor.sub ? { sub: actor.sub, aal: actor.aal ?? "aal1", role: actor.role ?? "authenticated" } : {};
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    return await fn(c);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}

/** Returns true if the statement is rejected (error), false if it succeeds. Uses a savepoint. */
export async function rejects(c: pg.PoolClient, sql: string, params: unknown[] = []): Promise<boolean> {
  await c.query("savepoint s");
  try { await c.query(sql, params); await c.query("release savepoint s"); return false; }
  catch { await c.query("rollback to savepoint s"); return true; }
}

export async function admin<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { return await fn(c); } finally { c.release(); }
}
