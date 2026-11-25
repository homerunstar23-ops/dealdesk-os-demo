'use strict';
// v3 home screen ("Today"): ONE big next-best-action card at a time, plus search / command bar and "More".
const { html, money, str, todayISO, backTo } = require('../lib/util');
const { csrfInput, MORE, demoTag } = require('../views/layout');
const { LOAN_TYPES, OPEN_STAGES } = require('../db');
const T = require('../lib/today');
const P = require('../lib/plain');

const COMMANDS = [
  ['New deal', '/new', 'new deal add create start loan application wizard'], ['Today', '/', 'today home next action todo'],
  ['Deals (pipeline)', '/pipeline', 'pipeline deals kanban board'], ['Pipeline health', '/pipeline/health', 'health charts aging report stats'],
  ['Outbox', '/outbox', 'outbox messages email text sms approve'], ['People', '/contacts', 'contacts people borrowers investors agents'],
  ['New person', '/contacts/new', 'new contact person add'], ['Tasks', '/tasks', 'tasks follow up todo'], ['Automations', '/automations', 'automations rules sequences kill switch'],
  ['Templates', '/templates', 'templates scripts email text'], ['Compliance', '/compliance', 'compliance respa tcpa can-spam fair lending'],
  ['Numbers board', '/dashboard', 'dashboard numbers kpi'], ['Settings', '/settings', 'settings profile nmls password backup'],
  ['Investor application form', '/apply', 'apply intake public form']
];

function greet(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: process.env.APP_TZ || 'America/New_York', hour: 'numeric', hour12: false }).format(now));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

module.exports = (app) => {
  const db = app.locals.db;

  function search(q, limit = 8) {
    const like = '%' + q.replace(/[%_]/g, '') + '%'; const ql = q.toLowerCase();
    const cmds = COMMANDS.filter(([l, , k]) => l.toLowerCase().includes(ql) || k.includes(ql)).slice(0, 4).map(([label, href]) => ({ type: 'Go to', label, href }));
    const deals = db.prepare(`SELECT d.id, d.name, d.stage, d.loan_type, d.loan_amount, d.is_demo, c.first_name, c.last_name FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id
      WHERE d.name LIKE ? OR d.property_address LIKE ? OR d.city LIKE ? OR c.first_name || ' ' || COALESCE(c.last_name,'') LIKE ? ORDER BY d.stage IN ('Closed','Dead'), d.id DESC LIMIT ?`).all(like, like, like, like, limit)
      .map(d => ({ type: 'Deal', label: d.name, sub: `${P.STAGE_PLAIN[d.stage]} · ${LOAN_TYPES[d.loan_type]} · ${money(d.loan_amount)}`, href: `/deals/${d.id}`, demo: d.is_demo }));
    const people = db.prepare(`SELECT id, first_name, last_name, type, email, city, is_demo FROM contacts WHERE first_name || ' ' || COALESCE(last_name,'') LIKE ? OR email LIKE ? OR phone LIKE ? ORDER BY first_name LIMIT ?`).all(like, like, like, limit)
      .map(c => ({ type: 'Person', label: [c.first_name, c.last_name].filter(Boolean).join(' '), sub: [c.type, c.city].filter(Boolean).join(' · '), href: `/contacts/${c.id}`, demo: c.is_demo }));
    const cos = db.prepare('SELECT id, name, kind, is_demo FROM companies WHERE name LIKE ? ORDER BY name LIMIT ?').all(like, limit).map(c => ({ type: 'Company', label: c.name, sub: c.kind || '', href: `/companies/${c.id}`, demo: c.is_demo }));
    const tasks = db.prepare('SELECT id, title, due_date, deal_id FROM tasks WHERE done = 0 AND title LIKE ? ORDER BY due_date LIMIT ?').all(like, 5).map(t => ({ type: 'Task', label: t.title, sub: t.due_date ? 'due ' + t.due_date : '', href: t.deal_id ? `/deals/${t.deal_id}` : '/tasks' }));
    return { cmds, deals, people, cos, tasks };
  }

  app.get('/', (req, res) => {
    const today = todayISO(); const actions = T.buildActions(db, { today });
    const top = actions[0]; const rest = actions.slice(1);
    const openDeals = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(loan_amount),0) v FROM deals WHERE stage IN (${OPEN_STAGES.map(() => '?').join(',')})`).get(...OPEN_STAGES);
    const waiting = db.prepare(`SELECT COUNT(*) n FROM conditions x JOIN deals d ON d.id = x.deal_id WHERE x.status = 'requested' AND d.stage NOT IN ('Closed','Dead')`).get().n;
    const doneToday = db.prepare("SELECT COUNT(*) n FROM today_dismissals WHERE day = ? AND kind = 'done'").get(today).n;
    const first = (req.user.name || '').split(' ')[0];
    const dateLine = new Intl.DateTimeFormat('en-US', { timeZone: process.env.APP_TZ || 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
    const btnForms = (a, big) => html`<form method="post" action="/today/done" class="inline">${csrfInput(res.locals.csrf)}<input type="hidden" name="key" value="${a.key}"><button class="btn ${big ? 'huge' : 'small'} ok">✓ ${big ? a.doneText : 'Done'}</button></form>
<form method="post" action="/today/skip" class="inline">${csrfInput(res.locals.csrf)}<input type="hidden" name="key" value="${a.key}"><button class="btn ${big ? 'huge' : 'small'} ghost">Skip${big ? ' for today' : ''}</button></form>`;
    const row = (a) => html`<li class="next-row kind-${a.kind}"><span class="ico" aria-hidden="true">${a.icon}</span><div class="next-main"><a href="${a.doHref}"><strong>${a.title}</strong></a><small>${a.why}</small></div><div class="next-act">${btnForms(a, false)}</div></li>`;
    res.page('Today', '/', html`
<section class="today-hero"><p class="eyebrow">${dateLine}</p><h1>${greet()}${first ? ', ' + first : ''}.</h1>
<p class="lede">${actions.length ? html`You have <strong>${actions.length}</strong> thing${actions.length > 1 ? 's' : ''} to do. Here's the most important one.` : 'Nothing needs you right now.'}</p>
<div class="stat-strip"><a href="/pipeline"><strong>${openDeals.n}</strong><span>open deals</span></a><a href="/pipeline/health"><strong>${money(openDeals.v)}</strong><span>requested in pipeline ${P.tip('The total of the loan amounts investors asked for on open deals. Not approvals.')}</span></a>
<a href="/dashboard"><strong>${waiting}</strong><span>items waiting on borrowers</span></a><span class="stat"><strong>${doneToday}</strong><span>done today</span></span></div></section>
${top ? html`<article class="action-card kind-${top.kind}" aria-live="polite"><div class="action-top"><span class="action-icon" aria-hidden="true">${top.icon}</span><p class="eyebrow">Next best action · 1 of ${actions.length}</p></div>
<h2>${top.title}</h2><p class="why">${top.why}</p>
<div class="action-buttons"><a class="btn huge primary" href="${top.doHref}">${top.doText} →</a>${top.call ? html`<a class="btn huge ghost" href="tel:${String(top.call).replace(/[^\d+]/g, '')}">📞 Call ${top.call}</a>` : ''}${btnForms(top, true)}</div>
${top.kind === 'intake' ? html`<p class="small muted">Before any marketing text or call list, check their consent on the person page. Manual, one-to-one calls about their own request are fine.</p>` : ''}</article>`
    : html`<article class="action-card empty-card"><div class="empty-art" aria-hidden="true">🎉</div><h2>You're all caught up.</h2><p class="why">Great time to start a new deal or check pipeline health.</p><div class="action-buttons"><a class="btn huge primary" href="/new">+ Start a new deal</a><a class="btn huge ghost" href="/pipeline/health">See pipeline health</a></div></article>`}
${rest.length ? html`<section class="card up-next"><div class="card-head"><h2>Up next <span class="count">${rest.length}</span></h2><span class="small muted">Ranked by urgency</span></div>
<ol class="next-list">${rest.slice(0, 6).map(row)}</ol>${rest.length > 6 ? html`<details class="more-next"><summary>Show ${rest.length - 6} more</summary><ol class="next-list">${rest.slice(6).map(row)}</ol></details>` : ''}</section>` : ''}
<section class="quick-tiles" aria-label="Shortcuts"><a href="/new" class="tile"><span>＋</span><strong>New deal</strong><small>One question at a time</small></a><a href="/pipeline" class="tile"><span>📂</span><strong>All deals</strong><small>Board by step</small></a>
<a href="/pipeline/health" class="tile"><span>📊</span><strong>Pipeline health</strong><small>Charts from your data</small></a><a href="/outbox" class="tile"><span>✉️</span><strong>Outbox</strong><small>Approve messages</small></a></section>`);
  });
  app.get('/today', (req, res) => res.redirect('/'));
  for (const kind of ['done', 'skip']) {
    app.post('/today/' + kind, (req, res) => {
      const key = str(req.body.key, 120);
      if (key && /^[a-z]+:[0-9:A-Za-z ]+$/.test(key)) { T.complete(db, key, { userId: req.user.id, kind }); req.flash(kind === 'done' ? 'Nice work. ✓ Here\'s the next one.' : 'Skipped for today. Here\'s the next one.'); }
      res.redirect(303, backTo(req, '/'));
    });
  }

  // ---- Search / command bar ------------------------------------------------------------------------
  app.get('/search.json', (req, res) => {
    const q = str(req.query.q, 80); if (!q) return res.json({ results: [] });
    const r = search(q, 5);
    res.json({ results: [...r.cmds, ...r.deals, ...r.people, ...r.cos, ...r.tasks].slice(0, 12) });
  });
  app.get('/search', (req, res) => {
    const q = str(req.query.q, 80);
    const r = q ? search(q, 25) : null;
    const group = (title, rows) => rows.length ? html`<section class="card"><h2>${title} <span class="count">${rows.length}</span></h2><ul class="result-list">${rows.map(x => html`<li><a href="${x.href}"><strong>${x.label}</strong>${x.demo ? html` <span class="badge demo">DEMO</span>` : ''}</a>${x.sub ? html`<small>${x.sub}</small>` : ''}</li>`)}</ul></section>` : '';
    const total = r ? r.cmds.length + r.deals.length + r.people.length + r.cos.length + r.tasks.length : 0;
    res.page(q ? 'Search: ' + q : 'Search', '/search', html`<h1>Search</h1>
<form action="/search" method="get" class="bigsearch" role="search"><input name="q" type="search" value="${q || ''}" placeholder="A name, an address, a city, or a command like &quot;new deal&quot;" autofocus aria-label="Search"><button class="btn big">Search</button></form>
${!q ? html`<p class="muted">Tip: press <kbd>/</kbd> anywhere to jump to the search bar.</p><section class="card"><h2>Jump to</h2><div class="chip-row">${COMMANDS.map(([l, h]) => html`<a class="chip link" href="${h}">${l}</a>`)}</div></section>`
    : total ? html`${group('Go to', r.cmds)}${group('Deals', r.deals)}${group('People', r.people)}${group('Companies', r.cos)}${group('Tasks', r.tasks)}`
      : html`<div class="empty"><div class="empty-art">🔎</div><h2>No matches for "${q}"</h2><p>Try part of a name, a street, or a city.</p><p><a class="btn" href="/new">+ Start a new deal</a></p></div>`}`);
  });
  app.get('/more', (req, res) => res.page('More', '/more', html`<h1>More</h1><div class="tile-grid">${MORE.map(([h, l, hint]) => html`<a class="tile" href="${h}"><strong>${l}</strong><small>${hint}</small></a>`)}
<a class="tile" href="/apply" target="_blank" rel="noopener"><strong>Investor application form ↗</strong><small>The public form investors fill out</small></a></div>`));
};
module.exports.COMMANDS = COMMANDS;
