# Cloudflare Access setup (Zero Trust free plan, up to 50 users)

Goal: the whole app sits behind Cloudflare Access (email one-time PIN or Google login), **except** the
few routes that borrowers or Stripe must reach without a login. The app still requires its own login
for everything internal; Access is a second lock in front of it.

Create two self-hosted Access applications in Zero Trust > Access > Applications:

1. **DealDesk OS (staff)** — domain `desk.<your-domain>`, path empty (whole host)
   - Policy: Allow — Include: Emails = Cory's email (+ any staff emails)
   - Session duration: 8 hours
2. **DealDesk OS (public paths)** — same domain, one application per path (or one app with multiple
   destinations): `/apply`, `/apply/thanks`, `/u/*`, `/static/*`, `/webhooks/stripe`, `/favicon.ico`
   - Policy: **Bypass** — Include: Everyone
   - Only turn this on after sponsor compliance approves the public intake form and upload links.

Until approval, leave only app #1 in place: then even `/apply` and `/u/*` require Cory's Access login,
so no borrower PII can arrive.

Then set in `.env`: `COOKIE_SECURE=1`, `TRUST_PROXY=1`, `PUBLIC_BASE_URL` via Settings >
"Public base URL" = `https://desk.<your-domain>`, and restart.
