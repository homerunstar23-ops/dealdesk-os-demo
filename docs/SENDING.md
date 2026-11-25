# Turning on real email / text sending (DealDesk OS v2)

Today every automated message is **held in the Outbox** (Automated sending = OFF) and any "send" is
**simulated** (no SMTP/Twilio credentials, and `OUTBOUND_DRY_RUN=1` in `.env`). Nothing has been sent.

## The order to do it in
1. **Broker approval** of the portal wording and every automated template (see `APPROVALS.md` items 13–17).
2. **Profile** (Settings): licensed name, NMLS #, sponsor name + NMLS #, phone, **physical mailing
   address** (required in every email — the app holds emails until it's set), state disclosures, and
   `public_base_url` = the HTTPS address borrowers will use for portal links.
3. **Pick an email account** (Cory creates it — DealDesk never creates accounts):

| Option | Cost | Limits (checked 2026-11-25) | Setup notes |
|---|---|---|---|
| Gmail / Google Workspace SMTP (`smtp.gmail.com:587`) | $0 with an existing account | Personal Gmail: 500 messages/rolling 24h; paid Workspace: 2,000/day; 100 recipients per SMTP message | Turn on 2-Step Verification, create an **app password**, use it as `SMTP_PASS`. Best for low volume from Cory's own mailbox; check your sponsor allows sending from it |
| Brevo free (`smtp-relay.brevo.com:587`) | $0 | 300 emails/day (transactional + campaign combined); free emails carry "Sent with Brevo" branding | Verify your domain, ask Brevo support to activate SMTP, copy the SMTP login/key from "SMTP & API" |
| Resend free (`smtp.resend.com:465`, user `resend`, password = API key) | $0 | 3,000 emails/month, 100/day (UTC day), 3 domains | Verify a domain you own (DNS records) |

   Sources: developers.google.com/workspace/gmail/imap/imap-smtp, brevo.com/free-smtp-server and
   help.brevo.com (free-plan limits), resend.com/pricing and resend.com/docs (account quotas).
4. Put `SMTP_HOST/PORT/USER/PASS` and `MAIL_FROM` in `.env`, **delete the `OUTBOUND_DRY_RUN=1` line**,
   `pm2 restart dealdesk-os --update-env`. The Outbox banner switches to "SMTP configured".
5. **Test with yourself:** create a test contact with your own email + email consent, queue a message,
   approve it in the Outbox, confirm it arrives with the footer + unsubscribe link.
6. Keep **Automated sending OFF** for a while and approve messages one by one. Turn it ON only when
   you're comfortable — the switch is on the Outbox page and works as a kill switch.

## Texts (optional, paid)
Twilio (or similar) charges per message, and US business texting from a 10-digit number requires
**A2P 10DLC brand + campaign registration** (fees + approval time). Requirements before turning on:
prior express **written** consent captured (the intake form checkbox does this), STOP handling (built in:
point the Twilio number's inbound webhook to `https://<your-domain>/webhooks/sms`; the app verifies
Twilio's signature with `TWILIO_AUTH_TOKEN`), quiet hours (built in), and broker TCPA sign-off.

## What the app enforces on every message (at queue time AND again at send time)
- **DNC** blocks everything. **Email:** needs an address, no unsubscribe, and either email consent or (for
  transactional updates only) a lawful basis — the borrower's own inquiry or an active file. Marketing /
  nurture email always needs email consent. **Text:** needs prior express written consent and no STOP.
- Footer added automatically: your disclosure block, **physical address**, **unsubscribe link**
  (`/unsub/<token>`, also sent as a `List-Unsubscribe` header) and an "educational, not an offer" line.
  Texts get "Reply STOP to opt out."
- **Quiet hours** 8am–9pm recipient local time (contact time zone → state → Eastern); outside the window
  the message is rescheduled, not sent.
- Messages with unfilled `{{PLACEHOLDERS}}` or an incomplete profile are held.
- Doc reminders are canceled automatically once nothing is outstanding; sequence steps are canceled when
  the contact replies, unsubscribes, texts STOP, is marked DNC, or their deal leaves the Lead stage.
