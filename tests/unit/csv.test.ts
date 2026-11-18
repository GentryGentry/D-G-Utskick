import { describe, expect, it } from "vitest";
import { decodeCsvBytes, parseCsv, parseSubscriberCsv, toCsv } from "../../src/lib/csv";

const ok = (t: string) => { const r = parseSubscriberCsv(t); if (!r.ok) throw new Error(r.error); return r.analysis; };

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, embedded newlines and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n"l1\nl2",z')).toEqual([["a", "b"], ["x, y", 'he said "hi"'], ["l1\nl2", "z"]]);
  });
  it("detects semicolon and tab delimiters and strips a BOM", () => {
    expect(parseCsv("﻿a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("skips blank lines and survives a missing trailing newline", () => {
    expect(parseCsv("a,b\n\n1,2\n\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("does not hang or throw on an unterminated quote", () => {
    expect(() => parseCsv('a,b\n"oops,1')).not.toThrow();
  });
});

describe("parseSubscriberCsv", () => {
  it("maps Swedish headers, tags and names", () => {
    const a = ok("E-post;Förnamn;Taggar\nanna@example.com;Anna;trapphus-a, styrelse\n");
    expect(a.rows).toEqual([{ email: "anna@example.com", first_name: "Anna", tags: ["trapphus-a", "styrelse"] }]);
  });
  it("normalises and de-duplicates, merging tags", () => {
    const a = ok("email,förnamn,taggar\n Anna@Example.com ,,a\nanna@example.com,Anna,b\n");
    expect(a.rows).toHaveLength(1);
    expect(a.duplicatesInFile).toBe(1);
    expect(a.rows[0]).toMatchObject({ email: "anna@example.com", first_name: "Anna", tags: ["a", "b"] });
  });
  it("reports invalid and empty rows with line numbers, never as valid", () => {
    const a = ok("email\nfoo@\n@bar\n\nok@example.com\n \nx@y@z\n");
    expect(a.rows.map((r) => r.email)).toEqual(["ok@example.com"]);
    expect(a.invalid.map((i) => i.line)).toEqual([2, 3, 7]);
  });
  it("rejects header-injection attempts as invalid", () => {
    expect(ok('email\n"a@example.com\r\nBcc: x@y.z"\n').rows).toEqual([]);
  });
  it("accepts plus-addresses and unicode domains", () => {
    expect(ok("email\na+b@example.com\nåsa@bostäder.example.org\n").rows).toHaveLength(2);
  });
  it("fails clearly without an email column, on empty input and on too many rows", () => {
    expect(parseSubscriberCsv("namn,taggar\nAnna,a")).toEqual({ ok: false, error: "no_email_column" });
    expect(parseSubscriberCsv("")).toEqual({ ok: false, error: "empty" });
    expect(parseSubscriberCsv("email\n" + "a@example.com\n".repeat(5001))).toEqual({ ok: false, error: "too_many_rows" });
  });
  it("limits tags to 60 characters", () => {
    expect(ok(`email,taggar\na@example.com,${"x".repeat(61)}|ok\n`).rows[0].tags).toEqual(["ok"]);
  });
});

describe("encoding", () => {
  it("reads UTF-8", () => expect(decodeCsvBytes(new TextEncoder().encode("Åsa"))).toBe("Åsa"));
  it("falls back to Windows-1252 (Swedish Excel)", () => {
    const bytes = new Uint8Array([0xc5, 0x73, 0x61, 0x20, 0xe4, 0xf6]); // "Åsa äö" in cp1252
    expect(decodeCsvBytes(bytes)).toBe("Åsa äö");
  });
});

describe("toCsv", () => {
  it("neutralises spreadsheet formulas", () => {
    const out = toCsv([["email", "namn"], ["a@example.com", "=HYPERLINK(\"http://evil\")"], ["b@example.com", "+1"], ["c@example.com", "@SUM(A1)"]]);
    expect(out).not.toMatch(/(^|;)[=+@]/m);
    expect(out).toContain("'=HYPERLINK");
  });
  it("quotes delimiters, quotes and newlines", () => {
    expect(toCsv([["a;b", 'c"d', "e\nf"]])).toBe('﻿"a;b";"c""d";"e\nf"\r\n');
  });
  it("round-trips through the importer, including guarded cells", () => {
    const csv = toCsv([["email", "förnamn", "taggar"], ["+tag@example.com", "=Evil", "a, b"], ["x@example.com", "Åsa", ""]]);
    const a = ok(csv);
    expect(a.rows).toEqual([
      { email: "+tag@example.com", first_name: "=Evil", tags: ["a", "b"] },
      { email: "x@example.com", first_name: "Åsa", tags: [] },
    ]);
  });
});
