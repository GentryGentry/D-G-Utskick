import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeCsvBytes, parseSubscriberCsv } from "../../src/lib/csv";

const load = (f: string) => { const r = parseSubscriberCsv(decodeCsvBytes(readFileSync(`tests/fixtures/${f}`))); if (!r.ok) throw new Error(r.error); return r.analysis; };

describe("import fixtures (used for the manual check in README)", () => {
  for (const f of ["import-alfa.csv", "import-alfa-excel-1252.csv"]) {
    it(`${f}: 9 unique valid rows, 1 in-file duplicate, 3 invalid (lines 10, 11, 12)`, () => {
      const a = load(f);
      expect(a.rows).toHaveLength(9);
      expect(a.duplicatesInFile).toBe(1);
      expect(a.invalid.map((i) => i.line)).toEqual([10, 11, 12]);
      expect(a.rows.find((r) => r.email === "ny.boende1@alfa.example.com")?.tags).toEqual(["trapphus-a", "nyboende", "styrelse"]);
      expect(a.rows.find((r) => r.email === "ny.boende3@alfa.example.com")?.first_name).toBe("Märta");
    });
  }
  it("Windows-1252 and UTF-8 files give identical results (å, ä, ö survive)", () => {
    expect(load("import-alfa-excel-1252.csv")).toEqual(load("import-alfa.csv"));
    expect(load("import-alfa.csv").rows.map((r) => r.first_name)).toContain("Åsa");
  });
});
