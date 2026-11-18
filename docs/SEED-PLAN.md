# Seed-plan (påhittad data)

Regel: bara `example.com` / `example.org` / `.test`. Inget som liknar verkliga personer eller Sågenvägen.

## Föreningar
| slug | name | reply_to | daily_send_limit |
|---|---|---|---|
| `alfa` | Brf Testgården Alfa | `styrelsen@alfa.test` | 500 |
| `beta` | Brf Provbacken Beta | `styrelsen@beta.test` | 100 |

## Användare (lösenord genereras slumpmässigt vid seed, skrivs aldrig ut i repot)
| e-post | roll | tenant |
|---|---|---|
| `admin@dg.example.org` | dg_admin | alfa, beta |
| `sender-alfa@example.com` | sender | alfa |
| `sender-beta@example.com` | sender | beta |
| `sender-ingen@example.com` | (ingen medlemskap) | – (negativ testanvändare) |

## Prenumeranter
- Alfa: 120 adresser `boende001@alfa.example.com` …, förnamn från påhittad lista, taggar `trapphus-a`, `trapphus-b`, `styrelse`.
- Beta: 40 adresser `boende001@beta.example.com` …
- **Fällor med flit:** dubbletter (versaler/blanksteg), ogiltiga (`foo@`, `@bar`), en adress i **båda** föreningarna (samma `shared@example.com`), 3 `unsubscribed`, 2 `bounced`, 1 `complained`, 5 rader i `suppressions`, tom tagg, adress med `+` och unicode-domän.
- Deterministisk seed (fast slumpfrö) så att tester ger samma resultat.

## Hur den körs
- Skript `scripts/seed.ts`, vägrar köra om `NODE_ENV=production` eller om databas-URL inte är lokal/dev-projekt. Idempotent: nollställer bara seed-tenanterna.
