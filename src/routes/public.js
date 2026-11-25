'use strict';
// Public (no-login) routes: deal intake form, borrower upload links, Stripe webhook.
const rateLimit = require('express-rate-limit');
const { html, raw, str, text, num, int, oneOf, bool, email, phone, sha256, fmtDate, todayISO } = require('../lib/util');
const { publicPage, field, csrfInput } = require('../views/layout');
const { verifyCsrf, csrfToken } = require('../lib/security');
const { LOAN_TYPES, CREDIT_RANGES } = require('../db');
const model = require('../lib/model');
const up = require('../lib/uploads');
const stripe = require('../lib/stripe');

const PROPERTY_TYPES = ['Single family', '2-4 unit', 'Condo / townhome', '5+ unit multifamily', 'Mixed use', 'Lot / new construction', 'Other'];
const TX_TYPES = [['purchase', 'Purchase'], ['refi', 'Rate/term refinance'], ['cashout', 'Cash-out refinance']];

function intakeForm(csrf, s, v = {}, errors = []) {
  const lo = s.lo_name || 'the loan officer', co = s.company_name || 'the lender';
  return html`<h1>Investment property loan scenario</h1>
<p class="lead">Tell us about your deal. A licensed loan officer will review your scenario and follow up. <strong>Business-purpose investment property financing only</strong> — not for a home you or your family will live in.</p>
<div class="notice">Do <strong>not</strong> include your Social Security number, full date of birth, or any bank/credit account numbers. We'll never ask for those through this form.</div>
${errors.length ? html`<div class="flash err"><strong>Please fix:</strong><ul>${errors.map(e => html`<li>${e}</li>`)}</ul></div>` : ''}
<form method="post" action="/apply" class="card form-grid" novalidate>${csrfInput(csrf)}
<div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>
<h2 class="span2">About you</h2>
${field('first_name', 'First name', { required: true, value: v.first_name, max: 80, autocomplete: 'given-name' })}
${field('last_name', 'Last name', { required: true, value: v.last_name, max: 80, autocomplete: 'family-name' })}
${field('email', 'Email', { type: 'email', required: true, value: v.email, max: 254, autocomplete: 'email' })}
${field('phone', 'Phone', { type: 'tel', value: v.phone, max: 30, autocomplete: 'tel' })}
${field('entity_name', 'Borrowing entity (LLC name, if any)', { value: v.entity_name, max: 150 })}
${field('experience_deals', 'Completed investment projects (last 3 years)', { type: 'number', value: v.experience_deals, step: '1' })}
${field('credit_range', 'Estimated credit score range (self-reported)', { type: 'select', options: [['', 'Select…'], ...CREDIT_RANGES], value: v.credit_range, help: 'Your best estimate. No credit check is run from this form.' })}
${field('liquidity', 'Approx. cash available for this deal ($)', { type: 'number', value: v.liquidity })}
<h2 class="span2">The property & loan</h2>
${field('loan_type', 'Loan type', { type: 'select', required: true, options: [['', 'Select…'], ...Object.entries(LOAN_TYPES)], value: v.loan_type })}
${field('transaction_type', 'Transaction', { type: 'select', options: TX_TYPES, value: v.transaction_type })}
${field('property_address', 'Property street address', { value: v.property_address, max: 150 })}
${field('city', 'City', { required: true, value: v.city, max: 80 })}
${field('state', 'State', { required: true, value: v.state || 'FL', max: 2 })}
${field('zip', 'ZIP', { value: v.zip, max: 10 })}
${field('property_type', 'Property type', { type: 'select', options: PROPERTY_TYPES, value: v.property_type })}
${field('units', 'Units', { type: 'number', value: v.units || 1 })}
${field('purchase_price', 'Purchase price ($)', { type: 'number', value: v.purchase_price })}
${field('as_is_value', 'Current / as-is value ($, refis)', { type: 'number', value: v.as_is_value })}
${field('rehab_budget', 'Rehab / construction budget ($)', { type: 'number', value: v.rehab_budget })}
${field('arv', 'After-repair value ($)', { type: 'number', value: v.arv })}
${field('monthly_rent', 'Monthly rent — actual or expected ($)', { type: 'number', value: v.monthly_rent })}
${field('loan_amount', 'Loan amount requested ($)', { type: 'number', value: v.loan_amount })}
${field('target_close_date', 'Target closing date', { type: 'date', value: v.target_close_date })}
${field('exit_strategy', 'Plan / exit strategy', { type: 'textarea', value: v.exit_strategy, max: 1500, cls: 'span2' })}
<h2 class="span2">Consent</h2>
<div class="span2 consents">
${field('ack', '', { type: 'checkbox', required: true, value: v.ack, labelHtml: `<strong>Required:</strong> I understand this is a business-purpose investment property inquiry, not a loan application, approval, rate quote or commitment to lend, and that I should not submit SSNs, dates of birth or account numbers here.` })}
${field('email_consent', '', { type: 'checkbox', value: v.email_consent, labelHtml: `Email me about this inquiry and related educational updates. I can unsubscribe anytime.` })}
${field('sms_consent', '', { type: 'checkbox', value: v.sms_consent, labelHtml: `Optional: I agree to receive calls and text messages from ${html`${lo}`} / ${html`${co}`} about this inquiry at the phone number above, which may be sent using automated technology. Consent is not a condition of any loan or purchase. Message and data rates may apply. Reply STOP to opt out.` })}
</div>
<div class="span2"><button class="btn big">Submit scenario</button></div>
</form>`;
}

module.exports = (app) => {
  const db = app.locals.db; const cfg = app.locals.config;
  const intakeLimiter = rateLimit({ windowMs: 3600 * 1000, limit: cfg.intakeMax, standardHeaders: 'draft-7', legacyHeaders: false, message: 'Too many submissions from this network. Please try again later.' });
  const uploadLimiter = rateLimit({ windowMs: 3600 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, message: 'Too many uploads. Please try again later.' });

  app.get('/apply', (req, res) => res.send(publicPage({ demoMode: cfg.demoMode, title: 'Investment property loan scenario', settings: model.getSettings(db), body: intakeForm(res.locals.csrf, model.getSettings(db)) })));

  app.post('/apply', intakeLimiter, (req, res) => {
    const b = req.body; const s = model.getSettings(db);
    if (b.website) return res.redirect('/apply/thanks'); // honeypot: silently drop bots
    const v = {
      first_name: str(b.first_name, 80), last_name: str(b.last_name, 80), email: email(b.email), phone: phone(b.phone), entity_name: str(b.entity_name, 150),
      experience_deals: int(b.experience_deals, { min: 0, max: 1000 }), credit_range: oneOf(b.credit_range, CREDIT_RANGES), liquidity: num(b.liquidity, { min: 0, max: 1e9 }),
      loan_type: oneOf(b.loan_type, Object.keys(LOAN_TYPES)), transaction_type: oneOf(b.transaction_type, TX_TYPES.map(t => t[0]), 'purchase'),
      property_address: text(b.property_address, 150), city: str(b.city, 80), state: (str(b.state, 2) || '').toUpperCase() || null, zip: str(b.zip, 10),
      property_type: oneOf(b.property_type, PROPERTY_TYPES, 'Other'), units: int(b.units, { min: 1, max: 1000 }),
      purchase_price: num(b.purchase_price, { min: 0, max: 1e10 }), as_is_value: num(b.as_is_value, { min: 0, max: 1e10 }), rehab_budget: num(b.rehab_budget, { min: 0, max: 1e10 }),
      arv: num(b.arv, { min: 0, max: 1e10 }), monthly_rent: num(b.monthly_rent, { min: 0, max: 1e8 }), loan_amount: num(b.loan_amount, { min: 0, max: 1e10 }),
      target_close_date: /^\d{4}-\d{2}-\d{2}$/.test(b.target_close_date || '') ? b.target_close_date : null,
      exit_strategy: text(b.exit_strategy, 1500), ack: bool(b.ack), email_consent: bool(b.email_consent), sms_consent: bool(b.sms_consent)
    };
    const errors = [];
    if (!v.first_name) errors.push('First name is required.');
    if (!v.last_name) errors.push('Last name is required.');
    if (!v.email) errors.push('A valid email is required.');
    if (b.phone && !v.phone) errors.push('Phone number looks invalid.');
    if (v.sms_consent && !v.phone) errors.push('Add a phone number if you want calls/texts, or uncheck that box.');
    if (!v.loan_type) errors.push('Choose a loan type.');
    if (!v.city || !v.state || !/^[A-Z]{2}$/.test(v.state)) errors.push('City and 2-letter state are required.');
    if (!v.ack) errors.push('Please check the required acknowledgment.');
    if (errors.length) return res.status(400).send(publicPage({ demoMode: cfg.demoMode, title: 'Investment property loan scenario', settings: s, body: intakeForm(res.locals.csrf, s, Object.assign({}, b, v), errors) }));

    const tx = db.transaction(() => {
      let companyId = null;
      if (v.entity_name) { const ex = db.prepare('SELECT id FROM companies WHERE name = ?').get(v.entity_name); companyId = ex ? ex.id : db.prepare("INSERT INTO companies (name, kind, state) VALUES (?, 'Borrower LLC', ?)").run(v.entity_name, v.state).lastInsertRowid; }
      let c = db.prepare('SELECT * FROM contacts WHERE email = ?').get(v.email);
      const consentMethod = 'Public intake form checkbox';
      if (!c) {
        const id = db.prepare(`INSERT INTO contacts (type, first_name, last_name, email, phone, company_id, lead_source, tags, city, state, email_consent, email_consent_at, sms_consent, sms_consent_at, consent_method)
          VALUES ('borrower',?,?,?,?,?,'Public intake form','intake',?,?,?,?,?,?,?)`).run(v.first_name, v.last_name, v.email, v.phone, companyId, v.city, v.state,
          v.email_consent, v.email_consent ? new Date().toISOString() : null, v.sms_consent, v.sms_consent ? new Date().toISOString() : null, (v.email_consent || v.sms_consent) ? consentMethod : null).lastInsertRowid;
        c = { id };
      } else {
        // Existing contact: never overwrite their record from a public form; only record newly granted consent.
        if (v.email_consent && !c.email_consent) db.prepare("UPDATE contacts SET email_consent = 1, email_consent_at = ?, consent_method = ?, updated_at = datetime('now') WHERE id = ?").run(new Date().toISOString(), consentMethod, c.id);
        if (v.sms_consent && !c.sms_consent && v.phone) db.prepare("UPDATE contacts SET sms_consent = 1, sms_consent_at = ?, consent_method = ?, updated_at = datetime('now') WHERE id = ?").run(new Date().toISOString(), consentMethod, c.id);
        if (v.phone && v.phone !== c.phone) db.prepare("INSERT INTO notes (entity_type, entity_id, body) VALUES ('contact', ?, ?)").run(c.id, 'Intake form listed a different phone: ' + v.phone);
      }
      const name = `${v.property_address || v.city} — ${LOAN_TYPES[v.loan_type]}`;
      const dealId = db.prepare(`INSERT INTO deals (name, contact_id, company_id, stage, loan_type, transaction_type, property_address, city, state, zip, property_type, units, purchase_price, as_is_value, rehab_budget, arv, monthly_rent, loan_amount, experience_deals, credit_range, liquidity, exit_strategy, lead_source, target_close_date, source, intake_reviewed, updated_at)
        VALUES (?,?,?,'Lead',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Public intake form',?,'intake',0,datetime('now'))`).run(name, c.id, companyId, v.loan_type, v.transaction_type, v.property_address, v.city, v.state, v.zip, v.property_type, v.units, v.purchase_price, v.as_is_value, v.rehab_budget, v.arv, v.monthly_rent, v.loan_amount, v.experience_deals, v.credit_range, v.liquidity, v.exit_strategy, v.target_close_date).lastInsertRowid;
      model.seedChecklist(db, dealId);
      const owner = db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1").get();
      db.prepare("INSERT INTO tasks (title, due_date, contact_id, deal_id, assigned_to) VALUES (?, ?, ?, ?, ?)").run(`Review new intake from ${v.first_name} ${v.last_name} (reply within 1 business hour if possible)`, todayISO(), c.id, dealId, owner && owner.id);
      model.log(db, { entity_type: 'deal', entity_id: dealId, action: 'intake.created', detail: `Public intake: ${v.first_name} ${v.last_name}; email consent ${v.email_consent ? 'yes' : 'no'}, SMS consent ${v.sms_consent ? 'yes' : 'no'}`, ip: req.ip });
      return dealId;
    });
    const newDealId = tx();
    try { app.locals.engine.onIntake(newDealId); } catch (e) { console.error('intake automation failed', e); }
    res.redirect('/apply/thanks');
  });

  app.get('/apply/thanks', (req, res) => res.send(publicPage({ demoMode: cfg.demoMode, title: 'Thanks', settings: model.getSettings(db), body: html`<div class="card"><h1>Thanks — your scenario was received.</h1><p>A licensed loan officer will review it and follow up using the contact preferences you selected. This is not an application, approval, or commitment to lend.</p><p><a href="/apply">Submit another scenario</a></p></div>` })));

  // ---- Borrower upload links ---------------------------------------------------------------
  function linkFromToken(token) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token || '')) return null;
    const l = db.prepare('SELECT * FROM upload_links WHERE token_hash = ?').get(sha256(token));
    if (!l || l.revoked || new Date(l.expires_at) < new Date()) return null;
    return l;
  }
  function uploadPage(req, res, l, msg) {
    const d = db.prepare('SELECT d.*, c.first_name FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id WHERE d.id = ?').get(l.deal_id);
    const items = db.prepare("SELECT id, category, COALESCE(NULLIF(borrower_text, ''), title) title, status, requirement FROM conditions WHERE deal_id = ? AND borrower_visible = 1 AND status IN ('open','requested') ORDER BY CASE status WHEN 'requested' THEN 0 ELSE 1 END, sort, id").all(l.deal_id);
    const done = db.prepare('SELECT f.original_name, f.created_at, CASE WHEN length(c.borrower_text) > 0 THEN c.borrower_text ELSE c.title END title FROM files f LEFT JOIN conditions c ON c.id = f.condition_id WHERE f.link_id = ? ORDER BY f.id DESC').all(l.id);
    const s = model.getSettings(db);
    res.status(msg && msg.status || 200).send(publicPage({ demoMode: cfg.demoMode, title: 'Secure document upload', settings: s, body: html`<h1>Secure document upload</h1>
<p class="lead">Hi ${d.first_name || 'there'} — upload the items requested for <strong>${model.propertyShort(d)}</strong>. This link expires ${fmtDate(l.expires_at)}.</p>
<div class="notice">Accepted: ${up.ALLOWED.join(', ')} · up to ${cfg.maxUploadMb} MB each. Please black out SSNs and full account numbers on statements unless your loan officer's secure company system asks for them.</div>
${msg ? html`<div class="flash ${msg.type}">${msg.text}</div>` : ''}
<form method="post" action="/u/${req.params.token}" enctype="multipart/form-data" class="card form-grid">${csrfInput(csrfToken(req))}
${field('condition_id', 'Which item is this?', { type: 'select', value: items.length ? items[0].id : '', options: [...items.map(i => [i.id, (i.status === 'requested' ? '★ Requested: ' : '') + i.title]), ['', 'Other / not listed']] })}
<label class="field"><span>File<em>*</em></span><input type="file" name="file" required accept="${up.ALLOWED.join(',')}"></label>
<div class="span2"><button class="btn">Upload</button></div></form>
${done.length ? html`<div class="card"><h2>Uploaded through this link</h2><ul>${done.map(f => html`<li>${f.original_name} ${f.title ? html`— <em>${f.title}</em>` : ''}</li>`)}</ul></div>` : ''}` }));
  }

  app.get('/u/:token', (req, res) => {
    const l = linkFromToken(req.params.token);
    if (!l) return res.status(404).send(publicPage({ demoMode: cfg.demoMode, title: 'Link expired', settings: model.getSettings(db), body: html`<div class="card"><h1>This upload link is invalid or has expired.</h1><p>Please ask your loan officer for a new link.</p></div>` }));
    uploadPage(req, res, l);
  });

  app.post('/u/:token', uploadLimiter, (req, res, next) => {
    const l = linkFromToken(req.params.token);
    if (!l) return res.status(404).send('This upload link is invalid or has expired.');
    up.uploader(cfg.maxUploadMb)(req, res, (err) => {
      if (err) { if (err.code === 'LIMIT_FILE_SIZE') return uploadPage(req, res, l, { type: 'err', text: `File is larger than ${cfg.maxUploadMb} MB.`, status: 413 }); return next(err); }
      if (!verifyCsrf(req)) return res.status(403).send('Invalid or missing security token. Refresh the page and try again.');
      if (l.upload_count >= 100) return uploadPage(req, res, l, { type: 'err', text: 'This link has reached its upload limit. Ask your loan officer for a new link.', status: 429 });
      const bad = up.validate(req.file); if (bad) return uploadPage(req, res, l, { type: 'err', text: bad, status: 400 });
      let condId = int(req.body.condition_id);
      if (condId && !db.prepare('SELECT id FROM conditions WHERE id = ? AND deal_id = ? AND borrower_visible = 1').get(condId, l.deal_id)) condId = null;
      const st = up.store(cfg.uploadDir, req.file);
      db.transaction(() => {
        db.prepare("INSERT INTO files (deal_id, condition_id, original_name, stored_name, mime, size, sha256, uploaded_via, link_id) VALUES (?,?,?,?,?,?,?,'borrower_link',?)").run(l.deal_id, condId, st.original, st.stored, st.mime, req.file.size, st.sha, l.id);
        if (condId) db.prepare("UPDATE conditions SET status = 'received', received_at = datetime('now') WHERE id = ? AND status IN ('open','requested')").run(condId);
        db.prepare("UPDATE upload_links SET upload_count = upload_count + 1, last_used_at = datetime('now') WHERE id = ?").run(l.id);
        model.log(db, { entity_type: 'deal', entity_id: l.deal_id, action: 'file.uploaded', detail: 'Borrower link upload: ' + st.original, ip: req.ip });
      })();
      app.locals.engine.onDocReceived(l.deal_id, st.original, { via: 'upload link' });
      uploadPage(req, res, Object.assign(l, { upload_count: l.upload_count + 1 }), { type: 'ok', text: 'Uploaded: ' + st.original + '. Thank you!' });
    });
  });

  // ---- Stripe webhook (optional; test mode) ------------------------------------------------------
  app.post('/webhooks/stripe', (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!cfg.stripeWebhookSecret || !stripe.verifyWebhook(rawBody, req.get('stripe-signature'), cfg.stripeWebhookSecret)) return res.status(400).send('bad signature');
    let ev; try { ev = JSON.parse(rawBody); } catch { return res.status(400).send('bad json'); }
    if (ev.type === 'checkout.session.completed' && ev.data && ev.data.object) {
      const o = ev.data.object;
      const p = o.payment_link && db.prepare('SELECT * FROM payments WHERE stripe_payment_link_id = ?').get(o.payment_link);
      if (p && p.status === 'requested' && o.payment_status === 'paid') {
        db.prepare("UPDATE payments SET status = 'paid', paid_at = datetime('now') WHERE id = ?").run(p.id);
        model.log(db, { entity_type: 'deal', entity_id: p.deal_id, action: 'payment.paid', detail: `Stripe ${ev.livemode ? 'LIVE' : 'test'} payment received for payment #${p.id}` });
      }
    }
    res.json({ received: true });
  });
};
