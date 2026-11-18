# Planted & Plated — authentication slice

Preserves the existing homepage and adds real email/password signup, login,
logout, and session restoration through Neon Auth. No passwords or fabricated
sessions are stored in browser local storage.

## Vercel setup

Upload this folder's contents at the root of camihurrell/plantedandplates.
Keep the Neon-provided environment variables. VITE_NEON_AUTH_URL is public
configuration and must contain only the https URL, without a key= prefix.
Vercel should use the Vite framework preset, npm run build, and dist output.
The included vercel.json declares those settings. Node 22 or newer is needed.

In Neon → Better Auth → Configure Auth → Domains, allow exactly:

https://plantedandplates.vercel.app

Add an exact preview origin separately if testing a preview deployment.
Do not allow all vercel.app domains.

## Local development

Install Node.js 22 or newer. Copy .env.example to .env.local, run npm install,
then npm run dev. After installing, commit the generated package-lock.json.
Direct dependencies are pinned. The generated lockfile should be retained to
make future builds reproducible.

## Checks performed

JavaScript syntax validation passed. An esbuild browser bundle successfully
compiled auth.js against the installed @neondatabase/auth 0.7.0-beta package.
The local Vite build could not run because the bundled macOS Node executable
rejects the Rollup native module's signing identity. A complete Vercel build and
live signup/login tests have not yet been performed.

## Validation before marking accounts complete

1. Create a fresh account through the deployed Join the kitchen form.
2. Complete email verification if Neon requires it.
3. Confirm the user row in Neon Auth.
4. Log out and confirm the header returns to Log in.
5. Log in with that same account, reload, close the tab, and return.
6. Confirm the correct account is restored, then test an incorrect password.
7. Test a second account and on a narrow mobile viewport.

## Scope and remaining work

This is the account slice, not the finished assignment. Existing recipes still
search the original three-item starter collection. Farm results remain labeled
illustrative. AI recipes, real farm search, saved user data in Neon, Stripe
checkout, paid entitlements, and the seeded paid demo account remain to build.
The required demo credentials do not currently receive any hardcoded bypass.

## References

- https://github.com/neondatabase/neon-js/blob/main/packages/auth/README.md
- https://neon.com/docs/auth/guides/configure-domains
