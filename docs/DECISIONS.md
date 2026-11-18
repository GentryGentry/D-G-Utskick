# Beslut och avvikelser

Format: ID, status, beslut, skäl. Ändringar mot `BYGGINSTRUKTION.md` markeras **AVVIKELSE**.

## D-001 Briefen saknas (öppen)
`CLAUDE.md` (projektbriefen) fanns inte i repot när milstolpe 0 påbörjades. Arkitekturen bygger enbart på `BYGGINSTRUKTION.md`.
**Åtgärd:** Thomas lägger in briefen. Jag stämmer av `ARCHITECTURE.md` mot den innan milstolpe 1.

## D-002 Mottagarstatus `sending` och `unknown` — AVVIKELSE
`campaign_recipients.status` utökas med `sending` (reserverad av arbetaren, anrop pågår) och `unknown` (anrop gjordes, utfall oklart).
**Skäl:** SES `SendEmail` har ingen idempotensnyckel. Exakt-en-gång mot en extern tjänst är omöjligt. Vi väljer **högst-en-gång**: raden markeras `sending` i en transaktion *före* anropet. Kraschar arbetaren efteråt går raden aldrig tillbaka till `queued` automatiskt. Efter en tidsgräns blir den `unknown` och visas för D&G, som kan skicka om manuellt. Hellre en saknad mejl som syns i historiken än ett dubblett till en boende.

## D-003 Korrelation av studs via meddelandetagg
Varje SES-sändning får taggen `recipient_id` (UUID för `campaign_recipients`-raden, ingen e-postadress). SNS-händelser mappas via taggen, med `provider_message_id` som reserv.
**Skäl:** Om processen dör mellan SES-svar och DB-uppdatering saknas annars koppling.

## D-004 `email_hash` är HMAC, inte vanlig hash — AVVIKELSE (förtydligande)
`suppressions.email_hash = HMAC-SHA256(normaliserad e-post, tenant-specifik nyckel)`.
**Skäl:** En osaltad SHA-256 av en e-postadress går att slå upp med en ordlista, och är då i praktiken klartext. Hashen är fortfarande en personuppgift (pseudonymiserad). Det ska stå i `PERSONUPPGIFTER.md`.
**Öppen juridisk fråga (Thomas/avtalet):** Vid *radering på begäran* står "hård radering plus rad i suppressions" i konflikt med radering. Förslag: avanmälan, studs och klagomål behåller hashen (berättigat intresse att inte skicka mer). Radering på begäran lagrar hash bara om personen får veta det och godkänner det, annars ingen post. Kräver beslut innan milstolpe 2.

## D-005 Hosting för Next.js (öppen, kräver beslut)
Instruktionen anger databas och sändtjänst i EU men inte var Next.js körs. **Förslag:** Vercel med funktionsregion `arn1` (Stockholm) eller `fra1`, eller egen container i EU. Obs: Vercel är ett amerikanskt bolag, och blir underbiträde i Bilaga 2 oavsett region. Supabase har samma förhållande.
**Alternativ utan US-bolag:** Hetzner/Scaleway-container med Docker. Mer drift för Thomas.

## D-006 Köhanteraren (arbetaren)
Arbetaren är en route handler i Next.js (delad kod, testbar) som anropas av `pg_cron` + `pg_net` varje minut med en delad hemlighet. Den tar högst N rader per anrop med `FOR UPDATE SKIP LOCKED`.
**Skäl:** Ingen extra tjänst. **Risk:** Vercels cron på billigaste plan är för grov, därför pg_cron. Funktionstidsgräns styr N. Verifieras i milstolpe 4.

## D-007 Avanmälan kringgår inte RLS via servicenyckel
Den oautentiserade avanmälningsändpunkten anropar en `SECURITY DEFINER`-funktion i Postgres (`unsubscribe_by_token`) som tar emot redan verifierad payload. Servicenyckeln används bara av arbetaren och SNS-webhooken.
**Skäl:** Minimerar vad en bugg i webblagret kan göra.

## D-008 HMAC-nycklar med versions-id
Avanmälningstoken: `v1.<recipient_id>.<signatur>`, nyckel-id i token. Tokens ska fungera i många år (mejl ligger kvar i inkorgar). Nyckelrotation får aldrig ogiltigförklara gamla länkar utan att gamla nycklar behålls.

## D-009 Supabase-region
Stockholm (`eu-north-1`) om tillgänglig vid projektskapande, annars Frankfurt. Samma region som SES minskar latens men är inget krav.

## D-011 TOTP krävs för alla roller — AVVIKELSE (strängare)
Instruktionen kräver tvåstegsverifiering för `sender`. Vi kräver den för **alla** användare, inklusive `dg_admin`. Ett kapat adminkonto är värre än ett kapat sender-konto. Gäller i tre lager: proxy, `requireFullAuth()` på serversidan, och `private.can_send()` (kräver `aal2` i JWT) som alla sändande funktioner i M4 måste anropa.

## D-012 RLS är testad mot vanlig Postgres 16, inte mot riktiga Supabase
Docker och Supabase CLI saknas i utvecklingsmiljön. Testerna kör migreringarna mot en tillfällig Postgres 16 med en liten förenkling av Supabase (`tests/db/supabase-shim.sql`: rollerna `anon`/`authenticated`/`service_role`, `auth.uid()`, `auth.jwt()`).
**Obevisat tills det körs mot ett riktigt Supabase-projekt:** att migreringarna går igenom där, att `auth.jwt()->>'aal'` är `aal2` efter TOTP, att inloggnings- och MFA-flödet i webbläsaren fungerar. Gör detta i dev-projektet före godkännande av M1 (se checklista i README).

**Uppdatering (verifierat av Thomas mot riktigt Supabase, dev-projekt i EU):** migreringarna går igenom, Security Advisor visar 0 fel och 0 varningar (1 info: `provider_events` saknar policy, avsiktligt), seed gick igenom, och inloggning + TOTP fungerar. Åtta manuella tester godkända, inklusive att alfa-användare bara ser Alfa, beta-användare bara Beta och användare utan förening ingenting. **Ej körda av Thomas:** SQL-kontrollerna av policyantal (21) och anon-rättigheter. Täcks av de automatiska testerna men är inte bekräftade i Supabase.

## D-013 Skrivningar utan WHERE testas särskilt
Mutationstestet visade att ett test med `WHERE id = …` missar för breda DELETE/UPDATE-policyer, eftersom SELECT-policyn då även filtrerar. Isoleringstesten kör därför även `delete from …`/`update … ` helt utan filter och kräver att bara den egna föreningens rader berörs.

## D-014 Kolumnnivå-rättigheter
Användarroller får inte uppdatera `tenant_id`, `id` eller `campaigns.status`; rättigheter är beviljade per kolumn. Statusövergångar för utskick sker i M4 via `SECURITY DEFINER`-funktioner. `provider_events` har inga rättigheter alls för API-rollerna. `audit_log` har en trigger som blockerar UPDATE/DELETE (undantag för tenant-radering i M6).

## D-015 Next.js 16: `proxy.ts` ersätter `middleware.ts`
Används enligt installerad version. Proxyn är bara första försvarslinjen; varje skyddad sida anropar `requireFullAuth()`.

## D-016 Spärrnyckel: huvudnyckel i miljön, adresshash lagras på abonnenten
`subscribers.email_hash` (ny kolumn, unik per förening) och `suppressions.email_hash` är HMAC-SHA256 av den normaliserade adressen med en nyckel som härleds per förening från `SUPPRESSION_HMAC_MASTER_KEY` (miljövariabel, minst 32 tecken). Nyckeln når aldrig databasen. Databasen jämför bara hashar, så att utskickskön i M4 kan utesluta spärrade adresser med ren SQL.
**Medvetet accepterad risk:** hashen beräknas av appen. En inloggad användare i en förening som anropar databasfunktionen direkt med påhittad hash kan lägga till en spärrad adress i *sin egen* förening. Kräver ett avsiktligt angrepp från ett inloggat, TOTP-verifierat konto som redan kan skicka till hela listan. Att stänga luckan kräver hashning i databasen med nyckel i Supabase Vault. Kandidat för M6.
**Driftkrav:** nyckeln måste sparas säkert och får aldrig bytas utan omhashning. Förlust: gamla spärrnoteringar slutar matcha (risk att avregistrerade läggs till igen). Läckage: hasharna kan slås upp mot en adresslista.

## D-017 Alla skrivningar till `subscribers` går via SECURITY DEFINER-funktioner — AVVIKELSE
INSERT, UPDATE och DELETE är indragna för API-rollerna. Funktionerna `add_subscriber`, `update_subscriber`, `set_subscriber_active`, `delete_subscriber`, `import_subscribers`, `import_preview`, `erase_person` och `log_list_export` kontrollerar roll och förening, och är de enda vägarna in.
**Skäl:** med direkt tabellåtkomst kunde en användare med ett API-anrop sätta `unsubscribed` till `active` och därmed bryta mot ett samtycke. Nu kan en användare bara växla `active` ↔ `inactive`. Avregistrerade, studsade och klagomål är låsta. En ny status `inactive` (avaktiverad av användare) lades till. Policyerna för INSERT/UPDATE/DELETE på `subscribers` är borttagna eftersom de inte längre har någon funktion. Samma felmeddelande ges för "finns inte" och "inte din" så att andra föreningars id inte kan sondas.

## D-018 Två sorters radering (beslut: Thomas)
"Ta bort adress" (Carl): hård radering, men en spärrnotering (`reason='deleted'`) sparas så att personen inte läggs till igen av misstag. "Radera helt på begäran" (bara D&G, `erase_person`): tar bort adressen, spärrnoteringen och leverantörshändelser som innehåller adressen. Ingen hash sparas. Auditloggen får bara åtgärdskod, aldrig adress. Kampanjhistorik behålls utan personkoppling.
**Följd att dokumentera i PERSONUPPGIFTER.md (M6):** efter full radering kan adressen läggas till igen, till exempel vid ny import. Föreningen måste föra egen anteckning om vem som begärt radering. Säkerhetskopior innehåller uppgifterna tills de roterats ut.

## D-019 Massimport är bara för D&G — AVVIKELSE från milstolpetexten
Milstolpe 2 listar CSV-import under adresslistan, men "Gränser för användaren Carl" säger att massimport ska ligga i adminvyn. Importen ligger därför under `/admin` (kräver `dg_admin`, kontrolleras i databasen). Carl kan lägga till, redigera, avaktivera och ta bort enskilda adresser samt **exportera** (loggas i auditloggen).

## D-020 CSV-hantering
Importen känner av semikolon, komma och tab, läser både UTF-8 och Windows-1252 (svensk Excel), och rapporterar ogiltiga rader med verkligt radnummer. Exporten använder semikolon och BOM så att svensk Excel öppnar den rätt. Celler som börjar med `=`, `+`, `-`, `@` får ett inledande apostrof (formelinjektion); importen tar bort det igen så att export → import ger samma data. Taggar i filen läggs även till på adresser som redan finns. Importen återaktiverar aldrig någon och ändrar inte befintliga adressers status.

## D-021 Migrering 0004 kräver tom dev-databas
Kolumnen `email_hash` är NOT NULL och kan inte fyllas i efterhand (nyckeln finns inte i databasen). Migreringen avbryter med instruktion om det finns rader. Gäller bara dev-databasen. Kör `truncate public.tenants cascade;` och seeda om.

## D-010 Tidsbudget: 40 timmar är snålt — se ARCHITECTURE.md §8
