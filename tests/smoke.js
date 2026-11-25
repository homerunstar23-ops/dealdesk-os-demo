'use strict';
// Headless-browser smoke test of every module. Starts a throwaway instance (temp DB + demo data) on
// port 4199 so the real database is untouched, walks each screen, fails on any console/CSP error,
// and saves full-page screenshots to screenshots-review/.  Run: npm run smoke
const fs = require('fs'); const os = require('os'); const path = require('path');
const puppeteer = require('puppeteer-core');
const { createApp } = require('../src/app');

const OUT = path.join(__dirname, '..', 'screenshots-review');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const PORT = 4199, BASE = `http://127.0.0.1:${PORT}`;
const EMAIL = 'smoke@dealdesk.local', PASSWORD = 'smoke-test-password-' + Date.now();

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddsmoke-'));
  const app = createApp({ dbFile: path.join(dir, 'db.sqlite'), uploadDir: path.join(dir, 'uploads'), sessionSecret: 'smoke', adminEmail: EMAIL, adminPassword: PASSWORD, adminName: 'Cory Jones', scheduler: false, forceSimulate: true });
  const db = app.locals.db;
  db.prepare("UPDATE settings SET value = ? WHERE key = ?").run('Cory Jones', 'lo_name');
  db.prepare("UPDATE settings SET value = ? WHERE key = ?").run('[NMLS # here]', 'nmls_id');
  db.prepare("UPDATE settings SET value = ? WHERE key = ?").run('[Sponsoring broker]', 'company_name');
  db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(BASE, 'public_base_url');
  const server = app.listen(PORT, '127.0.0.1');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  const problems = []; const results = [];
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('response', r => { if (r.status() === 404) problems.push('404 ' + r.url()); if (r.status() >= 500) problems.push('HTTP ' + r.status() + ' ' + r.url()); });
  const shot = async (name, full = true) => { await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full }); results.push(name); };
  const go = async (p, expectText) => { const r = await page.goto(BASE + p, { waitUntil: 'networkidle0' }); if (r.status() >= 400) throw new Error(p + ' -> ' + r.status()); if (expectText) { const t = await page.content(); if (!t.includes(expectText)) throw new Error(p + ' missing text: ' + expectText); } };
  const dealId = (like) => db.prepare('SELECT id FROM deals WHERE name LIKE ?').get(like).id;
  try {
    await go('/login', 'Log in'); await shot('00-login', false);
    await page.type('input[name=email]', EMAIL); await page.type('input[name=password]', PASSWORD);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('form[action="/login"] button')]);
    await go('/dashboard', 'Open pipeline'); await shot('01-dashboard');
    await go('/pipeline', 'Kanban'); await shot('02-pipeline-kanban');
    await go('/pipeline?view=table', 'Target close'); await shot('03-pipeline-table');
    await go('/contacts', 'Contacts'); await shot('04-contacts');
    const avery = db.prepare("SELECT id FROM contacts WHERE first_name = 'Avery'").get().id;
    await go('/contacts/' + avery, 'Consent'); await shot('05-contact-detail');
    await go('/companies', 'Companies'); await shot('06-companies', false);
    await go('/tasks', 'Follow-up tasks'); await shot('07-tasks');
    const d4 = dealId('DEMO 455 Mock%'), d6 = dealId('DEMO 3 Sampleton%'), d10 = dealId('DEMO 5 Mockingbird%');
    await go('/deals/' + d4, 'Deal details'); await shot('08-deal-overview');
    await go('/deals/' + d4 + '/analyze?s=flip', 'Results'); await shot('09-analyzer-flip');
    await go('/deals/' + d6 + '/analyze?s=dscr', 'DSCR'); await shot('10-analyzer-dscr');
    await go('/deals/' + d4 + '/analyze?s=brrrr', 'Cash left in deal'); await go('/deals/' + d4 + '/analyze?s=rental', 'Cap rate');
    await go('/deals/' + d6 + '/estimate?s=dscr', 'NOT A COMMITMENT TO LEND'); await shot('11-estimate-printable');
    await go('/deals/' + d4 + '/underwriting', 'Red-flag checklist'); await shot('12-underwriting');
    // Documents: create upload link, then use it as the borrower (fresh incognito context = no login)
    await go('/deals/' + d10 + '/documents', 'Borrower upload link');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click(`form[action="/deals/${d10}/links"] button`)]);
    const link = await page.$eval('#newlink', el => el.value); await shot('13-documents-link-created');
    const ctx = await browser.createBrowserContext(); const bp = await ctx.newPage(); await bp.setViewport({ width: 1100, height: 900 });
    bp.on('pageerror', e => problems.push('borrower pageerror: ' + e.message));
    await bp.goto(link, { waitUntil: 'networkidle0' });
    const pdf = path.join(dir, 'Bank-Statement-Oct.pdf'); fs.writeFileSync(pdf, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const input = await bp.$('input[type=file]'); await input.uploadFile(pdf);
    await Promise.all([bp.waitForNavigation({ waitUntil: 'networkidle0' }), bp.click('form button')]);
    if (!(await bp.content()).includes('Uploaded: Bank-Statement-Oct.pdf')) throw new Error('borrower upload failed');
    if (!db.prepare("SELECT condition_id FROM files WHERE original_name = 'Bank-Statement-Oct.pdf'").get().condition_id) throw new Error('upload not linked to checklist item');
    await bp.screenshot({ path: path.join(OUT, '14-borrower-upload-page.png'), fullPage: true }); results.push('14-borrower-upload-page');
    await go('/deals/' + d10 + '/documents', 'Bank-Statement-Oct.pdf'); await shot('15-documents-received');
    await go('/deals/' + d10 + '/payments', 'Request appraisal'); await page.type('input[name=amount]', '850'); await page.type('input[name=payment_url]', 'https://example.com/demo-pay');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click(`form[action="/deals/${d10}/payments"] button`)]); await shot('16-payments');
    await go('/templates?deal_id=' + d4, 'Templates library'); await shot('17-templates');
    await go('/compliance', 'Responsibility note'); await shot('18-compliance');
    await go('/compliance/tcpa-and-telemarketing', 'TCPA'); await shot('19-compliance-doc', false);
    await go('/settings', 'Loan officer profile'); await shot('20-settings');
    // Public intake in a logged-out context
    const pp = await ctx.newPage(); await pp.setViewport({ width: 1100, height: 900 }); pp.on('pageerror', e => problems.push('intake pageerror: ' + e.message));
    await pp.goto(BASE + '/apply', { waitUntil: 'networkidle0' }); await pp.screenshot({ path: path.join(OUT, '21-public-intake-form.png'), fullPage: true }); results.push('21-public-intake-form');
    await pp.type('[name=first_name]', 'Smoke'); await pp.type('[name=last_name]', 'Tester'); await pp.type('[name=email]', 'smoke@example.com'); await pp.select('[name=loan_type]', 'flip');
    await pp.type('[name=city]', 'Jupiter'); await pp.type('[name=purchase_price]', '250000'); await pp.type('[name=rehab_budget]', '60000'); await pp.type('[name=arv]', '410000'); await pp.click('[name=ack]'); await pp.click('[name=email_consent]');
    await Promise.all([pp.waitForNavigation({ waitUntil: 'networkidle0' }), pp.click('form button.big')]);
    if (!(await pp.content()).includes('your scenario was received')) throw new Error('intake submit failed');
    await pp.screenshot({ path: path.join(OUT, '22-public-intake-thanks.png') }); results.push('22-public-intake-thanks');
    await go('/dashboard', 'Smoke Tester'); await shot('23-dashboard-after-intake');
    // Kanban one-click move
    await go('/pipeline'); const before = db.prepare('SELECT stage FROM deals WHERE id = ?').get(d4).stage;
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.select(`form[action="/deals/${d4}/stage"].kmove select`, 'Underwriting')]);
    const after = db.prepare('SELECT stage FROM deals WHERE id = ?').get(d4).stage; if (after !== 'Underwriting' || before === after) throw new Error('kanban move failed');
    // ---- v2: outbox, automations, deal portal panel, borrower status portal (desktop + mobile)
    await go('/outbox', 'Automated sending: OFF'); await shot('24-outbox');
    const heldId = db.prepare("SELECT id FROM outbox WHERE status = 'held' AND rule_key = 'stage_change' AND channel = 'email'").get().id;
    await go('/outbox/' + heldId, 'as it will be sent'); await shot('25-outbox-message');
    await go('/automations', 'Stage-change updates'); await shot('26-automations');
    await go('/deals/' + d6, 'Borrower status portal'); await shot('27-deal-portal-panel');
    const portal = app.locals.engine.portalUrl(d6, { create: false }); if (!portal) throw new Error('no portal link for demo deal');
    const pctx = await browser.createBrowserContext(); const pv = await pctx.newPage(); await pv.setViewport({ width: 1280, height: 900 });
    pv.on('pageerror', e => problems.push('portal pageerror: ' + e.message)); pv.on('console', m => { if (m.type() === 'error') problems.push('portal console: ' + m.text()); });
    await pv.goto(portal, { waitUntil: 'networkidle0' }); await pv.screenshot({ path: path.join(OUT, '28-portal-verify.png') }); results.push('28-portal-verify');
    await pv.type('[name=email]', 'avery.sample@example.com'); await pv.type('[name=phone4]', '0101');
    await Promise.all([pv.waitForNavigation({ waitUntil: 'networkidle0' }), pv.click('form button.big')]);
    const ptxt = await pv.content();
    if (!ptxt.includes('What happens now') || !ptxt.includes('Conditions issued')) throw new Error('portal did not unlock');
    if (ptxt.includes('DEMO internal') || ptxt.includes('Wire instructions verified by phone')) throw new Error('portal leaked internal content');
    await pv.screenshot({ path: path.join(OUT, '29-portal-desktop.png'), fullPage: true }); results.push('29-portal-desktop');
    await pv.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 }); await pv.reload({ waitUntil: 'networkidle0' });
    await pv.screenshot({ path: path.join(OUT, '30-portal-mobile.png'), fullPage: true }); results.push('30-portal-mobile');
    const pdf2 = path.join(dir, 'Insurance-Binder.pdf'); fs.writeFileSync(pdf2, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const fin = await pv.$('.need-item input[type=file]'); await fin.uploadFile(pdf2);
    await Promise.all([pv.waitForNavigation({ waitUntil: 'networkidle0' }), pv.click('.need-item button')]);
    if (!(await pv.content()).includes('Uploaded: Insurance-Binder.pdf')) throw new Error('portal upload failed');
    await pv.screenshot({ path: path.join(OUT, '31-portal-mobile-after-upload.png'), fullPage: false }); results.push('31-portal-mobile-after-upload');
    await pctx.close();
    await go('/dashboard', 'Automation alerts'); await shot('32-dashboard-v2');
    // ---- v3 screens: walk them for console/CSP errors (v3 review screenshots come from scripts/screenshots-v3.js)
    await go('/', 'Next best action'); await go('/pipeline/health', 'Volume by step'); await go('/search?q=avery', 'Avery'); await go('/more', 'Numbers board');
    await go('/deals/' + d6 + '/next', 'Move to'); await go('/deals/' + d6 + '/summary', 'NOT A COMMITMENT TO LEND');
    await go('/new', 'What kind of loan is this?');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[name=loan_type][value=dscr]')]);
    await page.type('input[name=first_name]', 'Smokey'); await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.wiz-nav button')]);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[name=transaction_type][value=purchase]')]);
    await page.type('input[name=property_address]', '9 Smoke Ln'); await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.wiz-nav button')]);
    for (let i = 0; i < 3; i++) await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.wiz-nav button.primary')]);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.wiz-nav button.primary')]);
    if (!db.prepare("SELECT id FROM deals WHERE property_address = '9 Smoke Ln'").get()) throw new Error('wizard did not create the deal');
    await page.focus('body'); await page.keyboard.press('/'); await page.keyboard.type('avery');
    await page.waitForSelector('#cmd-results a', { visible: true, timeout: 5000 });
    await ctx.close();
  } catch (e) { problems.push('FAIL: ' + e.message); try { await shot('zz-failure'); } catch (_) { /* ignore */ } }
  await browser.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log('Screens captured (' + results.length + '): ' + results.join(', '));
  if (problems.length) { console.log('PROBLEMS:\n' + problems.join('\n')); process.exit(1); }
  console.log('SMOKE OK — all modules rendered with no console/CSP/page errors.');
})();
