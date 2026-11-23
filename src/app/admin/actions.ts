"use server";
import { requireFullAuth } from "@/lib/auth";
import { requireAdminTenant } from "@/lib/tenant";
import { friendly } from "@/lib/messages";
import { decodeCsvBytes, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseSubscriberCsv, type ImportRow } from "@/lib/csv";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { requireEnv } from "@/lib/env";
import { subscriberHash } from "@/lib/suppression";
import { wrongTenantWarning } from "@/lib/import-guard";

export type PreviewState =
  | undefined
  | { error: string }
  | { ok: true; tenant: string; counts: { fresh: number; existing: number; suppressed: number; invalid: number; duplicatesInFile: number }; invalidSample: number[]; rowsJson: string; warning: string | null };
export type CommitState = undefined | { error: string } | { done: true; inserted: number; existing: number; suppressed: number };
export type EraseState = undefined | { error: string } | { done: true; subscribers: number; suppressions: number; events: number };

const CSV_ERRORS: Record<string, string> = {
  empty: "Filen är tom.", no_email_column: "Filen saknar en kolumn för e-post. Första raden ska ha rubriken email (eller e-post).",
  too_many_rows: `Filen har fler än ${MAX_IMPORT_ROWS} rader. Dela upp den.`,
};

export async function previewImportAction(_prev: PreviewState, form: FormData): Promise<PreviewState> {
  const { supabase, user } = await requireFullAuth();
  const { current, admins } = await requireAdminTenant(supabase, user.id, String(form.get("tenant") ?? ""));
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Välj en CSV-fil." };
  if (file.size > MAX_IMPORT_BYTES) return { error: "Filen är för stor (högst 1 MB)." };
  const parsed = parseSubscriberCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
  if (!parsed.ok) return { error: CSV_ERRORS[parsed.error] ?? "Filen kunde inte läsas." };
  const { rows, invalid, duplicatesInFile } = parsed.analysis;

  const master = requireEnv("SUPPRESSION_HMAC_MASTER_KEY");
  const hashes = rows.map((r) => subscriberHash(master, current.id, r.email));
  const { data, error } = rows.length ? await supabase.rpc("import_preview", { p_tenant: current.id, p_hashes: hashes }) : { data: [], error: null };
  if (error) return { error: friendly(error.message) };
  const kind = new Map<string, string>();
  for (const r of (data ?? []) as { h: string; kind: string }[]) if (kind.get(r.h) !== "suppressed") kind.set(r.h, r.kind);  // suppression wins
  let existing = 0, suppressed = 0;
  for (const h of hashes) { const k = kind.get(h); if (k === "suppressed") suppressed++; else if (k === "existing") existing++; }

  // Does the file look like it belongs to another association this admin manages? Hashes are per
  // association, so each one is checked with its own key. Only counts come back, never addresses.
  const others = [];
  for (const t of admins.filter((a) => a.id !== current.id)) {
    const hs = rows.map((r) => subscriberHash(master, t.id, r.email));
    const { data: d } = hs.length ? await supabase.rpc("import_preview", { p_tenant: t.id, p_hashes: hs }) : { data: [] };
    others.push({ name: t.name, matches: new Set(((d ?? []) as { h: string }[]).map((x) => x.h)).size });
  }
  const warning = wrongTenantWarning({ name: current.name, matches: existing + suppressed }, others);
  return {
    ok: true, tenant: current.id,
    counts: { fresh: rows.length - existing - suppressed, existing, suppressed, invalid: invalid.length, duplicatesInFile },
    invalidSample: invalid.slice(0, 10).map((i) => i.line),
    rowsJson: JSON.stringify(rows), warning,
  };
}

export async function commitImportAction(_prev: CommitState, form: FormData): Promise<CommitState> {
  const { supabase, user } = await requireFullAuth();
  const { current } = await requireAdminTenant(supabase, user.id, String(form.get("tenant") ?? ""));
  // The admin must tick "this file belongs to <association>". Checked here too, not just in the browser.
  if (String(form.get("confirm_tenant") ?? "") !== current.id) return { error: `Bekräfta att filen hör till ${current.name} innan du importerar.` };
  let raw: unknown;
  try { raw = JSON.parse(String(form.get("rows") ?? "[]")); } catch { return { error: "Förhandsgranskningen kunde inte läsas. Börja om." }; }
  if (!Array.isArray(raw) || raw.length > MAX_IMPORT_ROWS) return { error: "Ogiltigt innehåll. Börja om." };
  // Never trust the browser: re-validate every row and compute every hash here, on the server.
  const master = requireEnv("SUPPRESSION_HMAC_MASTER_KEY");
  const rows = (raw as Partial<ImportRow>[]).flatMap((r) => {
    if (typeof r?.email !== "string" || !isValidEmail(r.email)) return [];
    const tags = Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string").slice(0, 10) : [];
    return [{ email: normalizeEmail(r.email), first_name: typeof r.first_name === "string" ? r.first_name : null, tags,
              hash: subscriberHash(master, current.id, r.email) }];
  });
  const { data, error } = await supabase.rpc("import_subscribers", { p_tenant: current.id, p_rows: rows });
  if (error) return { error: friendly(error.message) };
  const d = data as { inserted: number; existing: number; suppressed: number };
  return { done: true, inserted: d.inserted, existing: d.existing, suppressed: d.suppressed };
}

export async function erasePersonAction(_prev: EraseState, form: FormData): Promise<EraseState> {
  const { supabase, user } = await requireFullAuth();
  const { current } = await requireAdminTenant(supabase, user.id, String(form.get("tenant") ?? ""));
  const email = String(form.get("email") ?? "");
  if (!isValidEmail(email)) return { error: "Det ser inte ut som en giltig e-postadress." };
  if (String(form.get("confirm") ?? "").trim() !== "RADERA") return { error: 'Skriv RADERA (med versaler) för att bekräfta.' };
  const hash = subscriberHash(requireEnv("SUPPRESSION_HMAC_MASTER_KEY"), current.id, email);
  const { data, error } = await supabase.rpc("erase_person", { p_tenant: current.id, p_email: email, p_email_hash: hash });
  if (error) return { error: friendly(error.message) };
  const d = data as { subscribers: number; suppressions: number; events: number };
  return { done: true, ...d };
}
