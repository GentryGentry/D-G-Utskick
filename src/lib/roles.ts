// Pure role rules, kept free of server-only imports so they can be unit tested.
// D-024: board_viewer is a member but not staff. D-031: a sender must accept the terms first.

export type TenantRole = "dg_admin" | "sender" | "board_viewer";

/** May see and change the address list (subject to the terms for a sender). */
export const canManage = (role: TenantRole) => role === "dg_admin" || role === "sender";

/** The associations where this user may import and erase. A sender or board member gets none. */
export function adminTenantsOf<T extends { role: TenantRole }>(tenants: T[]): T[] {
  return tenants.filter((t) => t.role === "dg_admin");
}

export type TermsStatus = { version: number | null; body: string | null; needs_acceptance: boolean };

/** Fails closed: if the status could not be read, a sender is sent to the terms page, not let through. */
export function mustAcceptTerms(role: TenantRole, status: TermsStatus | null | undefined): boolean {
  if (role === "dg_admin") return false;
  if (role !== "sender") return false; // board_viewer never reaches the list anyway
  return status?.needs_acceptance !== false;
}
