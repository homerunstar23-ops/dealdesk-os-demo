# DealDesk OS (v2) — a DealSheet Lab project

One login, one app, $0 to run: CRM, loan pipeline, public deal intake ("deal collector"), deal analyzer,
underwriting-support workspace, borrower document collection, appraisal/fee payment requests, dashboard,
templates library and compliance reference, plus (v2) an **investor status portal**, an **automation engine**
and an **Outbox with a kill switch** — built for a licensed MLO working investor / business-purpose
loans (DSCR, fix & flip, bridge, ground-up, cash-out refi).

> **Support tool, not a lender system.** Analyses are educational estimates — never loan offers,
> approvals, rate quotes or commitments to lend. The underwriting workspace tracks items; it never makes
> credit decisions. Cory remains responsible for licensing, sponsorship, RESPA, TCPA, CAN-SPAM, fair
> lending and state rules. **Get sponsoring-broker compliance sign-off before any public or
> borrower-facing use** (see `APPROVALS.md`). No LendingOne name, branding or guidelines are used.

**Name:** "DealDesk OS" was chosen to sit under the existing DealSheet Lab brand (the free calculators
and kit) without using any lender's name. It's easy to rename (`BRAND` in `src/views/layout.js`).

## Run it

```bash
cd /workspace/lending-platform
npm ci                 # Node 20+ (tested on Node 24)
npm run setup          # first time only: writes .env + secrets/admin-login.txt (chmod 600)
npm start              # http://127.0.0.1:4100  (or: pm2 start ecosystem.config.js)
npm test               # API + calculator + v2 automation/portal tests
npm run smoke          # headless Chrome walk-through of every module -> screenshots-review/
```

- **Login:** email + password are in `secrets/admin-login.txt` (never committed, never printed).
  Change the password after first login (Settings > Change password).
- **On the box right now:** running under pm2 as `dealdesk-os` on `127.0.0.1:4100` (`pm2 status`,
  `pm2 logs dealdesk-os`, `pm2 restart dealdesk-os`; after a box reboot run `pm2 resurrect`).
- **Demo data:** loads once on first start and is clearly labeled (DEMO tags, `@example.com`
  emails, 555-01xx phones, "Example/Sample/Mock" street names). Remove it in Settings > Delete demo data.
  Set `SEED_DEMO=0` for a clean production database.

## Modules

| # | Module | Where | What it does |
|---|---|---|---|
| 1 | CRM | `/contacts`, `/companies`, `/tasks` | Borrowers, brokers, agents, wholesalers, partners, title, insurance; companies/entities; notes; activity log; tags; lead source; **consent records** (email/SMS consent + date + method, DNC/opt-out date); follow-up tasks with due dates and overdue flags |
| 2 | Pipeline | `/pipeline` | Lead → Application → Processing → Underwriting → Conditionally Approved → Clear to Close → Closed / Dead. Kanban (one-click stage move) + filterable table; assigned to; app/target-close/closed dates |
| 3 | Deal intake | `/apply` (public, no login) | Borrower/entity, property, loan type, purchase/rehab/ARV/rent, experience, **self-reported** credit range, consent checkboxes, disclaimer. Creates contact + deal + checklist + "review intake" task. No SSN/DOB fields; SSN-like numbers in text are auto-redacted; honeypot + rate limit |
| 4 | Deal analyzer | `/deals/:id/analyze` | DSCR, fix & flip (LTC/LTV/ARV sizing, points, carry, profit, 70% rule), BRRRR/cash-out, rental cash flow — the tested DealSheet Lab engine (`src/lib/calc.js`, `memo.js`). Rule-based deal memo + stress tests. Printable **ESTIMATE — NOT A COMMITMENT TO LEND** at `/deals/:id/estimate` |
| 5 | Underwriting workspace | `/deals/:id/underwriting` | Per-loan-type document checklist (from the toolkit's requirement matrix) + condition tracker (open → requested → received → reviewed → cleared / waived, with dates), red-flag escalation checklist, UW notes, scenario-desk summary export (`/deals/:id/scenario.txt`, initials only, no address/email) |
| 6 | Document collection | `/deals/:id/documents`, `/u/:token` | Per-deal expiring borrower upload link (random 256-bit token, stored hashed, shown once, revocable). PDF/JPG/PNG/HEIC/DOC(X)/XLS(X)/CSV/TXT, content-checked, 15 MB max. Files stored in `data/uploads` (outside the web root, chmod 600) and downloaded only by logged-in staff |
| 7 | Appraisal / fee payments | `/deals/:id/payments` | Record a fee request (amount, status requested/paid/refunded/canceled, dates) with a payment link. If `STRIPE_SECRET_KEY` is a **test** key, it can create a Stripe Payment Link; live keys are refused in v1. Otherwise paste a link. Optional signed webhook marks payments paid |
| 8 | Dashboard | `/` | Pipeline count/value by stage, tasks overdue/due today, new intakes, outstanding conditions, unpaid fee requests, recent activity |
| 9 | Templates | `/templates` | 29 email/SMS/call/DM templates from the LO toolkit with merge fields filled from a deal/contact; copy-to-clipboard only; DNC and no-SMS-consent warnings; add custom templates |
| 10 | Compliance | `/compliance` | The toolkit's compliance guides (RESPA, TCPA, CAN-SPAM, fair lending, SAFE/NMLS, business purpose, state variance, record retention, attorney-review list) + playbooks; responsibility note; global footer disclaimer on every page |

## v2: status portal + automation (what's new)

| Module | Where | What it does |
|---|---|---|
| Investor status portal | `/p/<token>` (public link, no login) | Per-deal secret link (256-bit, stored hashed + encrypted, revocable, one active per deal). Optional check: email on file + last 4 of phone (or email only); locks after 10 failed tries; rate-limited. Shows the 7-step timeline, plain-English **what happens now / what we need from you / typical next step** (no approval language, no promised dates), outstanding items with **upload buttons**, conditions in borrower wording, received items, an updates feed, your contact card (NMLS placeholders until Settings is filled) and a disclaimer. Never shows internal notes, red flags, UW notes or items marked internal. Mobile-first layout |
| Portal controls | Deal page > "Borrower status portal" | Create/replace/revoke link, copy it, choose verification, post updates. Underwriting tab: "Borrower sees" checkbox + borrower-facing wording per item |
| Automation engine | `src/lib/engine.js`, `/automations` | Rules: **stage change** (tasks, checklist items, portal update, status email/text), **new intake** (instant acknowledgement with portal link + tasks + nurture enrollment), **document reminders** (days 2/5/9 until received), **nurture sequences** for leads (21 days) and partners (30 days) with auto-stop on reply/unsubscribe/STOP/DNC/stage change, **stale-deal alerts** (7 days) and a **daily digest** (in-app + email to you). Scheduler runs inside the app every minute (node-cron). Toggle rules, edit timing/templates, see the run log and alerts |
| Outbox + kill switch | `/outbox` | Every automated message lands here as queued / **held** / sent / failed / **blocked by consent** / canceled. **Automated sending defaults OFF** → everything is held for review; approve one or many; edit before approving; cancel. Consent, DNC, profile and quiet hours are re-checked at send time. With no SMTP/Twilio credentials (current state) sends are **simulated and logged** |
| Unsubscribe + STOP | `/unsub/<token>`, `/webhooks/sms` | One-click unsubscribe page (stops sequences, blocks pending email). Twilio inbound webhook (signature-verified) handles STOP and marks replies |

Turning real sending on: see **`docs/SENDING.md`** (Gmail app password / Brevo free / Resend free; Twilio
optional and paid). Demo v2 data: Avery's "3 Sampleton St" deal has a portal (verify with
`avery.sample@example.com` + `0101`); the Outbox has held and consent-blocked demo messages.

## File map

```
server.js                 entry (loads .env, listens on HOST:PORT)
ecosystem.config.js       pm2 process file
scripts/setup.js          generates .env + secrets/admin-login.txt
src/app.js                Express app: helmet/CSP, sessions (SQLite store), CSRF, routing
src/db.js                 SQLite schema + enums (stages, loan types, statuses)
src/seed.js               admin bootstrap, settings, template import, FAKE demo data, demo delete
src/reference.js          reads reference/lo-toolkit (doc matrix, conditions, red flags, templates, compliance)
src/lib/calc.js, memo.js  deal math + memo engine (ported unchanged from DealSheet Lab)
src/lib/model.js          dashboard queries, checklist seeding, analyzer defaults, merge fields
src/lib/security.js       session store, CSRF, auth guards
src/lib/uploads.js        upload limits + magic-byte checks + storage
src/lib/stripe.js         Payment Links (test mode only) + webhook signature check
src/lib/util.js           escaping HTML templates, validation, SSN redaction, formatting
src/lib/engine.js         v2 automation engine: rules, consent gates, outbox queue/dispatch, sequences, scheduler, portal tokens
src/lib/transports.js     SMTP (nodemailer) / Twilio senders — simulated unless credentials set and OUTBOUND_DRY_RUN != 1
src/lib/stages.js         borrower-facing stage wording;  src/lib/timeutil.js  quiet hours / time zones
src/lib/auto-templates.js automated message templates + nurture sequences (seeded, editable in /automations)
src/routes/*.js           auth, public (intake/upload/webhook), portal (/p, /unsub, /webhooks/sms), dashboard, crm, deals,
                          automation (/outbox, /automations), library, settings
src/views/*.js            layout + analyzer tables
public/                   CSS, JS (no inline scripts), favicon
reference/lo-toolkit/     copy of the LO toolkit docs the app reads
tests/                    app.test.js (API), calc.test.js (+ legacy_calc_check.js), smoke.js (browser)
deploy/                   Cloudflare Tunnel + Access, systemd, Oracle VM script, backups, Render demo-only
Dockerfile, docker-compose.yml   optional container route
docs/HOSTING.md           $0 hosting evaluation + recommendation
SECURITY.md  ROADMAP.md  APPROVALS.md
data/  (git-ignored)      dealdesk.db + uploads/   ·   secrets/ (git-ignored) admin login
```

## Configuration
See `.env.example`. Key items: `SESSION_SECRET`, `ADMIN_EMAIL/ADMIN_PASSWORD` (first admin only),
`SEED_DEMO`, `COOKIE_SECURE`/`TRUST_PROXY` (set to 1 behind HTTPS/tunnel), `MAX_UPLOAD_MB`,
`UPLOAD_LINK_DAYS`, `STRIPE_SECRET_KEY` (test only), `STRIPE_WEBHOOK_SECRET`.
v2: `SCHEDULER` (1/0), `OUTBOUND_DRY_RUN` (1 = never really send), `SMTP_*` + `MAIL_FROM`, optional `TWILIO_*`.
Your name/NMLS/company/disclosures for templates and the public form live in **Settings**.

## Costs
v2 automation is $0 while sending is simulated. Email can stay $0 on Gmail SMTP / Brevo free / Resend free
(limits in `docs/SENDING.md`). Texting is never free (per-message + A2P 10DLC registration fees).
Software, hosting (recommended route) and database: **$0**. Card payments are never free: Stripe has no
setup or monthly fee but charges per successful transaction (standard US domestic card rate listed as
2.9% + 30¢ on stripe.com/pricing, checked 2026-11-25). A custom domain for the tunnel is optional (~$11/yr
at Cloudflare's at-cost registrar, based on the getmarginbench.com purchase).
