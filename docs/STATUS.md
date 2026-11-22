# Status: var vi är (uppdaterad 22 nov 2026)

Läs den här filen först när arbetet återupptas. Den bygger på `BYGGINSTRUKTION.md` (hur), `SLUTPRODUKT.md` (vad kunden vill ha efter mötet med Carl), `ARCHITECTURE.md` och `DECISIONS.md` (alla beslut och öppna frågor).

## Första meddelandet att klistra in när vi fortsätter

> Läs `docs/STATUS.md`, `docs/SLUTPRODUKT.md` och `docs/DECISIONS.md`. Fortsätt där vi slutade. Jag har gjort följande sedan sist: …

## Läget

| Milstolpe | Status |
|---|---|
| 0 Underlag | Klar, godkänd |
| 1 Grund (schema, RLS, TOTP-inloggning, seed, isoleringstest) | Klar, godkänd, **verifierad mot riktigt Supabase** (åtta manuella tester) |
| 2 Adresslista (lägg till/redigera/avaktivera/ta bort, taggar, CSV-import i adminvyn, export, "radera helt") | **Byggd och testad mot Postgres. Inte verifierad mot riktigt Supabase och inte godkänd av Thomas.** |
| "Gör redan nu" från SLUTPRODUKT (datamodell) | **Byggd (migrering 0005 och 0006) och testad mot Postgres. Inte körd i Supabase.** |
| 3 Skriv och förhandsgranska | Ej påbörjad |
| 4 Skicka och avanmäla | Ej påbörjad (väntar på beslut om hosting, D-005, och på Q2 och Q3) |
| 5 Riktig sändning | Ej påbörjad. SES-ansökan är inte inskickad (utkast i `docs/SES-ANSOKAN.md`) |
| 6 Hårdgöring | Ej påbörjad |
| F1–F5 (SLUTPRODUKT) | **Ej byggda, avsiktligt.** Thomas säger till när. Öppna frågor Q1–Q7 i `DECISIONS.md` |

Tester: 37 enhetstester (`npm test`) och 57 databastester (`npm run test:db`, startar en lokal Postgres 16). Alla passerar. Databastesterna inkluderar mutationstester som försvagar varje policy och vakt och kräver att testsviten blir röd.

## Det som väntar på Thomas, i ordning
1. **Kör migreringarna i Supabase** (SQL Editor, en fråga i taget): `truncate public.tenants cascade;` om det finns data, sedan `0003`, `0004`, `0005`, `0006` från `supabase/migrations/`. Detaljer i README under "Milstolpe 2".
2. **Skapa `SUPPRESSION_HMAC_MASTER_KEY`** (Node-raden i README), lägg den i `.env.local` och i lösenordshanteraren. Använd samma värde när du seedar om.
3. **Seeda om** (samma PowerShell-rader som tidigare plus nyckeln). Skapar nu fem testanvändare.
4. **Gör testlistan för milstolpe 2** (15 punkter, se Claudes senaste rapport) och lägg till: logga in som `board-alfa@example.com` (ställ in TOTP): ska se föreningen men "Adresslista (inte för din roll)".
5. **Svara på frågorna Q1–Q7** i `DECISIONS.md`, framför allt **Q3** (vem får ta emot utskick) och **Q5** (vilken plattform hemsidan ligger på) samt hosting (D-005).
6. Skicka in **SES-ansökan** när Thomas är redo (kan göras parallellt, tar tid).

## Nästa steg för Claude när Thomas har godkänt M2
Milstolpe 3 (skriv och förhandsgranska). **Regel:** brödtexten lagras utan sidfot och avanmälningslänk (D-026). Därefter M4 med de nya statusarna enligt Q2. F1–F5 byggs först när Thomas säger till, i ordningen F1, F2 (efter F1), F4 (före M4), F3, F5.

## Fakta som är lätta att tappa bort
- **Repo:** `GentryGentry/D-G-Utskick`, gren `claude/vibrant-carson-kku6ib`. Inga pull requests skapade.
- **Projektbriefen `CLAUDE.md` har aldrig funnits i repot.** Arkitekturen bygger enbart på byggfilerna (D-001).
- **Stack:** Next.js 16 (`proxy.ts` i stället för `middleware.ts`), Supabase (dev-projektet "D&G Utskick", EU), TypeScript, Vitest. Inga riktiga mejl har skickats; alla adresser är påhittade (`example.com`, `.test`).
- **Alla skrivningar till `subscribers` går via databasfunktioner** (D-017). Alla nya funktioner måste anropa `assert_staff` eller `assert_admin`.
- **Hashar:** `email_hash` = HMAC med nyckel härledd från `SUPPRESSION_HMAC_MASTER_KEY` (D-016). Nyckeln når aldrig databasen.
- **Thomas kör Windows/PowerShell:** `npm.cmd` i stället för `npm`, och miljövariabler sätts med `$env:NAMN='värde'` (enkla citattecken). Nycklar och lösenord klistras aldrig in i chatten.
- **Seed** vägrar köra utan `SEED_I_KNOW_THIS_IS_DEV=yes` och om databasen redan är seedad.
- **Kända luckor:** skärmarna är aldrig körda i en webbläsare mot riktigt Supabase av mig. Ingen hastighetsbegränsning på inloggning än (M6). Accepterad risk i D-016 (påhittad hash).

## Tid
Min uppskattning, inte mätt: M0 2 h, M1 6 h, M2 6 h, datamodellen från mötet 2 h, plus Thomas egna kontroller. Ungefär 16 av 40 timmar förbrukade. Q1–Q7 och F1–F5 är inte inräknade i den ursprungliga budgeten. Det är ett eget beslut för Thomas, se nedan.

## Ärlig kommentar om budgeten
SLUTPRODUKT lägger till F1–F5 på ett projekt som redan var budgeterat precis på taket (40 timmar fram till pilot). Min bedömning av tillägget är ungefär: F1 5 h, F2 4 h (efter juridisk bedömning), F3 4 h, F4 8 h, F5 4 h, totalt cirka 25 timmar. Antingen höjs taket, eller så väljer Thomas vad som ska med i piloten. Mitt förslag är F1 och F4 (kunden ser dem varje dag och F4 ersätter Egrannars anmälan), därefter F5, och skjuta F2 och F3 till efter pilot.
