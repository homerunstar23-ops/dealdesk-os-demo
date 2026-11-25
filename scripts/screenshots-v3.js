'use strict';
// v3 review screenshots against the LOCAL pm2 instance only (127.0.0.1:4100). Reads the local admin login
// from secrets/admin-login.txt at runtime (never printed). Walks the wizard up to "review" but does NOT
// create a deal. Sets the demo deal's investor ETA through the app's own form so the portal shows it.
// Run: node scripts/screenshots-v3.js
const fs = require('fs'); const path = require('path');
const puppeteer = require('puppeteer-core');
const BASE = 'http://127.0.0.1:4100';
const OUT = path.join(__dirname, '..', 'screenshots-review');
const login = fs.readFileSync(path.join(__dirname, '..', 'secrets', 'admin-login.txt'), 'utf8');
const EMAIL = (login.match(/Email:\s*(\S+)/) || [])[1]; const PASSWORD = (login.match(/Password:\s*(.+)/) || [])[1].trim();
const DESK = { width: 1440, height: 900 }, MOB = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const problems = []; const shots = [];
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); await page.setViewport(DESK);
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); }); page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const go = async (p, url) => { await p.goto(BASE + url, { waitUntil: 'networkidle0' }); };
  const shot = async (p, name, full = true) => { const f = path.join(OUT, name + '.png'); await p.screenshot({ path: f, fullPage: full }); shots.push(f); };
  try {
    await go(page, '/login'); await page.type('input[name=email]', EMAIL); await page.type('input[name=password]', PASSWORD);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('form[action="/login"] button')]);
    if (!(await page.content()).includes('Next best action') && !(await page.content()).includes('all caught up')) throw new Error('login or Today failed');
    await shot(page, 'v3-today-desktop');
    // command bar open
    await page.focus('body'); await page.keyboard.press('/'); await page.keyboard.type('avery'); await page.waitForSelector('#cmd-results a', { visible: true }); await shot(page, 'v3-command-bar-desktop', false);
    await go(page, '/pipeline'); await shot(page, 'v3-pipeline-desktop', false);
    await go(page, '/pipeline/health'); await shot(page, 'v3-health-desktop');
    // wizard (no deal is created)
    await go(page, '/new'); await shot(page, 'v3-wizard-1-type-desktop');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[name=loan_type][value=flip]')]);
    await page.type('input[name=first_name]', 'Sample'); await page.type('input[name=last_name]', 'Screenshot'); await shot(page, 'v3-wizard-2-who-desktop');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.wiz-nav button.primary')]);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[name=transaction_type][value=purchase]')]);
    await page.type('input[name=property_address]', '12 Example Ct'); await page.type('input[name=city]', 'Jupiter');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.wiz-nav button.primary')]);
    for (const [n, v] of [['purchase_price', '240000'], ['rehab_budget', '55000'], ['arv', '385000'], ['loan_amount', '250000']]) await page.type(`input[name=${n}]`, v);
    await shot(page, 'v3-wizard-5-numbers-desktop');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.wiz-nav button.primary')]);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.wiz-nav button.primary')]);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.wiz-nav button.primary')]);
    await shot(page, 'v3-wizard-8-review-desktop');
    // deal page + move-to-next + summary (the demo DSCR deal with a portal)
    await go(page, '/search?q=3%20Sampleton'); const dealHref = await page.$eval('.result-list a[href^="/deals/"]', a => a.getAttribute('href'));
    await go(page, dealHref); await page.type('#next-step input[name=next_step_note]', '');
    const eta = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
    await page.$eval('#next-step input[name=next_step_date]', (el, v) => { el.value = v; }, eta);
    await page.$eval('#next-step input[name=next_step_note]', (el) => { el.value = 'We expect to review your uploaded items with the lender'; });
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#next-step button')]);
    await go(page, dealHref); await shot(page, 'v3-deal-next-step-desktop');
    const portalUrl = await page.$eval('input[id^="portal-url-"]', el => el.value);
    await go(page, dealHref + '/next'); await shot(page, 'v3-move-next-step-desktop');
    await go(page, dealHref + '/summary'); await shot(page, 'v3-summary-desktop');
    await page.pdf({ path: path.join(OUT, 'v3-summary-print.pdf'), format: 'letter', printBackground: true }); shots.push(path.join(OUT, 'v3-summary-print.pdf'));
    // mobile (same session)
    await page.setViewport(MOB);
    await go(page, '/'); await shot(page, 'v3-today-mobile', false);
    await go(page, '/new'); await shot(page, 'v3-wizard-1-type-mobile', false);
    await go(page, dealHref); await shot(page, 'v3-deal-mobile', false);
    await go(page, '/pipeline/health'); await shot(page, 'v3-health-mobile', false);
    // investor portal in a fresh, logged-out context
    const pctx = await browser.createBrowserContext(); const pv = await pctx.newPage(); await pv.setViewport(DESK);
    pv.on('pageerror', e => problems.push('portal pageerror: ' + e.message));
    const u = new URL(portalUrl); await pv.goto(BASE + u.pathname, { waitUntil: 'networkidle0' });
    if (await pv.$('input[name=email]')) { await pv.type('input[name=email]', 'avery.sample@example.com'); if (await pv.$('input[name=phone4]')) await pv.type('input[name=phone4]', '0101');
      await Promise.all([pv.waitForNavigation({ waitUntil: 'networkidle0' }), pv.click('form[action$="/verify"] button')]); }
    await pv.screenshot({ path: path.join(OUT, 'v3-portal-desktop.png'), fullPage: true }); shots.push(path.join(OUT, 'v3-portal-desktop.png'));
    await pv.setViewport(MOB); await pv.reload({ waitUntil: 'networkidle0' });
    await pv.screenshot({ path: path.join(OUT, 'v3-portal-mobile.png'), fullPage: false }); shots.push(path.join(OUT, 'v3-portal-mobile.png'));
    await pctx.close();
    await go(page, '/new'); // leave no wizard draft behind (GET /new resets it)
  } catch (e) { problems.push('FAIL: ' + e.message); try { await shot(page, 'v3-zz-failure'); } catch (_) { /* ignore */ } }
  await browser.close();
  console.log(shots.map(s => path.relative(path.join(__dirname, '..'), s)).join('\n'));
  if (problems.length) { console.log('PROBLEMS:\n' + problems.join('\n')); process.exit(1); }
  console.log('V3 SCREENSHOTS OK');
})();
