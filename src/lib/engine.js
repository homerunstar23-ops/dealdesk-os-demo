'use strict';
// DealDesk OS automation engine: rules, event hooks, scheduler tick, outbox with consent gates.
// Nothing leaves the app unless (a) "Automated sending" is ON or a person approves the message, AND
// (b) consent/DNC/profile checks pass at send time, AND (c) real transport credentials exist.
// Without credentials every "send" is simulated and logged.
const crypto = require('crypto');
const { STAGES, OPEN_STAGES, LOAN_TYPES } = require('../db');
const model = require('./model');
const stages = require('./stages');
const tu = require('./timeutil');
const { randomToken, sha256, money } = require('./util');
const transports = require('./transports');

const STAGE_DEFAULTS = {
  'Lead': { email: '', sms: '', portal: false, tasks: ['Qualify the scenario — 3 questions (F-1) | 0'], checklist: [] },
  'Application': { email: 'A-stage-email', sms: 'A-stage-sms', portal: true, tasks: ['Send document checklist + status-portal link | 0', 'Confirm business purpose and vesting entity | 1'], checklist: [] },
  'Processing': { email: 'A-stage-email', sms: 'A-stage-sms', portal: true, tasks: ['Order appraisal through the lender/AMC process | 1', 'Request title commitment and insurance quote | 1'], checklist: ['Appraisal ordered through lender/AMC (internal) | internal'] },
  'Underwriting': { email: 'A-stage-email', sms: 'A-stage-sms', portal: true, tasks: ['Submit file to underwriting with scenario summary | 0'], checklist: [] },
  'Conditionally Approved': { email: 'A-conditions-email', sms: 'A-stage-sms', portal: true, tasks: ['Request borrower conditions in the portal | 0', 'Review the conditions list with the borrower | 1'], checklist: ['Insurance binder with correct mortgagee clause and coverage amount | borrower'] },
  'Clear to Close': { email: 'A-ctc-email', sms: 'A-stage-sms', portal: true, tasks: ['Confirm closing date/time with title | 0', 'Verify wire instructions process with title by phone | 0'], checklist: ['Wire instructions verified by phone with title at a known number | internal'] },
  'Closed': { email: 'A-closed-email', sms: '', portal: true, tasks: ['30-day post-close check-in (no referral incentives) | 30'], checklist: [] },
  'Dead': { email: '', sms: '', portal: false, tasks: ['Send close-out note per company withdrawal/adverse-action process | 1'], checklist: [] }
};

const RULES = {
  stage_change: { name: 'Stage-change updates', trigger: 'Deal moves to a new stage', desc: 'Creates tasks, adds checklist items, posts a borrower-facing portal update and queues a status email/SMS for that stage.', defaults: { stages: STAGE_DEFAULTS } },
  intake_ack: { name: 'New intake acknowledgement', trigger: 'Public intake form submitted', desc: 'Creates the status-portal link, queues an instant acknowledgement email (and text if consented) with the portal link, and creates follow-up tasks.', defaults: { email: true, sms: true, tasks: ['Call/email new lead — 3 scenario questions (F-1) | 0', 'Follow up if no response (F-2) | 1'] } },
  doc_reminders: { name: 'Missing-document reminders', trigger: 'Scheduler (every few minutes)', desc: 'While borrower-visible items stay "requested", queues reminders on the configured days after the first request. Stops automatically once everything requested is received (pending reminders are canceled).', defaults: { days: [2, 5, 9], email: true, sms: true } },
  nurture: { name: 'Lead & partner nurture sequences', trigger: 'Enrollment + scheduler', desc: 'Sends multi-step educational email sequences. Auto-enrolls new intake leads who gave email consent. Stops on reply, stage change past Lead, unsubscribe/opt-out or DNC.', defaults: { auto_enroll_intake: true, intake_sequence: 'investor-lead-21' } },
  stale_deals: { name: 'Stale-deal alerts', trigger: 'Daily', desc: 'Flags open deals with no updates for N days: in-app alert + task for you.', defaults: { days: 7 } },
  daily_digest: { name: 'Daily digest for you', trigger: 'Daily at the set hour (ET)', desc: 'In-app digest of new intakes, tasks due/overdue, stale deals, documents received and messages waiting for approval, plus a queued digest email to you.', defaults: { hour: 7, email: true } }
};

function parseLine(l) { const [t, x] = String(l).split('|').map(s => s.trim()); return { title: t, extra: x || '' }; }
const nowIso = (now) => tu.iso(now || new Date());

function createEngine({ db, config }) {
  const key = crypto.createHash('sha256').update(String(config.sessionSecret) + ':portal-token').digest();
  const encrypt = (t) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const e = Buffer.concat([c.update(t, 'utf8'), c.final()]); return [iv, c.getAuthTag(), e].map(b => b.toString('base64url')).join('.'); };
  const decrypt = (s) => { try { const [iv, tag, e] = s.split('.').map(x => Buffer.from(x, 'base64url')); const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag); return Buffer.concat([d.update(e), d.final()]).toString('utf8'); } catch { return null; } };
  const settings = () => model.getSettings(db);
  const baseUrl = () => (settings().public_base_url || 'http://localhost:4100').replace(/\/$/, '');

  // ---- Rules config --------------------------------------------------------------------------------
  function rule(key) {
    const def = RULES[key]; const row = db.prepare('SELECT * FROM automation_rules WHERE key = ?').get(key);
    const cfg = JSON.parse(JSON.stringify(def.defaults)); const saved = row && row.config_json ? JSON.parse(row.config_json) : {};
    Object.assign(cfg, saved);
    if (key === 'stage_change') cfg.stages = Object.assign({}, def.defaults.stages, saved.stages || {});
    return { key, ...def, enabled: row ? !!row.enabled : true, config: cfg };
  }
  function saveRule(key, { enabled, config: cfg }) {
    db.prepare("INSERT INTO automation_rules (key, enabled, config_json, updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, config_json = excluded.config_json, updated_at = excluded.updated_at")
      .run(key, enabled ? 1 : 0, JSON.stringify(cfg));
  }
  const runLog = (ruleKey, summary, count = 0, now) => db.prepare('INSERT INTO automation_runs (rule_key, ran_at, summary, count) VALUES (?,?,?,?)').run(ruleKey, nowIso(now), summary, count);
  const notify = (kind, title, body, dealId, dedupe, now) => db.prepare('INSERT OR IGNORE INTO notifications (kind, title, body, deal_id, dedupe_key, created_at) VALUES (?,?,?,?,?,?)').run(kind, title, body, dealId || null, dedupe || null, nowIso(now)).changes;
  const sendingOn = () => settings().automated_sending === '1';

  // ---- Portal links ------------------------------------------------------------------------------------
  function createPortalLink(dealId, { verifyMode, userId } = {}) {
    const d = db.prepare('SELECT d.id, c.email, c.phone FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id WHERE d.id = ?').get(dealId);
    if (!d) return null;
    const mode = ['none', 'email', 'email_phone4'].includes(verifyMode) ? verifyMode : (d.phone && d.email ? 'email_phone4' : (d.email ? 'email' : 'none'));
    const token = randomToken(32);
    db.prepare('UPDATE portal_links SET revoked = 1 WHERE deal_id = ? AND revoked = 0').run(dealId); // one active link per deal
    db.prepare('INSERT INTO portal_links (deal_id, token_hash, token_enc, verify_mode, created_by) VALUES (?,?,?,?,?)').run(dealId, sha256(token), encrypt(token), mode, userId || null);
    model.log(db, { entity_type: 'deal', entity_id: dealId, action: 'portal.link_created', detail: `Status-portal link created (verification: ${mode})`, user_id: userId || null });
    return token;
  }
  function activePortal(dealId) { return db.prepare('SELECT * FROM portal_links WHERE deal_id = ? AND revoked = 0 ORDER BY id DESC').get(dealId); }
  function portalUrl(dealId, { create = true } = {}) {
    let l = activePortal(dealId); let tok = l && decrypt(l.token_enc);
    if (!tok && create) tok = createPortalLink(dealId);
    return tok ? `${baseUrl()}/p/${tok}` : null;
  }
  function postUpdate(dealId, body, { source = 'automation', ruleKey = null, userId = null } = {}) {
    db.prepare('INSERT INTO portal_updates (deal_id, body, source, rule_key, user_id) VALUES (?,?,?,?,?)').run(dealId, body, source, ruleKey, userId);
  }

  // ---- Outbox --------------------------------------------------------------------------------------------
  function ensureUnsubToken(contactId) {
    const c = db.prepare('SELECT unsub_token FROM contacts WHERE id = ?').get(contactId); if (!c) return null;
    if (c.unsub_token) return c.unsub_token;
    const t = randomToken(24); db.prepare('UPDATE contacts SET unsub_token = ? WHERE id = ?').run(t, contactId); return t;
  }
  // Consent / lawful-basis gate. Returns { ok, basis, reason }.
  function consentCheck(m, c, d) {
    if (m.purpose === 'internal') return { ok: true, basis: 'Internal message to the loan officer' };
    if (!c) return { ok: false, reason: 'No contact on file' };
    if (c.dnc) return { ok: false, reason: 'Contact is marked DO NOT CONTACT' };
    if (m.channel === 'sms') {
      if (!c.phone) return { ok: false, reason: 'No phone number' };
      if (c.sms_opt_out_at) return { ok: false, reason: 'Contact replied STOP / opted out of texts' };
      if (!c.sms_consent) return { ok: false, reason: 'No prior express written consent for texts on file' };
      return { ok: true, basis: 'Prior express written consent (SMS) ' + (c.sms_consent_at || '').slice(0, 10) };
    }
    if (!c.email) return { ok: false, reason: 'No email address' };
    if (c.email_opt_out_at) return { ok: false, reason: 'Contact unsubscribed from email' };
    if (c.email_consent) return { ok: true, basis: 'Email consent ' + (c.email_consent_at || '').slice(0, 10) };
    if (m.purpose === 'marketing') return { ok: false, reason: 'No email consent on file (required for nurture/marketing email)' };
    if (m.rule_key === 'intake_ack' || (d && !['Lead', 'Dead'].includes(d.stage))) return { ok: true, basis: 'Transactional: reply to the borrower\'s own inquiry / active application' };
    return { ok: false, reason: 'No email consent and no active application (no lawful basis)' };
  }
  function stageFields(dealId) {
    const d = db.prepare('SELECT stage FROM deals WHERE id = ?').get(dealId); if (!d) return {};
    const info = stages.STAGE_INFO[d.stage] || {}; const u = portalUrl(dealId, { create: false });
    return Object.assign({ STAGE_LABEL: info.label, STAGE_NOW: info.now, STAGE_NEED: info.need, STAGE_NEXT: info.next }, u ? { PORTAL_LINK: u } : {});
  }
  // Renders a template with merge fields (incl. portal + stage fields).
  function render(code, { dealId, contactId, extra = {} }) {
    const t = db.prepare('SELECT * FROM templates WHERE code = ?').get(code); if (!t) return null;
    const f = model.mergeFields(db, { dealId, contactId });
    if (dealId) {
      const d = db.prepare('SELECT stage FROM deals WHERE id = ?').get(dealId); const info = stages.STAGE_INFO[d.stage] || {};
      Object.assign(f, { STAGE_LABEL: info.label, STAGE_NOW: info.now, STAGE_NEED: info.need, STAGE_NEXT: info.next });
      if (/\{\{PORTAL_LINK\}\}/.test(t.body + (t.subject || ''))) { const u = portalUrl(dealId); if (u) f.PORTAL_LINK = u; }
    }
    Object.assign(f, extra);
    return { subject: t.subject ? model.applyMerge(t.subject, f) : null, body: model.applyMerge(t.body, f), channel: t.channel };
  }
  // Queues a message. Status: blocked (consent fails now) | held (sending OFF) | queued.
  function queue(m, now) {
    const c = m.contact_id ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(m.contact_id) : null;
    const d = m.deal_id ? db.prepare('SELECT * FROM deals WHERE id = ?').get(m.deal_id) : null;
    const to = m.to_addr || (c ? (m.channel === 'sms' ? c.phone : c.email) : null);
    const chk = consentCheck(m, c, d);
    const status = !chk.ok ? 'blocked' : (sendingOn() ? 'queued' : 'held');
    const reason = !chk.ok ? chk.reason : (status === 'held' ? 'Automated sending is OFF — review and approve to send' : null);
    const r = db.prepare(`INSERT OR IGNORE INTO outbox (channel, to_addr, contact_id, deal_id, enrollment_id, subject, body, purpose, basis, status, reason, rule_key, template_code, dedupe_key, send_after, created_at, updated_at)
      VALUES (@channel,@to,@contact_id,@deal_id,@enrollment_id,@subject,@body,@purpose,@basis,@status,@reason,@rule_key,@template_code,@dedupe_key,@send_after,@now,@now)`).run({
      channel: m.channel, to, contact_id: m.contact_id || null, deal_id: m.deal_id || null, enrollment_id: m.enrollment_id || null, subject: m.subject || null, body: m.body,
      purpose: m.purpose || 'transactional', basis: chk.basis || null, status, reason, rule_key: m.rule_key || null, template_code: m.template_code || null,
      dedupe_key: m.dedupe_key || null, send_after: nowIso(m.send_after || now), now: nowIso(now) });
    return r.changes ? db.prepare('SELECT * FROM outbox WHERE id = ?').get(r.lastInsertRowid) : null;
  }
  function queueTemplate(code, opts, now) {
    const r = render(code, { dealId: opts.deal_id, contactId: opts.contact_id, extra: opts.extra }); if (!r) return null;
    return queue(Object.assign({ channel: r.channel, subject: r.subject, body: r.body, template_code: code }, opts), now);
  }
  function footer(m, c) {
    const s = settings();
    if (m.channel === 'sms') return /\bSTOP\b/i.test(m.body) ? '' : ' Reply STOP to opt out.';
    if (m.purpose === 'internal') return '';
    const lines = ['', '--', [s.lo_name, s.lo_title, s.nmls_id && 'NMLS #' + s.nmls_id].filter(Boolean).join(' | '),
      s.company_name ? s.company_name + (s.company_nmls_id ? ' NMLS #' + s.company_nmls_id : '') : null, s.phone || null, s.state_disclosures || null, s.physical_address || null,
      c ? `Unsubscribe: ${baseUrl()}/unsub/${ensureUnsubToken(c.id)}` : null,
      'Educational information only — not a loan offer, approval, rate quote or commitment to lend.'];
    return lines.filter(x => x !== null).join('\n');
  }
  const preview = (m) => { const c = m.contact_id && db.prepare('SELECT * FROM contacts WHERE id = ?').get(m.contact_id); return m.body + footer(m, c); };
  const setStatus = (id, status, fields = {}, now) => {
    const cols = Object.keys(fields).map(k => `, ${k} = @${k}`).join('');
    db.prepare(`UPDATE outbox SET status = @status, updated_at = @now${cols} WHERE id = @id`).run(Object.assign({ id, status, now: nowIso(now) }, fields));
  };

  // Final checks + transport for one message. Returns the new status.
  async function sendOne(id, now = new Date(), { force = false } = {}) {
    const m = db.prepare('SELECT * FROM outbox WHERE id = ?').get(id); if (!m || !['queued'].includes(m.status)) return m && m.status;
    const c = m.contact_id ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(m.contact_id) : null;
    const d = m.deal_id ? db.prepare('SELECT * FROM deals WHERE id = ?').get(m.deal_id) : null;
    const s = settings();
    // stop conditions
    if (m.enrollment_id) { const e = db.prepare('SELECT status, stop_reason FROM sequence_enrollments WHERE id = ?').get(m.enrollment_id); if (!e || e.status === 'stopped') { setStatus(id, 'canceled', { reason: 'Sequence stopped: ' + ((e && e.stop_reason) || 'unenrolled') }, now); return 'canceled'; } }
    if (m.rule_key === 'doc_reminders' && d) { const n = db.prepare("SELECT COUNT(*) n FROM conditions WHERE deal_id = ? AND borrower_visible = 1 AND status = 'requested'").get(d.id).n; if (!n) { setStatus(id, 'canceled', { reason: 'Requested items were received — reminder no longer needed' }, now); return 'canceled'; } }
    const chk = consentCheck(m, c, d); if (!chk.ok) { setStatus(id, 'blocked', { reason: chk.reason }, now); return 'blocked'; }
    let left = ((m.subject || '') + m.body).match(/\{\{[A-Z_/a-z .-]+\}\}/g);
    if (left) { // fill placeholders that can be resolved now (e.g. profile completed after the message was queued); keeps manual edits
      const f = Object.assign(model.mergeFields(db, { dealId: m.deal_id, contactId: m.contact_id }), m.deal_id ? stageFields(m.deal_id) : {});
      const subj = m.subject ? model.applyMerge(m.subject, f) : m.subject, body = model.applyMerge(m.body, f);
      db.prepare('UPDATE outbox SET subject = ?, body = ? WHERE id = ?').run(subj, body, id); m.subject = subj; m.body = body;
      left = ((m.subject || '') + m.body).match(/\{\{[A-Z_/a-z .-]+\}\}/g);
    }
    if (left) { setStatus(id, 'held', { reason: 'Unfilled merge fields: ' + [...new Set(left)].join(' ') + ' — edit or complete your profile, then approve' }, now); return 'held'; }
    if (m.channel === 'email' && m.purpose !== 'internal' && (!s.physical_address || !s.lo_name || !s.nmls_id)) { setStatus(id, 'held', { reason: 'Profile incomplete: name, NMLS # and physical mailing address are required in every email (Settings)' }, now); return 'held'; }
    if (!m.to_addr) { setStatus(id, 'blocked', { reason: 'No recipient address' }, now); return 'blocked'; }
    if (!force && m.purpose !== 'internal') {
      const start = Number(s.quiet_start || 8), end = Number(s.quiet_end || 21);
      const ok = tu.nextAllowed(now, tu.contactTz(c), start, end);
      if (ok.getTime() > now.getTime()) { setStatus(id, 'queued', { send_after: tu.iso(ok), reason: `Quiet hours — scheduled for ${start}:00 recipient local time` }, now); return 'queued'; }
    }
    try {
      const fullBody = m.body + footer(m, c);
      const unsub = c && m.channel === 'email' && m.purpose !== 'internal' ? `${baseUrl()}/unsub/${ensureUnsubToken(c.id)}` : null;
      const res = await transports.send({ channel: m.channel, to: m.to_addr, subject: m.subject, body: fullBody, unsubscribeUrl: unsub }, config);
      setStatus(id, 'sent', { sent_at: nowIso(now), transport: res.transport, provider_id: res.id || null, reason: res.simulated ? 'Simulated — no ' + (m.channel === 'sms' ? 'Twilio' : 'SMTP') + ' credentials configured; nothing left the app' : null, error: null }, now);
      model.log(db, { entity_type: d ? 'deal' : 'contact', entity_id: d ? d.id : (c && c.id), action: 'outbox.sent', detail: `${m.channel.toUpperCase()} ${res.simulated ? '(simulated) ' : ''}sent: ${m.subject || m.body.slice(0, 60)}` });
      return 'sent';
    } catch (e) { setStatus(id, 'failed', { error: String(e.message).slice(0, 500), reason: 'Transport error' }, now); return 'failed'; }
  }
  async function dispatchDue(now = new Date()) {
    const due = db.prepare("SELECT id FROM outbox WHERE status = 'queued' AND (send_after IS NULL OR send_after <= ?) ORDER BY id LIMIT 200").all(nowIso(now));
    let sent = 0; for (const r of due) if ((await sendOne(r.id, now)) === 'sent') sent++;
    return sent;
  }
  async function approve(id, userId, now = new Date()) {
    const m = db.prepare('SELECT * FROM outbox WHERE id = ?').get(id); if (!m || !['held', 'failed'].includes(m.status)) return m && m.status;
    db.prepare("UPDATE outbox SET status = 'queued', reason = NULL, approved_by = ?, updated_at = ? WHERE id = ?").run(userId || null, nowIso(now), id);
    return sendOne(id, now);
  }

  // ---- Events ------------------------------------------------------------------------------------------------
  function addTasks(lines, { dealId, contactId }, now) {
    const owner = db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1").get();
    let n = 0; (lines || []).forEach(l => { const { title, extra } = parseLine(l); if (!title) return; const off = Number(extra) || 0;
      const due = tu.localDate(tu.addDays(now || new Date(), off));
      db.prepare('INSERT INTO tasks (title, due_date, deal_id, contact_id, assigned_to) VALUES (?,?,?,?,?)').run(title, due, dealId || null, contactId || null, owner && owner.id); n++; });
    return n;
  }
  function onStageChange(dealId, from, to, { userId = null, now = new Date() } = {}) {
    db.prepare('UPDATE deals SET stage_changed_at = ? WHERE id = ?').run(nowIso(now), dealId);
    const d = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId); if (!d) return null;
    // Sequences: stop investor nurture once the deal moves past Lead
    if (to !== 'Lead') stopEnrollments({ dealId, contactId: null, reason: `Deal moved to ${to}` }, now);
    const r = rule('stage_change'); if (!r.enabled) return { skipped: 'rule disabled' };
    const cfg = r.config.stages[to] || {}; const out = { tasks: 0, checklist: 0, messages: [] };
    out.tasks = addTasks(cfg.tasks, { dealId, contactId: d.contact_id }, now);
    (cfg.checklist || []).forEach(l => { const { title, extra } = parseLine(l); if (!title) return;
      if (db.prepare('SELECT id FROM conditions WHERE deal_id = ? AND title = ?').get(dealId, title)) return;
      db.prepare("INSERT INTO conditions (deal_id, kind, category, title, status, requested_at, borrower_visible, sort) VALUES (?, 'condition', 'Added by automation', ?, ?, ?, ?, 900)")
        .run(dealId, title, extra === 'internal' ? 'open' : 'requested', extra === 'internal' ? null : nowIso(now).replace('T', ' ').slice(0, 19), extra === 'internal' ? 0 : 1); out.checklist++; });
    if (cfg.portal) { const info = stages.STAGE_INFO[to]; postUpdate(dealId, `Your file moved to "${info.label}". ${info.now}`, { ruleKey: 'stage_change' }); }
    const key = `stage:${dealId}:${to}:${tu.localDate(now)}`;
    if (d.contact_id && cfg.email) { const m = queueTemplate(cfg.email, { deal_id: dealId, contact_id: d.contact_id, rule_key: 'stage_change', dedupe_key: key + ':email' }, now); if (m) out.messages.push(m); }
    if (d.contact_id && cfg.sms) { const m = queueTemplate(cfg.sms, { deal_id: dealId, contact_id: d.contact_id, rule_key: 'stage_change', dedupe_key: key + ':sms' }, now); if (m) out.messages.push(m); }
    runLog('stage_change', `Deal #${dealId}: ${from} → ${to}: ${out.tasks} task(s), ${out.checklist} checklist item(s), ${out.messages.length} message(s) ${out.messages.map(m => m.status).join('/')}`, out.tasks + out.checklist + out.messages.length, now);
    return out;
  }
  function onIntake(dealId, { now = new Date() } = {}) {
    const d = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId); if (!d) return null;
    const r = rule('intake_ack'); const out = { messages: [], enrolled: false };
    portalUrl(dealId); // ensure a portal link exists
    if (r.enabled) {
      addTasks(r.config.tasks, { dealId, contactId: d.contact_id }, now);
      if (r.config.email) { const m = queueTemplate('A-intake-ack-email', { deal_id: dealId, contact_id: d.contact_id, rule_key: 'intake_ack', dedupe_key: `intake:${dealId}:email` }, now); if (m) out.messages.push(m); }
      if (r.config.sms) { const c = db.prepare('SELECT sms_consent FROM contacts WHERE id = ?').get(d.contact_id); if (c && c.sms_consent) { const m = queueTemplate('A-intake-ack-sms', { deal_id: dealId, contact_id: d.contact_id, rule_key: 'intake_ack', dedupe_key: `intake:${dealId}:sms` }, now); if (m) out.messages.push(m); } }
      postUpdate(dealId, 'We received your scenario. A licensed loan officer will review it and follow up.', { ruleKey: 'intake_ack' });
    }
    const n = rule('nurture');
    if (n.enabled && n.config.auto_enroll_intake) { const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(d.contact_id); if (c && c.email_consent && !c.dnc) out.enrolled = !!enroll(n.config.intake_sequence, c.id, dealId, now); }
    notify('intake', 'New intake: ' + d.name, `${LOAN_TYPES[d.loan_type]} · ${money(d.loan_amount)} requested`, dealId, `intake:${dealId}`, now);
    runLog('intake_ack', `Deal #${dealId}: acknowledgement ${out.messages.map(m => m.channel + ' ' + m.status).join(', ') || 'none'}${out.enrolled ? '; enrolled in nurture' : ''}`, out.messages.length, now);
    return out;
  }
  function onDocReceived(dealId, fileName, { now = new Date(), via = 'borrower' } = {}) {
    notify('docs', `Document received (${via}): ${fileName}`, null, dealId, null, now);
  }

  // ---- Sequences ------------------------------------------------------------------------------------------
  function enroll(seqKey, contactId, dealId, now = new Date()) {
    const s = db.prepare('SELECT * FROM sequences WHERE (key = ? OR id = ?) AND active = 1').get(seqKey, Number(seqKey) || -1); if (!s) return null;
    if (db.prepare("SELECT id FROM sequence_enrollments WHERE sequence_id = ? AND contact_id = ? AND status = 'active'").get(s.id, contactId)) return null;
    const steps = JSON.parse(s.steps_json);
    const r = db.prepare("INSERT INTO sequence_enrollments (sequence_id, contact_id, deal_id, step, next_at, status, enrolled_at, updated_at) VALUES (?,?,?,0,?, 'active', ?, ?)").run(s.id, contactId, dealId || null, tu.iso(tu.addDays(now, steps[0] ? steps[0].day : 0)), nowIso(now), nowIso(now));
    model.log(db, { entity_type: 'contact', entity_id: contactId, action: 'sequence.enrolled', detail: 'Enrolled in ' + s.name });
    return r.lastInsertRowid;
  }
  function stopEnrollments({ contactId, dealId, enrollmentId, reason }, now = new Date()) {
    let sql = "UPDATE sequence_enrollments SET status = 'stopped', stop_reason = ?, updated_at = ? WHERE status = 'active' AND "; const p = [reason, nowIso(now)];
    if (enrollmentId) { sql += 'id = ?'; p.push(enrollmentId); } else if (dealId) { sql += 'deal_id = ?'; p.push(dealId); } else { sql += 'contact_id = ?'; p.push(contactId); }
    const n = db.prepare(sql).run(...p).changes;
    // cancel anything already queued/held for those enrollments
    db.prepare("UPDATE outbox SET status = 'canceled', reason = ?, updated_at = ? WHERE status IN ('queued','held') AND enrollment_id IN (SELECT id FROM sequence_enrollments WHERE status = 'stopped')").run('Sequence stopped: ' + reason, nowIso(now));
    return n;
  }
  function processSequences(now = new Date()) {
    if (!rule('nurture').enabled) return 0;
    const due = db.prepare("SELECT e.*, s.steps_json, s.name seq_name FROM sequence_enrollments e JOIN sequences s ON s.id = e.sequence_id WHERE e.status = 'active' AND e.next_at <= ?").all(nowIso(now));
    let n = 0;
    for (const e of due) {
      const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(e.contact_id);
      const d = e.deal_id && db.prepare('SELECT stage FROM deals WHERE id = ?').get(e.deal_id);
      if (!c) { stopEnrollments({ enrollmentId: e.id, reason: 'Contact deleted' }, now); continue; }
      // DNC / unsubscribe / no consent: the queued message is recorded as blocked and the enrollment stops (below).
      if (c.replied_at && c.replied_at >= e.enrolled_at.replace('T', ' ').slice(0, 19)) { stopEnrollments({ enrollmentId: e.id, reason: 'Contact replied' }, now); continue; }
      if (d && d.stage !== 'Lead') { stopEnrollments({ enrollmentId: e.id, reason: 'Deal moved to ' + d.stage }, now); continue; }
      const steps = JSON.parse(e.steps_json); const st = steps[e.step];
      if (!st) { db.prepare("UPDATE sequence_enrollments SET status = 'completed', updated_at = ? WHERE id = ?").run(nowIso(now), e.id); continue; }
      const m = queueTemplate(st.template, { deal_id: e.deal_id, contact_id: e.contact_id, enrollment_id: e.id, purpose: 'marketing', rule_key: 'nurture', dedupe_key: `seq:${e.id}:${e.step}` }, now);
      if (m && m.status === 'blocked') { stopEnrollments({ enrollmentId: e.id, reason: m.reason }, now); continue; }
      const next = steps[e.step + 1];
      db.prepare('UPDATE sequence_enrollments SET step = step + 1, next_at = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(next ? tu.iso(tu.addDays(tu.parseTs(e.enrolled_at), next.day)) : null, next ? 'active' : 'completed', nowIso(now), e.id);
      if (m) n++;
    }
    if (n) runLog('nurture', `${n} sequence email(s) queued`, n, now);
    return n;
  }
  function markReplied(contactId, now = new Date()) {
    db.prepare("UPDATE contacts SET replied_at = ? WHERE id = ?").run(nowIso(now).replace('T', ' ').slice(0, 19), contactId);
    return stopEnrollments({ contactId, reason: 'Contact replied' }, now);
  }
  function unsubscribe(contactId, now = new Date()) {
    db.prepare("UPDATE contacts SET email_consent = 0, email_opt_out_at = ?, updated_at = datetime('now') WHERE id = ?").run(nowIso(now), contactId);
    stopEnrollments({ contactId, reason: 'Unsubscribed' }, now);
    db.prepare("UPDATE outbox SET status = 'blocked', reason = 'Contact unsubscribed from email', updated_at = ? WHERE contact_id = ? AND channel = 'email' AND status IN ('queued','held')").run(nowIso(now), contactId);
    model.log(db, { entity_type: 'contact', entity_id: contactId, action: 'email.unsubscribed', detail: 'Unsubscribed from email via link' });
  }
  function smsStop(contactId, now = new Date()) {
    db.prepare("UPDATE contacts SET sms_consent = 0, sms_opt_out_at = ?, updated_at = datetime('now') WHERE id = ?").run(nowIso(now), contactId);
    db.prepare("UPDATE outbox SET status = 'blocked', reason = 'Contact replied STOP', updated_at = ? WHERE contact_id = ? AND channel = 'sms' AND status IN ('queued','held')").run(nowIso(now), contactId);
    model.log(db, { entity_type: 'contact', entity_id: contactId, action: 'sms.stop', detail: 'Replied STOP — texts disabled' });
  }

  // ---- Scheduled jobs ---------------------------------------------------------------------------------------
  function processDocReminders(now = new Date()) {
    const r = rule('doc_reminders'); if (!r.enabled) return 0;
    const days = (r.config.days || []).map(Number).filter(n => n > 0).sort((a, b) => a - b);
    const rows = db.prepare(`SELECT d.id, d.contact_id, MIN(c.requested_at) first_req, COUNT(*) n FROM deals d JOIN conditions c ON c.deal_id = d.id
      WHERE d.stage IN (${OPEN_STAGES.map(() => '?').join(',')}) AND c.borrower_visible = 1 AND c.status = 'requested' AND c.requested_at IS NOT NULL AND d.contact_id IS NOT NULL GROUP BY d.id`).all(...OPEN_STAGES);
    let n = 0;
    for (const row of rows) {
      const anchor = tu.parseTs(row.first_req); const elapsed = (now - anchor) / 864e5;
      const day = days.filter(x => elapsed >= x).pop(); if (!day) continue; // most recent milestone only (no back-fill bursts)
      const base = `docrem:${row.id}:${row.first_req.slice(0, 10)}:d${day}`;
      if (r.config.email && queueTemplate('A-docs-reminder-email', { deal_id: row.id, contact_id: row.contact_id, rule_key: 'doc_reminders', dedupe_key: base + ':email' }, now)) n++;
      if (r.config.sms) { const c = db.prepare('SELECT sms_consent FROM contacts WHERE id = ?').get(row.contact_id); if (c && c.sms_consent && queueTemplate('A-docs-reminder-sms', { deal_id: row.id, contact_id: row.contact_id, rule_key: 'doc_reminders', dedupe_key: base + ':sms' }, now)) n++; }
    }
    if (n) runLog('doc_reminders', `${n} reminder(s) queued`, n, now);
    return n;
  }
  function staleDeals(now = new Date()) {
    const r = rule('stale_deals'); if (!r.enabled) return [];
    const cutoff = tu.iso(tu.addDays(now, -Number(r.config.days || 7))).replace('T', ' ').slice(0, 19);
    const rows = db.prepare(`SELECT id, name, stage, updated_at FROM deals WHERE stage IN (${OPEN_STAGES.map(() => '?').join(',')}) AND COALESCE(updated_at, created_at) < ?`).all(...OPEN_STAGES, cutoff);
    const week = tu.localDate(now).slice(0, 8) + String(Math.ceil(Number(tu.localDate(now).slice(8)) / 7));
    let n = 0;
    rows.forEach(d => { if (notify('stale', `Stale deal: ${d.name}`, `${d.stage} · no updates for ${r.config.days}+ days`, d.id, `stale:${d.id}:${week}`, now)) { addTasks([`Check stale deal: ${d.name} | 0`], { dealId: d.id }, now); n++; } });
    runLog('stale_deals', `${rows.length} stale deal(s); ${n} new alert(s)`, n, now);
    return rows;
  }
  function digest(now = new Date()) {
    const r = rule('daily_digest'); if (!r.enabled) return null;
    const today = tu.localDate(now); const since = tu.iso(tu.addDays(now, -1)).replace('T', ' ').slice(0, 19);
    const stale = staleDeals(now);
    const intakes = db.prepare("SELECT name FROM deals WHERE source = 'intake' AND created_at >= ?").all(since);
    const overdue = db.prepare('SELECT COUNT(*) n FROM tasks WHERE done = 0 AND due_date < ?').get(today).n;
    const dueToday = db.prepare('SELECT COUNT(*) n FROM tasks WHERE done = 0 AND due_date = ?').get(today).n;
    const docs = db.prepare('SELECT COUNT(*) n FROM files WHERE created_at >= ?').get(since).n;
    const held = db.prepare("SELECT COUNT(*) n FROM outbox WHERE status = 'held'").get().n;
    const blocked = db.prepare("SELECT COUNT(*) n FROM outbox WHERE status = 'blocked' AND updated_at >= ?").get(tu.iso(tu.addDays(now, -1))).n;
    const lines = [`DealDesk daily digest — ${today}`, '', `New intakes (24h): ${intakes.length}${intakes.length ? ' — ' + intakes.map(i => i.name).join('; ') : ''}`,
      `Tasks overdue: ${overdue} · due today: ${dueToday}`, `Stale deals: ${stale.length}${stale.length ? ' — ' + stale.map(s => s.name).join('; ') : ''}`,
      `Documents received (24h): ${docs}`, `Messages waiting for your approval: ${held}`, `Messages blocked by consent rules (24h): ${blocked}`, '', `Open DealDesk: ${baseUrl()}/`];
    const body = lines.join('\n');
    const created = notify('digest', `Daily digest — ${today}`, body, null, `digest:${today}`, now);
    if (created && r.config.email) {
      const to = settings().digest_email || (db.prepare("SELECT email FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get() || {}).email;
      const t = render('A-daily-digest', { extra: { DIGEST_BODY: body } });
      queue({ channel: 'email', to_addr: to, subject: t.subject, body: t.body, purpose: 'internal', rule_key: 'daily_digest', template_code: 'A-daily-digest', dedupe_key: `digest:${today}` }, now);
    }
    if (created) runLog('daily_digest', `Digest for ${today}: ${intakes.length} intake(s), ${overdue} overdue task(s), ${stale.length} stale, ${held} held`, 1, now);
    return created ? body : null;
  }
  async function tick(now = new Date()) {
    const out = { reminders: processDocReminders(now), sequences: processSequences(now), digest: null, sent: 0 };
    const r = rule('daily_digest'); const last = settings().last_digest_date;
    if (tu.localHour(now) >= Number(r.config.hour || 7) && last !== tu.localDate(now)) { out.digest = digest(now); model.setSetting(db, 'last_digest_date', tu.localDate(now)); }
    out.sent = await dispatchDue(now);
    return out;
  }
  let task = null;
  function start() {
    if (task || config.scheduler === false) return;
    const cron = require('node-cron');
    task = cron.schedule('* * * * *', () => { tick(new Date()).catch(e => console.error('automation tick failed', e)); });
  }
  function stop() { if (task) { task.stop(); task = null; } }

  return { RULES, rule, saveRule, runLog, notify, createPortalLink, activePortal, portalUrl, decrypt, postUpdate, consentCheck, render, queue, queueTemplate, preview, sendOne, dispatchDue, approve,
    onStageChange, onIntake, onDocReceived, enroll, stopEnrollments, processSequences, markReplied, unsubscribe, smsStop, processDocReminders, staleDeals, digest, tick, start, stop, sendingOn, footer };
}
module.exports = { createEngine, RULES, STAGE_DEFAULTS };
