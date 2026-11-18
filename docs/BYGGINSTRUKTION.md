# D&G Utskick: bygginstruktion till Claude Code

Lägg `dg-utskick-projektbrief.md` som `CLAUDE.md` i repots rot och den här filen som `docs/BYGGINSTRUKTION.md`.
Briefen säger vad och varför. Den här filen säger hur, i vilken ordning, och när du ska stanna.

## Första meddelandet att klistra in i Claude Code

> Läs `CLAUDE.md` och `docs/BYGGINSTRUKTION.md`. Börja med milstolpe 0. Stanna efter varje milstolpe och redovisa vad som är klart, vad som är testat och vad du är osäker på. Bygg inte nästa milstolpe förrän jag har godkänt. Använd bara påhittad testdata och skicka aldrig riktig e-post under utvecklingen.

## Hårda regler

1. **Ingen riktig personuppgift i utvecklingen.** All testdata är påhittad: adresser på `example.com`, `example.org` eller `.test`. Inga riktiga adresslistor, inga riktiga namn, inget från Sågenvägen. Avtalets Bilaga 2 förbjuder att D&G använder AI-tjänster för att behandla föreningens personuppgifter.
2. **Inget riktigt utskick förrän milstolpe 5.** Under utveckling används en `ConsoleProvider` som skriver mejlen till en lokal fil eller logg, och en `FakeInbox` för test.
3. **Inga personuppgifter i applikationsloggar.** E-postadresser maskas (`a***@example.com`) i alla loggar och felmeddelanden.
4. **Inga hemligheter i repot.** Bara `.env.example` med tomma värden.
5. **All data i EU-region.** Det gäller databas, hosting och sändtjänst.
6. **Ingen spårning.** Inga öppnings- eller klickpixlar och inga tredjepartsskript eller externa typsnitt.
7. **Stanna och fråga** om något i den här filen krockar med verkligheten (en leverantörs villkor, en teknisk begränsning). Gissa inte tyst.

## Tekniska val (ändra bara med motivering i `docs/DECISIONS.md`)

| Del | Val | Skäl |
|---|---|---|
| Språk och ramverk | TypeScript, Next.js (App Router) | Thomas bygger redan PWA:er, ett språk att underhålla |
| Databas och inloggning | Supabase i EU-region (Stockholm eller Frankfurt), Postgres med Row Level Security | Inloggning, TOTP-tvåstegsverifiering och RLS ingår |
| Sändning | Amazon SES, region `eu-north-1`, bakom ett `EmailProvider`-gränssnitt | Billigt, bounce- och klagomålshändelser via SNS |
| Reserv | `BrevoProvider` med samma gränssnitt (implementeras först i milstolpe 6) | Fallback om SES-ansökan stoppar |
| Köhantering | Postgres-tabell som kö, plus en schemalagd funktion som tömmer den | Inget extra system att drifta |
| Test | Vitest, Playwright, pgTAP eller motsvarande för RLS-test | |
| Språk i gränssnittet | Svenska. Kod, variabler och commit-meddelanden på engelska | |

Starta SES-ansökan om produktionsåtkomst (ut ur sandbox) redan under milstolpe 0. Den kan ta tid och är inget som koden kan lösa. Thomas gör ansökan, du skriver ett utkast till texten.

## Datamodell (förslag, förfina i milstolpe 0)

Alla tabeller utom `tenants` har `tenant_id`. RLS-policy på varje tabell: en användare ser bara rader för tenanter hen är medlem i.

- `tenants` (id, name, slug, sender_name, reply_to, footer_text, daily_send_limit, created_at)
- `memberships` (user_id, tenant_id, role: `dg_admin` | `sender`)
- `subscribers` (id, tenant_id, email, first_name nullable, status: `active` | `unsubscribed` | `bounced` | `complained`, created_at, status_changed_at)
- `tags` och `subscriber_tags`
- `campaigns` (id, tenant_id, subject, body_json, status: `draft` | `queued` | `sending` | `sent` | `cancelled` | `failed`, created_by, approved_by nullable, sent_at, recipient_count)
- `campaign_recipients` (campaign_id, subscriber_id, status: `queued` | `sent` | `delivered` | `bounced` | `complained` | `failed`, provider_message_id, updated_at). Unik på (campaign_id, subscriber_id).
- `suppressions` (tenant_id, email_hash, reason, created_at). Hashen gör att en raderad eller avanmäld adress inte läggs till igen av misstag vid ny import.
- `provider_events` (id, provider, raw_payload, processed_at) för spårbarhet
- `audit_log` (tenant_id, user_id, action, target, created_at), utan personuppgifter i klartext

## Milstolpar

### Milstolpe 0: Underlag (ingen funktionskod)
- Repo-struktur, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md` (datamodell, flöden, hotbild i en sida).
- Utkast på SES-ansökan, och en lista på DNS-poster som behövs för avsändardomänen (se nedan).
- En seed-plan för påhittad data.
- **Stopp:** Thomas godkänner arkitekturen.

### Milstolpe 1: Grund
- Projekt, Supabase-schema med migreringar, RLS på alla tabeller.
- Inloggning med e-post och lösenord. Tvåstegsverifiering (TOTP) krävs för rollen `sender` innan något kan skickas.
- Seed-skript som skapar två påhittade föreningar med påhittade adresser.
- **RLS-test som bevisar isolering:** användare i förening A kan inte läsa, ändra eller radera något i förening B. Testet ska fela om en policy tas bort.
- **Stopp.**

### Milstolpe 2: Adresslista
- Import av CSV (kolumner: email, förnamn valfritt, taggar valfritt). Förhandsgranskning före import: antal nya, dubbletter, ogiltiga och adresser i `suppressions`.
- Lägg till, redigera, avaktivera och radera enskild adress. Radering är hård radering plus en rad i `suppressions`.
- Taggar. Export till CSV.
- **Stopp.**

### Milstolpe 3: Skriv och förhandsgranska
- Enkel redigerare med rubriker, fet stil, listor och länkar. Inga bilder i v1. Bilagor som länkar.
- Rendera till sanerad HTML och en ren textversion. Sidfot från `tenants.footer_text` med avanmälningslänk.
- Förhandsgranskning i läsbar mejlstil, och en mobilvy.
- Testutskick till inloggad användares egen adress.
- **Stopp.**

### Milstolpe 4: Skicka och avanmäla
- Skicka till alla aktiva eller en tagg. **Bekräftelsesteg** med antal mottagare, ämnesrad och avsändare, där användaren måste skriva eller klicka en tydlig bekräftelse.
- Kön med idempotens: ett utskick kan aldrig gå ut två gånger till samma mottagare, även vid omstart eller dubbelklick. Pausa och avbryt ett pågående utskick.
- `daily_send_limit` per tenant. Utskick som överskrider gränsen avvisas med tydligt meddelande.
- Avanmälan: signerad token (HMAC) per mottagare, GET visar bekräftelsesida, POST utför avanmälan. Rubrikerna `List-Unsubscribe` och `List-Unsubscribe-Post: List-Unsubscribe=One-Click` enligt RFC 8058 ska finnas i varje mejl.
- Historiksida: utskick, tidpunkt, antal skickade, levererade, studsade. Ingen adress i klartext i listvyn.
- **Test:** mot `ConsoleProvider` och `FakeInbox`. Dubbelskick, avbrott mitt i utskick, avanmälan och studsflöde ska ha egna tester.
- **Stopp.**

### Milstolpe 5: Riktig sändning och leveranstest
- `SesProvider`. Webhook för SNS-notiser med verifierad signatur. Hård studs och klagomål sätter status och skapar post i `suppressions`. Mjuk studs försöks begränsat antal gånger.
- Avsändardomän: **en D&G-subdomän, till exempel `utskick.danielssongentry.se`**, med SPF, DKIM (Easy DKIM) och DMARC. Avsändarnamn "Brf Sågenvägen" (från `tenants.sender_name`), svarsadress `styrelsen@sagenvagen.se` (från `tenants.reply_to`). Föreningens egen domän och DNS ska inte röras.
- Leveranstest med Thomas egna testadresser hos Gmail, Outlook och iCloud: ankomst i inkorgen, avanmälan, studs.
- Dokumentera resultatet i `docs/LEVERANSTEST.md`.
- **Stopp.** Först här får något riktigt mejl skickas, och bara till Thomas egna adresser.

### Milstolpe 6: Hårdgöring
- Gallring: tenant-radering som tar bort all föreningens data och bekräftas i audit-loggen. Rutin för att radera en enskild persons uppgifter på begäran.
- Backup och **testad återställning**, beskriven i `docs/DRIFT.md`.
- Hastighetsbegränsning på inloggning och avanmälningsendpoints. Säkerhetsrubriker. Beroendeskanning.
- `docs/PERSONUPPGIFTER.md`: vilka uppgifter som lagras, var, hur länge, och underbiträden. Underlag till Bilaga 2.
- `BrevoProvider` som reserv, med samma tester.
- **Stopp.** Därefter bestämmer Thomas om pilot med Sågenvägen.

## Gränser för användaren Carl

Carl är ingen tekniker och sköter allt själv. Allt som bara D&G ska göra (import i bulk, ändra avsändardomän, inställningar för tenant) ska ligga i en separat adminvy som `sender`-rollen inte ser. Carls vy ska ha tre saker: adresslistan, skriv utskick, historik.

## Kvalitetskrav i varje milstolpe

- Alla tester körs och passerar innan stopp. Redovisa antal tester och vad de täcker.
- Ingen funktion utan ett test för det som kan gå fel (dubbelskick, fel tenant, ogiltig token, tom lista).
- Uppdatera `docs/DECISIONS.md` med varje avvikelse och dess skäl.
- Små commits med tydliga meddelanden.
- Redovisa tidsåtgång per milstolpe. Projektets tak är 40 timmar fram till pilot, och Thomas ska veta när det närmar sig.

## Utanför omfånget

Visuell nyhetsbrevsbyggare, öppnings- och klickstatistik, bilder i mejl, självregistrering för boende, bokning, felanmälan, medlemsregister, automatiska mejl från händelser, flera språk i gränssnittet.
