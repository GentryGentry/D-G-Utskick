import { isValidEmail, normalizeEmail } from "./email";

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 1_000_000;

/** Excel in Swedish often saves Windows-1252, not UTF-8. Try strict UTF-8 first, then fall back. */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("windows-1252").decode(bytes); }
}

function detectDelimiter(firstLine: string): string {
  let best = ",", bestCount = -1, inQuotes = false;
  const counts: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  for (const d of [";", ",", "\t"]) if (counts[d] > bestCount) { best = d; bestCount = counts[d]; }
  return best;
}

export type CsvLine = { cells: string[]; line: number };

/** RFC 4180-style parser: quotes, doubled quotes, CRLF/LF, BOM, embedded newlines. Skips blank lines
 *  but keeps the real line number of every row (1-based, as shown in Notepad/Excel). */
export function parseCsvLines(input: string): CsvLine[] {
  const text = input.replace(/^\uFEFF/, "");
  const delim = detectDelimiter(text.split(/\r?\n/, 1)[0] ?? "");
  const out: CsvLine[] = [];
  let row: string[] = [], field = "", inQuotes = false, i = 0, lineNo = 1, rowStart = 1;
  const endField = () => { row.push(field); field = ""; };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0].trim() === "")) out.push({ cells: row, line: rowStart });
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else { if (ch === "\n") lineNo++; field += ch; }
    } else if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delim) endField();
    else if (ch === "\r") { if (text[i + 1] === "\n") i++; endRow(); lineNo++; rowStart = lineNo; }
    else if (ch === "\n") { endRow(); lineNo++; rowStart = lineNo; }
    else field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) endRow();
  return out;
}

export function parseCsv(input: string): string[][] { return parseCsvLines(input).map((r) => r.cells); }

export type ImportRow = { email: string; first_name: string | null; tags: string[] };
export type InvalidRow = { line: number; reason: "invalid_email" | "empty" };
export type Analysis = {
  rows: ImportRow[];              // valid, unique by normalised address
  invalid: InvalidRow[];
  duplicatesInFile: number;
};
export type ParseResult = { ok: true; analysis: Analysis } | { ok: false; error: "no_header" | "no_email_column" | "too_many_rows" | "empty" };

const EMAIL_HEADERS = ["email", "e-post", "epost", "e-mail", "mail", "mejl", "epostadress", "e-postadress"];
const NAME_HEADERS = ["förnamn", "fornamn", "first_name", "firstname", "first name", "namn", "name"];
const TAG_HEADERS = ["taggar", "tagg", "tags", "tag"];
const norm = (s: string) => s.trim().toLowerCase();

/** Undo our own export's formula-injection guard so export → import round-trips. */
function unguard(cell: string): string {
  return /^'[=+\-@]/.test(cell) ? cell.slice(1) : cell;
}

export function parseSubscriberCsv(text: string): ParseResult {
  const table = parseCsvLines(text);
  if (table.length === 0) return { ok: false, error: "empty" };
  const header = table[0].cells.map(norm);
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const iEmail = col(EMAIL_HEADERS);
  if (iEmail < 0) return { ok: false, error: "no_email_column" };
  const iName = col(NAME_HEADERS), iTags = col(TAG_HEADERS);
  const body = table.slice(1);
  if (body.length > MAX_IMPORT_ROWS) return { ok: false, error: "too_many_rows" };

  const seen = new Map<string, ImportRow>();
  const invalid: InvalidRow[] = [];
  let duplicatesInFile = 0;
  body.forEach(({ cells, line }) => {
    const rawEmail = unguard((cells[iEmail] ?? "").trim());
    if (rawEmail === "") { invalid.push({ line, reason: "empty" }); return; }
    if (!isValidEmail(rawEmail)) { invalid.push({ line, reason: "invalid_email" }); return; }
    const email = normalizeEmail(rawEmail);
    const first = iName >= 0 ? unguard((cells[iName] ?? "").trim()).replace(/[\r\n]+/g, " ") : "";
    const tags = iTags >= 0
      ? (cells[iTags] ?? "").split(/[,;|]/).map((t) => t.trim().replace(/[\r\n]+/g, " ")).filter((t) => t.length > 0 && t.length <= 60)
      : [];
    const existing = seen.get(email);
    if (existing) {
      duplicatesInFile++;
      for (const t of tags) if (!existing.tags.includes(t)) existing.tags.push(t);
      if (!existing.first_name && first) existing.first_name = first;
    } else seen.set(email, { email, first_name: first || null, tags: [...new Set(tags)] });
  });
  return { ok: true, analysis: { rows: [...seen.values()], invalid, duplicatesInFile } };
}

/** CSV export. Cells that a spreadsheet would execute as formulas are prefixed with an apostrophe. */
export function toCsv(rows: string[][], delimiter = ";"): string {
  const cell = (v: string) => {
    let s = v ?? "";
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /["\r\n;,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(delimiter)).join("\r\n") + "\r\n";
}
