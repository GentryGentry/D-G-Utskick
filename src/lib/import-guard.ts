// Guards against importing (or erasing) in the wrong association.
// Background: on 23 Nov a manual test imported the Alfa file into Beta, because the admin pages
// silently picked the first association in alphabetical order. The database behaved correctly
// (Beta has no suppressions for Alfa's residents), so the protection has to live here, in the app.

export type AdminTenant = { id: string; name: string };

/** An admin with more than one association must choose explicitly. No silent default. */
export function chooseAdminTenant<T extends AdminTenant>(admins: T[], requested: string | undefined): T | null {
  const hit = admins.find((t) => t.id === requested);
  if (hit) return hit;
  return admins.length === 1 ? admins[0] : null;
}

/** How many of the file's addresses already exist in, or are blocked by, an association. */
export type TenantMatch = { name: string; matches: number };

/**
 * Warn when the file clearly belongs somewhere else: another association the admin manages
 * recognises at least 2 of the addresses, and more of them than the chosen one does.
 */
export function wrongTenantWarning(current: TenantMatch, others: TenantMatch[]): string | null {
  const best = [...others].sort((a, b) => b.matches - a.matches)[0];
  if (!best || best.matches < 2 || best.matches <= current.matches) return null;
  return `Kontrollera föreningen. ${best.matches} av adresserna i filen finns redan i ${best.name}, men bara ${current.matches} i ${current.name}. Har du valt fel förening?`;
}
