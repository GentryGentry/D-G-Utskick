import { createHmac } from "node:crypto";
import { emailHash } from "./email";

/** D-016: one secret master key in the environment; a per-tenant key is derived from it.
 *  The key never reaches the database. Losing it breaks matching against existing suppressions;
 *  leaking it makes the stored hashes reversible with a dictionary attack. */
export function tenantKey(master: string, tenantId: string): string {
  if (!master || master.length < 32) throw new Error("SUPPRESSION_HMAC_MASTER_KEY must be at least 32 characters");
  return createHmac("sha256", master).update(`tenant:${tenantId}`).digest("hex");
}

export function subscriberHash(master: string, tenantId: string, email: string): string {
  return emailHash(email, tenantKey(master, tenantId));
}
