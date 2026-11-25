'use strict';
// v3: Today queue, New-deal wizard, Move-to-next-step gates, expected next-step date, search/command bar,
// pipeline health, term-sheet-style summary, investor portal redesign, plain-English labels. Run: npm test
process.env.OUTBOUND_DRY_RUN = '1'; // nothing can leave the box from tests
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const request = require('supertest');
const { createApp } = require('../src/app');
const model = require('../src/lib/model');
const gates = require('../src/lib/gates');
const P = require('../src/lib/plain');
const T = require('../src/lib/today');

const ADMIN = { email: 'admin@test.local', password: 'correct-horse-battery-1' };
function mkApp(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv3-'));
  const app = createApp(Object.assign({ dbFile: path.join(dir, 'db.sqlite'), uploadDir: path.join(dir, 'uploads'), sessionSecret: 'test-secret', adminEmail: ADMIN.email, adminPassword: ADMIN.password, adminName: 'Cory Tester', maxUploadMb: 1, loginMax: 50, intakeMax: 100, scheduler: false, forceSimulate: true }, extra));
  return { app, dir, db: app.locals.db, engine: app.locals.engine };
}
const csrfFrom = (t) => { const m = t.match(/name="_csrf" value="([^"]+)"/); return m && m[1]; };
async function login(app) {
  const a = request.agent(app); const t = csrfFrom((await a.get('/login')).text);
  await a.post('/login').type('form').send({ email: ADMIN.email, password: ADMIN.password, _csrf: t, next: '/' });
  a.csrf = csrfFrom((await a.get('/')).text); assert.ok(a.csrf); return a;
}
const post = (a, url, body = {}) => a.post(url).type('form').send(Object.assign({ _csrf: a.csrf }, body));
const deal = (db, prefix) => db.prepare('SELECT * FROM deals WHERE name LIKE ?').get('DEMO ' + prefix + '%');
const outboxSent = (db) => db.prepare("SELECT COUNT(*) n FROM outbox WHERE status = 'sent' AND (transport IS NULL OR transport NOT LIKE 'simulated%')").get().n;

describe('v3 Today home screen', () => {
  let ctx, a; before(async () => { ctx = mkApp(); a = await login(ctx.app); });
  test('/ is Today: one big next-best-action card with Do it / Done / Skip, ranked list below', async () => {
    const r = await a.get('/'); assert.equal(r.status, 200);
    assert.match(r.text, /<title>Today · DealDesk OS<\/title>/);
    assert.equal((r.text.match(/class="action-card /g) || []).length, 1, 'exactly one big card');
    assert.match(r.text, /Next best action · 1 of \d+/);
    assert.match(r.text, /Call Casey about the new application/, 'new intake ranks first');
    assert.match(r.text, /action="\/today\/done"/); assert.match(r.text, /action="\/today\/skip"/); assert.match(r.text, /Up next/);
    assert.doesNotMatch(r.text, /Conditions outstanding/);
  });
  test('ranking: new intake > overdue task > docs to review > outbox approvals', () => {
    const acts = T.buildActions(ctx.db);
    const firstOf = (k) => acts.findIndex(x => x.kind === k);
    assert.ok(firstOf('intake') < firstOf('overdue')); assert.ok(firstOf('overdue') < firstOf('review')); assert.ok(firstOf('review') < firstOf('outbox'));
    assert.ok(acts.every((x, i) => i === 0 || acts[i - 1].score >= x.score));
  });
  test('Done on an intake marks it reviewed and the next card moves up; Skip hides for today only', async () => {
    const casey = deal(ctx.db, '22 Sample'); assert.equal(casey.intake_reviewed, 0);
    const d = await post(a, '/today/done', { key: 'intake:' + casey.id }); assert.equal(d.status, 303);
    assert.equal(ctx.db.prepare('SELECT intake_reviewed FROM deals WHERE id = ?').get(casey.id).intake_reviewed, 1);
    const r = await a.get('/'); assert.doesNotMatch(r.text, /Call Casey about the new application/);
    const top = T.buildActions(ctx.db)[0];
    await post(a, '/today/skip', { key: top.key });
    assert.ok(!T.buildActions(ctx.db).some(x => x.key === top.key), 'skipped item hidden');
    assert.ok(T.buildActions(ctx.db, { today: '2099-01-01', includeDismissed: false }).some(x => x.key === top.key), 'back tomorrow');
    assert.equal(ctx.db.prepare("SELECT kind FROM today_dismissals WHERE item_key = ?").get(top.key).kind, 'skip');
  });
  test('Done on a task completes the task; bad keys are ignored safely', async () => {
    const id = ctx.db.prepare("INSERT INTO tasks (title, due_date) VALUES ('Call the title company', '2020-01-02')").run().lastInsertRowid;
    assert.ok(T.buildActions(ctx.db).some(x => x.key === 'task:' + id));
    await post(a, '/today/done', { key: 'task:' + id });
    assert.equal(ctx.db.prepare('SELECT done FROM tasks WHERE id = ?').get(id).done, 1);
    const bad = await post(a, '/today/done', { key: '<script>' }); assert.equal(bad.status, 303);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM today_dismissals WHERE item_key LIKE '%script%'").get().n, 0);
  });
  test('empty state when nothing is left', async () => {
    const db = ctx.db; const keys = T.buildActions(db).map(x => x.key);
    keys.forEach(k => T.complete(db, k, { kind: 'skip' }));
    const r = await a.get('/'); assert.match(r.text, /You're all caught up/); assert.match(r.text, /Start a new deal/);
  });
});

describe('v3 New-deal wizard', () => {
  let ctx, a; before(async () => { ctx = mkApp({ seedDemo: false }); a = await login(ctx.app); });
  test('one question per screen with a progress bar; guarded order', async () => {
    let r = await a.get('/new'); assert.equal(r.status, 302); assert.equal(r.headers.location, '/new/type');
    r = await a.get('/new/type'); assert.match(r.text, /What kind of loan is this\?/); assert.match(r.text, /<progress value="1" max="8"/);
    assert.match(r.text, /Rental \(DSCR\)/); assert.match(r.text, /Fix &amp; flip/); assert.match(r.text, /Ground-up build/); assert.match(r.text, /Cash-out refi/);
    const jump = await a.get('/new/numbers'); assert.equal(jump.status, 302); assert.equal(jump.headers.location, '/new/type');
  });
  test('validation: friendly errors, nothing created', async () => {
    await post(a, '/new/type', { loan_type: 'flip' });
    let r = await post(a, '/new/who', { first_name: '', contact_id: '' }); assert.equal(r.status, 400); assert.match(r.text, /Pick a person, or type a first name/);
    r = await post(a, '/new/who', { first_name: 'Pat', email: 'not-an-email' }); assert.equal(r.status, 400); assert.match(r.text, /email doesn&#39;t look right/);
    assert.match(r.text, /name="first_name" value="Pat"/, 'typed values are kept after an error');
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM deals').get().n, 0);
  });
  test('full flow creates contact (consent off by default), deal, checklist, follow-up task and status page', async () => {
    await a.get('/new');
    let r = await post(a, '/new/type', { loan_type: 'flip' }); assert.equal(r.headers.location, '/new/who');
    r = await post(a, '/new/who', { first_name: 'Pat', last_name: 'Wizard', email: 'pat.wizard@example.com', phone: '(561) 555-0199' }); assert.equal(r.headers.location, '/new/purpose');
    r = await post(a, '/new/purpose', { transaction_type: 'purchase' }); assert.equal(r.headers.location, '/new/where');
    r = await post(a, '/new/where', { property_address: '77 Wizard Way', city: 'Jupiter', state: 'fl', zip: '33458', property_type: 'Single family', units: '1' }); assert.equal(r.headers.location, '/new/numbers');
    const nums = await a.get('/new/numbers'); assert.match(nums.text, /Repair budget/); assert.match(nums.text, /Value after the work \(ARV\)/); assert.doesNotMatch(nums.text, /Monthly rent/);
    r = await post(a, '/new/numbers', { purchase_price: '$250,000', rehab_budget: '60000', arv: '400000', loan_amount: '255000' }); assert.equal(r.headers.location, '/new/investor');
    r = await post(a, '/new/investor', { skip: '1' }); assert.equal(r.headers.location, '/new/timing');
    r = await post(a, '/new/timing', { target_close_date: '2030-01-15', follow_up: '2030-01-02', portal: '1' }); assert.equal(r.headers.location, '/new/review');
    const rv = await a.get('/new/review'); assert.match(rv.text, /Does this look right\?/); assert.match(rv.text, /77 Wizard Way, Jupiter, FL, 33458/); assert.match(rv.text, /\$250,000/); assert.match(rv.text, /Create deal/);
    r = await post(a, '/new/review'); assert.equal(r.status, 303);
    const d = ctx.db.prepare("SELECT * FROM deals WHERE property_address = '77 Wizard Way'").get(); assert.ok(d);
    assert.equal(r.headers.location, '/deals/' + d.id);
    assert.equal(d.stage, 'Lead'); assert.equal(d.loan_type, 'flip'); assert.equal(d.purchase_price, 250000); assert.equal(d.state, 'FL'); assert.equal(d.target_close_date, '2030-01-15');
    const c = ctx.db.prepare('SELECT * FROM contacts WHERE id = ?').get(d.contact_id);
    assert.equal(c.first_name, 'Pat'); assert.equal(c.email_consent, 0); assert.equal(c.sms_consent, 0);
    assert.ok(ctx.db.prepare("SELECT COUNT(*) n FROM conditions WHERE deal_id = ? AND kind = 'doc'").get(d.id).n > 5);
    assert.equal(ctx.db.prepare("SELECT due_date FROM tasks WHERE deal_id = ?").get(d.id).due_date, '2030-01-02');
    assert.ok(ctx.db.prepare('SELECT id FROM portal_links WHERE deal_id = ? AND revoked = 0').get(d.id));
    const page = await a.get('/deals/' + d.id); assert.match(page.text, /Deal created/); assert.match(page.text, /Move to next step/);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM outbox').get().n, 0, 'the wizard sends nothing');
  });
  test('cash-out skips the buying/refinancing question and asks rent + payoff', async () => {
    await a.get('/new');
    const r = await post(a, '/new/type', { loan_type: 'cashout' });
    await post(a, '/new/who', { contact_id: String(ctx.db.prepare('SELECT id FROM contacts LIMIT 1').get().id) });
    const w = await post(a, '/new/where', { city: 'Stuart', property_type: '2-4 unit', units: '2' }); assert.equal(w.headers.location, '/new/numbers');
    const n = await a.get('/new/numbers'); assert.match(n.text, /What it&#39;s worth today/); assert.match(n.text, /Monthly rent/); assert.match(n.text, /What they still owe on it/);
    assert.match(n.text, /Step 4 of 7/); assert.equal(r.headers.location, '/new/who');
  });
});

describe('v3 Move to next step (gates) + expected next-step date', () => {
  let ctx, a; before(async () => { ctx = mkApp(); a = await login(ctx.app); });
  test('blocked with a plain-English checklist until the info is in', async () => {
    const id = ctx.db.prepare("INSERT INTO deals (name, stage, loan_type) VALUES ('Gate test', 'Lead', 'dscr')").run().lastInsertRowid;
    const g = gates.gateFor(ctx.db, ctx.db.prepare('SELECT * FROM deals WHERE id = ?').get(id));
    assert.equal(g.next, 'Application'); assert.equal(g.ready, false); assert.ok(g.checks.find(c => c.key === 'amount' && !c.ok));
    const page = await a.get(`/deals/${id}/next`); assert.match(page.text, /Before you can move it, finish these/); assert.match(page.text, /The loan amount they want is filled in/); assert.match(page.text, /disabled/);
    const r = await post(a, `/deals/${id}/next`); assert.equal(r.status, 303);
    assert.equal(ctx.db.prepare('SELECT stage FROM deals WHERE id = ?').get(id).stage, 'Lead', 'not moved');
    const cid = ctx.db.prepare("INSERT INTO contacts (first_name, email) VALUES ('Gina', 'gina@example.com')").run().lastInsertRowid;
    ctx.db.prepare("UPDATE deals SET contact_id = ?, property_address = '5 Gate St', loan_amount = 200000 WHERE id = ?").run(cid, id);
    const ok = await post(a, `/deals/${id}/next`, { next_step_date: '2030-02-01', next_step_note: 'Sending your document list' }); assert.equal(ok.status, 303);
    const d = ctx.db.prepare('SELECT * FROM deals WHERE id = ?').get(id); assert.equal(d.stage, 'Application'); assert.equal(d.next_step_date, '2030-02-01'); assert.ok(d.app_date);
    assert.ok(ctx.db.prepare("SELECT COUNT(*) n FROM activities WHERE entity_id = ? AND action = 'stage.changed'").get(id).n === 1);
  });
  test('lender-only steps need an explicit confirm; approval language is blocked in investor notes', async () => {
    const d = deal(ctx.db, '3 Sampleton'); ctx.db.prepare("UPDATE deals SET stage = 'Underwriting' WHERE id = ?").run(d.id);
    let r = await post(a, `/deals/${d.id}/next`); assert.equal(ctx.db.prepare('SELECT stage FROM deals WHERE id = ?').get(d.id).stage, 'Underwriting');
    r = await post(a, `/deals/${d.id}/next`, { c_conditions: '1', next_step_note: 'You are approved!' }); assert.equal(ctx.db.prepare('SELECT stage FROM deals WHERE id = ?').get(d.id).stage, 'Underwriting');
    const page = await a.get(`/deals/${d.id}/next`); assert.match(page.text, /can&#39;t include &quot;approved&quot;|can't include "approved"/);
    r = await post(a, `/deals/${d.id}/next`, { c_conditions: '1', next_step_note: 'Upload the items on your list' }); assert.equal(r.status, 303);
    assert.equal(ctx.db.prepare('SELECT stage FROM deals WHERE id = ?').get(d.id).stage, 'Conditionally Approved');
    assert.ok(ctx.db.prepare("SELECT COUNT(*) n FROM portal_updates WHERE deal_id = ? AND body LIKE '%Conditions issued%'").get(d.id).n >= 1, 'portal update posted');
    assert.equal(model.getSettings(ctx.db).automated_sending, '0'); assert.equal(outboxSent(ctx.db), 0, 'nothing really sent');
    const g = gates.gateFor(ctx.db, ctx.db.prepare('SELECT * FROM deals WHERE id = ?').get(d.id));
    assert.equal(g.ready, false); assert.ok(g.confirms.some(c => c.key === 'c_ctc'));
  });
  test('LO sets the expected next-step date; lint blocks rates and guarantees', async () => {
    const d = deal(ctx.db, '455 Mock');
    await post(a, `/deals/${d.id}/next-step`, { next_step_date: '2030-03-03', next_step_note: 'Rate is 7.5% guaranteed' });
    assert.notEqual(ctx.db.prepare('SELECT next_step_date FROM deals WHERE id = ?').get(d.id).next_step_date, '2030-03-03');
    await post(a, `/deals/${d.id}/next-step`, { next_step_date: '2030-03-03', next_step_note: 'Appraisal visit being scheduled' });
    assert.equal(ctx.db.prepare('SELECT next_step_date FROM deals WHERE id = ?').get(d.id).next_step_date, '2030-03-03');
    assert.equal(P.lintBorrowerText('Your loan is pre-approved'), 'pre-approved'); assert.equal(P.lintBorrowerText('Appraisal ordered'), null);
  });
  test('classic stage dropdown still works and still runs automations', async () => {
    const d = deal(ctx.db, '101 Example');
    await post(a, `/deals/${d.id}/stage`, { stage: 'Processing' });
    assert.equal(ctx.db.prepare('SELECT stage FROM deals WHERE id = ?').get(d.id).stage, 'Processing');
    assert.ok(ctx.db.prepare("SELECT COUNT(*) n FROM automation_runs WHERE rule_key = 'stage_change' AND summary LIKE ?").get(`Deal #${d.id}:%`).n >= 1);
  });
});

describe('v3 investor portal redesign', () => {
  let ctx, token, d6; before(() => { ctx = mkApp(); d6 = deal(ctx.db, '3 Sampleton'); token = ctx.engine.createPortalLink(d6.id, { verifyMode: 'none' }); });
  test('stage timeline + progress, what we need, what happens next with the LO date; no approval words or internal notes', async () => {
    const p = await request(ctx.app).get('/p/' + token); assert.equal(p.status, 200);
    assert.match(p.text, /<progress value="5" max="7"/); assert.match(p.text, /Step 5 of 7/); assert.match(p.text, /class="timeline"/);
    assert.match(p.text, /What we need from you/); assert.match(p.text, /What happens now/); assert.match(p.text, /What happens next/);
    assert.match(p.text, /Expected next step/); assert.match(p.text, /We expect to review your uploaded items with the lender/); assert.match(p.text, /not a promise/);
    assert.match(p.text, /Wire safety/); assert.match(p.text, /not a loan approval/);
    assert.doesNotMatch(p.text, /Conditionally Approved/); assert.doesNotMatch(p.text, /DEMO internal/); assert.doesNotMatch(p.text, /\b(you are|you're) (approved|pre-approved)\b/i);
    assert.doesNotMatch(p.text, /\d+(\.\d+)?\s?% (rate|interest)/i);
  });
  test('a past expected date is hidden from the investor', async () => {
    ctx.db.prepare("UPDATE deals SET next_step_date = '2020-01-01' WHERE id = ?").run(d6.id);
    const p = await request(ctx.app).get('/p/' + token); assert.doesNotMatch(p.text, /Expected next step/);
  });
  test('demo mode: the demo status-page link is stable across restarts (same secret), real links stay random', () => {
    const one = mkApp({ demoMode: true }), two = mkApp({ demoMode: true });
    const u1 = one.engine.portalUrl(deal(one.db, '3 Sampleton').id, { create: false }), u2 = two.engine.portalUrl(deal(two.db, '3 Sampleton').id, { create: false });
    assert.equal(u1.split('/p/')[1], u2.split('/p/')[1]);
    const plain = mkApp(); const u3 = plain.engine.portalUrl(deal(plain.db, '3 Sampleton').id, { create: false });
    assert.notEqual(u3.split('/p/')[1], u1.split('/p/')[1]);
    assert.equal(one.engine.demoToken('x').length, 43); assert.equal(plain.engine.demoToken('x'), null);
  });
});

describe('v3 search, health, summary, plain-English UI', () => {
  let ctx, a; before(async () => { ctx = mkApp(); a = await login(ctx.app); });
  test('search + command bar (JSON and page); login required', async () => {
    const j = await a.get('/search.json?q=avery'); assert.equal(j.status, 200);
    assert.ok(j.body.results.some(r => r.type === 'Person' && /Avery/.test(r.label))); assert.ok(j.body.results.some(r => r.type === 'Deal'));
    const c = await a.get('/search.json?q=new deal'); assert.equal(c.body.results[0].href, '/new');
    const s = await a.get('/search?q=Sampleton'); assert.match(s.text, /3 Sampleton/);
    const none = await a.get('/search?q=zzzznothing'); assert.match(none.text, /No matches/);
    assert.equal((await request(ctx.app).get('/search.json?q=avery')).status, 302);
    const home = await a.get('/'); assert.match(home.text, /id="cmd"/); assert.match(home.text, /class="bottombar"/);
  });
  test('pipeline health: SVG charts from app data only, no NaN, not approvals', async () => {
    const r = await a.get('/pipeline/health'); assert.equal(r.status, 200);
    assert.ok((r.text.match(/<svg class="chart/g) || []).length >= 5);
    for (const t of ['Volume by step', 'Days in step', 'Aging', 'Closed by month', 'Loan type mix', 'not approvals']) assert.match(r.text, new RegExp(t));
    assert.doesNotMatch(r.text, /NaN|undefined|Infinity/);
    const empty = mkApp({ seedDemo: false }); const b = await login(empty.app);
    assert.match((await b.get('/pipeline/health')).text, /No open deals yet/);
  });
  test('term-sheet-style summary prints cleanly and never reads as an offer', async () => {
    const d = deal(ctx.db, '455 Mock'); const r = await a.get(`/deals/${d.id}/summary`); assert.equal(r.status, 200);
    assert.match(r.text, /INTERNAL SUMMARY — NOT A COMMITMENT TO LEND/); assert.match(r.text, /Loan-to-value/); assert.match(r.text, /Loan-to-ARV/); assert.match(r.text, /data-print/);
    assert.match(r.text, /not a loan offer, approval, rate quote/); assert.doesNotMatch(r.text, /NaN|undefined/); assert.doesNotMatch(r.text, /LendingOne/i);
  });
  test('plain-English labels replace jargon in staff screens; formal terms kept in tooltips', async () => {
    const pl = await a.get('/pipeline'); assert.match(pl.text, /Clearing final items/); assert.match(pl.text, /Lender term: Conditionally Approved/);
    const d = deal(ctx.db, '3 Sampleton'); const uw = await a.get(`/deals/${d.id}/underwriting`);
    assert.match(uw.text, /Waiting on borrower/); assert.match(uw.text, /Got it — needs review/); assert.doesNotMatch(uw.text, /Conditions outstanding|Outstanding conditions/);
    const dp = await a.get(`/deals/${d.id}`); assert.match(dp.text, /class="stepper"/); assert.match(dp.text, /Move to next step/); assert.match(dp.text, /id="next-step"/); assert.match(dp.text, /class="tip"/);
    assert.match((await a.get('/more')).text, /Numbers board/);
  });
  test('kill switch + dry run unchanged; CSP still forbids inline script', async () => {
    const r = await a.get('/'); assert.match(r.headers['content-security-policy'], /script-src 'self'/); assert.doesNotMatch(r.text, /<script>(?!<\/script>)/);
    assert.doesNotMatch(r.text, /style="/, 'no inline styles (CSP)');
    assert.equal(model.getSettings(ctx.db).automated_sending, '0'); assert.equal(outboxSent(ctx.db), 0);
  });
});
