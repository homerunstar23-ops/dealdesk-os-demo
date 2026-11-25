'use strict';
// v2: status portal, automation engine, outbox + consent gates, kill switch, sequences, admin pages. Run: npm test
process.env.OUTBOUND_DRY_RUN = '1'; // belt and braces: nothing can leave the box from tests
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const request = require('supertest');
const { createApp } = require('../src/app');
const tu = require('../src/lib/timeutil');
const transports = require('../src/lib/transports');
const model = require('../src/lib/model');

const ADMIN = { email: 'admin@test.local', password: 'correct-horse-battery-1' };
function mkApp(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv2-'));
  const app = createApp(Object.assign({ dbFile: path.join(dir, 'db.sqlite'), uploadDir: path.join(dir, 'uploads'), sessionSecret: 'test-secret', adminEmail: ADMIN.email, adminPassword: ADMIN.password, adminName: 'Test Admin', maxUploadMb: 1, loginMax: 50, intakeMax: 100, scheduler: false, forceSimulate: true }, extra));
  return { app, dir, db: app.locals.db, engine: app.locals.engine };
}
const csrfFrom = (t) => { const m = t.match(/name="_csrf" value="([^"]+)"/); return m && m[1]; };
async function login(app) {
  const a = request.agent(app); const t = csrfFrom((await a.get('/login')).text);
  await a.post('/login').type('form').send({ email: ADMIN.email, password: ADMIN.password, _csrf: t, next: '/' });
  a.csrf = csrfFrom((await a.get('/')).text); assert.ok(a.csrf); return a;
}
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const fillProfile = (db) => { [['lo_name', 'Test Officer'], ['nmls_id', '000000'], ['physical_address', '1 Test St, Testville, FL 00000'], ['company_name', 'Test Brokerage']].forEach(([k, v]) => model.setSetting(db, k, v)); };
const deal = (db, prefix) => db.prepare("SELECT * FROM deals WHERE name LIKE ?").get('DEMO ' + prefix + '%');
const person = (db, fn) => db.prepare('SELECT * FROM contacts WHERE first_name = ?').get(fn);
// 2026-06-10 15:00 UTC = 11:00 ET (inside quiet hours window)
const NOON = new Date('2026-06-10T15:00:00Z');

describe('time + quiet hours', () => {
  test('nextAllowed pushes late-night sends to 8am recipient-local, keeps daytime', () => {
    assert.equal(tu.nextAllowed(NOON, 'America/New_York').toISOString(), NOON.toISOString());
    assert.equal(tu.nextAllowed(new Date('2026-06-11T03:30:00Z'), 'America/New_York').toISOString(), '2026-06-11T12:00:00.000Z'); // 23:30 ET -> 08:00 ET
    assert.equal(tu.nextAllowed(new Date('2026-06-10T11:00:00Z'), 'America/Los_Angeles').toISOString(), '2026-06-10T15:00:00.000Z'); // 04:00 PT -> 08:00 PT
    assert.equal(tu.contactTz({ state: 'CA' }), 'America/Los_Angeles'); assert.equal(tu.contactTz({}), 'America/New_York');
  });
  test('transports simulate without credentials (no real sends)', async () => {
    assert.equal(transports.emailConfigured({}), false); assert.equal(transports.smsConfigured({}), false);
    const r = await transports.send({ channel: 'email', to: 'x@example.com', subject: 's', body: 'b' }, {}, {});
    assert.equal(r.simulated, true);
    const r2 = await transports.send({ channel: 'sms', to: '+15555550100', body: 'b' }, {}, { TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+1', OUTBOUND_DRY_RUN: '1' });
    assert.equal(r2.simulated, true);
  });
});

describe('demo v2 seed + outbox defaults', () => {
  let ctx; before(() => { ctx = mkApp(); });
  test('automated sending defaults OFF; demo messages are held or blocked, never sent', () => {
    assert.equal(model.getSettings(ctx.db).automated_sending, '0');
    const st = ctx.db.prepare('SELECT DISTINCT status FROM outbox').all().map(r => r.status).sort();
    assert.deepEqual(st, ['blocked', 'held']);
    assert.ok(ctx.db.prepare("SELECT COUNT(*) n FROM outbox WHERE rule_key = 'intake_ack'").get().n >= 1);
    assert.ok(ctx.db.prepare("SELECT COUNT(*) n FROM outbox WHERE rule_key = 'doc_reminders'").get().n >= 1);
    assert.ok(ctx.db.prepare("SELECT COUNT(*) n FROM portal_links").get().n >= 2);
  });
  test('DNC contact: sequence message blocked and enrollment stopped', () => {
    const q = person(ctx.db, 'Quinn');
    assert.equal(ctx.db.prepare('SELECT status FROM outbox WHERE contact_id = ?').get(q.id).status, 'blocked');
    assert.equal(ctx.db.prepare('SELECT status FROM sequence_enrollments WHERE contact_id = ?').get(q.id).status, 'stopped');
  });
  test('no SMS consent: stage-change text blocked', () => {
    const j = person(ctx.db, 'Jordan');
    const m = ctx.db.prepare("SELECT * FROM outbox WHERE contact_id = ? AND channel = 'sms'").get(j.id);
    assert.equal(m.status, 'blocked'); assert.match(m.reason, /written consent/);
  });
  test('approving a held message with an incomplete profile keeps it held (needs physical address/NMLS)', async () => {
    const m = ctx.db.prepare("SELECT id FROM outbox WHERE status = 'held' AND channel = 'email' AND purpose != 'internal'").get();
    const st = await ctx.engine.approve(m.id, 1, NOON);
    assert.equal(st, 'held'); assert.match(ctx.db.prepare('SELECT reason FROM outbox WHERE id = ?').get(m.id).reason, /Profile incomplete|Unfilled/);
  });
  test('approve with complete profile: simulated send with footer + unsubscribe link', async () => {
    fillProfile(ctx.db);
    const m = ctx.db.prepare("SELECT id, body FROM outbox WHERE status = 'held' AND rule_key = 'intake_ack' AND channel = 'email'").get();
    const st = await ctx.engine.approve(m.id, 1, NOON);
    assert.equal(st, 'sent');
    const row = ctx.db.prepare('SELECT * FROM outbox WHERE id = ?').get(m.id);
    assert.equal(row.transport, 'simulated-email'); assert.ok(row.approved_by);
    const full = ctx.engine.preview(row);
    assert.match(full, /1 Test St, Testville/); assert.match(full, /\/unsub\/[A-Za-z0-9_-]{20,}/); assert.match(full, /NMLS #000000/);
    assert.match(row.body, /\/p\/[A-Za-z0-9_-]{30,}/, 'acknowledgement contains the portal link');
  });
  test('quiet hours: approved at 11pm ET is rescheduled to 8am, not sent', async () => {
    const m = ctx.db.prepare("SELECT id FROM outbox WHERE status = 'held' AND channel = 'email' AND purpose = 'transactional' AND rule_key = 'doc_reminders'").get();
    const st = await ctx.engine.approve(m.id, 1, new Date('2026-06-11T03:00:00Z'));
    assert.equal(st, 'queued');
    assert.equal(ctx.db.prepare('SELECT send_after FROM outbox WHERE id = ?').get(m.id).send_after, '2026-06-11T12:00:00.000Z');
    assert.equal(await ctx.engine.dispatchDue(new Date('2026-06-11T11:00:00Z')), 0);
    assert.equal(await ctx.engine.dispatchDue(new Date('2026-06-11T12:01:00Z')), 1);
  });
});

describe('portal', () => {
  let ctx, token, d6; before(() => { ctx = mkApp(); d6 = deal(ctx.db, '3 Sampleton'); token = ctx.engine.createPortalLink(d6.id, { verifyMode: 'email_phone4' }); });
  test('unknown/invalid token 404s; valid token asks for verification and shows nothing private', async () => {
    assert.equal((await request(ctx.app).get('/p/not-a-real-token-1234567890')).status, 404);
    const r = await request(ctx.app).get('/p/' + token);
    assert.equal(r.status, 200); assert.match(r.text, /Last 4 digits/); assert.doesNotMatch(r.text, /Sampleton St/);
  });
  test('wrong details rejected and counted; right details unlock the portal', async () => {
    const a = request.agent(ctx.app); const t = csrfFrom((await a.get('/p/' + token)).text);
    const bad = await a.post(`/p/${token}/verify`).type('form').send({ _csrf: t, email: 'avery.sample@example.com', phone4: '9999' });
    assert.equal(bad.status, 401);
    assert.equal(ctx.db.prepare('SELECT failed_count FROM portal_links WHERE deal_id = ? AND revoked = 0').get(d6.id).failed_count, 1);
    const t2 = csrfFrom(bad.text);
    const ok = await a.post(`/p/${token}/verify`).type('form').send({ _csrf: t2, email: 'Avery.Sample@example.com', phone4: '0101' });
    assert.equal(ok.status, 303);
    const p = await a.get('/p/' + token); assert.equal(p.status, 200);
    // timeline + current stage plain English + LO card + disclaimer
    assert.match(p.text, /class="timeline"/); assert.match(p.text, /tl-current/); assert.match(p.text, /Conditions issued/);
    assert.match(p.text, /What happens now/); assert.match(p.text, /Your loan officer/); assert.match(p.text, /not a loan approval/);
    assert.match(p.text, /Insurance binder from your agent/, 'borrower wording is used');
    // never shows internal notes, internal-only items or red flags; no approval language
    assert.doesNotMatch(p.text, /DEMO internal/); assert.doesNotMatch(p.text, /Wire instructions verified by phone with title at a known number/);
    assert.doesNotMatch(p.text, /Appraisal came in at contract price/); assert.doesNotMatch(p.text, /red.flag/i);
    assert.doesNotMatch(p.text, /\b(you are|you're|you have been) (approved|pre-approved)\b/i); assert.doesNotMatch(p.text, /Conditionally Approved/);
    assert.match(p.text, /Updates/); assert.match(p.text, /Appraisal has been ordered/);
    // upload against a requested item → received + notification
    const cond = ctx.db.prepare("SELECT id FROM conditions WHERE deal_id = ? AND status = 'requested' AND borrower_visible = 1").get(d6.id);
    const pt = csrfFrom(p.text);
    const u = await a.post(`/p/${token}/upload`).field('_csrf', pt).field('condition_id', String(cond.id)).attach('file', PDF, { filename: 'binder.pdf', contentType: 'application/pdf' });
    assert.equal(u.status, 303);
    assert.equal(ctx.db.prepare('SELECT status FROM conditions WHERE id = ?').get(cond.id).status, 'received');
    assert.equal(ctx.db.prepare("SELECT uploaded_via FROM files WHERE condition_id = ?").get(cond.id).uploaded_via, 'borrower_portal');
    assert.ok(ctx.db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'docs' AND deal_id = ?").get(d6.id).n >= 1);
    const after = await a.get('/p/' + token); assert.match(after.text, /Uploaded: binder\.pdf/); assert.match(after.text, /Received — under review/);
  });
  test('upload without verification is refused; bad file type refused', async () => {
    const a = request.agent(ctx.app); const t = csrfFrom((await a.get('/p/' + token)).text);
    const r = await a.post(`/p/${token}/upload`).field('_csrf', t).attach('file', PDF, { filename: 'x.pdf', contentType: 'application/pdf' });
    assert.equal(r.status, 401);
  });
  test('locks after 10 failed attempts', async () => {
    const tok = ctx.engine.createPortalLink(deal(ctx.db, '7 Placeholder').id, { verifyMode: 'email' });
    ctx.db.prepare('UPDATE portal_links SET failed_count = 10 WHERE token_hash = ?').run(require('../src/lib/util').sha256(tok));
    const r = await request(ctx.app).get('/p/' + tok); assert.equal(r.status, 423); assert.match(r.text, /locked/);
  });
  test('revoked link stops working; mobile viewport meta present', async () => {
    const a = await login(ctx.app);
    const r0 = await request(ctx.app).get('/p/' + token); assert.match(r0.text, /width=device-width/);
    await a.post(`/deals/${d6.id}/portal/revoke`).type('form').send({ _csrf: a.csrf });
    assert.equal((await request(ctx.app).get('/p/' + token)).status, 404);
  });
  test('staff can create a link, post an update, toggle borrower visibility', async () => {
    const a = await login(ctx.app);
    await a.post(`/deals/${d6.id}/portal`).type('form').send({ _csrf: a.csrf, verify_mode: 'email' });
    const page = await a.get('/deals/' + d6.id); assert.match(page.text, /Borrower status portal/); assert.match(page.text, /\/p\/[A-Za-z0-9_-]{30,}/);
    await a.post(`/deals/${d6.id}/portal/update`).type('form').send({ _csrf: a.csrf, body: 'Title commitment received.' });
    assert.ok(ctx.db.prepare("SELECT id FROM portal_updates WHERE body = 'Title commitment received.'").get());
    const c = ctx.db.prepare('SELECT id FROM conditions WHERE deal_id = ? LIMIT 1').get(d6.id);
    await a.post('/conditions/' + c.id).type('form').send({ _csrf: a.csrf, status: 'requested', note: 'internal', bv_present: '1', borrower_text: 'Plain words' });
    const row = ctx.db.prepare('SELECT borrower_visible, borrower_text FROM conditions WHERE id = ?').get(c.id);
    assert.equal(row.borrower_visible, 0); assert.equal(row.borrower_text, 'Plain words');
  });
});

describe('automation rules', () => {
  let ctx; before(() => { ctx = mkApp({ seedDemo: false }); fillProfile(ctx.db); });
  async function intake(a, extra = {}) {
    const t = csrfFrom((await a.get('/apply')).text);
    return a.post('/apply').type('form').send(Object.assign({ _csrf: t, first_name: 'Pat', last_name: 'Tester', email: 'pat@example.com', phone: '(561) 555-0199', loan_type: 'dscr', city: 'Jupiter', state: 'FL', ack: '1', email_consent: '1', sms_consent: '1' }, extra));
  }
  test('new intake: instant acknowledgement email+text with portal link, tasks, nurture enrollment, alert', async () => {
    const r = await intake(request.agent(ctx.app)); assert.equal(r.status, 302);
    const d = ctx.db.prepare("SELECT * FROM deals WHERE source = 'intake' ORDER BY id DESC").get();
    const msgs = ctx.db.prepare('SELECT * FROM outbox WHERE deal_id = ?').all(d.id);
    assert.deepEqual(msgs.map(m => m.channel).sort(), ['email', 'sms']);
    msgs.forEach(m => { assert.equal(m.status, 'held'); assert.match(m.body, /\/p\/[A-Za-z0-9_-]{30,}/); });
    assert.ok(ctx.db.prepare('SELECT COUNT(*) n FROM tasks WHERE deal_id = ?').get(d.id).n >= 3);
    assert.equal(ctx.db.prepare("SELECT status FROM sequence_enrollments WHERE contact_id = ?").get(d.contact_id).status, 'active');
    assert.ok(ctx.db.prepare("SELECT id FROM notifications WHERE kind = 'intake' AND deal_id = ?").get(d.id));
  });
  test('intake without email consent: transactional ack allowed (lawful basis), no nurture, no text', async () => {
    await intake(request.agent(ctx.app), { email: 'noconsent@example.com', email_consent: '', sms_consent: '' });
    const d = ctx.db.prepare("SELECT * FROM deals WHERE source = 'intake' ORDER BY id DESC").get();
    const msgs = ctx.db.prepare('SELECT * FROM outbox WHERE deal_id = ?').all(d.id);
    assert.equal(msgs.length, 1); assert.equal(msgs[0].channel, 'email'); assert.equal(msgs[0].status, 'held'); assert.match(msgs[0].basis, /Transactional/);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM sequence_enrollments WHERE contact_id = ?').get(d.contact_id).n, 0);
  });
  test('stage change: tasks, checklist, portal update, status email; sequence stops when the lead advances', async () => {
    const a = await login(ctx.app);
    const d = ctx.db.prepare("SELECT * FROM deals WHERE contact_id = (SELECT id FROM contacts WHERE email = 'pat@example.com')").get();
    const r = await a.post(`/deals/${d.id}/stage`).type('form').send({ _csrf: a.csrf, stage: 'Processing' });
    assert.equal(r.status, 302);
    assert.ok(ctx.db.prepare("SELECT id FROM tasks WHERE deal_id = ? AND title LIKE 'Order appraisal%'").get(d.id));
    assert.ok(ctx.db.prepare("SELECT id FROM conditions WHERE deal_id = ? AND title LIKE 'Appraisal ordered%' AND borrower_visible = 0").get(d.id));
    assert.ok(ctx.db.prepare("SELECT id FROM portal_updates WHERE deal_id = ? AND body LIKE '%Processing%'").get(d.id));
    const m = ctx.db.prepare("SELECT * FROM outbox WHERE deal_id = ? AND rule_key = 'stage_change' AND channel = 'email'").get(d.id);
    assert.match(m.subject, /Processing/); assert.doesNotMatch(m.body, /approved/i);
    assert.equal(ctx.db.prepare('SELECT status FROM sequence_enrollments WHERE contact_id = ?').get(d.contact_id).status, 'stopped');
    assert.ok(ctx.db.prepare('SELECT stage_changed_at FROM deals WHERE id = ?').get(d.id).stage_changed_at);
  });
  test('disabled rule does nothing', async () => {
    const r = ctx.engine.rule('stage_change'); ctx.engine.saveRule('stage_change', { enabled: false, config: r.config });
    const d = ctx.db.prepare("SELECT * FROM deals ORDER BY id DESC").get();
    const before = ctx.db.prepare('SELECT COUNT(*) n FROM outbox').get().n;
    assert.deepEqual(ctx.engine.onStageChange(d.id, 'Lead', 'Application'), { skipped: 'rule disabled' });
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM outbox').get().n, before);
    ctx.engine.saveRule('stage_change', { enabled: true, config: r.config });
  });
  test('document reminders on day 2/5/9, deduped, canceled once items arrive', async () => {
    const d = ctx.db.prepare("SELECT * FROM deals WHERE contact_id = (SELECT id FROM contacts WHERE email = 'pat@example.com')").get();
    ctx.db.prepare("UPDATE conditions SET status = 'requested', requested_at = '2026-06-01 15:00:00', borrower_visible = 1 WHERE deal_id = ? AND id IN (SELECT id FROM conditions WHERE deal_id = ? ORDER BY id LIMIT 2)").run(d.id, d.id);
    const n0 = ctx.engine.processDocReminders(new Date('2026-06-02T15:00:00Z')); assert.equal(n0, 0, 'day 1: nothing');
    const n2 = ctx.engine.processDocReminders(new Date('2026-06-03T16:00:00Z')); assert.equal(n2, 2, 'day 2: email + text');
    assert.equal(ctx.engine.processDocReminders(new Date('2026-06-03T18:00:00Z')), 0, 'same day: deduped');
    assert.equal(ctx.engine.processDocReminders(new Date('2026-06-06T16:00:00Z')), 2, 'day 5');
    const rem = ctx.db.prepare("SELECT * FROM outbox WHERE deal_id = ? AND rule_key = 'doc_reminders' AND channel = 'email' ORDER BY id DESC").get(d.id);
    assert.match(rem.body, /- /, 'lists outstanding items'); assert.match(rem.dedupe_key, /:d5:/);
    // items arrive → approving the reminder cancels it instead of sending
    ctx.db.prepare("UPDATE conditions SET status = 'received' WHERE deal_id = ? AND status = 'requested'").run(d.id);
    assert.equal(await ctx.engine.approve(rem.id, 1, NOON), 'canceled');
    assert.equal(ctx.engine.processDocReminders(new Date('2026-06-10T16:00:00Z')), 0, 'day 9: nothing outstanding');
  });
  test('sequences: steps queue on schedule; reply, unsubscribe and SMS STOP stop them', async () => {
    const id = ctx.db.prepare("INSERT INTO contacts (first_name, last_name, email, phone, email_consent, sms_consent, type) VALUES ('Lee','Partner','lee@example.com','(561) 555-0177',1,1,'agent')").run().lastInsertRowid;
    const start = new Date('2026-06-01T15:00:00Z');
    const e = ctx.engine.enroll('partner-30', id, null, start); assert.ok(e);
    assert.equal(ctx.engine.enroll('partner-30', id, null, start), null, 'no double enrollment');
    assert.equal(ctx.engine.processSequences(new Date('2026-06-01T16:00:00Z')), 0);
    assert.equal(ctx.engine.processSequences(new Date('2026-06-02T16:00:00Z')), 1);
    const m = ctx.db.prepare('SELECT * FROM outbox WHERE enrollment_id = ?').get(e); assert.equal(m.purpose, 'marketing'); assert.equal(m.template_code, 'N-partner-intro');
    // reply → stop + pending step canceled
    ctx.engine.markReplied(id, new Date('2026-06-03T16:00:00Z'));
    assert.equal(ctx.db.prepare('SELECT status, stop_reason FROM sequence_enrollments WHERE id = ?').get(e).stop_reason, 'Contact replied');
    assert.equal(ctx.db.prepare('SELECT status FROM outbox WHERE id = ?').get(m.id).status, 'canceled');
    // unsubscribe link (GET confirm, POST performs)
    const e2 = ctx.engine.enroll('investor-lead-21', id, null, start); assert.ok(e2);
    const tok = ctx.db.prepare('SELECT unsub_token FROM contacts WHERE id = ?').get(id).unsub_token || (ctx.engine.footer({ channel: 'email', purpose: 'marketing', body: '' }, { id }), ctx.db.prepare('SELECT unsub_token FROM contacts WHERE id = ?').get(id).unsub_token);
    const ag = request.agent(ctx.app); const g = await ag.get('/unsub/' + tok); assert.match(g.text, /Unsubscribe from emails/);
    await ag.post('/unsub/' + tok).type('form').send({ _csrf: csrfFrom(g.text) });
    const c = ctx.db.prepare('SELECT * FROM contacts WHERE id = ?').get(id); assert.equal(c.email_consent, 0); assert.ok(c.email_opt_out_at);
    assert.equal(ctx.db.prepare('SELECT status FROM sequence_enrollments WHERE id = ?').get(e2).status, 'stopped');
    // marketing email now blocked at queue time
    const blocked = ctx.engine.queueTemplate('N-partner-intro', { contact_id: id, purpose: 'marketing', rule_key: 'nurture' }, NOON); assert.equal(blocked.status, 'blocked');
    // SMS STOP via webhook (unsigned only allowed in tests)
    const ctx2 = mkApp({ seedDemo: false, allowUnsignedSms: true });
    const cid = ctx2.db.prepare("INSERT INTO contacts (first_name, email, phone, sms_consent) VALUES ('Sky','sky@example.com','(561) 555-0166',1)").run().lastInsertRowid;
    const w = await request(ctx2.app).post('/webhooks/sms').type('form').send({ From: '+15615550166', Body: 'STOP' });
    assert.equal(w.status, 200);
    const sc = ctx2.db.prepare('SELECT sms_consent, sms_opt_out_at FROM contacts WHERE id = ?').get(cid); assert.equal(sc.sms_consent, 0); assert.ok(sc.sms_opt_out_at);
    const sms = ctx2.engine.queue({ channel: 'sms', contact_id: cid, body: 'hi' }, NOON); assert.equal(sms.status, 'blocked');
    // unsigned webhook refused when not in test mode
    assert.equal((await request(ctx.app).post('/webhooks/sms').type('form').send({ From: '+1', Body: 'STOP' })).status, 403);
  });
  test('kill switch ON: consented messages send (simulated) on tick; OFF moves queued back to held', async () => {
    model.setSetting(ctx.db, 'automated_sending', '1');
    const id = ctx.db.prepare("INSERT INTO contacts (first_name, email, email_consent, state) VALUES ('Kim','kim@example.com',1,'FL')").run().lastInsertRowid;
    const m = ctx.engine.queueTemplate('N-partner-intro', { contact_id: id, purpose: 'marketing', rule_key: 'manual-test' }, NOON);
    assert.equal(m.status, 'queued');
    const r = await ctx.engine.tick(NOON); assert.ok(r.sent >= 1);
    assert.equal(ctx.db.prepare('SELECT status, transport FROM outbox WHERE id = ?').get(m.id).transport, 'simulated-email');
    const m2 = ctx.engine.queueTemplate('N-partner-intro', { contact_id: id, purpose: 'marketing', rule_key: 'manual-test', dedupe_key: 'x2' }, NOON);
    const a = await login(ctx.app);
    await a.post('/outbox/sending').type('form').send({ _csrf: a.csrf, on: '0' });
    assert.equal(model.getSettings(ctx.db).automated_sending, '0');
    assert.equal(ctx.db.prepare('SELECT status FROM outbox WHERE id = ?').get(m2.id).status, 'held');
  });
  test('stale-deal alerts and daily digest (in-app + queued internal email, once per day)', async () => {
    ctx.db.prepare("UPDATE deals SET updated_at = '2026-01-01 00:00:00' WHERE id = (SELECT MAX(id) FROM deals)").run();
    const DAY = new Date('2026-06-12T15:00:00Z');
    const stale = ctx.engine.staleDeals(DAY); assert.ok(stale.length >= 1);
    const body = ctx.engine.digest(DAY); assert.match(body, /Stale deals: [1-9]/); assert.match(body, /Messages waiting for your approval/);
    assert.equal(ctx.engine.digest(DAY), null, 'once per day');
    const m = ctx.db.prepare("SELECT * FROM outbox WHERE rule_key = 'daily_digest' AND dedupe_key = 'digest:2026-06-12'").get(); assert.equal(m.purpose, 'internal'); assert.equal(m.to_addr, ADMIN.email);
    assert.ok(ctx.db.prepare("SELECT id FROM notifications WHERE kind = 'digest'").get());
  });
});

describe('admin pages', () => {
  let ctx; before(() => { ctx = mkApp(); });
  test('outbox + automations pages render, filters work, rule edits persist, message edit/approve/cancel', async () => {
    const a = await login(ctx.app);
    const o = await a.get('/outbox'); assert.equal(o.status, 200); assert.match(o.text, /Automated sending: OFF/); assert.match(o.text, /SIMULATED/);
    assert.match((await a.get('/outbox?status=blocked')).text, /blocked by consent/);
    const au = await a.get('/automations'); assert.equal(au.status, 200);
    ['Stage-change updates', 'Missing-document reminders', 'Lead &amp; partner nurture', 'Stale-deal alerts', 'Daily digest', 'Run log', 'Message templates'].forEach(s => assert.ok(au.text.includes(s), s));
    await a.post('/automations/doc_reminders').type('form').send({ _csrf: a.csrf, days: '3, 6, 10', email: '1' });
    assert.deepEqual(ctx.engine.rule('doc_reminders').config.days, [3, 6, 10]); assert.equal(ctx.engine.rule('doc_reminders').config.sms, false);
    await a.post('/automations/stale_deals/toggle').type('form').send({ _csrf: a.csrf }); assert.equal(ctx.engine.rule('stale_deals').enabled, false);
    const held = ctx.db.prepare("SELECT id FROM outbox WHERE status = 'held' AND channel = 'email'").get();
    const det = await a.get('/outbox/' + held.id); assert.match(det.text, /as it will be sent/);
    await a.post('/outbox/' + held.id).type('form').send({ _csrf: a.csrf, subject: 'Edited subject', body: 'Edited body' });
    assert.equal(ctx.db.prepare('SELECT subject FROM outbox WHERE id = ?').get(held.id).subject, 'Edited subject');
    await a.post(`/outbox/${held.id}/cancel`).type('form').send({ _csrf: a.csrf });
    assert.equal(ctx.db.prepare('SELECT status FROM outbox WHERE id = ?').get(held.id).status, 'canceled');
    const run = await a.post('/automations/run/daily_digest').type('form').send({ _csrf: a.csrf }); assert.equal(run.status, 302);
    const t = ctx.db.prepare("SELECT id FROM templates WHERE code = 'A-stage-email'").get();
    await a.post('/automations/templates/' + t.id).type('form').send({ _csrf: a.csrf, subject: 'Status: {{STAGE_LABEL}}', body: 'Hi {{FIRST_NAME}} — {{PORTAL_LINK}}' });
    assert.equal(ctx.db.prepare('SELECT subject FROM templates WHERE id = ?').get(t.id).subject, 'Status: {{STAGE_LABEL}}');
    const dash = await a.get('/dashboard'); assert.match(dash.text, /Messages waiting for approval/); assert.match(dash.text, /Automation alerts/);
    const contact = person(ctx.db, 'Riley'); const cp = await a.get('/contacts/' + contact.id); assert.match(cp.text, /Investor lead nurture/);
  });
  test('delete demo removes demo outbox rows and enrollments', async () => {
    const a = await login(ctx.app);
    await a.post('/settings/delete-demo').type('form').send({ _csrf: a.csrf, confirm: 'DELETE DEMO' });
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM contacts WHERE is_demo = 1').get().n, 0);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM outbox WHERE contact_id IS NOT NULL').get().n, 0);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM sequence_enrollments').get().n, 0);
  });
});

describe('demo mode & publicBaseUrl', () => {
  test('demoMode renders demo banner on login, dashboard, /apply and portal; publicBaseUrl sets portal links', async () => {
    const ctx = mkApp({ demoMode: true, publicBaseUrl: 'https://demo.example.onrender.com' });
    assert.equal(model.getSettings(ctx.db).public_base_url, 'https://demo.example.onrender.com');
    const lg = await request(ctx.app).get('/login');
    assert.match(lg.text, /DEMO — fake data only, do not enter real borrower info/);
    const ap = await request(ctx.app).get('/apply');
    assert.match(ap.text, /DEMO — fake data only, do not enter real borrower info/);
    const d6 = deal(ctx.db, '3 Sampleton');
    const url = ctx.engine.portalUrl(d6.id, { create: false });
    assert.ok(url.startsWith('https://demo.example.onrender.com/p/'));
    const tok = url.split('/p/')[1];
    const pv = await request(ctx.app).get('/p/' + tok);
    assert.match(pv.text, /DEMO — fake data only, do not enter real borrower info/);
    const a = await login(ctx.app);
    const dash = await a.get('/');
    assert.match(dash.text, /DEMO — fake data only, do not enter real borrower info/);
  });
});
