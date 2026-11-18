# DNS-poster för avsändardomänen

Zon: `danielssongentry.se` (D&G:s egen). **Rör aldrig föreningens domän (`sagenvagen.se`).**
Avsändaradress i M5: `utskick@utskick.danielssongentry.se`. Svarsadress: `styrelsen@sagenvagen.se` (Reply-To, bara rubrik).

| # | Typ | Namn | Värde | Syfte |
|---|---|---|---|---|
| 1–3 | CNAME | `<token1>._domainkey.utskick` | `<token1>.dkim.amazonses.com` | Easy DKIM (tre poster, AWS ger tokens) |
| 4 | MX | `bounce.utskick` | `10 feedback-smtp.eu-north-1.amazonses.com` | Egen MAIL FROM-domän (SPF-justering) |
| 5 | TXT | `bounce.utskick` | `"v=spf1 include:amazonses.com ~all"` | SPF för MAIL FROM |
| 6 | TXT | `_dmarc.utskick` | `"v=DMARC1; p=none; rua=mailto:<dmarc-adress>; adkim=s; aspf=s"` | DMARC. Börja `p=none`, gå till `quarantine` efter leveranstest |
| 7 | (valfri) | `utskick` | A/CNAME till appen | Om appen och avanmälan körs här |

Kontroller att göra i M5:
- Alignment: From-domän = DKIM-domän (`d=utskick.danielssongentry.se`) → DKIM-justerad. MAIL FROM `bounce.utskick…` är subdomän → SPF justerad vid `aspf=r`, ej vid `aspf=s`. **Använd `aspf=r` om strikt SPF-alignment ger fel; DKIM-alignment räcker för DMARC-pass.**
- Kontrollera `mail-tester`-liknande resultat med Thomas egna adresser, inte föreningens.
- TTL 300 under uppstart, höj efteråt.
- DMARC-rapportadress (`rua`) är en personuppgiftskälla i liten skala. Dokumentera.

Beslut för Thomas: avanmälningslänkar och appen på samma underdomän (enklast, bra anseende) eller `app.danielssongentry.se`. Förslag: samma underdomän.
