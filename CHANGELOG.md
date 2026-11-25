# DealDesk OS changelog

## v3 — 2026-11-25
Goal: look and feel like an institutional lender's deal desk, but be simple enough that anyone can run it.

**Simplicity**
- New home screen **Today** (`/`): one big next-best-action card with Do it / Done / Skip, ranked from new
  applications, overdue and due-today tasks, documents to review, Outbox approvals, deals ready to move,
  items borrowers have owed 3+ days, deals with no changes in 7+ days, unpaid fees and missing investor dates.
- **New-deal wizard** (`/new`): one question per screen, big buttons, progress bar, sensible defaults,
  questions that adapt to the loan type. Consent stays off unless the LO ticks it. Sends nothing.
- **Move to next step**: one button per deal with a plain-English checklist of what's missing and "fix it"
  links. Lender-only milestones are "you confirm" boxes (no credit decisions in the app).
- **Search / command bar** in the top bar (`/`, Ctrl/Cmd+K) with live results; `/search` page.
- Plain-English step and checklist labels on staff screens (formal terms kept in tooltips), "?" help tips.
- Mobile-first: bottom tab bar on phones, 44–58px tap targets.

**Institutional polish**
- New design system (navy / emerald / gold), status chips, empty states, loading spinners + loading bar.
- **Pipeline health** (`/pipeline/health`): volume by step, days in step, aging, closed by month, loan-type
  mix, oldest deals — SVG charts from the app's own data only.
- **Deal summary** (`/deals/:id/summary`): term-sheet-style internal one-pager that prints cleanly to PDF,
  stamped "INTERNAL SUMMARY — NOT A COMMITMENT TO LEND".
- **Investor portal redesign**: step X of 7 status block + progress bar, timeline, "What happens now /
  What we need from you / What happens next" with the LO's expected next-step date (estimate, not a
  promise), wire-safety card. Borrower notes with approval/rate/guarantee words or percentages are refused.

**Other**
- The classic dashboard moved to `/dashboard` ("Numbers board" under More); the classic deal form stays at `/deals/new`.
- Shared stage-move code (`src/lib/gates.js`) used by both the dropdown and the new button.
- DEMO_MODE only: the demo investor's status-page token is derived from `SESSION_SECRET`, so the demo link
  survives free-host restarts. Real links remain random.
- DB migration (idempotent): `deals.next_step_date`, `deals.next_step_note`, table `today_dismissals`.
- Tests: 73 (52 existing + 21 new in `tests/v3.test.js`), all passing; smoke walk covers the v3 screens.
- Unchanged: automated sending OFF by default, `OUTBOUND_DRY_RUN=1` on the demo, consent gating, kill switch,
  disclaimers. No LendingOne branding.

## v2 — 2026-11-25
Investor status portal, automation engine, Outbox with kill switch, consent gating, sequences, unsubscribe/STOP.

## v1 — 2026-11-24
CRM, pipeline, public intake, deal analyzer, underwriting workspace, document collection, fee requests,
dashboard, templates and compliance reference.
