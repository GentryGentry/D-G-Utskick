/** Maps database error codes (never raw SQL errors) to Swedish text for the user. */
const TEXT: Record<string, string> = {
  duplicate: "Adressen finns redan i listan.",
  suppressed: "Adressen har tidigare avregistrerats eller tagits bort och kan inte läggas till igen.",
  invalid_email: "Det ser inte ut som en giltig e-postadress.",
  status_locked: "Den här adressen har avregistrerat sig eller studsat och kan inte ändras eller aktiveras om.",
  forbidden: "Du har inte behörighet att göra det här.",
  too_many_rows: "Filen har för många rader (högst 5 000).",
};
export function friendly(message: string | undefined): string {
  return TEXT[message ?? ""] ?? "Något gick fel. Försök igen, eller kontakta D&G om det upprepas.";
}
export const NOTICE: Record<string, string> = {
  added: "Adressen lades till.", updated: "Ändringarna sparades.", activated: "Adressen är aktiv igen.",
  deactivated: "Adressen är avaktiverad och får inga utskick.", deleted: "Adressen togs bort.",
};
