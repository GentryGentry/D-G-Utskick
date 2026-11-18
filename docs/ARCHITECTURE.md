# Arkitektur (milstolpe 0)

Status: utkast för godkännande. Bygger på `BYGGINSTRUKTION.md`. Briefen (`CLAUDE.md`) saknas, se D-001.

## 1. Översikt

```
Carl / D&G (webbläsare)
        │ HTTPS
   Next.js (EU-region) ──── Supabase (Postgres + Auth, EU)
        │  ▲                      ▲  │
        │  └── /api/worker ◄── pg_cron + pg_net (varje minut)
        ▼
  EmailProvider  ──► ConsoleProvider (dev) | SesProvider (eu-north-1) | BrevoProvider (reserv)
        │
   SES ──► SNS ──► POST /api/webhooks/ses (signatur verifieras) ──► status + suppressions
Mottagare ──► GET/POST /unsubscribe/<token>  (+ RFC 8058 one-click)
```

## 2. Roller
- `dg_admin`: allt, inklusive tenant-inställningar, bulkimport, adminvy.
- `sender` (Carl): adresslista, skriv utskick, historik. Ser aldrig adminvyn. TOTP (AAL2) krävs för att skicka.
- Obehörig (ej inloggad): bara avanmälningsändpunkten.

## 3. Datamodell
Enligt instruktionen, med dessa förfiningar:

| Tabell | Tillägg |
|---|---|
| `subscribers` | `unique(tenant_id, email)` (normaliserad: trim, lowercase, NFC) och `unique(tenant_id, email_hash)`. Status utökad med `inactive`. Inga direkta skrivningar för användare, bara via funktioner (D-016/D-017). |
| `campaigns` | `body_json` + renderade `html`/`text` fryses vid bekräftelse så att det som godkändes är det som skickas. `approved_at`. `idempotency_key` (UUID från klienten, unik per tenant) mot dubbelklick. |
| `campaign_recipients` | Status utökas: `sending`, `unknown` (D-002). `attempts`, `claimed_at`. `subscriber_id` är **nullable, `ON DELETE SET NULL`**, så att historik överlever hård radering utan personkoppling. Ingen kopia av adressen här. |
| `suppressions` | `email_hash` = HMAC (D-004). `unique(tenant_id, email_hash)`. |
| `provider_events` | `raw_payload` kan innehålla adresser. Gallras efter 30 dagar, räknas som personuppgift. |
| `audit_log` | Bara id:n och åtgärdskod. Ingen e-post. Append-only: ingen UPDATE/DELETE-policy för någon roll. |
| `tenants` | + `retention_days` för provider_events. `daily_send_limit` default lågt. |

**RLS:** hjälpfunktion `is_member(tenant_id)` och `has_role(tenant_id, role)` (`SECURITY DEFINER`, fast `search_path`). Policy per kommando (SELECT/INSERT/UPDATE/DELETE) och tabell, aldrig `FOR ALL` med bara `USING`. `WITH CHECK` krävs så att man inte kan flytta en rad till annan tenant. `memberships` kan inte självskrivas av `sender`. Skickande kräver AAL2 i policy/RPC, inte bara i UI.

## 4. Flöden

**Utskick:** utkast → förhandsgranska → bekräfta (antal, ämne, avsändare, tydlig handling) → RPC `queue_campaign` i *en transaktion*: kontrollerar roll+AAL2, dagsgräns (summa skickade+köade senaste 24 h per tenant), fryser innehåll, skapar `campaign_recipients` från aktiva prenumeranter minus suppressions → status `queued`. Dubbelklick → samma `idempotency_key` → samma kampanj.

**Arbetare:** `claim` = `UPDATE … SET status='sending', claimed_at=now() WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT N) RETURNING …`. Anropa provider. Skriv `sent` + `provider_message_id`. Fel som är tillfälligt: tillbaka till `queued` med `attempts+1` (bara när providern *bevisligen* inte tog emot, t.ex. throttling). Oklart utfall: förblir `sending` → efter 10 min `unknown`. Pausad/avbruten kampanj: arbetaren hoppar över dess rader.

**Avanmälan:** GET visar bekräftelsesida (ingen statusändring, skyddar mot länkskannrar). POST utför. One-click POST enligt RFC 8058 går till samma endpoint. Idempotent. Svar avslöjar aldrig om adressen fanns.

**Studs/klagomål (M5):** SNS-meddelande → verifiera signatur (certifikat-URL måste vara `sns.<region>.amazonaws.com`) och `TopicArn` → logga i `provider_events` → hård studs/klagomål: status + suppression. Mjuk studs: SES försöker själv, vi räknar bara.

## 5. Hotbild (stresstest)

| Hot | Konsekvens | Motmedel |
|---|---|---|
| Förening A når B:s data | GDPR-incident | RLS per kommando, pgTAP-test som fallerar om policy tas bort, `WITH CHECK`, test av `UPDATE tenant_id` |
| Carls konto kapas → massutskick | Skada för föreningens rykte och vår SES-reputation | TOTP, bekräftelsesteg, `daily_send_limit`, hastighetsbegränsning, audit-logg, avbrytknapp |
| Dubbelskick | Boende får samma mejl två gånger | Unik (kampanj, mottagare), `idempotency_key`, claim med SKIP LOCKED, högst-en-gång (D-002) |
| Smygande skickning till fel lista | Samtyckesproblem | Bekräftelsesteg visar antal och tagg. Import visar förhandsgranskning |
| Förfalskad avanmälan/uppräkning | Någon avanmäler andra | HMAC, konstant-tids jämförelse, GET ändrar inget, rate limit |
| Falsk SNS-händelse | Någon sätter adresser som studsade | Signaturverifiering, TopicArn-kontroll, bara HTTPS-cert från AWS |
| XSS i mejl/förhandsgranskning | Kapning av inloggad sida | Sanera HTML med strikt allowlist, förhandsgranskning i `<iframe sandbox>` utan skript, CSP |
| CSV-formelinjektion vid export | Excel kör formel | Prefixa celler som börjar med `= + - @` |
| Header-injektion via ämne/namn | Falska rubriker | Avvisa CR/LF, använd SDK:ns strukturerade rubriker |
| Kapat konto lägger tillbaka spärrad adress med påhittad hash | Spärrad person får mejl | Accepterad risk (D-016), kräver TOTP-konto med sändrätt. Åtgärdas med hashning i databasen (M6) |
| Användare återaktiverar avregistrerad | Utskick utan samtycke | Status låst i databasen, bara active↔inactive (D-017), testat |
| Läckage i loggar | Brott mot regel 3 | Central `maskEmail()`, lint-regel mot `console.log` av objekt med e-post, test |
| Servicenyckel läcker | Total åtkomst | Bara server-side, aldrig `NEXT_PUBLIC_`, hemlighetsskanning i CI |
| Raderad person finns kvar i backup | Radering ej fullständig | Dokumentera backup-retention i `DRIFT.md`; PERSONUPPGIFTER.md anger fördröjning |
| Spamklagomål höjer SES-nivå | Kontot stängs | Klagomål → suppression direkt, Gmail/Yahoo-krav (DMARC, one-click, <0,3 % klagomål), liten och ren lista |

## 6. Test (planerat, ingen kod nu)
- pgTAP: RLS-isolering (läs/ändra/radera/flytta rad), rollgränser, append-only audit.
- Vitest: provider-kontrakt (Console/Fake), claim-logik under samtidighet, dagsgräns, token, normalisering, CSV-import, maskning.
- Playwright: Carls tre vyer, bekräftelsesteg, avanmälan, dubbelklick.
- Mutationskontroll: ett skript som tar bort en policy och kräver att isoleringstestet blir rött.

## 7. Öppna frågor till Thomas
1. Lägg in `CLAUDE.md` (briefen). (D-001)
2. Var körs Next.js? (D-005)
3. Radering på begäran vs. suppressions-hash. (D-004)
4. Vilken rättslig grund gäller för adresslistan hos Sågenvägen (avtal, berättigat intresse, samtycke)? Påverkar avanmälningstext och klagomålsrisk. Ligger hos föreningen som personuppgiftsansvarig, men vi bör kunna ställa frågan.
5. Domänen för avanmälningslänkar: samma underdomän som avsändaren (`utskick.danielssongentry.se`) eller separat appdomän? Förslag i `DNS.md`.

## 8. Tidsbudget (min uppskattning, inte uppmätt)

| Milstolpe | Timmar |
|---|---|
| 0 | 2 |
| 1 | 6 |
| 2 | 5 |
| 3 | 6 |
| 4 | 9 |
| 5 | 5 + väntetid på SES/DNS |
| 6 | 7 |
| **Summa** | **40** |

Det är exakt taket, utan marginal. Realistisk risk: M4 (samtidighet) och M1 (RLS-test) överskrider. **Förslag:** flytta `BrevoProvider` ur piloten (ta bort 2-3 h) och behandla den som tillval om SES-ansökan stoppas. Då finns ett litet buffert. Beslut krävs.
