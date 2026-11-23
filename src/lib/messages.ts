/** Maps database error codes (never raw SQL errors) to Swedish text for the user. */
const TEXT: Record<string, string> = {
  duplicate: "Adressen finns redan i listan.",
  suppressed: "Adressen har tidigare avregistrerats eller tagits bort och kan inte läggas till igen.",
  invalid_email: "Det ser inte ut som en giltig e-postadress.",
  status_locked: "Den här adressen har avregistrerat sig eller studsat och kan inte ändras eller aktiveras om.",
  forbidden: "Du har inte behörighet att göra det här.",
  too_many_rows: "Filen har för många rader (högst 5 000).",
  terms_not_accepted: "Du behöver godkänna villkoren för adresslistan först.",
  terms_outdated: "Villkoren har ändrats medan sidan var öppen. Läs den nya texten och godkänn igen.",
  terms_unchecked: "Kryssa i rutan för att bekräfta villkoret.",
};
export function friendly(message: string | undefined): string {
  return TEXT[message ?? ""] ?? "Något gick fel. Försök igen, eller kontakta D&G om det upprepas.";
}
export const NOTICE: Record<string, string> = {
  added: "Adressen lades till.", updated: "Ändringarna sparades.", activated: "Adressen är aktiv igen.",
  deactivated: "Adressen är avaktiverad och får inga utskick.", deleted: "Adressen togs bort.",
  terms_accepted: "Tack. Villkoret är godkänt och du kan använda adresslistan.",
};
