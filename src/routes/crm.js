'use strict';
const { validTz } = require('../lib/timeutil');
// CRM: contacts, companies, tasks, notes.
const { html, money, fmtDate, fmtDateTime, str, text, int, oneOf, bool, date, email, phone, todayISO, backTo } = require('../lib/util');
const { field, csrfInput, stageClass, demoTag, badge } = require('../views/layout');
const { CONTACT_TYPES } = require('../db');
const model = require('../lib/model');

const fullName = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ');

function consentBadges(c) {
  return html`${c.email_consent ? badge('Email ✓', 'ok') : badge('No email consent', 'muted')} ${c.sms_consent ? badge('SMS ✓', 'ok') : badge('No SMS consent', 'muted')} ${c.dnc ? badge('DNC', 'err') : ''}`;
}

function notesBlock(csrf, entity_type, entity_id, notes, label = 'Notes') {
  return html`<section class="card"><h2>${label}</h2>
<form method="post" action="/notes" class="note-form">${csrfInput(csrf)}<input type="hidden" name="entity_type" value="${entity_type}"><input type="hidden" name="entity_id" value="${entity_id}">
<textarea name="body" rows="2" maxlength="5000" placeholder="Add a note (no SSNs, DOBs or account numbers — numbers that look like SSNs are auto-redacted)" required></textarea><button class="btn small">Add note</button></form>
<ul class="notes">${notes.map(n => html`<li><p>${n.body}</p><span class="muted small">${n.user_name || 'system'} · ${fmtDateTime(n.created_at)}</span></li>`)}</ul></section>`;
}
function activityBlock(acts) {
  return html`<section class="card"><h2>Activity log</h2>${acts.length ? html`<ul class="list small">${acts.map(a => html`<li>${a.detail || a.action} <span class="muted">· ${a.user_name || 'system/public'} · ${fmtDateTime(a.created_at)}</span></li>`)}</ul>` : html`<p class="muted">No activity yet.</p>`}</section>`;
}
function tasksBlock(csrf, tasks, { dealId, contactId }) {
  const today = todayISO();
  return html`<section class="card"><h2>Follow-up tasks</h2>
<ul class="tasks">${tasks.map(t => html`<li class="${t.done ? 'done' : (t.due_date && t.due_date < today ? 'overdue' : (t.due_date === today ? 'today' : ''))}">
<form method="post" action="/tasks/${t.id}/toggle" class="inline">${csrfInput(csrf)}<button class="chk" title="Toggle done">${t.done ? '☑' : '☐'}</button></form> ${t.title} <span class="muted small">due ${fmtDate(t.due_date)}${!t.done && t.due_date && t.due_date < today ? ' · OVERDUE' : ''}</span></li>`)}</ul>
<form method="post" action="/tasks" class="row-form">${csrfInput(csrf)}${dealId ? html`<input type="hidden" name="deal_id" value="${dealId}">` : ''}${contactId ? html`<input type="hidden" name="contact_id" value="${contactId}">` : ''}
<input name="title" placeholder="New follow-up task" maxlength="200" required><input type="date" name="due_date" value="${today}"><button class="btn small">Add</button></form></section>`;
}

function contactForm(csrf, c, companies) {
  return html`<form method="post" action="${c.id ? '/contacts/' + c.id : '/contacts'}" class="card form-grid">${csrfInput(csrf)}
${field('type', 'Type', { type: 'select', options: CONTACT_TYPES, value: c.type || 'borrower' })}
${field('company_id', 'Company / entity', { type: 'select', options: [['', '—'], ...companies.map(x => [x.id, x.name])], value: c.company_id })}
${field('first_name', 'First name', { required: true, value: c.first_name, max: 80 })}${field('last_name', 'Last name', { value: c.last_name, max: 80 })}
${field('email', 'Email', { type: 'email', value: c.email })}${field('phone', 'Phone', { type: 'tel', value: c.phone })}
${field('city', 'City', { value: c.city })}${field('state', 'State', { value: c.state, max: 2 })}
${field('timezone', 'Time zone (for quiet hours)', { type: 'select', value: c.timezone || '', options: [['', 'Auto (from state, else Eastern)'], ['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii']] })}
${field('lead_source', 'Lead source', { value: c.lead_source, placeholder: 'e.g. DSCR calculator, referral — agent' })}
${field('tags', 'Tags (comma-separated)', { value: c.tags, placeholder: 'investor, repeat' })}
<fieldset class="span2"><legend>Consent & do-not-contact (TCPA / CAN-SPAM records)</legend><div class="form-grid">
${field('email_consent', 'Email consent on file', { type: 'checkbox', value: c.email_consent })}${field('email_consent_at', 'Email consent date', { type: 'date', value: (c.email_consent_at || '').slice(0, 10) })}
${field('sms_consent', 'Prior express written consent for calls/texts on file', { type: 'checkbox', value: c.sms_consent })}${field('sms_consent_at', 'SMS consent date', { type: 'date', value: (c.sms_consent_at || '').slice(0, 10) })}
${field('consent_method', 'How consent was obtained', { value: c.consent_method, placeholder: 'e.g. web form checkbox, signed form' })}
${field('dnc', 'Do not contact (DNC / opted out)', { type: 'checkbox', value: c.dnc, help: 'Checking this records the opt-out date and blocks templates from this contact view.' })}</div></fieldset>
${field('notes', 'Profile notes', { type: 'textarea', value: c.notes, cls: 'span2' })}
<div class="span2"><button class="btn">Save contact</button> <a class="btn ghost" href="${c.id ? '/contacts/' + c.id : '/contacts'}">Cancel</a></div></form>`;
}

function readContact(b) {
  return {
    type: oneOf(b.type, CONTACT_TYPES, 'other'), first_name: str(b.first_name, 80), last_name: str(b.last_name, 80), email: email(b.email), phone: phone(b.phone),
    company_id: int(b.company_id) || null, city: str(b.city, 80), state: (str(b.state, 2) || '').toUpperCase() || null, lead_source: str(b.lead_source, 120),
    tags: (str(b.tags, 300) || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean).join(',') || null,
    email_consent: bool(b.email_consent), email_consent_at: date(b.email_consent_at), sms_consent: bool(b.sms_consent), sms_consent_at: date(b.sms_consent_at),
    consent_method: str(b.consent_method, 200), dnc: bool(b.dnc), notes: text(b.notes, 5000), timezone: validTz(str(b.timezone, 60)) ? str(b.timezone, 60) : null
  };
}

module.exports = (app) => {
  const db = app.locals.db;
  const companies = () => db.prepare('SELECT id, name FROM companies ORDER BY name').all();

  // ---- Contacts -------------------------------------------------------------------------------
  app.get('/contacts', (req, res) => {
    const q = str(req.query.q, 100), type = oneOf(req.query.type, CONTACT_TYPES), tag = str(req.query.tag, 50);
    let sql = 'SELECT c.*, co.name company FROM contacts c LEFT JOIN companies co ON co.id = c.company_id WHERE 1=1'; const p = [];
    if (q) { sql += " AND (c.first_name || ' ' || COALESCE(c.last_name,'') || ' ' || COALESCE(c.email,'') || ' ' || COALESCE(co.name,'')) LIKE ?"; p.push('%' + q + '%'); }
    if (type) { sql += ' AND c.type = ?'; p.push(type); }
    if (tag) { sql += " AND (',' || COALESCE(c.tags,'') || ',') LIKE ?"; p.push('%,' + tag.toLowerCase() + ',%'); }
    const rows = db.prepare(sql + ' ORDER BY c.created_at DESC').all(...p);
    res.page('Contacts', '/contacts', html`<div class="page-head"><h1>Contacts</h1><a class="btn" href="/contacts/new">+ New contact</a></div>
<form class="filters" method="get"><input name="q" value="${q || ''}" placeholder="Search name, email, company"><select name="type"><option value="">All types</option>${CONTACT_TYPES.map(t => html`<option ${t === type ? 'selected' : ''}>${t}</option>`)}</select><input name="tag" value="${tag || ''}" placeholder="Tag"><button class="btn small">Filter</button></form>
<table class="card"><thead><tr><th>Name</th><th>Type</th><th>Company</th><th>Lead source</th><th>Tags</th><th>Consent</th><th>Added</th></tr></thead><tbody>
${rows.map(c => html`<tr><td><a href="/contacts/${c.id}">${fullName(c)}</a>${demoTag(c)}</td><td>${c.type}</td><td>${c.company || '—'}</td><td>${c.lead_source || '—'}</td><td>${(c.tags || '').split(',').filter(Boolean).map(t => html`<a class="tag" href="/contacts?tag=${encodeURIComponent(t)}">${t}</a> `)}</td><td>${consentBadges(c)}</td><td>${fmtDate(c.created_at)}</td></tr>`)}
</tbody></table>${rows.length ? '' : html`<p class="muted">No contacts match.</p>`}`);
  });
  app.get('/contacts/new', (req, res) => res.page('New contact', '/contacts', html`<h1>New contact</h1>${contactForm(res.locals.csrf, {}, companies())}`));
  app.post('/contacts', (req, res) => {
    const c = readContact(req.body);
    if (!c.first_name) { req.flash('First name is required.', 'err'); return res.redirect('/contacts/new'); }
    const now = new Date().toISOString();
    const id = db.prepare(`INSERT INTO contacts (type, first_name, last_name, email, phone, company_id, city, state, lead_source, tags, email_consent, email_consent_at, sms_consent, sms_consent_at, consent_method, dnc, opted_out_at, notes, timezone)
      VALUES (@type,@first_name,@last_name,@email,@phone,@company_id,@city,@state,@lead_source,@tags,@email_consent,@email_consent_at,@sms_consent,@sms_consent_at,@consent_method,@dnc,@opted_out_at,@notes,@timezone)`).run({ ...c, email_consent_at: c.email_consent ? (c.email_consent_at || now) : null, sms_consent_at: c.sms_consent ? (c.sms_consent_at || now) : null, opted_out_at: c.dnc ? now : null }).lastInsertRowid;
    model.log(db, { entity_type: 'contact', entity_id: id, action: 'contact.created', detail: 'Created contact ' + fullName(c), user_id: req.user.id });
    req.flash('Contact saved.'); res.redirect('/contacts/' + id);
  });
  app.get('/contacts/:id', (req, res, next) => {
    const c = db.prepare('SELECT c.*, co.name company FROM contacts c LEFT JOIN companies co ON co.id = c.company_id WHERE c.id = ?').get(req.params.id);
    if (!c) return next();
    const deals = db.prepare('SELECT * FROM deals WHERE contact_id = ? ORDER BY created_at DESC').all(c.id);
    const tasks = db.prepare('SELECT * FROM tasks WHERE contact_id = ? ORDER BY done, due_date').all(c.id);
    const notes = db.prepare("SELECT n.*, u.name user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE entity_type = 'contact' AND entity_id = ? ORDER BY n.id DESC").all(c.id);
    const acts = db.prepare("SELECT a.*, u.name user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id WHERE entity_type = 'contact' AND entity_id = ? ORDER BY a.id DESC LIMIT 30").all(c.id);
    if (req.query.edit) return res.page('Edit ' + fullName(c), '/contacts', html`<h1>Edit ${fullName(c)}</h1>${contactForm(res.locals.csrf, c, companies())}`);
    res.page(fullName(c), '/contacts', html`<div class="page-head"><h1>${fullName(c)}${demoTag(c)} <small class="muted">${c.type}</small></h1><div><a class="btn ghost" href="/contacts/${c.id}?edit=1">Edit</a> <a class="btn" href="/deals/new?contact_id=${c.id}">+ New deal</a> ${c.dnc ? '' : html`<a class="btn ghost" href="/templates?contact_id=${c.id}">Templates</a>`}</div></div>
${c.dnc ? html`<div class="flash err"><strong>Do not contact.</strong> Opted out ${fmtDate(c.opted_out_at)}. Do not call, text or email for marketing.</div>` : ''}
<div class="grid2"><section class="card"><h2>Profile</h2><dl class="dl">
<dt>Email</dt><dd>${c.email || '—'}</dd><dt>Phone</dt><dd>${c.phone || '—'}</dd><dt>Company</dt><dd>${c.company_id ? html`<a href="/companies/${c.company_id}">${c.company}</a>` : '—'}</dd>
<dt>Location</dt><dd>${[c.city, c.state].filter(Boolean).join(', ') || '—'}</dd><dt>Lead source</dt><dd>${c.lead_source || '—'}</dd><dt>Tags</dt><dd>${c.tags || '—'}</dd>
<dt>Consent</dt><dd>${consentBadges(c)}<br><span class="small muted">Email: ${fmtDate(c.email_consent_at)} · SMS: ${fmtDate(c.sms_consent_at)} · Method: ${c.consent_method || '—'}</span></dd>
<dt>Notes</dt><dd>${c.notes || '—'}</dd></dl></section>
<section class="card"><h2>Deals</h2>${deals.length ? html`<ul class="list">${deals.map(d => html`<li><a href="/deals/${d.id}">${d.name}</a> <span class="${stageClass(d.stage)}">${d.stage}</span> ${money(d.loan_amount)}</li>`)}</ul>` : html`<p class="muted">No deals yet.</p>`}</section>
${automationCard(c, res.locals.csrf, deals)}
${tasksBlock(res.locals.csrf, tasks, { contactId: c.id })}${notesBlock(res.locals.csrf, 'contact', c.id, notes)}${activityBlock(acts)}</div>`);
  });
  function automationCard(c, csrf, deals) {
    const enr = db.prepare('SELECT e.*, q.name FROM sequence_enrollments e JOIN sequences q ON q.id = e.sequence_id WHERE e.contact_id = ? ORDER BY e.id DESC LIMIT 10').all(c.id);
    const seqs = db.prepare('SELECT key, name FROM sequences WHERE active = 1').all();
    const msgs = db.prepare('SELECT id, channel, subject, body, status, created_at FROM outbox WHERE contact_id = ? ORDER BY id DESC LIMIT 6').all(c.id);
    return html`<section class="card"><h2>Automation</h2>
<p class="small">${c.email_opt_out_at ? html`<span class="badge err">Unsubscribed from email ${fmtDate(c.email_opt_out_at)}</span> ` : ''}${c.sms_opt_out_at ? html`<span class="badge err">Replied STOP ${fmtDate(c.sms_opt_out_at)}</span> ` : ''}${c.replied_at ? html`<span class="badge">Replied ${fmtDate(c.replied_at)}</span>` : ''}</p>
${enr.length ? html`<ul class="list">${enr.map(e => html`<li>${e.name}: <strong>${e.status}</strong> · step ${e.step}${e.stop_reason ? html` <span class="small muted">(${e.stop_reason})</span>` : ''}${e.status === 'active' ? html` <form method="post" action="/enrollments/${e.id}/stop" class="inline">${csrfInput(csrf)}<button class="btn tiny ghost">Unenroll</button></form>` : ''}</li>`)}</ul>` : html`<p class="muted small">Not in any sequence.</p>`}
${c.dnc ? '' : html`<form method="post" action="/contacts/${c.id}/enroll" class="inline">${csrfInput(csrf)}<select name="sequence" aria-label="Sequence">${seqs.map(q => html`<option value="${q.key}">${q.name}</option>`)}</select>${deals.length ? html`<select name="deal_id" aria-label="Deal"><option value="">No deal</option>${deals.filter(d => d.stage === 'Lead').map(d => html`<option value="${d.id}">${d.name}</option>`)}</select>` : ''}<button class="btn small">Enroll</button></form>`}
<form method="post" action="/contacts/${c.id}/replied" class="inline">${csrfInput(csrf)}<button class="btn small ghost" title="Stops all active sequences for this contact">They replied</button></form>
${msgs.length ? html`<h3>Recent automated messages</h3><ul class="list small">${msgs.map(m => html`<li><a href="/outbox/${m.id}">${m.subject || m.body.slice(0, 60)}</a> · ${m.channel} · ${m.status}</li>`)}</ul>` : ''}</section>`;
  }
  app.post('/contacts/:id', (req, res, next) => {
    const old = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id); if (!old) return next();
    const c = readContact(req.body);
    if (!c.first_name) { req.flash('First name is required.', 'err'); return res.redirect('/contacts/' + old.id + '?edit=1'); }
    const now = new Date().toISOString();
    c.email_consent_at = c.email_consent ? (c.email_consent_at || old.email_consent_at || now) : null;
    c.sms_consent_at = c.sms_consent ? (c.sms_consent_at || old.sms_consent_at || now) : null;
    c.opted_out_at = c.dnc ? (old.opted_out_at || now) : null;
    db.prepare(`UPDATE contacts SET type=@type, first_name=@first_name, last_name=@last_name, email=@email, phone=@phone, company_id=@company_id, city=@city, state=@state, lead_source=@lead_source, tags=@tags,
      email_consent=@email_consent, email_consent_at=@email_consent_at, sms_consent=@sms_consent, sms_consent_at=@sms_consent_at, consent_method=@consent_method, dnc=@dnc, opted_out_at=@opted_out_at, notes=@notes, timezone=@timezone, updated_at=datetime('now') WHERE id=@id`).run({ ...c, id: old.id });
    const eng = app.locals.engine;
    if (c.dnc && !old.dnc) eng.stopEnrollments({ contactId: old.id, reason: 'Marked DO NOT CONTACT' });
    if (!c.email_consent && old.email_consent) eng.stopEnrollments({ contactId: old.id, reason: 'Email consent withdrawn' });
    if (c.email_consent && !old.email_consent) db.prepare('UPDATE contacts SET email_opt_out_at = NULL WHERE id = ?').run(old.id);
    if (c.sms_consent && !old.sms_consent) db.prepare('UPDATE contacts SET sms_opt_out_at = NULL WHERE id = ?').run(old.id);
    if (c.dnc || !c.email_consent || !c.sms_consent) db.prepare("UPDATE outbox SET status = 'blocked', reason = 'Consent/DNC changed on the contact record', updated_at = datetime('now') WHERE contact_id = ? AND status IN ('queued','held') AND (? = 1 OR (channel = 'sms' AND ? = 0) OR (channel = 'email' AND purpose = 'marketing' AND ? = 0))").run(old.id, c.dnc, c.sms_consent, c.email_consent);
    const changes = [];
    if (old.email_consent !== c.email_consent) changes.push('email consent ' + (c.email_consent ? 'granted' : 'withdrawn'));
    if (old.sms_consent !== c.sms_consent) changes.push('SMS consent ' + (c.sms_consent ? 'granted' : 'withdrawn'));
    if (old.dnc !== c.dnc) changes.push(c.dnc ? 'marked DO NOT CONTACT' : 'DNC removed');
    model.log(db, { entity_type: 'contact', entity_id: old.id, action: 'contact.updated', detail: 'Contact updated' + (changes.length ? ': ' + changes.join(', ') : ''), user_id: req.user.id });
    req.flash('Contact saved.'); res.redirect('/contacts/' + old.id);
  });

  // ---- Companies ------------------------------------------------------------------------------
  const companyForm = (csrf, c) => html`<form method="post" action="${c.id ? '/companies/' + c.id : '/companies'}" class="card form-grid">${csrfInput(csrf)}
${field('name', 'Name', { required: true, value: c.name, max: 150 })}${field('kind', 'Kind', { type: 'select', options: ['Borrower LLC', 'Corporation', 'Trust', 'Brokerage', 'Wholesaler', 'Property manager', 'Title/escrow', 'Insurance', 'Lender', 'Other'], value: c.kind })}
${field('state', 'State', { value: c.state, max: 2 })}${field('website', 'Website', { value: c.website, max: 200 })}
${field('notes', 'Notes (no EINs or account numbers)', { type: 'textarea', value: c.notes, cls: 'span2' })}<div class="span2"><button class="btn">Save</button></div></form>`;
  const readCo = (b) => ({ name: str(b.name, 150), kind: str(b.kind, 50), state: (str(b.state, 2) || '').toUpperCase() || null, website: str(b.website, 200), notes: text(b.notes, 5000) });
  app.get('/companies', (req, res) => {
    const rows = db.prepare('SELECT co.*, (SELECT COUNT(*) FROM contacts WHERE company_id = co.id) n_contacts, (SELECT COUNT(*) FROM deals WHERE company_id = co.id) n_deals FROM companies co ORDER BY name').all();
    res.page('Companies', '/companies', html`<div class="page-head"><h1>Companies & entities</h1><a class="btn" href="/companies/new">+ New company</a></div>
<table class="card"><thead><tr><th>Name</th><th>Kind</th><th>State</th><th>Contacts</th><th>Deals</th></tr></thead><tbody>${rows.map(c => html`<tr><td><a href="/companies/${c.id}">${c.name}</a>${demoTag(c)}</td><td>${c.kind || '—'}</td><td>${c.state || '—'}</td><td class="num">${c.n_contacts}</td><td class="num">${c.n_deals}</td></tr>`)}</tbody></table>`);
  });
  app.get('/companies/new', (req, res) => res.page('New company', '/companies', html`<h1>New company / entity</h1>${companyForm(res.locals.csrf, {})}`));
  app.post('/companies', (req, res) => {
    const c = readCo(req.body); if (!c.name) { req.flash('Name is required.', 'err'); return res.redirect('/companies/new'); }
    const id = db.prepare('INSERT INTO companies (name, kind, state, website, notes) VALUES (@name,@kind,@state,@website,@notes)').run(c).lastInsertRowid;
    req.flash('Company saved.'); res.redirect('/companies/' + id);
  });
  app.get('/companies/:id', (req, res, next) => {
    const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id); if (!c) return next();
    if (req.query.edit) return res.page('Edit company', '/companies', html`<h1>Edit ${c.name}</h1>${companyForm(res.locals.csrf, c)}`);
    const contacts = db.prepare('SELECT * FROM contacts WHERE company_id = ?').all(c.id);
    const deals = db.prepare('SELECT * FROM deals WHERE company_id = ?').all(c.id);
    const notes = db.prepare("SELECT n.*, u.name user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE entity_type = 'company' AND entity_id = ? ORDER BY n.id DESC").all(c.id);
    res.page(c.name, '/companies', html`<div class="page-head"><h1>${c.name}${demoTag(c)} <small class="muted">${c.kind || ''}</small></h1><a class="btn ghost" href="/companies/${c.id}?edit=1">Edit</a></div>
<div class="grid2"><section class="card"><h2>People</h2><ul class="list">${contacts.map(p => html`<li><a href="/contacts/${p.id}">${fullName(p)}</a> <span class="muted">${p.type}</span></li>`)}</ul>${contacts.length ? '' : html`<p class="muted">None linked.</p>`}</section>
<section class="card"><h2>Deals (vesting)</h2><ul class="list">${deals.map(d => html`<li><a href="/deals/${d.id}">${d.name}</a> <span class="${stageClass(d.stage)}">${d.stage}</span></li>`)}</ul>${deals.length ? '' : html`<p class="muted">None.</p>`}</section>
<section class="card"><h2>Details</h2><dl class="dl"><dt>State</dt><dd>${c.state || '—'}</dd><dt>Website</dt><dd>${c.website || '—'}</dd><dt>Notes</dt><dd>${c.notes || '—'}</dd></dl></section>
${notesBlock(res.locals.csrf, 'company', c.id, notes)}</div>`);
  });
  app.post('/companies/:id', (req, res, next) => {
    const old = db.prepare('SELECT id FROM companies WHERE id = ?').get(req.params.id); if (!old) return next();
    const c = readCo(req.body); if (!c.name) { req.flash('Name is required.', 'err'); return res.redirect('/companies/' + old.id + '?edit=1'); }
    db.prepare('UPDATE companies SET name=@name, kind=@kind, state=@state, website=@website, notes=@notes WHERE id=@id').run({ ...c, id: old.id });
    req.flash('Company saved.'); res.redirect('/companies/' + old.id);
  });

  // ---- Tasks ----------------------------------------------------------------------------------
  app.get('/tasks', (req, res) => {
    const today = todayISO(); const f = oneOf(req.query.f, ['open', 'overdue', 'today', 'upcoming', 'done'], 'open');
    const where = { open: 't.done = 0', overdue: 't.done = 0 AND t.due_date < @today', today: 't.done = 0 AND t.due_date = @today', upcoming: 't.done = 0 AND t.due_date > @today', done: 't.done = 1' }[f];
    const rows = db.prepare(`SELECT t.*, d.name deal_name, c.first_name, c.last_name FROM tasks t LEFT JOIN deals d ON d.id = t.deal_id LEFT JOIN contacts c ON c.id = t.contact_id WHERE ${where} ORDER BY ${f === 'done' ? 't.done_at DESC' : 't.due_date IS NULL, t.due_date'} LIMIT 500`).all({ today });
    res.page('Tasks', '/tasks', html`<div class="page-head"><h1>Follow-up tasks</h1></div>
<nav class="tabs">${['open', 'overdue', 'today', 'upcoming', 'done'].map(k => html`<a href="/tasks?f=${k}" class="${k === f ? 'active' : ''}">${k[0].toUpperCase() + k.slice(1)}</a>`)}</nav>
<form method="post" action="/tasks" class="row-form card">${csrfInput(res.locals.csrf)}<input name="title" placeholder="New task" maxlength="200" required><input type="date" name="due_date" value="${today}"><button class="btn small">Add task</button></form>
<table class="card"><thead><tr><th></th><th>Task</th><th>Due</th><th>Deal</th><th>Contact</th></tr></thead><tbody>${rows.map(t => html`<tr class="${!t.done && t.due_date && t.due_date < today ? 'overdue' : (t.due_date === today ? 'today' : '')}"><td><form method="post" action="/tasks/${t.id}/toggle" class="inline">${csrfInput(res.locals.csrf)}<button class="chk">${t.done ? '☑' : '☐'}</button></form></td>
<td>${t.title}${!t.done && t.due_date && t.due_date < today ? html` ${badge('Overdue', 'err')}` : ''}</td><td>${fmtDate(t.due_date)}</td><td>${t.deal_id ? html`<a href="/deals/${t.deal_id}">${t.deal_name}</a>` : '—'}</td><td>${t.contact_id ? html`<a href="/contacts/${t.contact_id}">${t.first_name} ${t.last_name || ''}</a>` : '—'}</td></tr>`)}</tbody></table>${rows.length ? '' : html`<p class="muted">Nothing here.</p>`}`);
  });
  app.post('/tasks', (req, res) => {
    const title = str(req.body.title, 200); const due = date(req.body.due_date); const dealId = int(req.body.deal_id) || null; let contactId = int(req.body.contact_id) || null;
    if (dealId && !contactId) { const d = db.prepare('SELECT contact_id FROM deals WHERE id = ?').get(dealId); contactId = d ? d.contact_id : null; }
    if (title) {
      db.prepare('INSERT INTO tasks (title, due_date, deal_id, contact_id, assigned_to) VALUES (?,?,?,?,?)').run(title, due, dealId, contactId, req.user.id);
      if (dealId) model.log(db, { entity_type: 'deal', entity_id: dealId, action: 'task.created', detail: 'Task added: ' + title, user_id: req.user.id });
    }
    res.redirect(backTo(req, '/tasks'));
  });
  app.post('/tasks/:id/toggle', (req, res) => {
    db.prepare("UPDATE tasks SET done = 1 - done, done_at = CASE WHEN done = 0 THEN datetime('now') END WHERE id = ?").run(req.params.id);
    res.redirect(backTo(req, '/tasks'));
  });

  // ---- Notes (generic) ------------------------------------------------------------------------
  app.post('/notes', (req, res) => {
    const et = oneOf(req.body.entity_type, ['contact', 'company', 'deal', 'deal_uw']); const id = int(req.body.entity_id); const body = text(req.body.body, 5000);
    if (et && id && body) {
      db.prepare('INSERT INTO notes (entity_type, entity_id, body, user_id) VALUES (?,?,?,?)').run(et, id, body, req.user.id);
      if (et.startsWith('deal')) model.log(db, { entity_type: 'deal', entity_id: id, action: 'note.added', detail: (et === 'deal_uw' ? 'Underwriting note' : 'Note') + ' added', user_id: req.user.id });
    }
    const dest = { contact: '/contacts/', company: '/companies/', deal: '/deals/', deal_uw: '/deals/' }[et] + id + (et === 'deal_uw' ? '/underwriting' : '');
    res.redirect(et && id ? dest : '/');
  });
};
module.exports.helpers = { notesBlock, activityBlock, tasksBlock, fullName, consentBadges };
