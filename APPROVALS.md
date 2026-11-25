# Approvals needed — DealDesk OS

Status 2026-11-25 (v2): built and running **privately on the box only** (127.0.0.1:4100). Nothing was
deployed publicly, nothing was spent, no accounts were created, no Stripe/Render objects were created,
**no emails or texts were sent** — automated sending is OFF, `OUTBOUND_DRY_RUN=1`, and no SMTP/Twilio
credentials exist, so the Outbox only holds or simulates.

## From Cory's sponsoring broker (compliance) — before any real borrower use
1. **Outside business activity:** written OK to operate DealDesk OS / DealSheet Lab alongside sponsorship.
2. **System of record:** may borrower contact info, deal data and uploaded documents (bank statements,
   IDs, contracts) live in this system, or must NPI stay in company-approved systems? (If the latter,
   use DealDesk for pipeline/tasks/analysis with no documents, and collect documents in the company portal.)
3. **Public intake form** (`/apply`): wording, consent checkboxes (email; calls/texts with automated
   technology), disclaimer, and the NMLS/company/state disclosures shown in its footer.
4. **Borrower upload links** (`/u/...`): permitted for document collection?
5. **Printable estimate** (`/deals/:id/estimate`): may an illustrative, "not a commitment to lend" estimate
   be shared with borrowers, in this format, with which disclosures?
6. **Templates/scripts** (29 from the LO toolkit): approval before use; required signature/disclosure block.
7. **Appraisal/fee collection:** may Cory request/collect appraisal fees himself, or must the lender/AMC
   collect them? (Appraisal independence and fee handling vary by lender.)

## From Cory
8. **Hosting:** OK to use the recommended $0 route (Oracle Cloud Always Free VM + Cloudflare Tunnel +
   Cloudflare Access)? Oracle sign-up must be done by Cory (identity/card verification).
9. **Domain (optional, paid):** buy a lending-appropriate .com for the app (about $11/yr) — or use a
   subdomain of an existing domain for internal-only access.
10. **Stripe (optional):** a Stripe **test** key to try payment links. Going live later needs a Stripe
    account in the right business's name, sponsor OK, and acceptance of per-transaction fees
    (no monthly fee; standard US card rate listed as 2.9% + 30¢).
11. **Profile details** for merge fields/disclosures (Settings): licensed name, NMLS #, sponsor's legal
    name + NMLS #, phone, physical mailing address, state disclosures.
12. **Demo data:** delete before real use (Settings > Delete demo data), or start a fresh DB with `SEED_DEMO=0`.

## v2 — status portal + automated messages
### From the sponsoring broker (compliance)
13. **Borrower status portal wording** (`/p/...`): stage names shown to borrowers ("Conditions issued"
    instead of "Conditionally Approved", "Clear to close"), the what-happens-now / what-we-need /
    next-step text (`src/lib/stages.js`), the disclaimer, the LO card, and whether borrowers may upload
    documents through it (same system-of-record question as item 2).
14. **Every automated message** (Automations > Message templates): intake acknowledgement, stage
    updates, conditions, clear-to-close wire-safety note, closed note, document reminders, the lead and
    partner nurture sequences (partner messages: no referral fees/things of value — RESPA §8), and the
    footer (disclosure block, physical address, unsubscribe line).
15. **Consent language** on the intake form (email consent; calls/texts by automated technology, "not a
    condition of any loan", STOP) and the lawful basis the app uses for **transactional** email without
    marketing consent (reply to the borrower's own inquiry / active file). Confirm or tighten.
16. **Turning on automated sending** (kill switch) vs. approve-each-message.
### From Cory
17. **An email sending account** (Cory creates it): Gmail/Workspace SMTP with an app password, Brevo
    free (300/day) or Resend free (100/day, 3,000/month). See `docs/SENDING.md`. Needs a physical
    mailing address in Settings.
18. **SMS (optional, paid):** a Twilio (or similar) account + **A2P 10DLC brand and campaign
    registration** (fees + approval time) before any automated texts; prior express written consent only.
19. **Public HTTPS address** for portal and unsubscribe links (`public_base_url` in Settings) — portal
    links contain borrower data access, so this is the same hosting decision as item 8 (keep Cloudflare
    Access on staff pages only; `/p/`, `/u/`, `/unsub/`, `/apply` must be reachable by borrowers).

## Not included on purpose (would need separate approval)
Real (non-simulated) email/SMS sending, credit pulls, AVMs, e-signature, live payments, public deployment, any LendingOne
name, branding or guidelines.
