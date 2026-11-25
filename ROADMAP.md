# DealDesk OS roadmap

v1 = internal CRM/pipeline/underwriting system. **v2 (done 2026-11-25):** investor status portal, automation
engine (stage-change updates, intake acknowledgement, doc reminders, nurture sequences, stale alerts, daily
digest), Outbox with consent gates + kill switch, unsubscribe + STOP handling. Sending is simulated until
Cory adds credentials (docs/SENDING.md). **v3 (done 2026-11-25):** Today next-best-action home, New-deal
wizard, one-button "Move to next step" with a what's-missing checklist, search/command bar, pipeline health
charts, term-sheet-style deal summary, investor portal redesign with an LO-entered expected date, plain-English
UI and a new mobile-first design. Remaining items below note cost and the approval they need.

| Item | What | Free path | Paid / notes | Needs |
|---|---|---|---|---|
| Role permissions | Admin / LO / processor / read-only; per-deal assignment visibility; field-level hiding of documents | Build in-app ($0) | — | — |
| 2FA | TOTP for app login (Access OTP already covers hosted use) | Build in-app ($0) | — | — |
| ~~Borrower portal~~ | **Done in v2** (link + verification). Next: optional magic-code email login, portal e-sign of disclosures | $0 | — | Sponsor approval of wording |
| ~~Email sending~~ | **Built in v2** (Outbox, consent, footer, unsubscribe, quiet hours) — needs an SMTP account to go live | Gmail SMTP / Brevo free / Resend free | ESPs bill by volume above free tiers | Items 13–17 in APPROVALS.md |
| SMS (consented only) | **Built in v2** behind Twilio env vars (STOP webhook, quiet hours, consent + DNC). Next: inbound 2-way inbox in the app, HELP keyword | — | Twilio per-message + A2P 10DLC fees | Prior express written consent; sponsor TCPA policy; 10DLC registration |
| Inbound email replies | Auto-detect email replies (IMAP poll or provider webhook) to stop sequences automatically (today: "They replied" button + SMS replies auto-detected) | Gmail IMAP ($0) | — | — |
| Bounce/complaint handling | Mark hard bounces/complaints from the ESP webhook and block future sends | Brevo/Resend webhooks ($0) | — | — |
| Automation builder | Custom triggers/conditions beyond the six built-in rules; A/B of templates | Build in-app ($0) | — | Sponsor approval of new templates |
| E-signature | Term-sheet-style estimate acknowledgments, LOIs, authorizations | Some providers have limited free tiers | Most e-sign APIs are paid per envelope/seat | Sponsor/attorney approval of documents |
| Credit / AVM / property data | Soft-pull credit, AVMs, rent estimates, flood zone, title data | Public-record lookups only | Credit bureaus/AVM vendors are paid and require permissible purpose + vendor agreements | Sponsor approval; FCRA/permissible purpose; vendor contracts |
| Pricing engine | Lender rate sheets → indicative pricing | — | Lender/PPE access; licensing | Sponsor approval; never shown as a quote without proper disclosures |
| Lender/scenario-desk integration | Push scenario summaries/docs to the sponsor's LOS or desk | Email export (v1 has .txt) | LOS APIs vary | Sponsor IT/compliance |
| Calendar booking | Booking link + automatic follow-up task | Google Calendar API ($0) | — | — |
| Weekly status cadence | Friday S-2 status email per active file via the automation engine | Build in-app ($0) | — | Sponsor approval |
| Draw management | Rehab draw requests, inspections, holdback tracking | Build in-app ($0) | Inspection vendors paid | — |
| Reporting | **v3 added pipeline health charts** (volume, days in step, aging, closed by month, mix). Next: conversion by lead source, CSV export | Build in-app ($0) | — | — |
| Serverless port | Move to Cloudflare Workers + D1 + R2 | Free tiers | Paid tiers if limits exceeded | — |
| Malware scan on uploads | ClamAV on the VM | Free (CPU) | — | — |
| Audit export | Exportable activity log for compliance reviews | Build in-app ($0) | — | — |
