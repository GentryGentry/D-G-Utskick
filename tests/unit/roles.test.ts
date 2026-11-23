import { describe, expect, it } from "vitest";
import { adminTenantsOf, canManage, mustAcceptTerms } from "../../src/lib/roles";

const s = (needs: boolean) => ({ version: 1, body: "x", needs_acceptance: needs });

describe("who may manage the list", () => {
  it("admin and sender may, board may not", () => {
    expect(canManage("dg_admin")).toBe(true);
    expect(canManage("sender")).toBe(true);
    expect(canManage("board_viewer")).toBe(false);
  });
});

describe("import and full erase are admin only (D-019, D-031)", () => {
  it("a sender, like Carl, gets no association to import into or erase in", () =>
    expect(adminTenantsOf([{ id: "a", role: "sender" as const }])).toEqual([]));
  it("a board member gets none either", () =>
    expect(adminTenantsOf([{ id: "a", role: "board_viewer" as const }])).toEqual([]));
  it("someone who is sender in one association and admin in another gets only the admin one", () =>
    expect(adminTenantsOf([{ id: "a", role: "sender" as const }, { id: "b", role: "dg_admin" as const }]).map((t) => t.id)).toEqual(["b"]));
});

describe("terms gate (D-031)", () => {
  it("a sender who has not accepted must accept", () => expect(mustAcceptTerms("sender", s(true))).toBe(true));
  it("a sender who has accepted passes", () => expect(mustAcceptTerms("sender", s(false))).toBe(false));
  it("fails closed: if the status cannot be read, the sender is stopped", () => {
    expect(mustAcceptTerms("sender", null)).toBe(true);
    expect(mustAcceptTerms("sender", undefined)).toBe(true);
  });
  it("the admin is never asked, even if the status says so", () => expect(mustAcceptTerms("dg_admin", s(true))).toBe(false));
  it("the board is never asked (it cannot reach the list anyway)", () => expect(mustAcceptTerms("board_viewer", s(true))).toBe(false));
});
