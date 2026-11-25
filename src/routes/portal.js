'use strict';
// Borrower/investor status portal (/p/:token), email unsubscribe (/unsub/:token), inbound SMS webhook (/webhooks/sms).
// No login. The portal token is a long random secret (only its hash is used for lookup). Optional second factor:
// email on file + last 4 digits of the phone on file. Never shows internal notes, red flags or underwriting notes.
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { html, raw, int, sha256, fmtDate, fmtDateTime } = require('../lib/util');
const { publicPage, csrfInput } = require('../views/layout');
const { verifyCsrf, csrfToken } = require('../lib/security');
const { LOAN_TYPES } = require('../db');
const model = require('../lib/model');
const up = require('../lib/uploads');
const stages = require('../lib/stages');

const MAX_FAILS = 10;
const digits = (s) => String(s || '').replace(/\D/g, '');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function timeline(stage) {
  const idx = stages.PORTAL_STAGES.indexOf(stage);
  return html`<ol class="timeline" aria-label="Loan progress">${stages.PORTAL_STAGES.map((s, i) => {
    const st = idx < 0 ? 'todo' : i < idx ? 'done' : i === idx ? 'current' : 'todo';
    return html`<li class="tl-${st}" ${st === 'current' ? raw('aria-current="step"') : ''}><span class="dot">${st === 'done' ? '✓' : String(i + 1)}</span><span class="tl-label">${stages.label(s)}</span></li>`;
  })}</ol>`;
}

module.exports = (app) => {
  const db = app.locals.db; const cfg = app.locals.config; const engine = app.locals.engine;
  const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: 'Too many attempts. Please wait 15 minutes and try again.' });
  const uploadLimiter = rateLimit({ windowMs: 3600 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, message: 'Too many uploads. Please try again later.' });
  const viewLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });

  function linkFor(token) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token || '')) return null;
    const l = db.prepare('SELECT * FROM portal_links WHERE token_hash = ?').get(sha256(token));
    if (!l || l.revoked) return null;
    return l;
  }
  const unlocked = (req, l) => l.verify_mode === 'none' || !!(req.session.portal && req.session.portal[l.id]);
  const notFound = (res) => res.status(404).send(publicPage({ demoMode: cfg.demoMode, title: 'Link not available', settings: model.getSettings(db), body: html`<div class="card"><h1>This status link is not available.</h1><p>It may have been replaced or turned off. Please contact your loan officer for a new link.</p></div>` }));

  function verifyPage(req, res, l, err, status = 200) {
    const s = model.getSettings(db); const locked = l.failed_count >= MAX_FAILS;
    res.status(locked ? 423 : status).send(publicPage({ demoMode: cfg.demoMode, title: 'Confirm it\'s you', settings: s, body: html`<div class="card portal-verify">
<h1>Your loan status page</h1>
${locked ? html`<div class="flash err">This link is locked after too many unsuccessful attempts. Please contact your loan officer for a new link.</div>` : html`
<p>To protect your information, please confirm the details your loan officer has on file.</p>
${err ? html`<div class="flash err">${err}</div>` : ''}
<form method="post" action="/p/${req.params.token}/verify" class="stack">${csrfInput(res.locals.csrf)}
<label class="field"><span>Email address</span><input type="email" name="email" required autocomplete="email" maxlength="254"></label>
${l.verify_mode === 'email_phone4' ? html`<label class="field"><span>Last 4 digits of your phone number</span><input name="phone4" required inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off"></label>` : ''}
<button class="btn big">View my status</button></form>`}
<p class="muted small">Never share this link. Your loan officer will never ask for your password, SSN or bank login by email or text.</p></div>` }));
  }

  function portalPage(req, res, l, msg) {
    const d = db.prepare('SELECT d.*, c.first_name FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id WHERE d.id = ?').get(l.deal_id);
    const s = model.getSettings(db); const info = stages.STAGE_INFO[d.stage] || stages.STAGE_INFO.Lead;
    // Borrower-facing fields ONLY (no note / requirement / internal columns).
    const items = db.prepare("SELECT id, kind, category, COALESCE(NULLIF(borrower_text, ''), title) label, status, requested_at, received_at FROM conditions WHERE deal_id = ? AND borrower_visible = 1 ORDER BY sort, id").all(d.id);
    const needed = items.filter(i => i.status === 'requested');
    const docs = needed.filter(i => i.kind !== 'condition'), conds = needed.filter(i => i.kind === 'condition');
    const inReview = items.filter(i => ['received', 'reviewed'].includes(i.status)), done = items.filter(i => ['cleared', 'waived'].includes(i.status));
    const updates = db.prepare('SELECT body, created_at FROM portal_updates WHERE deal_id = ? ORDER BY created_at DESC, id DESC LIMIT 30').all(d.id);
    const statusWord = { received: 'Received — under review', reviewed: 'Reviewed', cleared: 'Complete', waived: 'No longer needed' };
    const tok = req.params.token; const csrf = csrfToken(req);
    const itemRow = (i) => html`<li class="need-item"><div><strong>${i.label}</strong>${i.requested_at ? html`<span class="muted small"> · requested ${fmtDate(i.requested_at)}</span>` : ''}</div>
<form method="post" action="/p/${tok}/upload" enctype="multipart/form-data" class="up-row">${csrfInput(csrf)}<input type="hidden" name="condition_id" value="${i.id}">
<input type="file" name="file" required accept="${up.ALLOWED.join(',')}" aria-label="File for ${i.label}"><button class="btn small">Upload</button></form></li>`;
    const loLine = [s.lo_name || '{{LO_NAME}}', s.lo_title].filter(Boolean).join(', ');
    res.status(msg && msg.status || 200).send(publicPage({ demoMode: cfg.demoMode, title: 'Loan status — ' + model.propertyShort(d), settings: s, body: html`
<div class="portal">
<section class="card portal-head">
  <p class="eyebrow">Loan status · ${LOAN_TYPES[d.loan_type]}</p>
  <h1>${model.propertyShort(d)}</h1>
  <p>Hi ${d.first_name || 'there'} — here is where your file stands today.${d.stage_changed_at ? html` <span class="muted small">Stage updated ${fmtDate(d.stage_changed_at)}.</span>` : ''}</p>
  ${d.stage === 'Dead' ? html`<div class="flash warn">This file is not currently active.</div>` : timeline(d.stage)}
</section>
${msg ? html`<div class="flash ${msg.type}">${msg.text}</div>` : ''}
<section class="card now-card">
  <h2>Current step: ${info.label}</h2>
  <dl class="now-dl"><dt>What happens now</dt><dd>${info.now}</dd><dt>What we need from you</dt><dd>${info.need}</dd><dt>Typical next step</dt><dd>${info.next}</dd></dl>
  <p class="muted small">Every file is different. Timing depends on the lender, third parties (appraisal, title, insurance) and how quickly items come in — we can't promise dates, and this page is not an approval or commitment to lend.</p>
</section>
<div class="portal-grid">
<div>
<section class="card">
  <h2>What we need from you <span class="count">${needed.length}</span></h2>
  ${!needed.length ? html`<p class="ok-text">Nothing outstanding right now. We'll post here if anything else is needed.</p>` : ''}
  ${docs.length ? html`<h3>Documents</h3><ul class="need-list">${docs.map(itemRow)}</ul>` : ''}
  ${conds.length ? html`<h3>Conditions from underwriting</h3><p class="muted small">Requirements that must be satisfied before closing — not a final approval.</p><ul class="need-list">${conds.map(itemRow)}</ul>` : ''}
  <details class="other-up"><summary>Upload something else</summary>
  <form method="post" action="/p/${tok}/upload" enctype="multipart/form-data" class="up-row">${csrfInput(csrf)}<input type="hidden" name="condition_id" value="">
  <input type="file" name="file" required accept="${up.ALLOWED.join(',')}" aria-label="Other file"><button class="btn small ghost">Upload</button></form></details>
  <p class="muted small">Accepted: ${up.ALLOWED.join(', ')} · up to ${cfg.maxUploadMb} MB each. Please black out SSNs and full account numbers unless your loan officer's secure company system asks for them.</p>
</section>
${inReview.length || done.length ? html`<section class="card"><h2>Received</h2><ul class="recv-list">${[...inReview, ...done].map(i => html`<li><span>${i.label}</span><span class="badge ${i.status === 'cleared' || i.status === 'waived' ? 'ok' : ''}">${statusWord[i.status]}</span></li>`)}</ul></section>` : ''}
</div>
<div>
<section class="card lo-card">
  <h2>Your loan officer</h2>
  <p class="lo-name">${loLine}</p>
  <p>${s.nmls_id ? 'NMLS #' + s.nmls_id : 'NMLS #{{NMLS_ID}}'}${s.company_name ? html`<br>${s.company_name}${s.company_nmls_id ? ' · NMLS #' + s.company_nmls_id : ''}` : html`<br>{{COMPANY_NAME}} · NMLS #{{COMPANY_NMLS_ID}}`}</p>
  ${s.phone ? html`<p><a href="tel:${digits(s.phone)}">${s.phone}</a></p>` : ''}
  ${s.booking_link ? html`<p><a class="btn small" href="${s.booking_link}" rel="noopener" target="_blank">Book a call</a></p>` : ''}
  <p class="muted small">Questions about your file? Contact your loan officer directly. Wire instructions are never sent through this page.</p>
</section>
<section class="card"><h2>Updates</h2>${updates.length ? html`<ul class="feed">${updates.map(u => html`<li><time>${fmtDateTime(u.created_at)}</time><p>${u.body}</p></li>`)}</ul>` : html`<p class="muted">No updates yet.</p>`}</section>
</div></div>
<p class="disclaimer small">This page shows general file status for a business-purpose investment property loan request. It is not a loan approval, commitment to lend, rate lock or guarantee of terms or timing. All loans are subject to lender underwriting, credit review, property valuation and program guidelines. ${s.state_disclosures || ''}</p>
</div>` }));
  }

  app.get('/p/:token', viewLimiter, (req, res) => {
    const l = linkFor(req.params.token); if (!l) return notFound(res);
    res.set('X-Robots-Tag', 'noindex, nofollow');
    if (!unlocked(req, l)) return verifyPage(req, res, l);
    db.prepare("UPDATE portal_links SET view_count = view_count + 1, last_viewed_at = datetime('now') WHERE id = ?").run(l.id);
    portalPage(req, res, l, req.session.portalMsg && (() => { const m = req.session.portalMsg; delete req.session.portalMsg; return m; })());
  });

  app.post('/p/:token/verify', verifyLimiter, (req, res) => {
    const l = linkFor(req.params.token); if (!l) return notFound(res);
    if (l.failed_count >= MAX_FAILS) return verifyPage(req, res, l);
    const c = db.prepare('SELECT c.email, c.phone FROM deals d JOIN contacts c ON c.id = d.contact_id WHERE d.id = ?').get(l.deal_id) || {};
    const okEmail = c.email && safeEq(String(req.body.email || '').trim().toLowerCase(), c.email.toLowerCase());
    const okPhone = l.verify_mode !== 'email_phone4' || (digits(c.phone).length >= 4 && safeEq(digits(req.body.phone4).slice(-4), digits(c.phone).slice(-4)));
    if (!okEmail || !okPhone) {
      db.prepare('UPDATE portal_links SET failed_count = failed_count + 1 WHERE id = ?').run(l.id);
      model.log(db, { entity_type: 'deal', entity_id: l.deal_id, action: 'portal.verify_failed', detail: 'Status-portal verification failed', ip: req.ip });
      return verifyPage(req, res, Object.assign(l, { failed_count: l.failed_count + 1 }), 'Those details don\'t match what we have on file.', 401);
    }
    const finish = (err) => {
      if (err) return res.status(500).send('Please try again.');
      req.session.portal = Object.assign({}, req.session.portal, { [l.id]: Date.now() });
      db.prepare('UPDATE portal_links SET failed_count = 0 WHERE id = ?').run(l.id);
      model.log(db, { entity_type: 'deal', entity_id: l.deal_id, action: 'portal.verified', detail: 'Borrower opened the status portal', ip: req.ip });
      req.session.save(() => res.redirect(303, '/p/' + req.params.token));
    };
    // fresh session id on unlock (anti-fixation), but keep a staff login intact if the LO is previewing
    if (req.session.userId) finish(); else req.session.regenerate(finish);
  });

  app.post('/p/:token/upload', uploadLimiter, (req, res, next) => {
    const l = linkFor(req.params.token); if (!l) return notFound(res);
    if (!unlocked(req, l)) return res.status(401).send('Please open your status link and confirm your details first.');
    up.uploader(cfg.maxUploadMb)(req, res, (err) => {
      if (err) { if (err.code === 'LIMIT_FILE_SIZE') return portalPage(req, res, l, { type: 'err', text: `File is larger than ${cfg.maxUploadMb} MB.`, status: 413 }); return next(err); }
      if (!verifyCsrf(req)) return res.status(403).send('Invalid or missing security token. Refresh the page and try again.');
      const bad = up.validate(req.file); if (bad) return portalPage(req, res, l, { type: 'err', text: bad, status: 400 });
      const cnt = db.prepare('SELECT COUNT(*) n FROM files WHERE portal_link_id = ?').get(l.id).n;
      if (cnt >= 200) return portalPage(req, res, l, { type: 'err', text: 'Upload limit reached for this link. Please contact your loan officer.', status: 429 });
      let condId = int(req.body.condition_id);
      if (condId && !db.prepare('SELECT id FROM conditions WHERE id = ? AND deal_id = ? AND borrower_visible = 1').get(condId, l.deal_id)) condId = null;
      const st = up.store(cfg.uploadDir, req.file);
      db.transaction(() => {
        db.prepare("INSERT INTO files (deal_id, condition_id, original_name, stored_name, mime, size, sha256, uploaded_via, portal_link_id) VALUES (?,?,?,?,?,?,?,'borrower_portal',?)").run(l.deal_id, condId, st.original, st.stored, st.mime, req.file.size, st.sha, l.id);
        if (condId) db.prepare("UPDATE conditions SET status = 'received', received_at = datetime('now') WHERE id = ? AND status IN ('open','requested')").run(condId);
        db.prepare("UPDATE deals SET updated_at = datetime('now') WHERE id = ?").run(l.deal_id);
        model.log(db, { entity_type: 'deal', entity_id: l.deal_id, action: 'file.uploaded', detail: 'Status-portal upload: ' + st.original, ip: req.ip });
      })();
      engine.onDocReceived(l.deal_id, st.original, { via: 'status portal' });
      req.session.portalMsg = { type: 'ok', text: 'Uploaded: ' + st.original + '. Thank you — it will be reviewed.' };
      res.redirect(303, '/p/' + req.params.token);
    });
  });

  // ---- Email unsubscribe (one click to confirm; POST performs it) ---------------------------------
  const unsubContact = (t) => /^[A-Za-z0-9_-]{20,100}$/.test(t || '') ? db.prepare('SELECT id, email, email_opt_out_at FROM contacts WHERE unsub_token = ?').get(t) : null;
  app.get('/unsub/:token', (req, res) => {
    const c = unsubContact(req.params.token); const s = model.getSettings(db);
    if (!c) return res.status(404).send(publicPage({ demoMode: cfg.demoMode, title: 'Unsubscribe', settings: s, body: html`<div class="card"><h1>Link not recognized.</h1><p>Reply to any email with "unsubscribe" and we'll remove you.</p></div>` }));
    res.send(publicPage({ demoMode: cfg.demoMode, title: 'Unsubscribe', settings: s, body: c.email_opt_out_at ? html`<div class="card"><h1>You're unsubscribed.</h1><p>You won't receive further marketing or automated emails. Your loan officer may still contact you directly about an active loan file if you ask them to.</p></div>`
      : html`<div class="card"><h1>Unsubscribe from emails?</h1><form method="post" action="/unsub/${req.params.token}">${csrfInput(res.locals.csrf)}<button class="btn big">Unsubscribe</button></form></div>` }));
  });
  app.post('/unsub/:token', (req, res) => {
    const c = unsubContact(req.params.token); if (!c) return res.status(404).send('Link not recognized.');
    if (!c.email_opt_out_at) engine.unsubscribe(c.id);
    res.redirect(303, '/unsub/' + req.params.token);
  });
  // RFC 8058 one-click (mail clients POST without our CSRF token) — List-Unsubscribe-Post
  app.post('/unsub/:token/one-click', (req, res) => { const c = unsubContact(req.params.token); if (c && !c.email_opt_out_at) engine.unsubscribe(c.id); res.status(200).send('ok'); });

  // ---- Inbound SMS (Twilio) — STOP handling + reply detection ------------------------------------
  function twilioValid(req) {
    const tokenSecret = process.env.TWILIO_AUTH_TOKEN; if (!tokenSecret) return cfg.allowUnsignedSms === true; // tests only
    const url = (model.getSettings(db).public_base_url || '').replace(/\/$/, '') + req.originalUrl;
    const data = Object.keys(req.body || {}).sort().reduce((a, k) => a + k + req.body[k], url);
    const sig = crypto.createHmac('sha1', tokenSecret).update(data).digest('base64');
    return safeEq(sig, req.get('x-twilio-signature') || '');
  }
  app.post('/webhooks/sms', (req, res) => {
    if (!twilioValid(req)) return res.status(403).send('bad signature');
    const from = digits(req.body.From).slice(-10); const body = String(req.body.Body || '').trim();
    const contacts = from.length === 10 ? db.prepare('SELECT id, phone FROM contacts WHERE phone IS NOT NULL').all().filter(c => digits(c.phone).slice(-10) === from) : [];
    const isStop = /^(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout|opt out)\b/i.test(body);
    contacts.forEach(c => { if (isStop) engine.smsStop(c.id); else engine.markReplied(c.id); });
    if (contacts.length) model.log(db, { entity_type: 'contact', entity_id: contacts[0].id, action: isStop ? 'sms.stop' : 'sms.reply', detail: isStop ? 'Inbound STOP' : 'Inbound text reply (auto-stops sequences)' });
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });
};
