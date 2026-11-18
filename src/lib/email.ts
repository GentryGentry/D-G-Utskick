import { createHmac } from "node:crypto";

/** Must stay identical to the SQL trigger private.subscribers_before_write (trim, lowercase, NFC). */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase().normalize("NFC");
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;
export function isValidEmail(raw: string): boolean {
  const e = normalizeEmail(raw);
  return e.length <= 254 && EMAIL_RE.test(e);
}

/** Hard rule 3: never log a full address. a***@example.com */
export function maskEmail(raw: string): string {
  const e = String(raw);
  const at = e.lastIndexOf("@");
  if (at < 1) return "***";
  return `${e[0]}***${e.slice(at)}`;
}

/** D-004: HMAC, not a plain hash. Key is per tenant and secret. */
export function emailHash(email: string, key: string): string {
  if (!key) throw new Error("emailHash: empty key");
  return createHmac("sha256", key).update(normalizeEmail(email)).digest("hex");
}
