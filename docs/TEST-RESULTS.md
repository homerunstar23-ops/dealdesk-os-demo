# Test run 2026-11-25 11:12 ET (v3)

## npm test — 73/73 pass (52 v1/v2 + 21 new v3 in tests/v3.test.js)
```
▶ auth & security
  ✔ health + unauthenticated redirect
  ✔ security headers
  ✔ wrong password rejected, right password accepted, password stored as bcrypt
  ✔ CSRF token required on POST
  ✔ login is rate-limited
  ✔ open redirect blocked after login
  ✔ logout ends session
✔ auth & security
▶ modules
  ✔ dashboard: pipeline by stage, tasks, intakes, conditions, unpaid (demo data, labeled DEMO)
  ✔ CRM: contact with consent + DNC, edit logs consent changes, SSN-like text redacted
  ✔ companies CRUD
  ✔ tasks: overdue flag + toggle
  ✔ pipeline: kanban + table, create deal seeds checklist, stage move logged
  ✔ public intake: no login, validation, creates lead + deal + checklist + task, redacts SSN, no SSN/DOB fields
  ✔ analyzer: saved inputs produce the tested calc results; estimate labeled not a commitment
  ✔ underwriting: status flow timestamps, add condition, red flags, scenario export strips NPI
  ✔ documents: expiring token link, public upload, type/magic/size limits, storage outside web root, auth download, revoke
  ✔ payments: manual link, https only, status transitions, dashboard unpaid count
  ✔ templates: merge fields from deal, DNC + SMS consent warnings, copy-only
  ✔ compliance reference + responsibility note + footer disclaimer
  ✔ settings: profile flows into merge fields + public footer; demo data can be deleted
  ✔ XSS: user input is escaped everywhere
✔ modules
▶ stripe (mocked, test mode only)
  ✔ key mode detection refuses live keys
  ✔ creates a test payment link via mocked API; webhook marks paid
  ✔ live key never calls Stripe
✔ stripe (mocked, test mode only)
▶ reference data
  ✔ checklists per loan type follow the matrix
  ✔ red flags and common conditions load
✔ reference data
✔ ported calc.js + memo.js pass the DealSheet Lab hand-worked cases
▶ time + quiet hours
  ✔ nextAllowed pushes late-night sends to 8am recipient-local, keeps daytime
  ✔ transports simulate without credentials (no real sends)
✔ time + quiet hours
▶ demo v2 seed + outbox defaults
  ✔ automated sending defaults OFF; demo messages are held or blocked, never sent
  ✔ DNC contact: sequence message blocked and enrollment stopped
  ✔ no SMS consent: stage-change text blocked
  ✔ approving a held message with an incomplete profile keeps it held (needs physical address/NMLS)
  ✔ approve with complete profile: simulated send with footer + unsubscribe link
  ✔ quiet hours: approved at 11pm ET is rescheduled to 8am, not sent
✔ demo v2 seed + outbox defaults
▶ portal
  ✔ unknown/invalid token 404s; valid token asks for verification and shows nothing private
  ✔ wrong details rejected and counted; right details unlock the portal
  ✔ upload without verification is refused; bad file type refused
  ✔ locks after 10 failed attempts
  ✔ revoked link stops working; mobile viewport meta present
  ✔ staff can create a link, post an update, toggle borrower visibility
✔ portal
▶ automation rules
  ✔ new intake: instant acknowledgement email+text with portal link, tasks, nurture enrollment, alert
  ✔ intake without email consent: transactional ack allowed (lawful basis), no nurture, no text
  ✔ stage change: tasks, checklist, portal update, status email; sequence stops when the lead advances
  ✔ disabled rule does nothing
  ✔ document reminders on day 2/5/9, deduped, canceled once items arrive
  ✔ sequences: steps queue on schedule; reply, unsubscribe and SMS STOP stop them
  ✔ kill switch ON: consented messages send (simulated) on tick; OFF moves queued back to held
  ✔ stale-deal alerts and daily digest (in-app + queued internal email, once per day)
✔ automation rules
▶ admin pages
  ✔ outbox + automations pages render, filters work, rule edits persist, message edit/approve/cancel
  ✔ delete demo removes demo outbox rows and enrollments
✔ admin pages
▶ demo mode & publicBaseUrl
  ✔ demoMode renders demo banner on login, dashboard, /apply and portal; publicBaseUrl sets portal links
✔ demo mode & publicBaseUrl
▶ v3 Today home screen
  ✔ / is Today: one big next-best-action card with Do it / Done / Skip, ranked list below
  ✔ ranking: new intake > overdue task > docs to review > outbox approvals
  ✔ Done on an intake marks it reviewed and the next card moves up; Skip hides for today only
  ✔ Done on a task completes the task; bad keys are ignored safely
  ✔ empty state when nothing is left
✔ v3 Today home screen
▶ v3 New-deal wizard
  ✔ one question per screen with a progress bar; guarded order
  ✔ validation: friendly errors, nothing created
  ✔ full flow creates contact (consent off by default), deal, checklist, follow-up task and status page
  ✔ cash-out skips the buying/refinancing question and asks rent + payoff
✔ v3 New-deal wizard
▶ v3 Move to next step (gates) + expected next-step date
  ✔ blocked with a plain-English checklist until the info is in
  ✔ lender-only steps need an explicit confirm; approval language is blocked in investor notes
  ✔ LO sets the expected next-step date; lint blocks rates and guarantees
  ✔ classic stage dropdown still works and still runs automations
✔ v3 Move to next step (gates) + expected next-step date
▶ v3 investor portal redesign
  ✔ stage timeline + progress, what we need, what happens next with the LO date; no approval words or internal notes
  ✔ a past expected date is hidden from the investor
  ✔ demo mode: the demo status-page link is stable across restarts (same secret), real links stay random
✔ v3 investor portal redesign
▶ v3 search, health, summary, plain-English UI
  ✔ search + command bar (JSON and page); login required
  ✔ pipeline health: SVG charts from app data only, no NaN, not approvals
  ✔ term-sheet-style summary prints cleanly and never reads as an offer
  ✔ plain-English labels replace jargon in staff screens; formal terms kept in tooltips
  ✔ kill switch + dry run unchanged; CSP still forbids inline script
✔ v3 search, health, summary, plain-English UI
ℹ tests 73
ℹ suites 15
ℹ pass 73
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 16570.42831
```

## npm run smoke — SMOKE OK
Headless Chrome walked all 33 v1/v2 screens plus the v3 Today, pipeline health, search, More, move-to-next-step, deal summary, the full New-deal wizard (creates a deal on the throwaway instance) and the live command bar, with no console, CSP or page errors.

## v3 screenshots (local pm2 instance, 127.0.0.1:4100) — node scripts/screenshots-v3.js
screenshots-review/v3-*.png (desktop 1440x900 and mobile 390x844) + v3-summary-print.pdf. Not committed (gitignored).

---

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
