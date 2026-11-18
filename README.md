# D&G Utskick

Utskickstjänst för bostadsrättsföreningar. Se `docs/BYGGINSTRUKTION.md` (hur), `docs/ARCHITECTURE.md` (design) och `docs/DECISIONS.md` (beslut).

Status: milstolpe 1 (grund) klar och verifierad mot riktigt Supabase.

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
