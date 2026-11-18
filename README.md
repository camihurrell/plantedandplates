# Planted & Plated

A farm-to-table cooking app with a public homepage and a separate personal
kitchen at `/kitchen.html`. Accounts use Neon Auth. Pantry items, preferences,
recipes, favorites, recipe quotas and payment entitlements live in Neon Postgres.

## Features

- Real email/password signup, login, logout and returning sessions.
- AI recipes based on ingredients, servings, cooking time and exclusions.
  Includes measured ingredients, steps, flavor tips and a separate shopping list.
- Persistent pantry and preferences; recipe history and favorite recipes.
- Actual mapped farm shops and farmers markets, filtered by 10/25/50/100-mile
  straight-line radius, with source links, directions and supplied listing data.
- $5 one-time Stripe Checkout; server-confirmed paid access, signed webhook
  updates, idempotent payment records and full-refund revocation.
- Production build provisions the required demo account when Auth and DB setup
  permits it. No hardcoded login bypass. The normal Neon login handles demo too.

## Environment variables in Vercel

| Variable | Visibility | Required for |
| --- | --- | --- |
| `DATABASE_URL` or `POSTGRES_URL` | Secret | Neon data; already supplied by the Neon integration |
| `VITE_NEON_AUTH_URL` | Config / public | Browser authentication; already supplied by Neon |
| `NEON_AUTH_BASE_URL` | Server configuration | JWT verification; falls back to the public auth URL |
| `OPENAI_API_KEY` | Secret | Real AI generation |
| `OPENAI_MODEL` | Config | Optional, defaults to `gpt-4.1-mini` |
| `STRIPE_SECRET_KEY` | Secret | Stripe-hosted checkout |
| `STRIPE_WEBHOOK_SECRET` | Secret | Verified asynchronous payment updates |
| `APP_URL` | Config | Production origin, defaults to `https://plantedandplates.vercel.app` |

Never add AI keys, Stripe keys or database connection strings with a `VITE_`
prefix: those would be public in a browser build. No secret values are in source.
No API key is needed for the OpenStreetMap farm search.

## Deploy

1. Push the root files and the `api` folder to the repository root. The app uses
   the included build command (`npm run build`) and output directory `dist`.
   There is no Vite/React framework preset requirement. Node 22+ is supported.
2. Keep the existing Neon integration variables. Add AI and Stripe secrets.
3. In Neon → Better Auth → Configure Auth → Domains, allow exactly
   `https://plantedandplates.vercel.app`. Add specific preview origins only when
   needed. Leave normal email verification enabled if desired.
4. In Stripe, add a webhook destination:
   `https://plantedandplates.vercel.app/api/app?action=webhook`.
   Subscribe to `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, and `charge.refunded`.
   Store its signing secret as `STRIPE_WEBHOOK_SECRET`.
5. Redeploy to apply variables and bootstrap the database/demo account.
   Stripe test keys enable test checkout only; live keys and a completed Stripe
   account are required to accept actual money. Keep modes consistent.

## Demo account

`demo@demo.com` / `password123!` is provisioned by `bootstrap.mjs` in production.
It uses normal signup/signin, verifies only that account in `neon_auth.user`,
and assigns paid demo access to its immutable user ID in `pp_profiles`.
The script checks the required password before granting access to an existing
account. It never resets another user's credentials. If a conflicting demo
account exists, the build logs explain that only that account needs attention.

The build succeeds with a clear pending message if Auth provisioning is blocked.
After fixing trusted domains, redeploy. Alternatively run `npm run seed:demo`
with `SEED_DEMO_ACCOUNT=true` and the database/auth variables locally.
Do not mark the demo requirement complete until its normal login is tested.

## Development and tests

Install Node.js 22+, run `npm install`, create `.env.local` with your variables,
then run `npm run dev`. Preview: `http://localhost:5173`.
`npm test` checks signed JWT authentication, invalid token rejection, payment
ownership/status/amount checks, quotas, recipe validation and geographic radius.
`npm run build` creates the deployment assets. The frontend build uses esbuild
to avoid the previous host's native Rollup signing issue.

## Usage and data notes

Free accounts receive three generated recipes total; Kitchen Pass and demo
accounts receive up to 30 per UTC day. Failed generations release their quota
reservation. Farm lookups are rate-limited, cache geocoding/listings, and respect
Nominatim's one-request-per-second policy with a database-backed service gate.
Farm mapping coverage can be incomplete. No farm names or stock claims are
invented. Recipe history currently displays the newest 150 recipes.

All protected requests verify signed Neon JWTs with issuer/audience checks.
All recipe and pantry queries scope data to the verified account ID. Paid status
comes from server data and verified Stripe payments, not browser parameters.
The publicly shared demo account is for sample data; don't enter private data.

## Before submitting

- Test signup → verification if required → logout → returning login.
- Confirm pantry and favorites persist after reloading and on a second session.
- Generate a useful real recipe and test exclusions/servings.
- Search a known town at two radii and verify source links.
- Run Stripe test checkout, webhook delivery, and paid-account activation.
- Test the already-existing demo login and full feature access.
- Create genuine test accounts, including a fresh one before the screenshot.
- Capture Neon users table and prepare the one-page document with live and repo
  URLs. A live $1 charge belongs to the later Week 4 proof.

## Primary documentation

- https://github.com/neondatabase/neon-js/blob/main/packages/auth/README.md
- https://neon.com/docs/auth/guides/plugins/jwt
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://docs.stripe.com/payments/checkout
- https://operations.osmfoundation.org/policies/nominatim/
- https://wiki.openstreetmap.org/wiki/Overpass_API
