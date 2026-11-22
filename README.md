# D&G Utskick

Utskickstjänst för bostadsrättsföreningar. Se `docs/BYGGINSTRUKTION.md` (hur), `docs/ARCHITECTURE.md` (design) och `docs/DECISIONS.md` (beslut).

Status: se `docs/STATUS.md`.

## Kommandon
```bash
npm install
npm test            # enhetstester (ingen databas behövs)
npm run test:db     # startar en tillfällig lokal Postgres 16, kör migreringar, seed, RLS-test och mutationstest
npm run typecheck
npm run build
```

## Kontroll mot riktigt Supabase (görs av Thomas i ett DEV-projekt, EU-region)
1. Skapa dev-projekt. Kör `supabase/migrations/0001_schema.sql` och `0002_rls.sql` i SQL-editorn (eller `supabase db push`). Båda ska gå igenom utan fel.
2. Aktivera TOTP under Authentication → Multi-Factor.
3. Kopiera `.env.example` till `.env.local` och fyll i URL och nycklar.
4. `SEED_I_KNOW_THIS_IS_DEV=yes SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… DATABASE_URL=… npm run seed`
5. `npm run dev`, logga in som `sender-alfa@example.com` (lösenord i `.seed-credentials.local.json`), ställ in TOTP, kontrollera att bara "Brf Testgården Alfa" syns.
6. Logga in som `sender-ingen@example.com`: ska se "inte kopplat till någon förening".

## Milstolpe 2: kontroll mot Supabase
1. `git pull` och `npm.cmd install`.
2. Skapa huvudnyckeln och spara den i lösenordshanteraren: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Lägg den som `SUPPRESSION_HMAC_MASTER_KEY=` i `.env.local`.
3. SQL Editor, en fråga i taget och i den här ordningen: `truncate public.tenants cascade;` (hoppa över om databasen är tom), sedan innehållet i `0003_inactive_status.sql`, `0004_subscriber_management.sql` (D-021), `0005_board_viewer_role.sql` och `0006_slutprodukt_datamodel.sql`. Alla fyra ska ge "Success".
4. Seeda om (samma `$env:`-rader som förra gången, plus `$env:SUPPRESSION_HMAC_MASTER_KEY='…'` med **samma** värde som i `.env.local`). Seed städar själv bort de gamla testanvändarna och skapar nu fem (inklusive `board-alfa@example.com`, styrelsemedlem utan skrivrätt).
5. `npm.cmd run dev` och följ testlistan som Claude ger.
