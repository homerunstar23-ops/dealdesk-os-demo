'use strict';
// v3: pipeline health (charts from the app's own data), the one-button "Move to next step" flow,
// the investor-facing expected-next-step date, and a printable term-sheet-style deal summary.
const { html, raw, money, pct, fmtDate, str, text, date, todayISO, backTo } = require('../lib/util');
const { csrfInput, demoBanner } = require('../views/layout');
const { LOAN_TYPES, OPEN_STAGES } = require('../db');
const model = require('../lib/model');
const gates = require('../lib/gates');
const P = require('../lib/plain');
const stages = require('../lib/stages');
const C = require('../views/charts');
const A = require('../views/analysis');

const TX = { purchase: 'Purchase', refi: 'Rate/term refi', cashout: 'Cash-out refi' };
const dayOf = (ts) => (ts ? String(ts).replace('T', ' ').slice(0, 10) : null);
const daysSince = (d, today) => d ? Math.max(0, Math.round((new Date(today + 'T12:00:00Z') - new Date(d + 'T12:00:00Z')) / 864e5)) : null;
const ratio = (a, b) => (a && b ? (a / b) * 100 : null);

function stepper(stage) {
  const idx = gates.FLOW.indexOf(stage);
  return html`<ol class="stepper" aria-label="Deal steps">${gates.FLOW.map((s, i) => html`<li class="${i < idx ? 'done' : i === idx ? 'current' : ''}" ${i === idx ? raw('aria-current="step"') : ''}><span class="sdot">${i < idx ? '✓' : i + 1}</span><span class="slabel">${P.STAGE_PLAIN[s]}</span></li>`)}</ol>`;
}

function checklist(g) {
  return html`<ul class="gate-list">${g.checks.map(c => html`<li class="${c.ok ? 'ok' : 'todo'}"><span class="gmark" aria-hidden="true">${c.ok ? '✓' : '!'}</span><div><strong>${c.label}</strong>${c.detail ? html`<small>${c.detail}</small>` : ''}</div>${c.ok ? html`<span class="chip cond-cleared">Done</span>` : html`<a class="btn small" href="${c.fix.href}">${c.fix.text}</a>`}</li>`)}</ul>`;
}

// Overview "next step" card used on the deal page.
function nextCard(db, d, csrf) {
  const g = gates.gateFor(db, d);
  const done = g.checks.filter(c => c.ok).length;
  const eta = html`<form method="post" action="/deals/${d.id}/next-step" class="eta-form" id="next-step">${csrfInput(csrf)}
<p class="field-label">What the investor sees as "next step" ${P.tip(P.HELP.nextStepDate)}</p>
<div class="eta-row"><label class="field"><span>Expected date</span><input type="date" name="next_step_date" value="${d.next_step_date || ''}"></label>
<label class="field grow"><span>Short note (optional)</span><input name="next_step_note" value="${d.next_step_note || ''}" maxlength="200" placeholder="e.g. Appraisal visit being scheduled"></label><button class="btn small">Save</button></div>
<small class="muted">Plain words only: no approval, rate or guarantee language. Shown as an estimate, not a promise.</small></form>`;
  if (!g.next) return html`<section class="card next-card">${stepper(d.stage)}<h2>${d.stage === 'Closed' ? '🎉 This deal is closed.' : 'This deal is inactive.'}</h2>${eta}</section>`;
  return html`<section class="card next-card ${g.ready ? 'is-ready' : ''}">${stepper(d.stage)}
<div class="next-head"><div><p class="eyebrow">Step ${g.step} of ${g.steps} · now: ${P.STAGE_PLAIN[d.stage]}</p><h2>Next: ${P.STAGE_PLAIN[g.next]}</h2><p class="muted">${P.STAGE_HELP[g.next]}</p></div>
<a class="btn huge ${g.ready ? 'primary' : 'ghost'}" href="/deals/${d.id}/next">${g.ready ? 'Move to next step →' : `Move to next step (${g.checks.length - done} to do)`}</a></div>
${g.checks.length ? html`<details class="gate-peek" ${g.ready ? '' : raw('open')}><summary>${g.ready ? 'Everything is ready ✓' : `What's missing: ${g.checks.length - done} of ${g.checks.length}`}</summary>${checklist(g)}</details>` : html`<p class="small muted">Nothing to check here. When the lender tells you, tap the button and confirm.</p>`}
${eta}</section>`;
}

module.exports = (app) => {
  const db = app.locals.db; const cfg = app.locals.config; const engine = app.locals.engine;
  const getDeal = (id) => db.prepare("SELECT d.*, c.first_name, c.last_name, c.email c_email, c.phone c_phone, TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) borrower, co.name entity FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id LEFT JOIN companies co ON co.id = d.company_id WHERE d.id = ?").get(id);

  // ---- Pipeline health ----------------------------------------------------------------------------
  app.get('/pipeline/health', (req, res) => {
    const today = todayISO();
    const open = db.prepare(`SELECT d.*, c.first_name FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id WHERE d.stage IN (${OPEN_STAGES.map(() => '?').join(',')})`).all(...OPEN_STAGES);
    open.forEach(d => { d.inStage = daysSince(dayOf(d.stage_changed_at) || d.app_date || dayOf(d.created_at), today); d.sinceUpdate = daysSince(dayOf(d.updated_at || d.created_at), today); });
    const byStage = OPEN_STAGES.map(s => { const l = open.filter(d => d.stage === s); return { s, n: l.length, v: l.reduce((a, d) => a + (d.loan_amount || 0), 0), avg: l.length ? Math.round(l.reduce((a, d) => a + d.inStage, 0) / l.length) : 0, max: l.length ? Math.max(...l.map(d => d.inStage)) : 0 }; });
    const buckets = [['0–7 days', 0, 7], ['8–14 days', 8, 14], ['15–30 days', 15, 30], ['31+ days', 31, 1e9]].map(([l, a, b]) => ({ label: l, value: open.filter(d => d.sinceUpdate >= a && d.sinceUpdate <= b).length }));
    const months = []; const base = new Date(today + 'T12:00:00Z');
    for (let i = 5; i >= 0; i--) { const m = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1)); months.push(m.toISOString().slice(0, 7)); }
    const closed = db.prepare("SELECT substr(closed_date,1,7) m, COUNT(*) n, COALESCE(SUM(loan_amount),0) v FROM deals WHERE stage = 'Closed' AND closed_date IS NOT NULL GROUP BY 1").all().reduce((o, r) => (o[r.m] = r, o), {});
    const types = Object.keys(LOAN_TYPES).map(k => { const l = open.filter(d => d.loan_type === k); return { label: P.LOAN_PLAIN[k], value: l.length, text: `${l.length} · ${money(l.reduce((a, d) => a + (d.loan_amount || 0), 0))}` }; }).filter(r => r.value);
    const totalV = open.reduce((a, d) => a + (d.loan_amount || 0), 0); const stuck = open.filter(d => d.inStage > 14).length;
    const avgIn = open.length ? Math.round(open.reduce((a, d) => a + d.inStage, 0) / open.length) : 0;
    const closed90 = db.prepare("SELECT COUNT(*) n FROM deals WHERE stage = 'Closed' AND closed_date >= date(?, '-90 days')").get(today).n;
    const oldest = [...open].sort((a, b) => b.inStage - a.inStage).slice(0, 8);
    res.page('Pipeline health', '/pipeline/health', html`<div class="page-head"><div><h1>Pipeline health</h1><p class="muted">Built only from your DealDesk data as of ${fmtDate(today)}. Dollar amounts are what investors asked for, not approvals.</p></div><div><a class="btn ghost" href="/pipeline">Open the board</a> <button class="btn ghost" data-print>Print</button></div></div>
${open.length ? html`<div class="kpis"><div class="kpi"><span>Open deals</span><strong>${open.length}</strong><small>${money(totalV)} requested</small></div>
<div class="kpi"><span>Avg. days in current step ${P.tip('How long open deals have been sitting in the step they are in now.')}</span><strong>${avgIn}</strong><small>across open deals</small></div>
<div class="kpi ${stuck ? 'warn' : ''}"><span>Stuck 15+ days</span><strong>${stuck}</strong><small>in the same step</small></div>
<div class="kpi"><span>Closed (last 90 days)</span><strong>${closed90}</strong><small>by closing date</small></div></div>
<div class="grid2">
<section class="card"><h2>Volume by step</h2>${C.hbars(byStage.map(r => ({ label: P.STAGE_PLAIN[r.s], value: r.n, text: `${r.n} · ${money(r.v)}` })), { title: 'Open deals by step' })}</section>
<section class="card"><h2>Days in step</h2><p class="small muted">Average days open deals have been in each step (longest in brackets).</p>${C.hbars(byStage.map(r => ({ label: P.STAGE_PLAIN[r.s], value: r.avg, text: r.n ? `${r.avg}d avg (${r.max}d)` : '—', cls: r.avg > 14 ? 'hot' : '' })), { title: 'Average days in step' })}</section>
<section class="card"><h2>Aging</h2><p class="small muted">Days since anything on the deal last changed.</p>${C.columns(buckets.map(b => ({ label: b.label, value: b.value })), { title: 'Deals by days since last update' })}</section>
<section class="card"><h2>Closed by month</h2><p class="small muted">Last 6 months, by closing date.</p>${C.columns(months.map(m => ({ label: new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), value: closed[m] ? closed[m].n : 0, text: closed[m] ? `${closed[m].n}` : '0' })), { title: 'Closed loans by month' })}</section>
<section class="card"><h2>Loan type mix</h2>${C.hbars(types, { title: 'Open deals by loan type' })}</section>
<section class="card"><h2>Oldest in their step</h2><table><thead><tr><th>Deal</th><th>Step</th><th class="num">Days</th></tr></thead><tbody>${oldest.map(d => html`<tr><td><a href="/deals/${d.id}">${d.name}</a></td><td>${P.stageChip(d.stage)}</td><td class="num">${d.inStage}</td></tr>`)}</tbody></table></section>
</div>` : html`<div class="empty"><div class="empty-art">📊</div><h2>No open deals yet</h2><p>Charts appear as soon as you add your first deal.</p><p><a class="btn big primary" href="/new">+ Start a new deal</a></p></div>`}`);
  });

  // ---- Move to next step ------------------------------------------------------------------------------
  app.get('/deals/:id/next', (req, res, next) => {
    const d = getDeal(req.params.id); if (!d) return next();
    const g = gates.gateFor(db, d);
    res.page('Next step · ' + d.name, '/pipeline', html`<p><a href="/deals/${d.id}">← Back to ${d.name}</a></p>
<div class="wizard"><section class="card wiz-card">${stepper(d.stage)}
${!g.next ? html`<h1>${d.stage === 'Closed' ? '🎉 This deal is closed.' : 'This deal is inactive.'}</h1><p>There is no next step. To restart an inactive deal, use "Change step manually" on the deal page.</p>` : html`
<p class="eyebrow">Now: ${P.STAGE_PLAIN[d.stage]}</p><h1>Move to "${P.STAGE_PLAIN[g.next]}"?</h1><p class="lede">${P.STAGE_HELP[g.next]}</p>
${g.checks.length ? html`<h2>${g.ready ? 'Everything is ready ✓' : 'Before you can move it, finish these:'}</h2>${checklist(g)}` : ''}
<form method="post" action="/deals/${d.id}/next" class="stack">${csrfInput(res.locals.csrf)}
${g.confirms.length ? html`<h2>You confirm</h2>${g.confirms.map(c => html`<label class="check big-check"><input type="checkbox" name="${c.key}" value="1" required> <span>${c.label}</span></label>`)}` : ''}
<fieldset class="eta-box"><legend>Tell the investor what happens next (optional) ${P.tip(P.HELP.nextStepDate)}</legend>
<div class="eta-row"><label class="field"><span>Expected date</span><input type="date" name="next_step_date"></label><label class="field grow"><span>Short note</span><input name="next_step_note" maxlength="200" placeholder="e.g. Title is scheduling the closing"></label></div>
<small class="muted">Shown on their status page as an estimate, not a promise. No approval, rate or guarantee words.</small></fieldset>
<p class="small muted">Moving the deal runs your automations: it adds tasks, posts a plain-English update to the investor's status page, and puts any messages in your Outbox (automated sending is ${model.getSettings(db).automated_sending === '1' ? 'ON' : 'OFF'}).</p>
<button class="btn huge primary" ${g.ready ? '' : raw('disabled aria-disabled="true"')}>${g.ready ? `Move to "${P.STAGE_PLAIN[g.next]}" →` : 'Finish the items above first'}</button></form>`}</section></div>`);
  });
  app.post('/deals/:id/next', (req, res, next) => {
    const d = getDeal(req.params.id); if (!d) return next();
    const g = gates.gateFor(db, d);
    if (!g.next) { req.flash('There is no next step for this deal.', 'warn'); return res.redirect('/deals/' + d.id); }
    const missing = g.checks.filter(c => !c.ok).map(c => c.label).concat(g.confirms.filter(c => !req.body[c.key]).map(c => 'Confirm: ' + c.label));
    if (missing.length) { req.flash('Not yet. Still to do: ' + missing.join(' · '), 'err'); return res.redirect(303, `/deals/${d.id}/next`); }
    const note = text(req.body.next_step_note, 200); const bad = P.lintBorrowerText(note);
    if (bad) { req.flash(`The investor note can't include "${bad}". Use plain status words (no approval, rate or guarantee language).`, 'err'); return res.redirect(303, `/deals/${d.id}/next`); }
    const r = gates.moveStage(db, engine, d.id, g.next, { userId: req.user.id, nextStepDate: date(req.body.next_step_date), nextStepNote: note });
    req.flash(`🚀 ${d.name} is now at "${P.STAGE_PLAIN[g.next]}". ` + r.msg); res.redirect(303, '/deals/' + d.id);
  });
  app.post('/deals/:id/next-step', (req, res, next) => {
    const d = getDeal(req.params.id); if (!d) return next();
    const note = text(req.body.next_step_note, 200); const bad = P.lintBorrowerText(note);
    if (bad) { req.flash(`The investor note can't include "${bad}". Use plain status words (no approval, rate or guarantee language).`, 'err'); return res.redirect(303, `/deals/${d.id}#next-step`); }
    const dt = date(req.body.next_step_date);
    db.prepare("UPDATE deals SET next_step_date = ?, next_step_note = ?, updated_at = datetime('now') WHERE id = ?").run(dt, note, d.id);
    model.log(db, { entity_type: 'deal', entity_id: d.id, action: 'deal.next_step', detail: `Investor next-step date ${dt ? 'set to ' + dt : 'cleared'}`, user_id: req.user.id });
    req.flash(dt ? `Saved. The investor now sees "${fmtDate(dt)}" as the expected next step.` : 'Saved. No expected date is shown to the investor.');
    res.redirect(303, backTo(req, '/deals/' + d.id) + '#next-step');
  });

  // ---- Term-sheet-style deal summary (internal, printable) ---------------------------------------------
  app.get('/deals/:id/summary', (req, res, next) => {
    const d = getDeal(req.params.id); if (!d) return next();
    const st = model.getSettings(db); const today = todayISO();
    const an = model.getAnalysis(d); const out = model.runAnalysis(an.strategy, an.inputs[an.strategy], d); const r = out.result || {};
    const conds = db.prepare('SELECT status, COUNT(*) n FROM conditions WHERE deal_id = ? GROUP BY status').all(d.id).reduce((o, x) => (o[x.status] = x.n, o), {});
    const totalItems = Object.values(conds).reduce((a, n) => a + n, 0); const doneItems = (conds.cleared || 0) + (conds.waived || 0);
    const g = gates.gateFor(db, d);
    const value = d.transaction_type === 'purchase' ? d.purchase_price || d.as_is_value : d.as_is_value || d.purchase_price;
    const cost = (d.purchase_price || d.as_is_value || 0) + (d.rehab_budget || 0);
    const lo = [st.lo_name, st.lo_title, st.nmls_id && 'NMLS #' + st.nmls_id, st.company_name && (st.company_name + (st.company_nmls_id ? ' NMLS #' + st.company_nmls_id : '')), st.phone].filter(Boolean).join(' · ');
    const kv = (rows) => html`<table class="ts-kv"><tbody>${rows.filter(Boolean).map(([k, v, t]) => html`<tr><th>${k}${t ? html` <small class="muted">${t}</small>` : ''}</th><td>${v == null || v === '' ? '—' : v}</td></tr>`)}</tbody></table>`;
    const headline = an.strategy === 'dscr' ? (r.dscr ? r.dscr.toFixed(2) + 'x DSCR' : '—') : an.strategy === 'flip' ? money(r.profit) + ' projected profit' : an.strategy === 'brrrr' ? money(r.cashLeftInDeal) + ' cash left in deal' : money(r.cashFlowMonthly) + '/mo cash flow';
    res.send('<!doctype html>' + html`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deal summary — ${d.name}</title><link rel="stylesheet" href="/static/app.css"><link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><meta name="robots" content="noindex"></head><body class="print-doc ts-body">${demoBanner(cfg.demoMode)}
<div class="noprint toolbar"><button class="btn" data-print>Print / save as PDF</button> <a class="btn ghost" href="/deals/${d.id}">Back to the deal</a><span class="small muted">Internal summary for you, your processor or a scenario desk. Not for borrowers without sponsoring-broker compliance approval.</span></div>
<article class="termsheet">
<header class="ts-head"><div><p class="ts-brand"><span class="logo">DD</span> DealDesk OS</p><h1>Deal summary</h1><p class="muted">${d.name}${d.is_demo ? ' · DEMO DATA' : ''}</p></div>
<div class="ts-meta"><div class="stamp">INTERNAL SUMMARY — NOT A COMMITMENT TO LEND</div><p>Prepared ${fmtDate(today)}<br>Ref. DD-${String(d.id).padStart(5, '0')}</p></div></header>
<section class="ts-status"><div><span class="ts-label">Current step</span><strong>${P.STAGE_PLAIN[d.stage]}</strong><small>${d.stage}</small></div><div><span class="ts-label">Next step</span><strong>${g.next ? P.STAGE_PLAIN[g.next] : '—'}</strong><small>${g.next ? (g.ready ? 'Ready to move' : `${g.checks.filter(c => !c.ok).length} item(s) to finish`) : ''}</small></div>
<div><span class="ts-label">Checklist</span><strong>${doneItems} / ${totalItems}</strong><small>done or not needed</small></div><div><span class="ts-label">Target close</span><strong>${fmtDate(d.target_close_date)}</strong><small>${d.next_step_date ? 'Investor ETA ' + fmtDate(d.next_step_date) : ''}</small></div></section>
<div class="ts-grid"><section><h2>Borrower</h2>${kv([['Investor', d.borrower || null], ['Vesting entity', d.entity || 'Individual / TBD'], ['Experience', d.experience_deals == null ? null : d.experience_deals + ' prior projects', '(self-reported)'], ['Credit range', d.credit_range, '(self-reported)'], ['Liquidity', d.liquidity != null ? money(d.liquidity) : null, '(self-reported)'], ['Lead source', d.lead_source]])}</section>
<section><h2>Property</h2>${kv([['Address', [d.property_address, d.city, d.state, d.zip].filter(Boolean).join(', ')], ['Type', d.property_type], ['Units', d.units], ['Exit plan', d.exit_strategy]])}</section>
<section><h2>Loan request</h2>${kv([['Program type', LOAN_TYPES[d.loan_type]], ['Transaction', TX[d.transaction_type] || d.transaction_type], ['Amount requested', money(d.loan_amount)], ['Purchase price', d.purchase_price ? money(d.purchase_price) : null], ['As-is value', d.as_is_value ? money(d.as_is_value) : null, '(estimate)'], ['Rehab / construction', d.rehab_budget ? money(d.rehab_budget) : null], ['After-repair value', d.arv ? money(d.arv) : null, '(estimate)'], ['Market / lease rent', d.monthly_rent ? money(d.monthly_rent) + '/mo' : null], ['Existing payoff', d.payoff ? money(d.payoff) : null]])}</section>
<section><h2>Ratios <small class="muted">(math on the numbers above)</small></h2>${kv([['Loan-to-value', pct(ratio(d.loan_amount, value))], ['Loan-to-cost', d.rehab_budget ? pct(ratio(d.loan_amount, cost)) : null], ['Loan-to-ARV', d.arv ? pct(ratio(d.loan_amount, d.arv)) : null], ['Analyzer snapshot', html`${headline} <small class="muted">${A.STRATS[an.strategy]} · ${an.isDefault ? 'starter assumptions' : 'saved ' + fmtDate(dayOf(an.savedAt))}</small>`]])}</section></div>
<section class="ts-steps"><h2>Progress</h2><ol class="ts-timeline">${gates.FLOW.map((s, i) => { const idx = gates.FLOW.indexOf(d.stage); return html`<li class="${i < idx ? 'done' : i === idx ? 'current' : ''}">${P.STAGE_PLAIN[s]}</li>`; })}</ol>
<p class="small">Created ${fmtDate(dayOf(d.created_at))} · Application ${fmtDate(d.app_date)} · In current step since ${fmtDate(dayOf(d.stage_changed_at))}${d.closed_date ? ' · Closed ' + fmtDate(d.closed_date) : ''}</p></section>
<footer class="disclaimer"><p><strong>Internal summary only. This is not a loan offer, approval, rate quote, Loan Estimate, term sheet issued by a lender, or commitment to lend.</strong> Figures are what the borrower reported or what was entered into DealDesk OS, and ratios are simple math on those figures. Actual terms, if any, come only from the lender after a complete application, underwriting, credit review, valuation, title and insurance, under that lender's guidelines. Business-purpose investment property financing only.</p>
<p>${lo || '[Loan officer name · NMLS # · Company · Company NMLS #]'} ${st.state_disclosures || ''}</p></footer>
</article><script src="/static/app.js"></script></body></html>`);
  });
};
module.exports.nextCard = nextCard;
module.exports.stepper = stepper;
