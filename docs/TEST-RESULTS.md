# Test run 2026-11-25 10:08 EST (v2)

## npm test — 51/51 pass (v1: 27 incl. 48 calculator checks; v2: 24 new in tests/v2.test.js)
```
▶ auth & security
  ✔ health + unauthenticated redirect (40.78267ms)
  ✔ security headers (3.161956ms)
  ✔ wrong password rejected, right password accepted, password stored as bcrypt (600.950437ms)
  ✔ CSRF token required on POST (306.996914ms)
  ✔ login is rate-limited (1176.21751ms)
  ✔ open redirect blocked after login (290.521194ms)
  ✔ logout ends session (296.066272ms)
✔ auth & security (3393.70317ms)
▶ modules
  ✔ dashboard: pipeline by stage, tasks, intakes, conditions, unpaid (demo data, labeled DEMO) (8.029473ms)
  ✔ CRM: contact with consent + DNC, edit logs consent changes, SSN-like text redacted (16.846728ms)
  ✔ companies CRUD (4.163008ms)
  ✔ tasks: overdue flag + toggle (12.097952ms)
  ✔ pipeline: kanban + table, create deal seeds checklist, stage move logged (15.226853ms)
  ✔ public intake: no login, validation, creates lead + deal + checklist + task, redacts SSN, no SSN/DOB fields (19.197402ms)
  ✔ analyzer: saved inputs produce the tested calc results; estimate labeled not a commitment (23.610521ms)
  ✔ underwriting: status flow timestamps, add condition, red flags, scenario export strips NPI (23.704682ms)
  ✔ documents: expiring token link, public upload, type/magic/size limits, storage outside web root, auth download, revoke (67.736086ms)
  ✔ payments: manual link, https only, status transitions, dashboard unpaid count (17.032907ms)
  ✔ templates: merge fields from deal, DNC + SMS consent warnings, copy-only (10.812063ms)
  ✔ compliance reference + responsibility note + footer disclaimer (57.970909ms)
  ✔ settings: profile flows into merge fields + public footer; demo data can be deleted (11.225722ms)
  ✔ XSS: user input is escaped everywhere (4.252686ms)
✔ modules (903.974513ms)
▶ stripe (mocked, test mode only)
  ✔ key mode detection refuses live keys (0.215337ms)
  ✔ creates a test payment link via mocked API; webhook marks paid (630.72712ms)
  ✔ live key never calls Stripe (0.819106ms)
✔ stripe (mocked, test mode only) (632.000552ms)
▶ reference data
  ✔ checklists per loan type follow the matrix (0.551153ms)
  ✔ red flags and common conditions load (0.175403ms)
✔ reference data (0.832093ms)
✔ ported calc.js + memo.js pass the DealSheet Lab hand-worked cases (54.596537ms)
▶ time + quiet hours
  ✔ nextAllowed pushes late-night sends to 8am recipient-local, keeps daytime (19.830602ms)
  ✔ transports simulate without credentials (no real sends) (0.558254ms)
✔ time + quiet hours (21.617176ms)
▶ demo v2 seed + outbox defaults
  ✔ automated sending defaults OFF; demo messages are held or blocked, never sent (2.023601ms)
  ✔ DNC contact: sequence message blocked and enrollment stopped (0.438515ms)
  ✔ no SMS consent: stage-change text blocked (0.445016ms)
  ✔ approving a held message with an incomplete profile keeps it held (needs physical address/NMLS) (2.495145ms)
  ✔ approve with complete profile: simulated send with footer + unsubscribe link (2.602646ms)
  ✔ quiet hours: approved at 11pm ET is rescheduled to 8am, not sent (3.19819ms)
✔ demo v2 seed + outbox defaults (750.392013ms)
▶ portal
  ✔ unknown/invalid token 404s; valid token asks for verification and shows nothing private (37.734579ms)
  ✔ wrong details rejected and counted; right details unlock the portal (33.035445ms)
  ✔ upload without verification is refused; bad file type refused (5.221724ms)
  ✔ locks after 10 failed attempts (2.766012ms)
  ✔ revoked link stops working; mobile viewport meta present (298.227645ms)
  ✔ staff can create a link, post an update, toggle borrower visibility (303.013108ms)
✔ portal (1027.272302ms)
▶ automation rules
  ✔ new intake: instant acknowledgement email+text with portal link, tasks, nurture enrollment, alert (12.1944ms)
  ✔ intake without email consent: transactional ack allowed (lawful basis), no nurture, no text (7.191451ms)
  ✔ stage change: tasks, checklist, portal update, status email; sequence stops when the lead advances (293.604923ms)
  ✔ disabled rule does nothing (1.096246ms)
  ✔ document reminders on day 2/5/9, deduped, canceled once items arrive (6.187526ms)
  ✔ sequences: steps queue on schedule; reply, unsubscribe and SMS STOP stop them (301.143108ms)
  ✔ kill switch ON: consented messages send (simulated) on tick; OFF moves queued back to held (321.875514ms)
  ✔ stale-deal alerts and daily digest (in-app + queued internal email, once per day) (4.087077ms)
✔ automation rules (1244.405885ms)
▶ admin pages
  ✔ outbox + automations pages render, filters work, rule edits persist, message edit/approve/cancel (371.655709ms)
  ✔ delete demo removes demo outbox rows and enrollments (309.076611ms)
✔ admin pages (1028.095845ms)
ℹ tests 51
ℹ suites 9
ℹ pass 51
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9526.781142
```

## npm run smoke — SMOKE OK, 33 screens, no console/CSP/page errors
```
Screens captured (33): 00-login, 01-dashboard, 02-pipeline-kanban, 03-pipeline-table, 04-contacts, 05-contact-detail, 06-companies, 07-tasks, 08-deal-overview, 09-analyzer-flip, 10-analyzer-dscr, 11-estimate-printable, 12-underwriting, 13-documents-link-created, 14-borrower-upload-page, 15-documents-received, 16-payments, 17-templates, 18-compliance, 19-compliance-doc, 20-settings, 21-public-intake-form, 22-public-intake-thanks, 23-dashboard-after-intake, 24-outbox, 25-outbox-message, 26-automations, 27-deal-portal-panel, 28-portal-verify, 29-portal-desktop, 30-portal-mobile, 31-portal-mobile-after-upload, 32-dashboard-v2
SMOKE OK — all modules rendered with no console/CSP/page errors.
```

## Live instance (pm2 dealdesk-os, 127.0.0.1:4100)
- DB migrated in place (backup of the pre-v2 DB: backups/dealdesk-pre-v2.db), v2 demo seeded, scheduler running (daily digest built 10:07 EST).
- Outbox: 14 held, 2 blocked by consent, 0 sent. Automated sending OFF, OUTBOUND_DRY_RUN=1, no SMTP/Twilio credentials.
