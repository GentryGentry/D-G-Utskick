import { describe, expect, it } from "vitest";
import { chooseAdminTenant, wrongTenantWarning } from "../../src/lib/import-guard";

const alfa = { id: "a", name: "Brf Testgården Alfa" }, beta = { id: "b", name: "Brf Provbacken Beta" };

describe("chooseAdminTenant", () => {
  it("never picks an association silently when the admin has several (the 23 Nov test 11 mistake)", () => {
    expect(chooseAdminTenant([beta, alfa], undefined)).toBeNull();
    expect(chooseAdminTenant([beta, alfa], "unknown")).toBeNull();
  });
  it("uses the requested one, or the only one", () => {
    expect(chooseAdminTenant([beta, alfa], "a")).toBe(alfa);
    expect(chooseAdminTenant([alfa], undefined)).toBe(alfa);
    expect(chooseAdminTenant([], undefined)).toBeNull();
  });
});

describe("wrongTenantWarning", () => {
  it("warns when the Alfa file is previewed in Beta", () => {
    const w = wrongTenantWarning({ name: beta.name, matches: 1 }, [{ name: alfa.name, matches: 4 }]);
    expect(w).toContain("Brf Testgården Alfa");
    expect(w).toContain("fel förening");
  });
  it("stays quiet in the right association, for a file of only new people, and on a single stray match", () => {
    expect(wrongTenantWarning({ name: alfa.name, matches: 4 }, [{ name: beta.name, matches: 1 }])).toBeNull();
    expect(wrongTenantWarning({ name: alfa.name, matches: 0 }, [{ name: beta.name, matches: 0 }])).toBeNull();
    expect(wrongTenantWarning({ name: alfa.name, matches: 0 }, [{ name: beta.name, matches: 1 }])).toBeNull();
    expect(wrongTenantWarning({ name: alfa.name, matches: 3 }, [])).toBeNull();
  });
});
