'use strict';
// v3 guided "New deal" wizard: one question per screen, big buttons, a progress bar, plain-English labels and
// sensible defaults. The draft lives in the staff session until "Create deal". Classic full form: /deals/new.
const { html, raw, money, fmtDate, str, text, num, int, oneOf, date, email, phone, todayISO } = require('../lib/util');
const { csrfInput } = require('../views/layout');
const { LOAN_TYPES, CREDIT_RANGES } = require('../db');
const model = require('../lib/model');
const P = require('../lib/plain');

const TYPES = ['dscr', 'flip', 'ground_up', 'cashout', 'bridge'];
const TYPE_ICON = { dscr: '🏠', flip: '🔨', ground_up: '🏗️', cashout: '💵', bridge: '🌉' };
const PROPERTY_TYPES = ['Single family', '2-4 unit', 'Condo / townhome', '5+ unit multifamily', 'Mixed use', 'Lot / new construction', 'Other'];
const EXPERIENCE = [[0, 'This is their first'], [1, '1–2 deals'], [3, '3–5 deals'], [6, '6 or more']];
const STEPS = [
  { key: 'type', q: 'What kind of loan is this?', help: 'Pick the one that sounds closest. You can change it later.' },
  { key: 'who', q: 'Who is the investor?', help: 'Pick someone you already know, or add a new person.' },
  { key: 'purpose', q: 'Are they buying or refinancing?', help: 'Refinancing means they already own the property.', skip: (w) => w.loan_type === 'cashout' },
  { key: 'where', q: 'Where is the property?', help: 'The street address is enough to start.' },
  { key: 'numbers', q: 'What are the numbers?', help: 'Rough numbers are fine. Leave anything you don\'t know blank.' },
  { key: 'investor', q: 'A little about the investor', help: 'Everything here is optional and self-reported. You can skip it.' },
  { key: 'timing', q: 'When do they want to close?', help: 'We\'ll also remind you to follow up.' },
  { key: 'review', q: 'Does this look right?', help: 'Tap "Change" on anything that\'s off. Nothing is sent to anyone.' }
];
const addDays = (n) => { const d = new Date(todayISO() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fresh = () => ({ loan_type: null, transaction_type: 'purchase', state: 'FL', property_type: 'Single family', units: 1, target_close_date: addDays(30), follow_up: addDays(1), portal: 1 });

function numberFields(w) {
  const refi = w.transaction_type !== 'purchase'; const t = w.loan_type; const f = [];
  if (!refi) f.push(['purchase_price', t === 'ground_up' ? 'Land price' : 'Purchase price', 'What they are paying for it.']);
  if (refi) f.push(['as_is_value', 'What it\'s worth today', 'Their best guess. The appraisal decides later.']);
  if (['flip', 'ground_up', 'bridge'].includes(t)) f.push(['rehab_budget', t === 'ground_up' ? 'Construction budget' : 'Repair budget', 'Total cost of the work. Leave blank if none.']);
  if (['flip', 'ground_up'].includes(t)) f.push(['arv', 'Value after the work (ARV)', P.HELP.arv]);
  if (['dscr', 'cashout'].includes(t)) f.push(['monthly_rent', 'Monthly rent', 'From the lease, or what similar places rent for.']);
  if (refi) f.push(['payoff', 'What they still owe on it', 'Today\'s loan payoff. 0 if it\'s free and clear.']);
  f.push(['loan_amount', 'How much they want to borrow', 'A rough number is fine.']);
  return f;
}

module.exports = (app) => {
  const db = app.locals.db; const engine = app.locals.engine;
  const visible = (w) => STEPS.filter(s => !(s.skip && s.skip(w)));
  const nextKey = (w, key, dir = 1) => { const v = visible(w); const i = v.findIndex(s => s.key === key); return (v[i + dir] || v[dir > 0 ? v.length - 1 : 0]).key; };

  function render(req, res, key, err) {
    const w = Object.assign({}, req.session.wiz);
    if (err) ['first_name', 'last_name', 'email', 'phone', 'property_address', 'city', 'state', 'zip'].forEach(k => { if (req.body[k] != null) w[k] = str(req.body[k], 254); });
    const v = visible(w); const i = v.findIndex(s => s.key === key); const step = v[i];
    const csrf = csrfInput(res.locals.csrf); const back = i > 0 ? `/new/${v[i - 1].key}` : '/';
    const money$ = (name, label, help) => html`<label class="field big-field"><span>${label}</span><div class="money-in"><b>$</b><input name="${name}" inputmode="decimal" value="${w[name] == null ? '' : w[name]}" placeholder="0" aria-describedby="h-${name}"></div><small id="h-${name}">${help}</small></label>`;
    let body;
    if (key === 'type') {
      body = html`<div class="choice-grid">${TYPES.map(t => html`<button class="choice ${w.loan_type === t ? 'picked' : ''}" name="loan_type" value="${t}"><span class="choice-ico" aria-hidden="true">${TYPE_ICON[t]}</span><strong>${P.LOAN_PLAIN[t]}</strong><small>${P.LOAN_HELP[t]}</small></button>`)}</div>`;
    } else if (key === 'who') {
      const people = db.prepare("SELECT id, first_name, last_name, type FROM contacts ORDER BY type != 'borrower', first_name LIMIT 500").all();
      body = html`${people.length ? html`<label class="field big-field"><span>Someone you already know</span><select name="contact_id"><option value="">— Pick a person —</option>${people.map(p => html`<option value="${p.id}" ${String(w.contact_id) === String(p.id) ? raw('selected') : ''}>${[p.first_name, p.last_name].filter(Boolean).join(' ')} (${p.type})</option>`)}</select></label><p class="or"><span>or add someone new</span></p>` : ''}
<div class="form-grid"><label class="field big-field"><span>First name</span><input name="first_name" value="${w.first_name || ''}" maxlength="80" autocomplete="off"></label><label class="field big-field"><span>Last name</span><input name="last_name" value="${w.last_name || ''}" maxlength="80" autocomplete="off"></label>
<label class="field big-field"><span>Email</span><input name="email" type="email" value="${w.email || ''}" maxlength="254" autocomplete="off"></label><label class="field big-field"><span>Phone</span><input name="phone" type="tel" value="${w.phone || ''}" maxlength="30" autocomplete="off"></label></div>
<fieldset class="consent-box"><legend>Permission to message them ${P.tip(P.HELP.consent)}</legend>
<label class="check big-check"><input type="checkbox" name="email_consent" value="1" ${w.email_consent ? raw('checked') : ''}> <span>They said it's OK to get <strong>emails</strong> from me</span></label>
<label class="check big-check"><input type="checkbox" name="sms_consent" value="1" ${w.sms_consent ? raw('checked') : ''}> <span>They said it's OK to get <strong>texts</strong> from me</span></label>
<small class="muted">Leave these unchecked if you're not sure. Automated messages never go to someone without permission.</small></fieldset>`;
    } else if (key === 'purpose') {
      body = html`<div class="choice-grid two">${[['purchase', '🛒', 'Buying it', 'They are purchasing the property.'], ['refi', '🔁', 'Refinancing', 'They own it and want a new loan.'], ['cashout', '💵', 'Refinancing + cash out', 'They own it and want to take equity out.']].map(([v, ico, l, h]) => html`<button class="choice ${w.transaction_type === v ? 'picked' : ''}" name="transaction_type" value="${v}"><span class="choice-ico" aria-hidden="true">${ico}</span><strong>${l}</strong><small>${h}</small></button>`)}</div>`;
    } else if (key === 'where') {
      body = html`<label class="field big-field"><span>Street address</span><input name="property_address" value="${w.property_address || ''}" maxlength="150" placeholder="123 Main St" autocomplete="off"></label>
<div class="form-grid"><label class="field big-field"><span>City</span><input name="city" value="${w.city || ''}" maxlength="80"></label><label class="field big-field"><span>State</span><input name="state" value="${w.state || ''}" maxlength="2" class="short"></label><label class="field big-field"><span>ZIP</span><input name="zip" value="${w.zip || ''}" maxlength="10" inputmode="numeric" class="short"></label></div>
<p class="field-label">What kind of property?</p><div class="pill-row" role="radiogroup">${PROPERTY_TYPES.map(t => html`<label class="pill"><input type="radio" name="property_type" value="${t}" ${w.property_type === t ? raw('checked') : ''}><span>${t}</span></label>`)}</div>
<label class="field big-field narrow-field"><span>How many units?</span><input name="units" inputmode="numeric" value="${w.units == null ? 1 : w.units}" class="short"></label>`;
    } else if (key === 'numbers') {
      body = html`<div class="form-grid">${numberFields(w).map(([n, l, h]) => money$(n, l, h))}</div>`;
    } else if (key === 'investor') {
      body = html`<p class="field-label">How many investment deals have they done?</p><div class="pill-row" role="radiogroup">${EXPERIENCE.map(([v, l]) => html`<label class="pill"><input type="radio" name="experience_deals" value="${v}" ${String(w.experience_deals) === String(v) ? raw('checked') : ''}><span>${l}</span></label>`)}</div>
<p class="field-label">Credit score range (what they told you)</p><div class="pill-row" role="radiogroup">${CREDIT_RANGES.map(c => html`<label class="pill"><input type="radio" name="credit_range" value="${c}" ${w.credit_range === c ? raw('checked') : ''}><span>${c}</span></label>`)}</div>
${money$('liquidity', 'Cash they have for this deal', P.HELP.liquidity)}`;
    } else if (key === 'timing') {
      body = html`<div class="form-grid"><label class="field big-field"><span>Target closing date</span><input type="date" name="target_close_date" value="${w.target_close_date || ''}"><small>Default is 30 days out. Change it if they told you a date.</small></label>
<label class="field big-field"><span>When will you follow up?</span><input type="date" name="follow_up" value="${w.follow_up || ''}"><small>We'll put a task on your Today list.</small></label></div>
<label class="check big-check"><input type="checkbox" name="portal" value="1" ${w.portal ? raw('checked') : ''}> <span>Turn on their <strong>status page</strong> ${P.tip(P.HELP.portal)}</span></label>`;
    } else {
      const who = w.contact_id ? (() => { const c = db.prepare('SELECT first_name, last_name FROM contacts WHERE id = ?').get(w.contact_id); return c ? [c.first_name, c.last_name].filter(Boolean).join(' ') + ' (already in your contacts)' : '—'; })() : [w.first_name, w.last_name].filter(Boolean).join(' ') + ' (new)';
      const row = (label, val, step) => html`<div class="rv-row"><dt>${label}</dt><dd>${val || html`<span class="muted">—</span>`}</dd><a href="/new/${step}" class="small">Change</a></div>`;
      body = html`<dl class="review">${row('Loan type', P.LOAN_PLAIN[w.loan_type], 'type')}${row('Investor', who, 'who')}${w.loan_type !== 'cashout' ? row('Buying or refinancing', { purchase: 'Buying', refi: 'Refinancing', cashout: 'Refinance + cash out' }[w.transaction_type], 'purpose') : ''}
${row('Property', [w.property_address, w.city, w.state, w.zip].filter(Boolean).join(', ') + ` · ${w.property_type}${w.units > 1 ? ' · ' + w.units + ' units' : ''}`, 'where')}
${numberFields(w).map(([n, l]) => row(l, w[n] == null ? null : money(w[n]), 'numbers'))}
${row('Investor background', [w.experience_deals != null ? (EXPERIENCE.find(e => String(e[0]) === String(w.experience_deals)) || [, ''])[1] : null, w.credit_range && 'credit ' + w.credit_range, w.liquidity != null && money(w.liquidity) + ' cash'].filter(Boolean).join(' · '), 'investor')}
${row('Target close', fmtDate(w.target_close_date), 'timing')}${row('Follow up', fmtDate(w.follow_up), 'timing')}${row('Status page', w.portal ? 'Turn on' : 'Off for now', 'timing')}</dl>
<p class="small muted">Creating the deal adds the right document checklist for a ${P.LOAN_PLAIN[w.loan_type]} loan. Nothing is sent to anyone.</p>`;
    }
    const isChoice = key === 'type' || key === 'purpose';
    res.status(err ? 400 : 200).page('New deal · ' + step.q, '/new', html`<div class="wizard">
<div class="wiz-progress"><div class="wiz-meta"><span>Step ${i + 1} of ${v.length}</span><a href="/" class="small">Cancel</a></div><progress value="${i + 1}" max="${v.length}" aria-label="Step ${i + 1} of ${v.length}"></progress></div>
<form method="post" action="/new/${key}" class="card wiz-card">${csrf}<h1>${step.q}</h1><p class="lede">${step.help}</p>${err ? html`<div class="flash err" role="alert">${err}</div>` : ''}
${body}
<div class="wiz-nav"><a class="btn big ghost" href="${back}">← Back</a>${isChoice ? (w.loan_type && key === 'type' || key === 'purpose' && w.transaction_type ? html`<button class="btn big" name="keep" value="1">Keep "${key === 'type' ? P.LOAN_PLAIN[w.loan_type] : { purchase: 'Buying it', refi: 'Refinancing', cashout: 'Refinancing + cash out' }[w.transaction_type]}" →</button>` : '') : key === 'review' ? html`<button class="btn huge primary">✓ Create deal</button>` : html`<button class="btn big primary">Next →</button>`}
${key === 'investor' ? html`<button class="btn big ghost" name="skip" value="1">Skip this</button>` : ''}</div></form></div>`);
  }

  app.get('/new', (req, res) => {
    req.session.wiz = fresh();
    const cid = int(req.query.contact_id); if (cid && db.prepare('SELECT id FROM contacts WHERE id = ?').get(cid)) req.session.wiz.contact_id = cid;
    res.redirect('/new/type');
  });
  app.get('/new/:step', (req, res, next) => {
    if (!STEPS.some(s => s.key === req.params.step)) return next();
    if (!req.session.wiz) req.session.wiz = fresh();
    const w = req.session.wiz;
    if (req.params.step !== 'type' && !w.loan_type) return res.redirect('/new/type');
    render(req, res, req.params.step);
  });
  app.post('/new/:step', (req, res, next) => {
    const key = req.params.step; if (!STEPS.some(s => s.key === key)) return next();
    const w = req.session.wiz || (req.session.wiz = fresh()); const b = req.body;
    if (key !== 'type' && !w.loan_type) return res.redirect('/new/type');
    const fail = (msg) => render(req, res, key, msg);
    if (key === 'type') {
      if (!b.keep) { const t = oneOf(b.loan_type, TYPES); if (!t) return fail('Tap one of the loan types.'); w.loan_type = t; if (t === 'cashout') w.transaction_type = 'cashout'; else if (w.transaction_type === 'cashout' && !b.keep) w.transaction_type = 'purchase'; }
    } else if (key === 'who') {
      const cid = int(b.contact_id);
      const first = str(b.first_name, 80), last = str(b.last_name, 80), em = str(b.email, 254), ph = str(b.phone, 30);
      if (em && !email(em)) return fail('That email doesn\'t look right. Check it, or leave it blank.');
      if (ph && !phone(ph)) return fail('That phone number doesn\'t look right. Use digits, like (561) 555-0100.');
      if (first) Object.assign(w, { contact_id: null, first_name: first, last_name: last, email: email(em), phone: phone(ph), email_consent: b.email_consent ? 1 : 0, sms_consent: b.sms_consent ? 1 : 0 });
      else if (cid && db.prepare('SELECT id FROM contacts WHERE id = ?').get(cid)) Object.assign(w, { contact_id: cid, first_name: null, last_name: null, email: null, phone: null, email_consent: 0, sms_consent: 0 });
      else return fail('Pick a person, or type a first name for someone new.');
    } else if (key === 'purpose') {
      if (!b.keep) { const t = oneOf(b.transaction_type, ['purchase', 'refi', 'cashout']); if (!t) return fail('Tap one of the choices.'); w.transaction_type = t; }
    } else if (key === 'where') {
      Object.assign(w, { property_address: text(b.property_address, 150), city: str(b.city, 80), state: (str(b.state, 2) || '').toUpperCase() || null, zip: str(b.zip, 10), property_type: oneOf(b.property_type, PROPERTY_TYPES, 'Single family'), units: int(b.units, { min: 1, max: 10000 }) || 1 });
      if (!w.property_address && !w.city) return fail('Add the street address or at least the city.');
    } else if (key === 'numbers') {
      numberFields(w).forEach(([n]) => { w[n] = num(b[n], { min: 0, max: 1e10 }); });
    } else if (key === 'investor') {
      if (b.skip) Object.assign(w, { experience_deals: null, credit_range: null, liquidity: null });
      else Object.assign(w, { experience_deals: b.experience_deals === '' || b.experience_deals == null ? null : int(b.experience_deals, { min: 0, max: 1000 }), credit_range: oneOf(b.credit_range, CREDIT_RANGES), liquidity: num(b.liquidity, { min: 0, max: 1e10 }) });
    } else if (key === 'timing') {
      Object.assign(w, { target_close_date: date(b.target_close_date), follow_up: date(b.follow_up), portal: b.portal ? 1 : 0 });
    } else if (key === 'review') {
      return create(req, res);
    }
    req.session.wiz = w;
    res.redirect(303, '/new/' + nextKey(w, key));
  });

  function create(req, res) {
    const w = req.session.wiz; const uid = req.user.id;
    const id = db.transaction(() => {
      let contactId = w.contact_id || null;
      if (!contactId && w.first_name) {
        const consentAt = (on) => on ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null;
        contactId = db.prepare(`INSERT INTO contacts (type, first_name, last_name, email, phone, lead_source, state, email_consent, email_consent_at, sms_consent, sms_consent_at, consent_method, updated_at)
          VALUES ('borrower', ?, ?, ?, ?, 'New-deal wizard', ?, ?, ?, ?, ?, ?, datetime('now'))`).run(w.first_name, w.last_name || null, w.email || null, w.phone || null, w.state || null,
          w.email_consent ? 1 : 0, consentAt(w.email_consent), w.sms_consent ? 1 : 0, consentAt(w.sms_consent), w.email_consent || w.sms_consent ? 'Recorded by LO in the New-deal wizard' : null).lastInsertRowid;
        model.log(db, { entity_type: 'contact', entity_id: contactId, action: 'contact.created', detail: 'Contact created in the New-deal wizard', user_id: uid });
      }
      const name = `${w.property_address || w.city || 'New deal'} — ${LOAN_TYPES[w.loan_type]}`;
      const d = { name, contact_id: contactId, loan_type: w.loan_type, transaction_type: w.transaction_type, property_type: w.property_type, property_address: w.property_address, city: w.city, state: w.state, zip: w.zip, units: w.units,
        purchase_price: w.purchase_price, as_is_value: w.as_is_value, rehab_budget: w.rehab_budget, arv: w.arv, monthly_rent: w.monthly_rent, payoff: w.payoff, loan_amount: w.loan_amount,
        experience_deals: w.experience_deals, credit_range: w.credit_range, liquidity: w.liquidity, target_close_date: w.target_close_date, uid };
      Object.keys(d).forEach(k => { if (d[k] === undefined) d[k] = null; });
      const dealId = db.prepare(`INSERT INTO deals (name, contact_id, stage, loan_type, transaction_type, property_type, property_address, city, state, zip, units, purchase_price, as_is_value, rehab_budget, arv, monthly_rent, payoff, loan_amount, experience_deals, credit_range, liquidity, target_close_date, assigned_to, lead_source, source, updated_at, stage_changed_at)
        VALUES (@name, @contact_id, 'Lead', @loan_type, @transaction_type, @property_type, @property_address, @city, @state, @zip, @units, @purchase_price, @as_is_value, @rehab_budget, @arv, @monthly_rent, @payoff, @loan_amount, @experience_deals, @credit_range, @liquidity, @target_close_date, @uid, 'New-deal wizard', 'manual', datetime('now'), datetime('now'))`).run(d).lastInsertRowid;
      model.seedChecklist(db, dealId);
      if (w.follow_up) db.prepare('INSERT INTO tasks (title, due_date, deal_id, contact_id, assigned_to) VALUES (?,?,?,?,?)').run(`Follow up with ${w.first_name || 'the investor'} about ${w.property_address || w.city || 'the new deal'}`, w.follow_up, dealId, contactId, uid);
      model.log(db, { entity_type: 'deal', entity_id: dealId, action: 'deal.created', detail: 'Deal created in the New-deal wizard: ' + name, user_id: uid });
      return dealId;
    })();
    if (w.portal && engine) engine.createPortalLink(id, { userId: uid });
    delete req.session.wiz;
    req.flash('🎉 Deal created with a ' + P.LOAN_PLAIN[w.loan_type] + ' document checklist. The big green button below always shows the next step.');
    res.redirect(303, '/deals/' + id);
  }
};
module.exports.STEPS = STEPS;
