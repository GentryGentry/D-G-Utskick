import { describe, expect, it, afterAll } from "vitest";
import { pool } from "./helpers";
import { runIsolationChecks } from "./isolation-checks";

afterAll(() => pool.end());
describe("tenant isolation", () => {
  it("passes every isolation and permission check", async () => {
    expect(await runIsolationChecks()).toEqual([]);
  });
});
