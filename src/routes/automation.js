'use strict';
// Staff routes: Outbox (review/approve/kill switch), Automations admin, portal link management, sequence enrollment.
const { html, raw, str, text, int, oneOf, bool, email, fmtDateTime, backTo } = require('../lib/util');
const { field, csrfInput, badge } = require('../views/layout');
const { requireAdmin } = require('../lib/security');
const { outboxRows, statusBadge, OUTBOX_SQL, STATUS_LABEL } = require('../views/automation');
const { STAGES, OUTBOX_STATUSES } = require('../db');
const model = require('../lib/model');
const transports = require('../lib/transports');

const linesOf = (v) => String(v || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 20).map(s => s.slice(0, 200));

module.exports = (app) => {
  const db = app.locals.db; const engine = app.locals.engine; const cfg = app.locals.config;

  // ---- Portal link management --------------------------------------------------------------------------
  app.post('/deals/:id/portal', (req, res, next) => {
    const d = db.prepare('SELECT id FROM deals WHERE id = ?').get(req.params.id); if (!d) return next();
    engine.createPortalLink(d.id, { verifyMode: oneOf(req.body.verify_mode, ['email_phone4', 'email', 'none'], 'email_phone4'), userId: req.user.id });
    req.flash('Status-portal link ready. Copy it below (any older link for this deal was turned off).'); res.redirect('/deals/' + d.id);
  });
  app.post('/deals/:id/portal/revoke', (req, res) => {
    db.prepare('UPDATE portal_links SET revoked = 1 WHERE deal_id = ? AND revoked = 0').run(req.params.id);
    model.log(db, { entity_type: 'deal', entity_id: Number(req.params.id), action: 'portal.revoked', detail: 'Status-portal link revoked', user_id: req.user.id });
    req.flash('Portal link revoked.'); res.redirect('/deals/' + req.params.id);
  });
  app.post('/deals/:id/portal/update', (req, res, next) => {
    const d = db.prepare('SELECT id FROM deals WHERE id = ?').get(req.params.id); if (!d) return next();
    const body = text(req.body.body, 1000); if (!body) { req.flash('Write an update first.', 'err'); return res.redirect('/deals/' + d.id); }
    engine.postUpdate(d.id, body, { source: 'staff', userId: req.user.id });
    db.prepare("UPDATE deals SET updated_at = datetime('now') WHERE id = ?").run(d.id);
    model.log(db, { entity_type: 'deal', entity_id: d.id, action: 'portal.update', detail: 'Posted portal update', user_id: req.user.id });
    req.flash('Update posted to the borrower portal.'); res.redirect('/deals/' + d.id);
  });

  // ---- Contacts: sequences, replies -------------------------------------------------------------------
  app.post('/contacts/:id/enroll', (req, res, next) => {
    const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id); if (!c) return next();
    if (c.dnc) { req.flash('This contact is DO NOT CONTACT — not enrolled.', 'err'); return res.redirect('/contacts/' + c.id); }
    const id = engine.enroll(str(req.body.sequence, 60), c.id, int(req.body.deal_id) || null);
    if (!id) req.flash('Already enrolled (or sequence inactive).', 'warn');
    else if (!c.email_consent) req.flash('Enrolled, but there is no email consent on file — the first step will be BLOCKED in the Outbox and the sequence will stop. Record consent first.', 'warn');
    else req.flash('Enrolled. Steps appear in the Outbox as they come due.');
    res.redirect('/contacts/' + c.id);
  });
  app.post('/enrollments/:id/stop', (req, res) => {
    const e = db.prepare('SELECT contact_id FROM sequence_enrollments WHERE id = ?').get(req.params.id);
    if (e) engine.stopEnrollments({ enrollmentId: Number(req.params.id), reason: 'Stopped by ' + req.user.name });
    req.flash('Unenrolled.'); res.redirect(backTo(req, e ? '/contacts/' + e.contact_id : '/automations'));
  });
  app.post('/contacts/:id/replied', (req, res) => {
    const n = engine.markReplied(Number(req.params.id));
    req.flash(`Marked as replied${n ? ` — ${n} sequence(s) stopped` : ''}.`); res.redirect('/contacts/' + req.params.id);
  });

  // ---- Outbox ---------------------------------------------------------------------------------------------
  app.get('/outbox', (req, res) => {
    const st = oneOf(req.query.status, OUTBOX_STATUSES), ch = oneOf(req.query.channel, ['email', 'sms']), dealId = int(req.query.deal_id);
    let sql = OUTBOX_SQL + ' WHERE 1=1'; const p = [];
    if (st) { sql += ' AND o.status = ?'; p.push(st); } if (ch) { sql += ' AND o.channel = ?'; p.push(ch); } if (dealId) { sql += ' AND o.deal_id = ?'; p.push(dealId); }
    const rows = db.prepare(sql + ' ORDER BY CASE o.status WHEN \'held\' THEN 0 WHEN \'queued\' THEN 1 WHEN \'failed\' THEN 2 ELSE 3 END, o.id DESC LIMIT 300').all(...p);
    const counts = db.prepare('SELECT status, COUNT(*) n FROM outbox GROUP BY status').all().reduce((o, r) => (o[r.status] = r.n, o), {});
    const s = model.getSettings(db); const on = s.automated_sending === '1';
    const em = transports.emailConfigured() && !transports.dryRun(cfg), sm = transports.smsConfigured() && !transports.dryRun(cfg);
    const profileOk = s.lo_name && s.nmls_id && s.physical_address;
    const tab = (v, l) => html`<a class="tab ${st === v || (!v && !st) ? 'active' : ''}" href="/outbox${v ? '?status=' + v : ''}">${l} <span class="count">${v ? counts[v] || 0 : Object.values(counts).reduce((a, b) => a + b, 0)}</span></a>`;
    res.page('Outbox', '/outbox', html`<div class="page-head"><h1>Outbox</h1><a class="btn small ghost" href="/automations">Automations</a></div>
<section class="card kill ${on ? 'on' : 'off'}"><div class="kill-row"><div><h2>Automated sending: ${on ? 'ON' : 'OFF'}</h2>
<p class="small">${on ? 'Messages that pass consent checks send automatically (inside quiet hours) — no review step.' : 'Every automated message is HELD here until you approve it. Nothing goes out on its own.'}</p></div>
<form method="post" action="/outbox/sending" data-confirm="${on ? 'Turn automated sending OFF? New messages will be held for review.' : 'Turn automated sending ON? Messages that pass consent checks will send without review.'}">${csrfInput(res.locals.csrf)}<input type="hidden" name="on" value="${on ? '0' : '1'}"><button class="btn ${on ? 'danger' : ''}">${on ? 'Turn OFF (kill switch)' : 'Turn ON'}</button></form></div>
<ul class="checks small"><li class="${em ? 'ok-text' : 'warn-text'}">Email transport: ${em ? 'SMTP configured — approved email really sends' : 'not configured — sends are SIMULATED and logged (nothing leaves the app)'}</li>
<li class="${sm ? 'ok-text' : 'warn-text'}">SMS transport: ${sm ? 'Twilio configured — approved texts really send' : 'not configured — texts are SIMULATED (Twilio is optional and paid)'}</li>
<li class="${profileOk ? 'ok-text' : 'warn-text'}">Profile: ${profileOk ? 'name, NMLS # and physical address set' : html`missing name / NMLS # / physical address — emails are held until set (<a href="/settings">Settings</a>)`}</li>
<li>Quiet hours: ${s.quiet_start || 8}:00–${s.quiet_end || 21}:00 recipient local time (default ET). Consent and DNC are re-checked at send time.</li></ul></section>
<nav class="tabs">${tab('', 'All')}${tab('held', 'Held for review')}${tab('queued', 'Queued')}${tab('sent', 'Sent')}${tab('blocked', 'Blocked by consent')}${tab('failed', 'Failed')}${tab('canceled', 'Canceled')}</nav>
<form id="bulk-approve" method="post" action="/outbox/bulk-approve" class="toolbar">${csrfInput(res.locals.csrf)}<button class="btn small">Approve & send selected</button>
<span class="small muted">Approving re-checks consent, DNC, profile and quiet hours first.</span></form>
<form method="post" action="/outbox/dispatch" class="inline">${csrfInput(res.locals.csrf)}<button class="btn small ghost">Process queue now</button></form>
<section class="card">${outboxRows(rows, res.locals.csrf)}</section>`);
  });
  app.post('/outbox/sending', requireAdmin, (req, res) => {
    const on = req.body.on === '1'; model.setSetting(db, 'automated_sending', on ? '1' : '0');
    if (!on) db.prepare("UPDATE outbox SET status = 'held', reason = 'Automated sending turned OFF — review and approve to send', updated_at = datetime('now') WHERE status = 'queued'").run();
    model.log(db, { action: 'automation.sending', detail: 'Automated sending turned ' + (on ? 'ON' : 'OFF'), user_id: req.user.id });
    req.flash('Automated sending is ' + (on ? 'ON.' : 'OFF. Queued messages were moved to Held.')); res.redirect('/outbox');
  });
  app.post('/outbox/dispatch', async (req, res, next) => { try { const n = await engine.dispatchDue(new Date()); req.flash(`${n} message(s) sent.`); res.redirect('/outbox'); } catch (e) { next(e); } });
  app.post('/outbox/bulk-approve', async (req, res, next) => {
    try {
      const ids = [].concat(req.body.ids || []).map(Number).filter(Boolean).slice(0, 200); const out = {};
      for (const id of ids) { const st = await engine.approve(id, req.user.id); out[st] = (out[st] || 0) + 1; }
      req.flash(ids.length ? 'Results: ' + Object.entries(out).map(([k, v]) => `${v} ${STATUS_LABEL[k] || k}`).join(', ') : 'Select messages first.', ids.length ? 'ok' : 'warn'); res.redirect('/outbox');
    } catch (e) { next(e); }
  });
  app.get('/outbox/:id', (req, res, next) => {
    const m = db.prepare(OUTBOX_SQL + ' WHERE o.id = ?').get(req.params.id); if (!m) return next();
    const full = engine.preview(m);
    res.page('Message #' + m.id, '/outbox', html`<p><a href="/outbox">← Outbox</a></p><h1>${m.subject || 'Text message'} ${statusBadge(m.status, m.transport)}</h1>
<div class="grid2"><section class="card"><h2>${m.channel === 'sms' ? 'Text' : 'Email'} as it will be sent</h2><p class="small">To: ${m.to_addr || '—'} ${m.contact_name ? html`(<a href="/contacts/${m.contact_id}">${m.contact_name}</a>)` : ''}${m.deal_name ? html` · <a href="/deals/${m.deal_id}">${m.deal_name}</a>` : ''}</p>
<pre class="msg-preview">${m.subject ? 'Subject: ' + m.subject + '\n\n' : ''}${full}</pre>
${['held', 'failed'].includes(m.status) ? html`<form method="post" action="/outbox/${m.id}/approve" class="inline">${csrfInput(res.locals.csrf)}<button class="btn">Approve & send</button></form>` : ''}
${['held', 'queued', 'failed'].includes(m.status) ? html` <form method="post" action="/outbox/${m.id}/cancel" class="inline">${csrfInput(res.locals.csrf)}<button class="btn ghost">Cancel</button></form>` : ''}</section>
<section class="card"><h2>Details</h2><dl class="dl"><dt>Status</dt><dd>${STATUS_LABEL[m.status]}${m.reason ? html` — ${m.reason}` : ''}</dd><dt>Purpose</dt><dd>${m.purpose}</dd><dt>Consent / basis</dt><dd>${m.basis || '—'}</dd>
<dt>Rule</dt><dd>${m.rule_key || 'manual'} ${m.template_code ? html`· template ${m.template_code}` : ''}</dd><dt>Created</dt><dd>${fmtDateTime(m.created_at)}</dd><dt>Send after</dt><dd>${fmtDateTime(m.send_after)}</dd>
<dt>Sent</dt><dd>${m.sent_at ? fmtDateTime(m.sent_at) + ' via ' + m.transport : '—'}</dd>${m.error ? html`<dt>Error</dt><dd class="err-text">${m.error}</dd>` : ''}</dl>
${m.status === 'held' ? html`<h3>Edit before approving</h3><form method="post" action="/outbox/${m.id}" class="stack">${csrfInput(res.locals.csrf)}
${m.channel === 'email' ? field('subject', 'Subject', { value: m.subject, max: 200 }) : ''}${field('body', 'Body (footer with disclosures/unsubscribe is added automatically)', { type: 'textarea', rows: 10, value: m.body })}<button class="btn small">Save edits</button></form>` : ''}</section></div>`);
  });
  app.post('/outbox/:id', (req, res, next) => {
    const m = db.prepare('SELECT * FROM outbox WHERE id = ?').get(req.params.id); if (!m) return next();
    if (m.status !== 'held') { req.flash('Only held messages can be edited.', 'err'); return res.redirect('/outbox/' + m.id); }
    const body = text(req.body.body, 5000); if (!body) { req.flash('Body is required.', 'err'); return res.redirect('/outbox/' + m.id); }
    db.prepare("UPDATE outbox SET subject = ?, body = ?, reason = 'Edited — review and approve to send', updated_at = datetime('now') WHERE id = ?").run(m.channel === 'email' ? str(req.body.subject, 200) : null, body, m.id);
    req.flash('Saved.'); res.redirect('/outbox/' + m.id);
  });
  app.post('/outbox/:id/approve', async (req, res, next) => {
    try { const st = await engine.approve(Number(req.params.id), req.user.id); const m = db.prepare('SELECT reason FROM outbox WHERE id = ?').get(req.params.id);
      req.flash(`Result: ${STATUS_LABEL[st] || st || 'not found'}${m && m.reason ? ' — ' + m.reason : ''}`, st === 'sent' ? 'ok' : 'warn'); res.redirect(backTo(req, '/outbox')); } catch (e) { next(e); }
  });
  app.post('/outbox/:id/cancel', (req, res) => {
    db.prepare("UPDATE outbox SET status = 'canceled', reason = ?, updated_at = datetime('now') WHERE id = ? AND status IN ('held','queued','failed')").run('Canceled by ' + req.user.name, req.params.id);
    req.flash('Canceled.'); res.redirect(backTo(req, '/outbox'));
  });

  // ---- Automations admin ---------------------------------------------------------------------------------
  function ruleForm(r, csrf, tplCodes) {
    const c = r.config; const tplSel = (name, v, ch) => html`<select name="${name}"><option value="">— none —</option>${tplCodes.filter(t => t.channel === ch).map(t => html`<option value="${t.code}" ${t.code === v ? raw('selected') : ''}>${t.code}</option>`)}</select>`;
    let body = '';
    if (r.key === 'stage_change') body = html`<table class="rule-stages"><thead><tr><th>Stage</th><th>Email</th><th>Text (consented only)</th><th>Portal update</th><th>Tasks (title | due in days)</th><th>Checklist items (title | borrower/internal)</th></tr></thead><tbody>${STAGES.map(st => { const x = c.stages[st] || {}; const k = st.replace(/\W+/g, '_'); return html`<tr><th>${st}</th>
<td>${tplSel('email_' + k, x.email, 'email')}</td><td>${tplSel('sms_' + k, x.sms, 'sms')}</td><td><input type="checkbox" name="portal_${k}" value="1" ${x.portal ? 'checked' : ''} aria-label="Portal update for ${st}"></td>
<td><textarea name="tasks_${k}" rows="2" aria-label="Tasks for ${st}">${(x.tasks || []).join('\n')}</textarea></td><td><textarea name="checklist_${k}" rows="2" aria-label="Checklist for ${st}">${(x.checklist || []).join('\n')}</textarea></td></tr>`; })}</tbody></table>`;
    if (r.key === 'intake_ack') body = html`<label class="check"><input type="checkbox" name="email" value="1" ${c.email ? 'checked' : ''}> Acknowledgement email (A-intake-ack-email) with portal link</label><label class="check"><input type="checkbox" name="sms" value="1" ${c.sms ? 'checked' : ''}> Acknowledgement text if SMS consent given (A-intake-ack-sms)</label>${field('tasks', 'Tasks created (title | due in days)', { type: 'textarea', rows: 2, value: (c.tasks || []).join('\n') })}`;
    if (r.key === 'doc_reminders') body = html`${field('days', 'Remind on these days after the first request (comma-separated)', { value: (c.days || []).join(', ') })}<label class="check"><input type="checkbox" name="email" value="1" ${c.email ? 'checked' : ''}> Email (A-docs-reminder-email)</label><label class="check"><input type="checkbox" name="sms" value="1" ${c.sms ? 'checked' : ''}> Text if consented (A-docs-reminder-sms)</label>`;
    if (r.key === 'nurture') body = html`<label class="check"><input type="checkbox" name="auto_enroll_intake" value="1" ${c.auto_enroll_intake ? 'checked' : ''}> Auto-enroll new public-intake leads who gave email consent</label>${field('intake_sequence', 'Sequence for new intake leads', { type: 'select', options: db.prepare('SELECT key, name FROM sequences').all().map(q => [q.key, q.name]), value: c.intake_sequence })}`;
    if (r.key === 'stale_deals') body = field('days', 'Alert when an open deal has no updates for (days)', { type: 'number', value: c.days });
    if (r.key === 'daily_digest') body = html`${field('hour', 'Hour (ET, 0–23)', { type: 'number', value: c.hour })}<label class="check"><input type="checkbox" name="email" value="1" ${c.email ? 'checked' : ''}> Also queue the digest as an email to you</label>`;
    return html`<article class="card rule ${r.enabled ? '' : 'disabled'}" id="rule-${r.key}"><header class="card-head"><div><h3>${r.name} ${r.enabled ? badge('on', 'ok') : badge('off', 'muted')}</h3><p class="small muted">Trigger: ${r.trigger}. ${r.desc}</p></div>
<form method="post" action="/automations/${r.key}/toggle" class="inline">${csrfInput(csrf)}<button class="btn small ${r.enabled ? 'ghost' : ''}">${r.enabled ? 'Turn off' : 'Turn on'}</button></form></header>
<details><summary>Edit timing & content</summary><form method="post" action="/automations/${r.key}" class="stack">${csrfInput(csrf)}${body}<button class="btn small">Save rule</button></form></details></article>`;
  }

  app.get('/automations', (req, res) => {
    const s = model.getSettings(db); const csrf = res.locals.csrf;
    const rules = Object.keys(engine.RULES).map(k => engine.rule(k));
    const tpls = db.prepare("SELECT * FROM templates WHERE category IN ('Automation','Nurture sequences') OR code IN ('F-4','F-5') ORDER BY category, code").all();
    const tplCodes = db.prepare('SELECT code, channel FROM templates WHERE code IS NOT NULL ORDER BY code').all();
    const seqs = db.prepare("SELECT q.*, (SELECT COUNT(*) FROM sequence_enrollments e WHERE e.sequence_id = q.id AND e.status = 'active') active_n FROM sequences q ORDER BY id").all();
    const enr = db.prepare(`SELECT e.*, q.name seq_name, TRIM(c.first_name || ' ' || COALESCE(c.last_name,'')) contact_name FROM sequence_enrollments e JOIN sequences q ON q.id = e.sequence_id JOIN contacts c ON c.id = e.contact_id ORDER BY e.status = 'active' DESC, e.id DESC LIMIT 40`).all();
    const runs = db.prepare('SELECT * FROM automation_runs ORDER BY id DESC LIMIT 40').all();
    const notes = db.prepare('SELECT n.*, d.name deal_name FROM notifications n LEFT JOIN deals d ON d.id = n.deal_id ORDER BY n.read_at IS NOT NULL, n.id DESC LIMIT 25').all();
    const held = db.prepare("SELECT COUNT(*) n FROM outbox WHERE status = 'held'").get().n;
    res.page('Automations', '/automations', html`<div class="page-head"><h1>Automations</h1><a class="btn small" href="/outbox">Outbox (${held} held)</a></div>
<div class="notice"><strong>How this works:</strong> rules react to events (new intake, stage change, uploads) and a built-in scheduler (every minute) handles reminders, sequences, stale-deal alerts and your digest. Every outgoing message goes to the <a href="/outbox">Outbox</a> first. <strong>Automated sending is ${s.automated_sending === '1' ? 'ON' : 'OFF'}</strong>${s.automated_sending === '1' ? '' : ' — messages wait for your approval'}. Consent, DNC and quiet hours are enforced on every message. Have your sponsoring broker approve the wording before turning sending on.</div>
<div class="grid2"><section class="card"><h2>Sending window & digest</h2><form method="post" action="/automations/settings" class="form-grid">${csrfInput(csrf)}
${field('quiet_start', 'Earliest send hour (recipient local)', { type: 'number', value: s.quiet_start || 8 })}${field('quiet_end', 'Stop sending at hour', { type: 'number', value: s.quiet_end || 21 })}
${field('digest_email', 'Digest email to (blank = your login email)', { type: 'email', value: s.digest_email })}<div class="span2"><button class="btn small">Save</button></div></form>
<p class="small muted">Recipient time zone comes from the contact's time-zone field, else their state, else Eastern.</p></section>
<section class="card"><h2>Run now</h2><p class="small muted">The scheduler runs these automatically; use these buttons to test. Anything they queue lands in the Outbox (held while sending is OFF).</p>
<div class="btn-row">${[['tick', 'Run all scheduled jobs'], ['doc_reminders', 'Document reminders'], ['nurture', 'Sequences'], ['stale_deals', 'Stale-deal check'], ['daily_digest', 'Build today\'s digest']].map(([k, l]) => html`<form method="post" action="/automations/run/${k}" class="inline">${csrfInput(csrf)}<button class="btn small ghost">${l}</button></form>`)}</div></section></div>
<h2>Rules</h2>${rules.map(r => ruleForm(r, csrf, tplCodes))}
<h2>Sequences</h2><div class="grid2">${seqs.map(q => html`<section class="card"><h3>${q.name} ${badge(q.active_n + ' active')}</h3><p class="small muted">${q.audience}</p><ol class="small">${JSON.parse(q.steps_json).map(st => html`<li>Day ${st.day}: <span class="tag">${st.template}</span></li>`)}</ol><p class="small">Auto-stops on reply, unsubscribe/STOP, DNC, or when the lead's deal moves past Lead. Enroll from a contact's page.</p></section>`)}</div>
<section class="card"><h2>Enrollments</h2>${enr.length ? html`<table><thead><tr><th>Contact</th><th>Sequence</th><th>Status</th><th>Step</th><th>Next</th><th></th></tr></thead><tbody>${enr.map(e => html`<tr><td><a href="/contacts/${e.contact_id}">${e.contact_name}</a></td><td>${e.seq_name}</td><td>${e.status}${e.stop_reason ? html`<div class="small muted">${e.stop_reason}</div>` : ''}</td><td>${e.step}</td><td class="small">${e.status === 'active' ? fmtDateTime(e.next_at) : '—'}</td><td>${e.status === 'active' ? html`<form method="post" action="/enrollments/${e.id}/stop" class="inline">${csrfInput(csrf)}<button class="btn tiny ghost">Unenroll</button></form>` : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">None yet.</p>`}</section>
<section class="card" id="templates"><h2>Message templates</h2><p class="small muted">Plain English; no rate quotes, approval language or promised dates. Merge fields: {{FIRST_NAME}} {{PROPERTY_SHORT}} {{LOAN_TYPE}} {{STAGE_LABEL}} {{STAGE_NOW}} {{STAGE_NEED}} {{ITEM_LIST}} {{CONDITION_LIST}} {{PORTAL_LINK}} {{LO_NAME}} {{LO_FIRST}}. The disclosure block, physical address and unsubscribe link (email) or "Reply STOP" (text) are appended automatically.</p>
<div class="tpl-grid">${tpls.map(t => html`<details class="card tpl"><summary><strong>${t.code}</strong> ${badge(t.channel)} ${t.name}</summary><form method="post" action="/automations/templates/${t.id}" class="stack">${csrfInput(csrf)}
${t.channel === 'email' ? field('subject', 'Subject', { value: t.subject, max: 200 }) : ''}${field('body', 'Body', { type: 'textarea', rows: 8, value: t.body })}<button class="btn small">Save template</button></form></details>`)}</div></section>
<div class="grid2"><section class="card"><div class="card-head"><h2>Alerts & digests</h2><form method="post" action="/notifications/read" class="inline">${csrfInput(csrf)}<button class="btn tiny ghost">Mark all read</button></form></div>${notes.length ? html`<ul class="feed">${notes.map(n => html`<li class="${n.read_at ? 'read' : 'unread'}"><time>${fmtDateTime(n.created_at)}</time> ${badge(n.kind)} <strong>${n.title}</strong>${n.deal_id ? html` · <a href="/deals/${n.deal_id}">open deal</a>` : ''}${n.body ? html`<pre class="small">${n.body}</pre>` : ''}</li>`)}</ul>` : html`<p class="muted">No alerts.</p>`}</section>
<section class="card"><h2>Run log</h2>${runs.length ? html`<table class="small"><thead><tr><th>When</th><th>Rule</th><th>Result</th></tr></thead><tbody>${runs.map(r => html`<tr><td>${fmtDateTime(r.ran_at)}</td><td>${r.rule_key}</td><td>${r.summary}</td></tr>`)}</tbody></table>` : html`<p class="muted">No runs yet.</p>`}</section></div>`);
  });

  app.post('/automations/settings', (req, res) => {
    const a = int(req.body.quiet_start, { min: 0, max: 23 }), b = int(req.body.quiet_end, { min: 1, max: 24 });
    if (a != null && b != null && a < b) { model.setSetting(db, 'quiet_start', String(a)); model.setSetting(db, 'quiet_end', String(b)); } else req.flash('Quiet hours: start must be before end.', 'err');
    model.setSetting(db, 'digest_email', email(req.body.digest_email) || '');
    if (!req.session.flash) req.flash('Saved.'); res.redirect('/automations');
  });
  app.post('/automations/run/:job', async (req, res, next) => {
    try {
      const now = new Date(); let msg;
      switch (req.params.job) {
        case 'tick': { const r = await engine.tick(now); msg = `Reminders ${r.reminders}, sequence steps ${r.sequences}, sent ${r.sent}${r.digest ? ', digest built' : ''}.`; break; }
        case 'doc_reminders': msg = engine.processDocReminders(now) + ' reminder(s) queued.'; break;
        case 'nurture': msg = engine.processSequences(now) + ' sequence step(s) queued.'; break;
        case 'stale_deals': msg = engine.staleDeals(now).length + ' stale deal(s).'; break;
        case 'daily_digest': { const d = engine.digest(now); msg = d ? 'Digest built (see Alerts) and queued to the Outbox.' : 'Today\'s digest already exists (or the rule is off).'; break; }
        default: return res.status(404).send('Unknown job');
      }
      req.flash(msg); res.redirect('/automations');
    } catch (e) { next(e); }
  });
  app.post('/automations/templates/:id', (req, res, next) => {
    const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id); if (!t) return next();
    const body = text(req.body.body, 5000); if (!body) { req.flash('Body is required.', 'err'); return res.redirect('/automations#templates'); }
    db.prepare('UPDATE templates SET subject = ?, body = ? WHERE id = ?').run(t.channel === 'email' ? (str(req.body.subject, 200) || t.subject) : null, body, t.id);
    model.log(db, { action: 'template.updated', detail: 'Template ' + (t.code || t.id) + ' edited', user_id: req.user.id });
    req.flash('Template ' + (t.code || '') + ' saved.'); res.redirect('/automations#templates');
  });
  app.post('/notifications/read', (req, res) => { db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE read_at IS NULL").run(); res.redirect(backTo(req, '/automations')); });
  app.post('/automations/:key/toggle', (req, res, next) => {
    if (!engine.RULES[req.params.key]) return next(); const r = engine.rule(req.params.key);
    engine.saveRule(r.key, { enabled: !r.enabled, config: r.config });
    model.log(db, { action: 'automation.rule', detail: `${r.name} turned ${r.enabled ? 'off' : 'on'}`, user_id: req.user.id });
    req.flash(`${r.name}: ${r.enabled ? 'off' : 'on'}.`); res.redirect('/automations#rule-' + r.key);
  });
  app.post('/automations/:key', (req, res, next) => {
    if (!engine.RULES[req.params.key]) return next(); const r = engine.rule(req.params.key); const b = req.body; const c = r.config;
    const tplOk = (code, ch) => code && db.prepare('SELECT 1 FROM templates WHERE code = ? AND channel = ?').get(code, ch) ? code : '';
    if (r.key === 'stage_change') STAGES.forEach(st => { const k = st.replace(/\W+/g, '_');
      c.stages[st] = { email: tplOk(b['email_' + k], 'email'), sms: tplOk(b['sms_' + k], 'sms'), portal: bool(b['portal_' + k]) === 1, tasks: linesOf(b['tasks_' + k]), checklist: linesOf(b['checklist_' + k]) }; });
    if (r.key === 'intake_ack') Object.assign(c, { email: !!bool(b.email), sms: !!bool(b.sms), tasks: linesOf(b.tasks) });
    if (r.key === 'doc_reminders') Object.assign(c, { days: [...new Set(String(b.days || '').split(/[,\s]+/).map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= 60))].sort((x, y) => x - y).slice(0, 8), email: !!bool(b.email), sms: !!bool(b.sms) });
    if (r.key === 'nurture') Object.assign(c, { auto_enroll_intake: !!bool(b.auto_enroll_intake), intake_sequence: str(b.intake_sequence, 60) || c.intake_sequence });
    if (r.key === 'stale_deals') c.days = int(b.days, { min: 1, max: 365 }) || c.days;
    if (r.key === 'daily_digest') Object.assign(c, { hour: int(b.hour, { min: 0, max: 23 }) ?? c.hour, email: !!bool(b.email) });
    engine.saveRule(r.key, { enabled: r.enabled, config: c });
    model.log(db, { action: 'automation.rule', detail: `${r.name} settings saved`, user_id: req.user.id });
    req.flash(r.name + ' saved.'); res.redirect('/automations#rule-' + r.key);
  });
};
