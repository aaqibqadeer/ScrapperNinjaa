# AGENTS.md

Project rules live in `CLAUDE.md` and `.cursorrules` (auto-loaded). Read
`docs/knowledge-base/current-state.md` first. This file only adds environment
notes for automated agents.

## Cursor Cloud specific instructions

This is **ScrapperNinja** (ninjakit fork): Next.js 15 web app + Chrome MV3
capture extension (`/extension`). Package manager is **npm**; Node 22.

### MongoDB — start manually
```
mongod --dbpath /data/db --bind_ip 127.0.0.1 --port 27017
mongosh --quiet --eval 'db.runCommand({ ping: 1 })'
```

### `.env.local` (git-ignored)
Standard set: Google OAuth (not LinkedIn/Gmail), Stripe, DeepSeek, scraper flags.
See `.env.example`. Placeholders boot locally; email links print to server console
without `RESEND_API_KEY`.

```
NEXT_PUBLIC_PRODUCT=scrapperninja
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_FEATURE_AUTH_EMAIL_PASSWORD=1
NEXT_PUBLIC_FEATURE_AUTH_OAUTH_GOOGLE=1
NEXT_PUBLIC_FEATURE_PAYMENTS=1
NEXT_PUBLIC_FEATURE_PAYMENTS_ANNUAL_BILLING=1
NEXT_PUBLIC_FEATURE_ADMIN=1
NEXT_PUBLIC_FEATURE_AI_PROVIDERS=deepseek
NEXT_PUBLIC_FEATURE_SCRAPER=1
NEXT_PUBLIC_FEATURE_COOKIE_BANNER=1
AUTH_SECRET=<openssl rand -base64 32>
EEO_ENCRYPTION_KEY=<openssl rand -base64 32>
SUPER_ADMIN_EMAIL=admin@example.com
GOOGLE_CLIENT_ID=placeholder
GOOGLE_CLIENT_SECRET=placeholder
STRIPE_SECRET_KEY=sk_test_placeholder
STRIPE_WEBHOOK_SECRET=whsec_placeholder
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_placeholder
DEEPSEEK_API_KEY=placeholder
DB_PROVIDER=mongodb
MONGODB_URI=mongodb://localhost:27017/scrapperninja
```

### Commands
- `npm run dev`, `npm run seed`, `npm run lint`, `npm run typecheck`, `npm test`
- `npm run build:extension` → `extension/dist/scrapperninja`
