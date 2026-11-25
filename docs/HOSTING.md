# $0 hosting — evaluation & recommendation (checked 2026-11-25)

Nothing has been deployed. Borrower PII must not go on a public URL until Cory (and his sponsor) approve.
The Render connector was only inspected (it can create web services, Postgres, Key Value, cron jobs,
static sites and blueprints, and defaults new resources to the `free` plan); **no Render resources were created.**

## Requirements that matter
- Persistent storage for the SQLite DB **and** uploaded documents (borrower PII).
- Always reachable for the public intake form / upload links (once approved), but staff screens locked down.
- $0/month, minimal maintenance, and no code rewrite for v1.

## Options

| Option | $0? | Persistence | Fit for DealDesk v1 | Notes (sources) |
|---|---|---|---|---|
| **Render free web service** | Yes (750 free instance-hours/workspace/month) | **No.** Ephemeral filesystem: SQLite DB and uploads are lost on every redeploy, restart **or spin-down**; free services can't attach a persistent disk | ❌ Real data. ✅ Throwaway demo only | Spins down after 15 min idle, ~1 min to wake; may restart any time. Free Postgres: one per workspace, 1 GB, **expires 30 days after creation** (14-day grace, then deleted), no backups. [render.com/docs/free](https://render.com/docs/free) |
| **Cloudflare Workers + D1 + R2** | Yes (Workers Free) | Yes. D1 free: 5 M rows read/day, 100k rows written/day, 5 GB total. R2 free: 10 GB-month, 1 M Class A + 10 M Class B ops/month, free egress | ✅ Good long-term serverless home, **but needs a port**: Express + better-sqlite3 + local disk don't run on Workers (rewrite routes to Hono/Workers, SQL to D1, files to R2) | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/). Daily D1 limits return errors when exceeded on Free. Confirm whether R2 activation asks for a payment method on file |
| **Cloudflare Pages** | Yes | Static only (Functions = Workers) | Same port as above | Already used for getmarginbench.com |
| **Oracle Cloud Always Free VM + Cloudflare Tunnel/Access** | Yes | Yes — up to 200 GB Always Free block storage; Ampere A1 up to 2 OCPU/12 GB, or 2 AMD micro VMs | ✅ Runs v1 unchanged (Node + SQLite + disk) | [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm). "Out of host capacity" errors can happen in a region. Sign-up asks for card verification (verify at sign-up); Always Free resources aren't charged. You patch the VM (unattended-upgrades) |
| **Cory's own always-on computer + Cloudflare Tunnel/Access** | Yes | Yes (local disk) | ✅ Runs v1 unchanged; PII stays on hardware he controls | Needs the machine on 24/7 and disk encryption (FileVault/BitLocker); home internet/power outages = downtime |
| **Cloudflare Zero Trust (Access + Tunnel)** | Yes — Free plan, up to 50 users | n/a (front door) | ✅ Puts an email-OTP/Google login in front of everything; `Bypass` policy only for `/apply`, `/u/*` after approval | [Zero Trust plans](https://www.cloudflare.com/plans/zero-trust-services/) — Free: 50-user limit, application connector (Tunnel) included, logs up to 24 h |

## Recommendation
**Now (v1, $0, no rewrite): run DealDesk OS on an Oracle Cloud Always Free Ampere VM (or an always-on
computer Cory owns), reachable only through a Cloudflare Tunnel, with Cloudflare Access in front.**
- No inbound ports open; HTTPS from Cloudflare; Access gives a second login (email one-time PIN).
- Persistent disk keeps SQLite + uploads; encrypted nightly backups via `deploy/backup.sh`.
- Keep the public paths (`/apply`, `/u/*`) behind Access too until the sponsor approves them; then add the Bypass policy.
- Hostname: a subdomain on a domain in his Cloudflare account. Use a lending-appropriate domain rather
  than getmarginbench.com (a new .com is about $11/yr — **a purchase, needs approval**). For a pure
  internal test, Access still works on any zone he owns.

**Later (v2): port to Cloudflare Workers + D1 + R2** if he wants zero servers to patch — still $0 at
small volume; adds per-request scaling and R2 object storage for documents.

**Not recommended for real data:** Render free (data loss on spin-down; 30-day Postgres). The included
`deploy/render-demo-only/render.yaml` is for a disposable demo with fake data only.

## Ready-to-use deploy config (recommended route)
- `deploy/oracle-vm-setup.sh` — installs Node 22, `age`, cloudflared; creates a locked-down `dealdesk` user; runs `npm ci`, `scripts/setup.js`; flips `.env` to `COOKIE_SECURE=1 TRUST_PROXY=1 SEED_DEMO=0`; installs systemd units.
- `deploy/systemd/dealdesk.service` (+ `dealdesk-backup.service/.timer`) — hardened service, nightly backup.
- `deploy/cloudflare-tunnel/config.yml` — tunnel ingress to `127.0.0.1:4100`.
- `deploy/cloudflare-tunnel/ACCESS-POLICY.md` — exact Access apps/policies (staff allow-list; public-path Bypass only after approval).
- `Dockerfile` + `docker-compose.yml` — same thing as containers (app + cloudflared, no published ports).

### Steps Cory (or I, with his OK) would follow
1. Create the Oracle Cloud account (Cory — needs his identity/card verification) and an Ubuntu Ampere A1 VM in the home region; no inbound ports beyond SSH.
2. Copy `/workspace/lending-platform` to `/opt/dealdesk`; run `deploy/oracle-vm-setup.sh`.
3. `cloudflared tunnel login` (Cory signs in), create the tunnel + DNS route, install `config.yml`, `sudo cloudflared service install`.
4. Create the Access applications in `ACCESS-POLICY.md` (staff only at first).
5. In the app: Settings > profile + Public base URL = `https://desk.<domain>`; change the admin password; delete demo data.
6. Set `AGE_RECIPIENT` for backups; confirm a restore.
