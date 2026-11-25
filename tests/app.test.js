'use strict';
// End-to-end API tests for every DealDesk OS module. Run: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const request = require('supertest');
const { createApp } = require('../src/app');
const C = require('../src/lib/calc');
const ref = require('../src/reference');
const stripe = require('../src/lib/stripe');

const ADMIN = { email: 'admin@test.local', password: 'correct-horse-battery-1' };
function mkApp(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddtest-'));
  const app = createApp(Object.assign({ dbFile: path.join(dir, 'db.sqlite'), uploadDir: path.join(dir, 'uploads'), sessionSecret: 'test-secret', adminEmail: ADMIN.email, adminPassword: ADMIN.password, adminName: 'Test Admin', maxUploadMb: 1, loginMax: 50, intakeMax: 100, stripeKey: '', scheduler: false, forceSimulate: true }, extra));
  return { app, dir, db: app.locals.db };
}
const csrfFrom = (text) => { const m = text.match(/name="_csrf" value="([^"]+)"/); return m && m[1]; };
async function login(app) {
  const agent = request.agent(app);
  const r = await agent.get('/login'); const t = csrfFrom(r.text);
  const p = await agent.post('/login').type('form').send({ email: ADMIN.email, password: ADMIN.password, _csrf: t, next: '/' });
  assert.equal(p.status, 302); assert.equal(p.headers.location, '/');
  const d = await agent.get('/'); agent.csrf = csrfFrom(d.text); assert.ok(agent.csrf);
  return agent;
}
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

describe('auth & security', () => {
  let ctx; before(() => { ctx = mkApp(); });
  test('health + unauthenticated redirect', async () => {
    assert.equal((await request(ctx.app).get('/healthz')).body.ok, true);
    const r = await request(ctx.app).get('/pipeline'); assert.equal(r.status, 302); assert.match(r.headers.location, /^\/login\?next=/);
  });
  test('security headers', async () => {
    const r = await request(ctx.app).get('/login');
    assert.match(r.headers['content-security-policy'], /script-src 'self'/); assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff'); assert.equal(r.headers['x-powered-by'], undefined); assert.equal(r.headers['cache-control'], 'no-store');
  });
  test('wrong password rejected, right password accepted, password stored as bcrypt', async () => {
    const a = request.agent(ctx.app); const t = csrfFrom((await a.get('/login')).text);
    assert.equal((await a.post('/login').type('form').send({ email: ADMIN.email, password: 'nope-nope-nope', _csrf: t })).status, 401);
    await login(ctx.app);
    assert.match(ctx.db.prepare('SELECT password_hash FROM users').get().password_hash, /^\$2[aby]\$12\$/);
  });
  test('CSRF token required on POST', async () => {
    const a = await login(ctx.app);
    assert.equal((await a.post('/contacts').type('form').send({ first_name: 'X' })).status, 403);
    assert.equal((await a.post('/contacts').type('form').send({ first_name: 'X', _csrf: 'wrong-token-wrong-token-wrong-tok' })).status, 403);
  });
  test('login is rate-limited', async () => {
    const c2 = mkApp({ loginMax: 3 }); const a = request.agent(c2.app); const t = csrfFrom((await a.get('/login')).text);
    for (let i = 0; i < 3; i++) await a.post('/login').type('form').send({ email: ADMIN.email, password: 'bad-bad-bad-bad', _csrf: t });
    assert.equal((await a.post('/login').type('form').send({ email: ADMIN.email, password: ADMIN.password, _csrf: t })).status, 429);
  });
  test('open redirect blocked after login', async () => {
    const a = request.agent(ctx.app); const t = csrfFrom((await a.get('/login')).text);
    const p = await a.post('/login').type('form').send({ email: ADMIN.email, password: ADMIN.password, _csrf: t, next: '//evil.example' });
    assert.equal(p.headers.location, '/');
  });
  test('logout ends session', async () => {
    const a = await login(ctx.app); await a.post('/logout').type('form').send({ _csrf: a.csrf });
    assert.equal((await a.get('/')).status, 302);
  });
});

describe('modules', () => {
  let ctx, a; before(async () => { ctx = mkApp(); a = await login(ctx.app); });
  const post = (url, data) => a.post(url).type('form').send(Object.assign({ _csrf: a.csrf }, data));

  test('dashboard: pipeline by stage, tasks, intakes, conditions, unpaid (demo data, labeled DEMO)', async () => {
    const r = await a.get('/'); assert.equal(r.status, 200);
    for (const s of ['Open pipeline', 'Tasks overdue / due today', 'New intakes to review', 'Outstanding conditions', 'Unpaid fee requests', 'Conditionally Approved', 'Clear to Close']) assert.ok(r.text.includes(s), s);
    assert.ok(r.text.includes('DEMO')); assert.ok(ctx.db.prepare('SELECT COUNT(*) n FROM deals WHERE is_demo = 1').get().n >= 9);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM contacts WHERE is_demo = 1 AND email NOT LIKE '%@example.com'").get().n, 0);
  });

  test('CRM: contact with consent + DNC, edit logs consent changes, SSN-like text redacted', async () => {
    let r = await post('/contacts', { type: 'agent', first_name: 'Pat', last_name: 'Tester', email: 'pat@example.com', phone: '(561) 555-0199', lead_source: 'Referral', tags: 'Partner, Agent', email_consent: '1', consent_method: 'Signed form' });
    assert.equal(r.status, 302); const id = Number(r.headers.location.split('/').pop());
    assert.ok((await a.get('/contacts?tag=partner')).text.includes('Pat Tester'));
    let c = ctx.db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    assert.equal(c.email_consent, 1); assert.ok(c.email_consent_at); assert.equal(c.sms_consent, 0); assert.equal(c.tags, 'partner,agent');
    r = await post('/contacts/' + id, { type: 'agent', first_name: 'Pat', last_name: 'Tester', email: 'pat@example.com', dnc: '1', notes: 'old ssn 123-45-6789 do not store' });
    c = ctx.db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    assert.equal(c.dnc, 1); assert.ok(c.opted_out_at); assert.equal(c.email_consent, 0); assert.ok(!c.notes.includes('123-45-6789')); assert.ok(c.notes.includes('[redacted-number]'));
    assert.ok(ctx.db.prepare("SELECT detail FROM activities WHERE entity_type='contact' AND entity_id=? ORDER BY id DESC").get(id).detail.includes('DO NOT CONTACT'));
    const page = await a.get('/contacts/' + id); assert.ok(page.text.includes('Do not contact'));
    await post('/notes', { entity_type: 'contact', entity_id: id, body: 'SSN 987654321 should vanish' });
    assert.ok(!ctx.db.prepare("SELECT body FROM notes WHERE entity_id = ? AND entity_type='contact' ORDER BY id DESC").get(id).body.includes('987654321'));
  });

  test('companies CRUD', async () => {
    const r = await post('/companies', { name: 'Test Holdings LLC', kind: 'Borrower LLC', state: 'fl' }); assert.equal(r.status, 302);
    assert.equal(ctx.db.prepare("SELECT state FROM companies WHERE name = 'Test Holdings LLC'").get().state, 'FL');
    assert.ok((await a.get('/companies')).text.includes('Test Holdings LLC'));
  });

  test('tasks: overdue flag + toggle', async () => {
    await post('/tasks', { title: 'Overdue test task', due_date: '2020-01-01' });
    const t = ctx.db.prepare("SELECT * FROM tasks WHERE title = 'Overdue test task'").get();
    assert.ok((await a.get('/tasks?f=overdue')).text.includes('Overdue test task'));
    assert.ok((await a.get('/')).text.includes('Overdue test task'));
    await post('/tasks/' + t.id + '/toggle', {}); assert.equal(ctx.db.prepare('SELECT done FROM tasks WHERE id = ?').get(t.id).done, 1);
  });

  test('pipeline: kanban + table, create deal seeds checklist, stage move logged', async () => {
    const k = await a.get('/pipeline'); assert.equal(k.status, 200); assert.ok(k.text.includes('class="kanban"'));
    const t = await a.get('/pipeline?view=table'); assert.ok(t.text.includes('Target close'));
    const r = await post('/deals', { loan_type: 'flip', transaction_type: 'purchase', property_address: '1 Test St', city: 'Jupiter', state: 'FL', purchase_price: '200000', rehab_budget: '50000', arv: '350000', loan_amount: '225000' });
    const id = Number(r.headers.location.split('/').pop());
    assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM conditions WHERE deal_id = ?").get(id).n, ref.checklistFor('flip', 'purchase').length);
    await post('/deals/' + id + '/stage', { stage: 'Application' });
    const d = ctx.db.prepare('SELECT stage, app_date FROM deals WHERE id = ?').get(id); assert.equal(d.stage, 'Application'); assert.ok(d.app_date);
    assert.ok(ctx.db.prepare("SELECT COUNT(*) n FROM activities WHERE entity_id = ? AND action = 'stage.changed'").get(id).n >= 1);
    assert.equal((await post('/deals/' + id + '/stage', { stage: 'Approved!!' })).status, 302); assert.equal(ctx.db.prepare('SELECT stage FROM deals WHERE id = ?').get(id).stage, 'Application');
  });

  test('public intake: no login, validation, creates lead + deal + checklist + task, redacts SSN, no SSN/DOB fields', async () => {
    const pub = request.agent(ctx.app);
    const g = await pub.get('/apply'); assert.equal(g.status, 200); const t = csrfFrom(g.text);
    assert.ok(!/name="(ssn|dob|date_of_birth|social)/i.test(g.text)); assert.ok(g.text.includes('not a loan application'));
    const bad = await pub.post('/apply').type('form').send({ _csrf: t, first_name: 'A' }); assert.equal(bad.status, 400); assert.ok(bad.text.includes('A valid email is required'));
    const before = ctx.db.prepare('SELECT COUNT(*) n FROM deals').get().n;
    const ok = await pub.post('/apply').type('form').send({ _csrf: t, first_name: 'Ivy', last_name: 'Intake', email: 'ivy@example.com', phone: '561-555-0123', entity_name: 'Ivy Test LLC', loan_type: 'dscr', transaction_type: 'purchase', city: 'Stuart', state: 'fl', purchase_price: '300000', monthly_rent: '2600', loan_amount: '225000', credit_range: '720-759', experience_deals: '2', exit_strategy: 'hold. my ssn is 123-45-6789', ack: '1', email_consent: '1', sms_consent: '1' });
    assert.equal(ok.status, 302); assert.equal(ok.headers.location, '/apply/thanks');
    const d = ctx.db.prepare('SELECT * FROM deals ORDER BY id DESC LIMIT 1').get();
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM deals').get().n, before + 1);
    assert.equal(d.source, 'intake'); assert.equal(d.intake_reviewed, 0); assert.equal(d.stage, 'Lead'); assert.equal(d.state, 'FL'); assert.ok(!d.exit_strategy.includes('123-45-6789'));
    const c = ctx.db.prepare('SELECT * FROM contacts WHERE id = ?').get(d.contact_id); assert.equal(c.sms_consent, 1); assert.ok(c.sms_consent_at); assert.equal(c.consent_method, 'Public intake form checkbox');
    assert.ok(ctx.db.prepare("SELECT COUNT(*) n FROM conditions WHERE deal_id = ?").get(d.id).n > 10);
    assert.ok(ctx.db.prepare("SELECT COUNT(*) n FROM tasks WHERE deal_id = ? AND title LIKE 'Review new intake%'").get(d.id).n === 1);
    assert.ok((await a.get('/')).text.includes('Ivy Intake'));
    // honeypot: silently dropped
    const n0 = ctx.db.prepare('SELECT COUNT(*) n FROM deals').get().n;
    await pub.post('/apply').type('form').send({ _csrf: t, website: 'spam', first_name: 'Bot', last_name: 'Bot', email: 'b@example.com', loan_type: 'dscr', city: 'X', state: 'FL', ack: '1' });
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM deals').get().n, n0);
    // mark reviewed
    await post('/deals/' + d.id + '/reviewed', {}); assert.equal(ctx.db.prepare('SELECT intake_reviewed FROM deals WHERE id = ?').get(d.id).intake_reviewed, 1);
  });

  test('analyzer: saved inputs produce the tested calc results; estimate labeled not a commitment', async () => {
    const id = ctx.db.prepare("SELECT id FROM deals WHERE name LIKE 'DEMO 3 Sampleton%'").get().id;
    const inputs = { price: 300000, rent: 2600, ltvPct: 75, ratePct: 7.5, amortYears: 30, interestOnly: 0, taxesAnnual: 4800, insuranceAnnual: 2400, hoaMonthly: 0, otherMonthly: 0, targetDscr: 1.25, maxLtvPct: 80, pointsPct: 1, closingPct: 2 };
    const body = { strategy: 'dscr' }; Object.entries(inputs).forEach(([k, v]) => { body['in_' + k] = String(v); });
    await post('/deals/' + id + '/analyze', body);
    const r = await a.get('/deals/' + id + '/analyze?s=dscr');
    const want = C.dscr(Object.assign({}, inputs, { interestOnly: false }));
    assert.ok(r.text.includes(want.dscr.toFixed(2) + 'x')); assert.ok(r.text.includes('$2,173.23')); assert.ok(r.text.includes('Deal memo'));
    for (const s of ['flip', 'brrrr', 'rental']) assert.equal((await a.get('/deals/' + id + '/analyze?s=' + s)).status, 200);
    const e = await a.get('/deals/' + id + '/estimate?s=dscr'); assert.ok(e.text.includes('NOT A COMMITMENT TO LEND')); assert.ok(e.text.includes('not a loan offer'));
    assert.ok(!/you qualify|you are approved|guaranteed/i.test(e.text));
  });

  test('underwriting: status flow timestamps, add condition, red flags, scenario export strips NPI', async () => {
    const d = ctx.db.prepare("SELECT * FROM deals WHERE name LIKE 'DEMO 455 Mock%'").get();
    const c = ctx.db.prepare("SELECT * FROM conditions WHERE deal_id = ? AND status = 'requested' LIMIT 1").get(d.id);
    await post('/conditions/' + c.id, { status: 'received', note: 'got it' });
    await post('/conditions/' + c.id, { status: 'cleared', note: 'ok' });
    const c2 = ctx.db.prepare('SELECT * FROM conditions WHERE id = ?').get(c.id); assert.equal(c2.status, 'cleared'); assert.ok(c2.received_at && c2.cleared_at);
    await post('/deals/' + d.id + '/conditions', { title: 'LOE for credit inquiry', category: 'Borrower / entity' });
    assert.ok(ctx.db.prepare("SELECT id FROM conditions WHERE deal_id = ? AND title = 'LOE for credit inquiry' AND status = 'requested'").get(d.id));
    await post('/deals/' + d.id + '/redflags', { rf1: '1', rf_note: 'Ask UW about occupancy' });
    assert.equal(JSON.parse(ctx.db.prepare('SELECT redflags_json FROM deals WHERE id = ?').get(d.id).redflags_json).rf1, 1);
    const u = await a.get('/deals/' + d.id + '/underwriting'); assert.ok(u.text.includes('not a credit decision')); assert.ok(u.text.includes('Red-flag checklist'));
    const s = await a.get('/deals/' + d.id + '/scenario.txt'); assert.equal(s.status, 200); assert.match(s.headers['content-disposition'], /attachment/);
    assert.ok(s.text.includes('SCENARIO REQUEST')); assert.ok(s.text.includes('J.E.')); assert.ok(!s.text.includes('Jordan')); assert.ok(!s.text.includes('@example.com')); assert.ok(!s.text.includes('455 Mock Blvd'));
    assert.ok(s.text.includes('Ask UW about occupancy'));
  });

  test('documents: expiring token link, public upload, type/magic/size limits, storage outside web root, auth download, revoke', async () => {
    const d = ctx.db.prepare("SELECT * FROM deals WHERE name LIKE 'DEMO 5 Mockingbird%'").get();
    await post('/deals/' + d.id + '/links', { label: 'initial', days: '7' });
    const page = await a.get('/deals/' + d.id + '/documents'); const m = page.text.match(/\/u\/([A-Za-z0-9_-]{40,})/); assert.ok(m, 'link shown once'); const token = m[1];
    assert.ok(!(await a.get('/deals/' + d.id + '/documents')).text.includes(token), 'link not shown again');
    const link = ctx.db.prepare('SELECT * FROM upload_links WHERE deal_id = ? ORDER BY id DESC').get(d.id);
    assert.equal(link.token_hash, crypto.createHash('sha256').update(token).digest('hex')); assert.ok(new Date(link.expires_at) > new Date(Date.now() + 6 * 864e5));
    const pub = request.agent(ctx.app); const g = await pub.get('/u/' + token); assert.equal(g.status, 200); assert.ok(g.text.includes('Secure document upload')); assert.ok(!g.text.includes('Morgan Mockley'));
    const t = csrfFrom(g.text);
    const cond = ctx.db.prepare("SELECT id FROM conditions WHERE deal_id = ? AND status = 'requested' LIMIT 1").get(d.id);
    const up = await pub.post('/u/' + token).field('_csrf', t).field('condition_id', String(cond.id)).attach('file', PDF, 'bank-statement.pdf');
    assert.equal(up.status, 200); assert.ok(up.text.includes('Uploaded: bank-statement.pdf'));
    const f = ctx.db.prepare('SELECT * FROM files WHERE deal_id = ? ORDER BY id DESC').get(d.id);
    assert.equal(f.uploaded_via, 'borrower_link'); assert.equal(ctx.db.prepare('SELECT status FROM conditions WHERE id = ?').get(cond.id).status, 'received');
    const stored = path.join(ctx.app.locals.config.uploadDir, f.stored_name); assert.ok(fs.existsSync(stored)); assert.ok(!stored.includes(path.join('lending-platform', 'public')));
    assert.equal((fs.statSync(stored).mode & 0o777), 0o600);
    assert.notEqual((await request(ctx.app).get('/static/' + f.stored_name)).status, 200, 'not web-served');
    assert.equal((await request(ctx.app).get('/files/' + f.id + '/download')).status, 302, 'download requires login');
    const dl = await a.get('/files/' + f.id + '/download'); assert.equal(dl.status, 200); assert.match(dl.headers['content-disposition'], /attachment/);
    assert.equal((await pub.post('/u/' + token).field('_csrf', t).attach('file', Buffer.from('MZ...'), 'virus.exe')).status, 400);
    assert.equal((await pub.post('/u/' + token).field('_csrf', t).attach('file', Buffer.from('not a pdf'), 'fake.pdf')).status, 400);
    assert.equal((await pub.post('/u/' + token).field('_csrf', t).attach('file', Buffer.concat([PDF, Buffer.alloc(1.2 * 1024 * 1024)]), 'big.pdf')).status, 413);
    assert.equal((await pub.post('/u/' + token).field('_csrf', 'bad').attach('file', PDF, 'x.pdf')).status, 403);
    assert.equal((await request(ctx.app).get('/u/not-a-real-token-xxxxxxxxxxxxxxxxxxxx')).status, 404);
    ctx.db.prepare("UPDATE upload_links SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(link.id);
    assert.equal((await request(ctx.app).get('/u/' + token)).status, 404, 'expired link');
    ctx.db.prepare("UPDATE upload_links SET expires_at = '2999-01-01T00:00:00.000Z' WHERE id = ?").run(link.id);
    await post('/links/' + link.id + '/revoke', {}); assert.equal((await request(ctx.app).get('/u/' + token)).status, 404, 'revoked link');
    // staff upload
    const s = await a.post('/deals/' + d.id + '/files').field('_csrf', a.csrf).attach('file', PDF, 'staff.pdf'); assert.equal(s.status, 302);
    assert.ok(ctx.db.prepare("SELECT id FROM files WHERE original_name = 'staff.pdf'").get());
    await post('/files/' + f.id + '/delete', {}); assert.ok(!fs.existsSync(stored));
  });

  test('payments: manual link, https only, status transitions, dashboard unpaid count', async () => {
    const d = ctx.db.prepare("SELECT * FROM deals WHERE name LIKE 'DEMO 7 Placeholder%'").get();
    await post('/deals/' + d.id + '/payments', { kind: 'appraisal', amount: '650', description: 'Appraisal fee', payment_url: 'http://insecure.example.com' });
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM payments WHERE deal_id = ?').get(d.id).n, 0);
    await post('/deals/' + d.id + '/payments', { kind: 'appraisal', amount: '650', description: 'Appraisal fee', payment_url: 'https://pay.example.com/abc' });
    const p = ctx.db.prepare('SELECT * FROM payments WHERE deal_id = ?').get(d.id); assert.equal(p.amount_cents, 65000); assert.equal(p.status, 'requested'); assert.equal(p.provider, 'manual');
    assert.ok((await a.get('/')).text.includes('Appraisal fee'));
    await post('/payments/' + p.id + '/status', { status: 'paid' }); assert.ok(ctx.db.prepare('SELECT paid_at FROM payments WHERE id = ?').get(p.id).paid_at);
    await post('/payments/' + p.id + '/status', { status: 'refunded' }); assert.ok(ctx.db.prepare('SELECT refunded_at FROM payments WHERE id = ?').get(p.id).refunded_at);
    const pg = await a.get('/deals/' + d.id + '/payments'); assert.ok(pg.text.includes('per-transaction fee'));
  });

  test('templates: merge fields from deal, DNC + SMS consent warnings, copy-only', async () => {
    const d = ctx.db.prepare("SELECT * FROM deals WHERE name LIKE 'DEMO 455 Mock%'").get();
    const r = await a.get('/templates?deal_id=' + d.id); assert.equal(r.status, 200);
    assert.ok(r.text.includes('Hi Jordan, your application for 455 Mock Blvd, West Palm Beach is in.'));
    assert.ok(r.text.includes('Copy-to-clipboard library')); assert.ok(r.text.includes('No SMS consent'));
    const q = ctx.db.prepare("SELECT id FROM contacts WHERE first_name = 'Quinn'").get();
    assert.ok((await a.get('/templates?contact_id=' + q.id)).text.includes('DO NOT CONTACT'));
    assert.ok(ctx.db.prepare('SELECT COUNT(*) n FROM templates').get().n >= 25);
    await post('/templates', { name: 'My custom', channel: 'email', body: 'Hi {{FIRST_NAME}}' }); assert.ok((await a.get('/templates?cat=Custom')).text.includes('My custom'));
  });

  test('compliance reference + responsibility note + footer disclaimer', async () => {
    const r = await a.get('/compliance'); assert.ok(r.text.includes('remains responsible for licensing, sponsorship')); assert.ok(r.text.includes('not a credit decision system'));
    for (const d of ref.complianceDocs()) assert.equal((await a.get('/compliance/' + d.slug)).status, 200, d.slug);
    assert.ok((await a.get('/compliance/tcpa-and-telemarketing')).text.includes('TCPA'));
  });

  test('settings: profile flows into merge fields + public footer; demo data can be deleted', async () => {
    const r = await post('/settings/profile', { lo_name: 'Cory Example', nmls_id: '000000', company_name: 'Sponsor Co', booking_link: 'javascript:alert(1)' });
    assert.equal(r.status, 302); assert.equal(ctx.db.prepare("SELECT value FROM settings WHERE key='booking_link'").get().value, '');
    assert.ok((await request(ctx.app).get('/apply')).text.includes('Cory Example · NMLS #000000 · Sponsor Co'));
    await post('/settings/delete-demo', {}); assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM deals WHERE is_demo = 1').get().n, 0);
    assert.equal((await a.get('/')).status, 200);
  });

  test('XSS: user input is escaped everywhere', async () => {
    await post('/contacts', { first_name: '<script>alert(1)</script>', type: 'borrower' });
    const r = await a.get('/contacts'); assert.ok(!r.text.includes('<script>alert(1)</script>')); assert.ok(r.text.includes('&lt;script&gt;'));
  });
});

describe('stripe (mocked, test mode only)', () => {
  test('key mode detection refuses live keys', () => {
    assert.equal(stripe.mode(''), 'off'); assert.equal(stripe.mode('sk_test_123'), 'test'); assert.equal(stripe.mode('sk_live_123'), 'blocked-live'); assert.equal(stripe.mode('rk_live_123'), 'blocked-live');
  });
  test('creates a test payment link via mocked API; webhook marks paid', async () => {
    const calls = [];
    const fetchImpl = async (u, opts) => { calls.push([u, opts.body]); const isPrice = u.endsWith('/prices'); return { ok: true, json: async () => isPrice ? { id: 'price_test_1' } : { id: 'plink_test_1', url: 'https://buy.stripe.com/test_abc', livemode: false } }; };
    const ctx = mkApp({ stripeKey: 'sk_test_fake', stripeFetch: fetchImpl, stripeWebhookSecret: 'whsec_test' }); const a = await login(ctx.app);
    const d = ctx.db.prepare("SELECT id FROM deals WHERE name LIKE 'DEMO 7 Placeholder%'").get();
    await a.post('/deals/' + d.id + '/payments').type('form').send({ _csrf: a.csrf, kind: 'appraisal', amount: '700', description: 'Appraisal', use_stripe: '1' });
    const p = ctx.db.prepare('SELECT * FROM payments WHERE deal_id = ?').get(d.id);
    assert.equal(p.provider, 'stripe'); assert.equal(p.stripe_mode, 'test'); assert.equal(p.payment_url, 'https://buy.stripe.com/test_abc'); assert.equal(calls.length, 2); assert.match(calls[0][1], /unit_amount=70000/);
    const body = JSON.stringify({ type: 'checkout.session.completed', livemode: false, data: { object: { payment_link: 'plink_test_1', payment_status: 'paid' } } });
    const ts = Math.floor(Date.now() / 1000); const sig = crypto.createHmac('sha256', 'whsec_test').update(ts + '.' + body).digest('hex');
    assert.equal((await request(ctx.app).post('/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', `t=${ts},v1=bad`).send(body)).status, 400);
    const ok = await request(ctx.app).post('/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', `t=${ts},v1=${sig}`).send(body);
    assert.equal(ok.status, 200); assert.equal(ctx.db.prepare('SELECT status FROM payments WHERE id = ?').get(p.id).status, 'paid');
  });
  test('live key never calls Stripe', async () => {
    let called = false; await assert.rejects(stripe.createPaymentLink({ amountCents: 100, description: 'x', dealId: 1, paymentId: 1 }, { key: 'sk_live_x', fetchImpl: async () => { called = true; } })); assert.equal(called, false);
  });
});

describe('reference data', () => {
  test('checklists per loan type follow the matrix', () => {
    assert.equal(ref.docMatrix().length, 24);
    const dscrP = ref.checklistFor('dscr', 'purchase').map(x => x.title); const dscrR = ref.checklistFor('dscr', 'refi').map(x => x.title);
    assert.ok(dscrP.some(t => /Purchase contract/.test(t))); assert.ok(!dscrP.some(t => /mortgage statement/.test(t)));
    assert.ok(dscrR.some(t => /mortgage statement/.test(t))); assert.ok(!dscrR.some(t => /Purchase contract/.test(t)));
    assert.ok(!ref.checklistFor('flip', 'purchase').some(t => /Lease/.test(t.title)));
    assert.ok(ref.checklistFor('ground_up', 'purchase').some(t => /permits/.test(t.title)));
  });
  test('red flags and common conditions load', () => { assert.ok(ref.redFlags().length >= 10); assert.ok(ref.commonConditions().length >= 10); });
});
