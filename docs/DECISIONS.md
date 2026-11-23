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

## D-022 `name` finns redan som `first_name` — AVVIKELSE
SLUTPRODUKT säger "lägg till `name` på `subscribers`". Kolumnen `first_name` (max 100 tecken, inga radbrytningar) finns redan och rymmer ett fullständigt namn. En dubblett skulle ge två fält för samma sak. Jag lade därför **inte** till `name` utan tolkar `first_name` som "namn". `subscription_requests.name` följer specen, och vid godkännande kopieras det till `first_name`.
Vill du hellre byta namn på kolumnen till `name` är det en liten migrering, men den rör M2-funktionerna, CSV-rubrikerna och seed. Jag väntade med det eftersom M2 inte är verifierat än.

## D-023 `subscription_requests.confirmed_at` — TILLÄGG till specen
Kolumnen finns inte i listan men behövs. Utan den skulle `subscribers.confirmed_at` bli tidpunkten då Carl godkände, inte tidpunkten då personen själv klickade på länken, och det är den senare som är beviset på samtycke. En konsistensregel i databasen kräver att `confirmed_at` är satt exakt när statusen inte längre är `pending_confirmation`.

## D-024 `board_viewer` ärver ingenting — skrivrätt kräver nu "staff"
Alla policyer och funktioner frågade "är medlem?". Hade jag bara lagt till rollen hade `board_viewer` därmed fått rätt att skapa och radera utkast, lägga till och ta bort adresser, exportera listan och mer. Nu finns `private.is_staff` (bara `sender` och `dg_admin`):
- **Skrivning och läsning av adresser, taggar, spärrlista och anmälningskö** kräver staff.
- **`board_viewer` får läsa:** föreningens namn, utskick (`campaigns`) och mottagarrader (`campaign_recipients`, utan `opened`). Det räcker för historik och statistik.
- `can_send` kräver staff och TOTP. Funktionerna från M2 anropar `assert_staff`; `assert_member` är borttagen eftersom den inte längre används.
- TOTP krävs även för `board_viewer` (D-011 gäller alla).
- **Följd för F1:** "Visa vilka" visar adress, namn och lägenhet för personer som inte nåtts, men `board_viewer` får inte läsa `subscribers`. F1 måste därför bygga på en databasfunktion som returnerar just de raderna och inget annat.
- Användare och roller skapas av D&G för hand i v1. Det finns ingen inbjudningsfunktion.
Täcks av ett 20-tal nya kontroller i isoleringstestet, och mutationstestet fallerar om `is_staff` eller `assert_staff` försvagas.

## D-025 `opened` kan inte läsas via API
Det är persondata, så `select` på `campaign_recipients` är nu beviljat kolumn för kolumn och `opened` är utelämnad. Varken `select opened`, `select *` eller filtrering på kolumnen fungerar för inloggade användare, oavsett roll. Bara servern (servicenyckel eller databasfunktion) kan skriva och läsa den.
**Var ärlig mot föreningen:** D&G med databasåtkomst (Supabase-konsolen) kan fortfarande se värdet per mottagare. "Aldrig per person i något gränssnitt, API eller export" gäller verktyget, inte oss som drift.

## D-026 Arkivfält
`archive_visible` kan bara vara sant om utskicket är `sent` och har `slug` och `archive_published_at` (konsistensregel i databasen). Användare kan inte skriva fälten alls; en funktion tillkommer med F3. `slug` är unik per förening. **Regel för M3:** `campaigns.html` och `text_body` ska innehålla enbart brödtexten. Sidfot och avanmälningslänk (som är unik per mottagare) läggs på när varje mejl renderas.

## D-027 `subscription_requests`
- Anmälningar som personen inte bekräftat är **dolda även för Carl**. Vem som helst kan skriva in någon annans adress i ett öppet formulär, och dessa adresser ska inte ligga och vänta i hans vy.
- Högst en öppen anmälan per adress och förening (delvis unikt index). Efter avslag går det att anmäla sig igen.
- Bara en SHA-256 av länktoken lagras. Ingen IP-adress, ingen webbläsaruppgift.
- Ingen användare kan skriva i tabellen. Servern och senare databasfunktioner gör det.
- **Gallring (M6):** obekräftade anmälningar raderas efter 48 timmar, avslagna efter 30 dagar.

## D-028 Två migreringar, inte en
SLUTPRODUKT säger "nästa migrering". En ny enumvärde (`board_viewer`) kan inte användas i samma transaktion som skapar det, så det ligger i `0005`. Resten ligger i `0006`. `0006` kräver att `0005` är körd först. `import_subscribers` sätter nu `source = 'import'`, och `add_subscriber` ger `'manual'` (standardvärdet). Det är datakorrekthet, inte en ny funktion.

## D-029 SLUTPRODUKT ersätter delar av BYGGINSTRUKTION (bara för F2)
Hård regel 6 ("Ingen spårning, inga öppningspixlar") och punkten "Öppnings- och klickstatistik" under "Utanför omfånget" i `BYGGINSTRUKTION.md` gäller inte längre för F2, och bara på villkoren i F2. Klickspårning är fortfarande utanför omfånget. Jag har inte ändrat `BYGGINSTRUKTION.md`.

## D-030 Adminsidor väljer aldrig förening åt dig
Manuellt test 11 (23 nov) importerade Alfa-filen till **Beta**, eftersom adminsidorna tyst valde den första föreningen i bokstavsordning ("Brf Provbacken Beta"). Databasen gjorde rätt: Beta har inga spärrar för Alfas boende, så de blev nya aktiva adresser i Beta. Alfa rördes inte. Felet är alltså inte spärrlistan utan att fel förening kunde väljas utan att någon märkte det. I verkligheten skulle det betyda att boende i en förening får utskick från en annan.
Åtgärd (`src/lib/import-guard.ts`): en admin med flera föreningar måste välja förening uttryckligen, föreningens namn står i rubrik och knapp, importen kräver en kryssruta "filen hör till X" som också kontrolleras på servern, och förhandsgranskningen varnar om filens adresser hellre känns igen i en annan förening som admin har. Varningen jämför bara antal, aldrig adresser. `tests/db/import-wrong-tenant.test.ts` låser fast vad databasen gör i båda fallen.

## D-031 Carl blir utskickare, med ett villkor han godkänner (beslut: D&G, 23 nov)
**Roller i Brf Testgården Alfa när verktyget går live:**
- **Carl (ordförande) → `sender` (utskickare).** Ser, lägger till, ändrar, avaktiverar och tar bort adresser i sin egen förening. Sköter senare utskicken.
- **Övriga i styrelsen → `board_viewer`.** Får bara titta (D-024). Om de ska se *antalet* adresser är inte avgjort; D&G stämmer av med Carl. Inget är byggt för det.
- **D&G → `dg_admin`.** Massimport (D-019) och "radera helt" (D-018) stannar hos D&G. Carl skickar filen till D&G i stället för att importera själv, eftersom det var där det gick fel i test 11 (D-030).
- Inget riktigt konto för Carl skapas förrän verktyget går live.

**Varför ett villkor.** När Carl får lägga in adresser själv flyttar ansvaret för *varifrån* adresserna kommer till honom, men det är D&G:s verktyg som skickar. Ett villkor på en mening som han godkänner är billigt och ger D&G ett bevis.

**Hur det fungerar (migrering `0007_sender_terms.sql`):**
- Texten ligger i `sender_terms`, en rad per version. Version 1: *"Jag lägger bara in e-postadresser som den boende själv har lämnat till föreningen för att få föreningens utskick. Jag lägger inte in adresser från andra listor eller register, och inte grannars adresser som de inte själva har lämnat."*
- Godkännandet sparas i `terms_acceptances`: vem (`user_id`), vilken förening, vilken version, när. Plus en rad i `audit_log` (`terms.accepted`, `v1`).
- **Båda tabellerna går inte att ändra eller radera i, inte ens för tabellägaren** (samma spärr som `audit_log`). En ny formulering läggs in som en ny version, aldrig genom att ändra den gamla. Annars går det inte att visa vad någon faktiskt godkände.
- `user_id` har ingen koppling till kontotabellen, med avsikt: beviset ska finnas kvar även om kontot raderas.
- API:t kommer inte åt tabellerna alls. Allt går via `sender_terms_status` och `accept_sender_terms`. Godkännande kräver tvåstegsinloggning och att versionen är den som visades. Ändrades texten medan sidan var öppen räknas klicket inte.
- **Spärren ligger i databasen, inte bara på sidan.** `add_subscriber` och `update_subscriber` vägrar (`terms_not_accepted`) för en utskickare som inte godkänt aktuell version *för just den föreningen*. Avaktivera och ta bort är inte spärrade: de minskar bara vem som får mejl, och en klagande boende ska kunna tas bort direkt.
- I appen skickas en utskickare till `/app/villkor` från adresslistan, redigeringssidan och exporten tills villkoret är godkänt. Om statusen inte går att läsa stoppas hen (stänger, inte öppnar).
- `dg_admin` och `board_viewer` påverkas inte.
- **Ny version:** kör i SQL Editor `insert into public.sender_terms (version, body) values (2, '...');`. Alla utskickare får godkänna igen vid nästa besök.
- **Regel för M4:** sändningsfunktionen ska också anropa `private.assert_terms`.
- **Känd följd:** precis som `audit_log` hindrar spärren att en förening raderas med vanlig `delete`. Hanteras i M6 tillsammans med `audit_log` (`dg.allow_audit_purge`).

Täcks av isoleringstestet (utan godkännande: kan inte lägga till eller ändra; ny version spärrar igen; ingen direkt skrivning; fel version, fel förening, utan tvåsteg och styrelseroll nekas), `tests/db/sender-terms.test.ts` (sparar rätt, går inte att ändra) och `tests/unit/roles.test.ts`. Mutationstestet blir rött om `assert_terms` eller `terms_ok` försvagas.

**Kontrollerat att utskickaren inte når import eller "radera helt":** sidorna och åtgärderna under `/admin` kräver `dg_admin` för just den valda föreningen (`requireAdminTenant`), och databasfunktionerna `import_preview`, `import_subscribers` och `erase_person` anropar `assert_admin`. Båda lagren är testade (isoleringstestet sedan M2, nu också `adminTenantsOf` i enhetstest).

## Öppna frågor till Thomas (kräver svar innan respektive funktion byggs)
**Q1. Gallring efter 90 dagar mot historiken.** F2 säger att mottagarrader gallras efter 90 dagar och att summorna sparas. Men F1 ("Visa vilka") och historiken i M4 bygger på mottagarraderna. Vi behöver sparade summor per utskick *innan* gallringen körs (en `campaign_stats`-tabell eller kolumner på `campaigns`), annars försvinner "nådde X av Y" för gamla utskick. Det finns inte i listan "Gör redan nu", så jag har inte byggt det. Föreslår att det byggs med F1. Bekräfta också att "Visa vilka" bara behöver fungera de första 90 dagarna.

**Q2. F1: att siffrorna går ihop.** Dagens statusar (`queued`, `sending`, `sent`, `delivered`, `bounced`, `complained`, `failed`, `unknown`) räcker inte för "exakt en status". Det saknas `rejected` (avvisad av SES) och `skipped` (inte skickad på grund av avanmälan). Dessutom: *"Y" måste definieras som antalet rader som skapades när utskicket köades*, och personer som avregistrerat sig i mellantiden måste ha en rad med status `skipped`, annars går summan aldrig ihop. Sist: SES skickar inte alltid en slutlig händelse. Ett utskick som är `sent` utan leveransbesked efter ett par timmar måste visas som "oklart", inte som levererat eller misslyckat. Det är sannolikt det som förklarar Egrannars 164 + 5 av 176 (sju oförklarade). Lägger in statusarna i M4.

**Q3. "Bara de som själva lagt in sin e-postadress får utskick".** M2 tillåter CSV-import (D&G) och manuell tilläggning (Carl). De adresserna har inte gått genom den nya dubbla bekräftelsen. Vad ska gälla vid utskick: (a) alla aktiva, som nu; (b) bara `confirmed_at is not null`; (c) aktiva med `source='form'` eller `source='import'` (importen är då en försäkran från Carl om att adresserna kommer från Egrannars egen anmälan)? Jag rekommenderar (c) och att importen kräver en kryssruta "Jag intygar att personerna själva har anmält sin adress". Svaret styr M4.

**Q4. F2 juridik.** Föreningens skriftliga godkännande är inte mottagarnas samtycke. En öppningspixel läser av mottagarens utrustning, och en jurist bör bedöma den svenska tolkningen av ePrivacy (LEK) innan funktionen slås på hos en förening. Dessutom behövs en inställning per förening (`open_tracking_enabled` och ett godkännandedatum) som inte finns i listan "Gör redan nu". Jag bygger den med F2. Siffran visas som uppskattning, och jag föreslår att den helst visas som "minst X" (bilder blockeras ofta, Apple Mail laddar i förväg), annars blir den ibland för hög och ibland för låg.

**Q5. F3 arkiv: vilken lösning?** Min lutning: **server till server med en skrivskyddad nyckel per förening**, där nyckeln bara kan hämta arkivet. Fördelar: hemsidan är alltid aktuell, ett utskick kan tas bort ur arkivet direkt, och inga adresser exponeras. Nackdel: hemsidans plattform måste kunna köra egen serverkod. Alternativet, att vi genererar en statisk sida, fungerar på vilken hemsida som helst men kräver att vi eller Thomas lägger in sidan vid varje nytt utskick. **Vilken plattform ligger hemsidan på?** Svaret avgör.

**Q6. F4 anmälan.** (a) En person som avregistrerat sig och sedan anmäler sig igen med bekräftad länk: ska det vara tillåtet? Min rekommendation: ja för `unsubscribed` och `deleted` efter dubbel bekräftelse och Carls godkännande, aldrig för `bounced` eller `complained`. Idag blockerar spärrlistan. (b) Hastighetsbegränsning per IP utan att lagra IP-adress kräver en kortlivad lagring (minne eller Redis) som beror på valet av hosting (D-005). (c) Bekräftelsemejlet är det första riktiga mejlet systemet skickar. Det hamnar före M4 och kräver `EmailProvider` och SES-ansökan i förväg.

**Q7. F5 lägenhetsnummer.** Fritext går att skriva fel ("1001", "lgh 1001", "1 001"). Vi normaliserar blanksteg och versaler, men inte format. Föreslår att Carl lägger in föreningens lägenhetslista (en rad per lägenhet) och att formulär och verktyg bara godtar nummer ur listan. Annars blir adresser omöjliga att rensa vid flytt, och det är hela poängen med F5.

## D-010 Tidsbudget: 40 timmar är snålt — se ARCHITECTURE.md §8
