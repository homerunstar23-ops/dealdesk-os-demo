'use strict';
const { html, money, fmtDate, fmtDateTime } = require('../lib/util');
const { stageClass, demoTag } = require('../views/layout');
const model = require('../lib/model');
const { OPEN_STAGES } = require('../db');

module.exports = (app) => {
  const db = app.locals.db;
  app.get('/', (req, res) => {
    const d = model.dashboard(db);
    const maxCount = Math.max(1, ...d.byStage.map(s => s.count));
    const taskRow = (t, cls) => html`<li class="${cls}"><a href="${t.deal_id ? '/deals/' + t.deal_id : '/tasks'}">${t.title}</a> <span class="muted">${t.deal_name || t.contact_name || ''} · due ${fmtDate(t.due_date)}</span></li>`;
    const held = db.prepare("SELECT COUNT(*) n FROM outbox WHERE status = 'held'").get().n;
    const blocked = db.prepare("SELECT COUNT(*) n FROM outbox WHERE status = 'blocked' AND updated_at >= datetime('now','-7 days')").get().n;
    const alerts = db.prepare('SELECT n.*, d.name deal_name FROM notifications n LEFT JOIN deals d ON d.id = n.deal_id WHERE n.read_at IS NULL ORDER BY n.id DESC LIMIT 8').all();
    const sendingOn = model.getSettings(db).automated_sending === '1';
    res.page('Dashboard', '/', html`<div class="page-head"><h1>Dashboard</h1><div><a class="btn" href="/deals/new">+ New deal</a> <a class="btn ghost" href="/contacts/new">+ New contact</a></div></div>
<div class="kpis">
  <div class="kpi"><span>Open pipeline</span><strong>${money(d.openValue)}</strong><small>${d.openCount} open deals (requested loan amounts)</small></div>
  <div class="kpi ${d.overdue.length ? 'warn' : ''}"><span>Tasks overdue / due today</span><strong>${d.overdue.length} / ${d.dueToday.length}</strong><small><a href="/tasks">Open task list</a></small></div>
  <div class="kpi ${d.newIntakes.length ? 'hot' : ''}"><span>New intakes to review</span><strong>${d.newIntakes.length}</strong><small>From the public form</small></div>
  <div class="kpi"><span>Outstanding conditions</span><strong>${d.outstandingTotal}</strong><small>Requested, received or in review</small></div>
  <div class="kpi ${held ? 'warn' : ''}"><span>Messages waiting for approval</span><strong>${held}</strong><small><a href="/outbox?status=held">Outbox</a> · sending ${sendingOn ? 'ON' : 'OFF'}${blocked ? ` · ${blocked} blocked (7d)` : ''}</small></div>
  <div class="kpi ${d.unpaid.length ? 'warn' : ''}"><span>Unpaid fee requests</span><strong>${d.unpaid.length}</strong><small>${money(d.unpaid.reduce((a, p) => a + p.amount_cents, 0) / 100, 2)} outstanding</small></div>
</div>
<div class="grid2">
<section class="card"><h2>Pipeline by stage</h2><table class="bars"><tbody>${d.byStage.map(s => html`<tr><td><a href="/pipeline?view=table&stage=${encodeURIComponent(s.stage)}"><span class="${stageClass(s.stage)}">${s.stage}</span></a></td><td class="num">${s.count}</td><td class="bar"><i class="w${Math.round(s.count / maxCount * 10)}"></i></td><td class="num">${money(s.value)}</td></tr>`)}</tbody></table>
<p class="muted small">Values are requested loan amounts, not approvals. ${OPEN_STAGES.length} open stages.</p></section>
<section class="card"><h2>Tasks</h2>
${d.overdue.length ? html`<h3 class="red">Overdue</h3><ul class="tasks">${d.overdue.map(t => taskRow(t, 'overdue'))}</ul>` : ''}
<h3>Due today</h3>${d.dueToday.length ? html`<ul class="tasks">${d.dueToday.map(t => taskRow(t, 'today'))}</ul>` : html`<p class="muted">Nothing due today.</p>`}</section>
<section class="card"><h2>New intakes</h2>${d.newIntakes.length ? html`<ul class="list">${d.newIntakes.map(x => html`<li><a href="/deals/${x.id}">${x.name}</a>${demoTag(x)} <span class="muted">${x.first_name} ${x.last_name} · ${fmtDateTime(x.created_at)}</span></li>`)}</ul>` : html`<p class="muted">No new intakes. Share <a href="/apply" target="_blank" rel="noopener">/apply</a> once your sponsor approves it.</p>`}</section>
<section class="card"><h2>Outstanding conditions</h2>${d.outstanding.length ? html`<table><thead><tr><th>Deal</th><th>Requested</th><th>Received</th><th>In review</th></tr></thead><tbody>${d.outstanding.map(o => html`<tr><td><a href="/deals/${o.id}/underwriting">${o.name}</a></td><td class="num">${o.requested}</td><td class="num">${o.received}</td><td class="num">${o.reviewed}</td></tr>`)}</tbody></table>` : html`<p class="muted">None.</p>`}</section>
<section class="card"><h2>Unpaid appraisal / fee requests</h2>${d.unpaid.length ? html`<table><thead><tr><th>Deal</th><th>Item</th><th>Amount</th><th>Requested</th></tr></thead><tbody>${d.unpaid.map(p => html`<tr><td><a href="/deals/${p.deal_id}/payments">${p.deal_name}</a></td><td>${p.description}</td><td class="num">${money(p.amount_cents / 100, 2)}</td><td>${fmtDate(p.requested_at)}</td></tr>`)}</tbody></table>` : html`<p class="muted">None.</p>`}</section>
<section class="card"><div class="card-head"><h2>Automation alerts</h2><a class="btn tiny ghost" href="/automations">Automations</a></div>${alerts.length ? html`<ul class="list small">${alerts.map(n => html`<li><strong>${n.title}</strong>${n.deal_id ? html` · <a href="/deals/${n.deal_id}">open</a>` : ''} <span class="muted">· ${fmtDateTime(n.created_at)}</span></li>`)}</ul>` : html`<p class="muted">No unread alerts.</p>`}</section>
<section class="card"><h2>Recent activity</h2><ul class="list small">${d.recent.map(a => html`<li>${a.detail || a.action} <span class="muted">· ${a.user_name || 'system/public'} · ${fmtDateTime(a.created_at)}</span></li>`)}</ul></section>
</div>`);
  });
};
