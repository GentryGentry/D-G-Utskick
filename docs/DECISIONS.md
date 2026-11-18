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

## D-013 Skrivningar utan WHERE testas särskilt
Mutationstestet visade att ett test med `WHERE id = …` missar för breda DELETE/UPDATE-policyer, eftersom SELECT-policyn då även filtrerar. Isoleringstesten kör därför även `delete from …`/`update … ` helt utan filter och kräver att bara den egna föreningens rader berörs.

## D-014 Kolumnnivå-rättigheter
Användarroller får inte uppdatera `tenant_id`, `id` eller `campaigns.status`; rättigheter är beviljade per kolumn. Statusövergångar för utskick sker i M4 via `SECURITY DEFINER`-funktioner. `provider_events` har inga rättigheter alls för API-rollerna. `audit_log` har en trigger som blockerar UPDATE/DELETE (undantag för tenant-radering i M6).

## D-015 Next.js 16: `proxy.ts` ersätter `middleware.ts`
Används enligt installerad version. Proxyn är bara första försvarslinjen; varje skyddad sida anropar `requireFullAuth()`.

## D-010 Tidsbudget: 40 timmar är snålt — se ARCHITECTURE.md §8
