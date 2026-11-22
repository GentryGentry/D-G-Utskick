# D&G Utskick: uppdatering efter mötet med Carl (22 nov)

Lägg filen som `docs/SLUTPRODUKT.md` och ersätt den tidigare versionen. Det här ändrar inte takten. Fortsätt med den milstolpe du är på. Bygg bara det som står under "Gör redan nu" och vänta med resten tills Thomas säger till.

## Första meddelandet att klistra in i Claude Code

> Läs `docs/SLUTPRODUKT.md`. Det ersätter den tidigare versionen. Fortsätt med nuvarande milstolpe. Lägg datamodelländringarna under "Gör redan nu" i nästa migrering. Bygg inget annat av dokumentet förrän jag säger till. Avvikelser och frågor skriver du i `docs/DECISIONS.md`.

## Vad kunden har idag (Egrannar)

Carl skriver och skickar utskick själv. De kommer från en avsändare utan svarsadress. Carl ser per utskick: hur många som nåtts, hur många som öppnat, och vilka som inte kunde nås. Det syns bara för styrelsen. Alla tidigare utskick ligger i ett arkiv, "Styrelsen informerar", som en egen sida. Bara de som själva har lagt in sin e-postadress får utskick. Gilla, kommentera, personliga konton och statistiken "läst på sajten" ska inte finnas i den nya lösningen.

## Gör redan nu (datamodell, ingen ny funktion)

- `subscribers`: lägg till `name` (valfritt), `apartment` (lägenhetsnummer, valfritt men rekommenderat), `source` (`import` | `form` | `manual`) och `confirmed_at`. Lägenhetsnumret är nyckeln när någon flyttar, se F5.
- `memberships.role`: lägg till `board_viewer` (får se historik och statistik, kan inte skicka).
- `campaigns`: lägg till `archive_visible` (standard falskt), `archive_published_at` och `slug`. Lagra brödtexten utan sidfot och avanmälningslänk, så att den går att visa fristående.
- `campaign_recipients.opened` (boolean, standard falskt). Ingen tidpunkt, ingen IP-adress och ingen webbläsaruppgift.
- Ny tabell `subscription_requests` (id, tenant_id, email, name, apartment, token_hash, status: `pending_confirmation` | `pending_approval` | `approved` | `rejected`, created_at).
- Alla nya tabeller och kolumner följer samma RLS-regler som övriga och täcks av isoleringstestet.

## F1. Leveransöversikt per utskick

Visa för `sender`, `board_viewer` och `dg_admin`:

- Nådde X av Y, och kunde inte nås med knappen "Visa vilka" (adress, namn och lägenhet om de finns, orsak i klartext, föreslagen åtgärd).
- Varje mottagare ligger i exakt en status (levererad, studsad, klagomål, avvisad, inte skickad på grund av avanmälan). Siffrorna ska alltid gå ihop till Y. Kunden ser idag 164 + 5 av 176, vilket inte stämmer, och det ska vi inte upprepa.
- Listan över dem som inte nåtts visas aldrig i själva mejlet till medlemmarna, bara i verktyget.

## F2. Öppningsstatistik (Thomas har beslutat: ja, med villkor)

- Avstängd som standard och slås på per förening efter att föreningen har godkänt det skriftligt.
- Visas som en siffra märkt uppskattning, bara för `sender`, `board_viewer` och `dg_admin`. Aldrig per person i något gränssnitt, API eller export.
- Lagras som `campaign_recipients.opened` (boolean). Rader på mottagarnivå gallras efter 90 dagar, och de sammanlagda siffrorna sparas.
- Pixeln serveras från vår egen domän med en signerad token. Logga ingen IP-adress eller webbläsaruppgift.
- Sidfoten ska berätta att öppningar räknas. Bilaga 2 uppdateras innan funktionen används.
- Siffran är opålitlig (Apple Mail laddar bilder i förväg, och blockerade bilder räknas aldrig). Visa en kort förklaring i gränssnittet och använd den aldrig som bevis på att någon har läst något.
- Bygg efter F1, inte före.

## F3. Arkiv "Styrelsen informerar"

- Visas på hemsidan som en egen sida, bakom hemsidans medlemsdel (delat lösenord).
- Hemsidans lösenord skyddar inte verktygets egna adresser. Arkivet får därför inte hämtas av webbläsaren direkt från ett öppet API. Föreslå en lösning där hemsidans server hämtar arkivet från verktyget med en nyckel per förening (server till server), eller att verktyget genererar en statisk arkivsida som hemsidan innehåller. Motivera valet i `DECISIONS.md`.
- Bara utskick med `archive_visible` visas. Ett utskick ska kunna tas bort från arkivet utan att utskicksloggen påverkas. Arkivsidan ska ha `noindex`.
- Äldre utskick från Egrannar importeras inte i v1. Det avgör Thomas senare.

## F4. Anmälan av e-postadress (före milstolpe 4)

Idag lägger boende själva in sin adress i Egrannar. Det ersätts av ett formulär på hemsidan.

1. Boende fyller i e-post, namn och lägenhetsnummer.
2. Ett bekräftelsemejl med länk skickas (dubbel bekräftelse).
3. När länken klickats hamnar anmälan i en kö som Carl godkänner i verktyget. Han kontrollerar lägenhetsnumret mot sin egen förteckning. Det hindrar att utomstående hamnar på listan.
4. Först efter godkännande blir adressen en aktiv mottagare, och en bekräftelse skickas.

Skydd mot missbruk utan tredjepartsskript: dolt fält (honeypot), tidskontroll och hastighetsbegränsning per IP och per adress. Ingen extern captcha. Carl kan också lägga till och ta bort adresser själv. Importen från CSV finns kvar.

## F5. Flytt

Någon flyttar ut och en annan flyttar in. Verktyget ska ha:

- en vy per lägenhetsnummer med alla adresser kopplade till lägenheten,
- en knapp Avregistrera lägenhet som sätter alla dess adresser som avaktiverade i ett steg, med bekräftelse,
- tydlig markering av adresser som saknar lägenhetsnummer, eftersom de inte går att rensa vid flytt.

## Utanför omfånget

Gilla, kommentera och följ tråd. Personliga konton och inloggning för boende. Statistik om läsning på sajten. Medlemsansökningar och aviseringar om nya medlemmar. Import av gamla utskick. Bokning och felanmälan (de lösas som sidor på hemsidan).
