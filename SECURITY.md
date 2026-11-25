# Security & PII handling — DealDesk OS v1

## What NOT to store (enforced where possible)
- **No Social Security numbers, ITINs, full dates of birth, bank/credit account numbers, credit reports,
  or driver's-license numbers** in any field, note or template. There are no fields for them; 9-digit
  SSN/ITIN-shaped numbers typed into free text (notes, exit strategy, condition notes) are replaced with
  `[redacted-number]`. Borrowers are told not to send them on the intake form and upload page.
- Credit is **self-reported range only**. No credit pulls, no AVMs, no tri-merge in v1.
- Uploaded documents (bank statements, IDs, contracts) *are* sensitive. Until the sponsoring broker
  approves this system for borrower documents, collect documents only through the company's approved
  portal and use DealDesk upload links for demo/testing only (the LO toolkit's rule: keep NPI in
  company-approved systems).

## Controls in v1
| Area | Control |
|---|---|
| Auth | bcrypt (cost 12) password hashes; 12+ char passwords; session regenerated on login (no fixation); 8-hour rolling sessions stored in SQLite; httpOnly + SameSite=Lax cookies (`Secure` when `COOKIE_SECURE=1`); password change signs out other sessions |
| Brute force | Login rate limit (10 failed attempts / 15 min / IP, configurable); constant-time-ish failure path; failed logins logged |
| CSRF | Synchronizer token on every POST (incl. multipart uploads, checked after parsing); Stripe webhook uses signature instead |
| Headers | helmet: strict CSP (`script-src 'self'`, no inline JS, `frame-ancestors 'none'`, `form-action 'self'`), nosniff, HSTS, same-origin referrer policy, `Cache-Control: no-store`, `noindex` |
| Input | Server-side validation/whitelists for every field, length limits, https-only payment/booking links, auto-escaped HTML templating (XSS test in suite) |
| Public form | No login, CSRF, honeypot, 20 submissions/hour/IP; never overwrites an existing contact's record |
| Upload links | 256-bit random token, only its SHA-256 stored, shown once, 3–30 day expiry, revocable, 100 uploads/link, 60 uploads/hour/IP |
| Files | Extension allow-list + magic-byte check, 15 MB cap, random stored names, `data/uploads` outside the web root, chmod 600, download only when logged in (`Content-Disposition: attachment`, nosniff), downloads/deletes logged |
| Payments | No card data ever touches the app (Stripe-hosted links). Live Stripe keys refused in v1 |
| Audit | Activity log: logins, failed logins, stage changes, consent/DNC changes, uploads, downloads, payment status, exports, backups |
| Network | Binds to `127.0.0.1` by default. Recommended hosting exposes it only through Cloudflare Tunnel + Cloudflare Access (no open inbound ports) |
| Outbound comms | None. No email/SMS sending in v1 (copy-to-clipboard templates only) |

## Secrets
`.env` and `secrets/admin-login.txt` are chmod 600 and git-ignored. Rotate `SESSION_SECRET` to sign
everyone out. Change the generated admin password after first login.

## Backups
- **In-app:** Settings > Download database backup (admin only) — a consistent SQLite snapshot.
  It contains borrower data: store it encrypted, never in email or a shared drive folder.
- **Scheduled:** `deploy/backup.sh` (systemd timer provided) snapshots the DB + `data/uploads`, encrypts
  with [`age`](https://age-encryption.org) to a public key you control, keeps 30 copies. Keep at least
  one copy off the server. Test a restore quarterly: stop app → replace `data/dealdesk.db` and
  `data/uploads/` → start.
- Retention: follow the sponsor's record-retention policy (see Compliance > Record retention); delete
  files for dead leads when policy allows (Documents tab > Delete).

## Before real borrower data
1. Sponsor approval that this system may hold borrower data (or decision to keep NPI in company systems).
2. HTTPS hosting behind Cloudflare Access (docs/HOSTING.md), `COOKIE_SECURE=1`, `TRUST_PROXY=1`, `SEED_DEMO=0`.
3. Strong unique admin password + Cloudflare Access with email OTP (acts as a second factor).
4. Encrypted nightly backups running and one restore tested.
5. Disk encryption on the host (FileVault/BitLocker on a home machine; OCI boot volumes are encrypted at rest by Oracle — confirm in your tenancy).
