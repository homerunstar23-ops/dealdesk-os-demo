'use strict';
const { portalPanel, dealOutbox } = require('../views/automation');
// Pipeline, deal record, analyzer + estimate, underwriting workspace, documents, payments.
const fs = require('fs');
const path = require('path');
const { html, raw, money, pct, fmtDate, fmtDateTime, str, text, num, int, oneOf, date, url, sha256, randomToken, todayISO, backTo, bool } = require('../lib/util');
const { field, csrfInput, stageClass, demoTag, demoBanner, badge, BRAND } = require('../views/layout');
const { STAGES, OPEN_STAGES, LOAN_TYPES, COND_STATUSES, PAY_STATUSES, CREDIT_RANGES } = require('../db');
const { verifyCsrf } = require('../lib/security');
const model = require('../lib/model');
const ref = require('../reference');
const up = require('../lib/uploads');
const stripe = require('../lib/stripe');
const A = require('../views/analysis');
const { notesBlock, activityBlock, tasksBlock, fullName } = require('./crm').helpers;

const TX = [['purchase', 'Purchase'], ['refi', 'Rate/term refi'], ['cashout', 'Cash-out refi']];
const PROPERTY_TYPES = ['Single family', '2-4 unit', 'Condo / townhome', '5+ unit multifamily', 'Mixed use', 'Lot / new construction', 'Other'];
const DEAL_NUM = ['purchase_price', 'as_is_value', 'rehab_budget', 'arv', 'monthly_rent', 'payoff', 'loan_amount', 'liquidity'];

function subnav(d, active) {
  const tabs = [['', 'Overview'], ['/analyze', 'Deal analyzer'], ['/underwriting', 'Underwriting'], ['/documents', 'Documents'], ['/payments', 'Fees & payments']];
  return html`<div class="page-head"><div><h1>${d.name}${demoTag(d)}</h1><p class="muted"><span class="${stageClass(d.stage)}">${d.stage}</span> · ${LOAN_TYPES[d.loan_type]} · ${money(d.loan_amount)} requested ${d.borrower ? html`· <a href="/contacts/${d.contact_id}">${d.borrower}</a>` : ''}</p></div>
<form method="post" action="/deals/${d.id}/stage" class="inline stage-move" data-csrf>${raw('')}<input type="hidden" name="_csrf" value="${d._csrf}"><select name="stage">${STAGES.map(s => html`<option ${s === d.stage ? 'selected' : ''}>${s}</option>`)}</select><button class="btn small">Move</button></form></div>
<nav class="tabs">${tabs.map(([p, l]) => html`<a href="/deals/${d.id}${p}" class="${active === p ? 'active' : ''}">${l}</a>`)}</nav>`;
}

function dealForm(csrf, d, contacts, companies) {
  return html`<form method="post" action="${d.id ? '/deals/' + d.id : '/deals'}" class="card form-grid">${csrfInput(csrf)}
${field('name', 'Deal name', { value: d.name, max: 150, placeholder: 'Auto: address — loan type', cls: 'span2' })}
${field('contact_id', 'Primary borrower / contact', { type: 'select', options: [['', '—'], ...contacts.map(c => [c.id, fullName(c) + ' (' + c.type + ')'])], value: d.contact_id })}
${field('company_id', 'Vesting entity', { type: 'select', options: [['', '— individual —'], ...companies.map(c => [c.id, c.name])], value: d.company_id })}
${field('stage', 'Stage', { type: 'select', options: STAGES, value: d.stage || 'Lead' })}${field('loan_type', 'Loan type', { type: 'select', options: Object.entries(LOAN_TYPES), value: d.loan_type })}
${field('transaction_type', 'Transaction', { type: 'select', options: TX, value: d.transaction_type })}${field('property_type', 'Property type', { type: 'select', options: PROPERTY_TYPES, value: d.property_type })}
${field('property_address', 'Property address', { value: d.property_address, max: 150 })}${field('city', 'City', { value: d.city, max: 80 })}
${field('state', 'State', { value: d.state, max: 2 })}${field('zip', 'ZIP', { value: d.zip, max: 10 })}${field('units', 'Units', { type: 'number', value: d.units })}
${field('purchase_price', 'Purchase price ($)', { type: 'number', value: d.purchase_price })}${field('as_is_value', 'As-is value ($)', { type: 'number', value: d.as_is_value })}
${field('rehab_budget', 'Rehab / construction ($)', { type: 'number', value: d.rehab_budget })}${field('arv', 'ARV ($)', { type: 'number', value: d.arv })}
${field('monthly_rent', 'Monthly rent ($)', { type: 'number', value: d.monthly_rent })}${field('payoff', 'Existing payoff ($)', { type: 'number', value: d.payoff })}
${field('loan_amount', 'Loan amount requested ($)', { type: 'number', value: d.loan_amount })}${field('experience_deals', 'Experience (# projects)', { type: 'number', value: d.experience_deals })}
${field('credit_range', 'Credit range (self-reported)', { type: 'select', options: [['', '—'], ...CREDIT_RANGES], value: d.credit_range })}${field('liquidity', 'Liquidity ($, self-reported)', { type: 'number', value: d.liquidity })}
${field('lead_source', 'Lead source', { value: d.lead_source })}${field('app_date', 'Application date', { type: 'date', value: d.app_date })}
${field('target_close_date', 'Target close', { type: 'date', value: d.target_close_date })}${field('closed_date', 'Closed date', { type: 'date', value: d.closed_date })}
${field('dead_reason', 'Dead / withdrawn reason', { value: d.dead_reason })}
${field('exit_strategy', 'Exit strategy', { type: 'textarea', value: d.exit_strategy, cls: 'span2' })}
<div class="span2"><button class="btn">Save deal</button> <a class="btn ghost" href="${d.id ? '/deals/' + d.id : '/pipeline'}">Cancel</a></div></form>`;
}
function readDeal(b) {
  const o = {
    name: str(b.name, 150), contact_id: int(b.contact_id) || null, company_id: int(b.company_id) || null, stage: oneOf(b.stage, STAGES, 'Lead'), loan_type: oneOf(b.loan_type, Object.keys(LOAN_TYPES), 'dscr'),
    transaction_type: oneOf(b.transaction_type, TX.map(t => t[0]), 'purchase'), property_type: oneOf(b.property_type, PROPERTY_TYPES, 'Other'), property_address: text(b.property_address, 150), city: str(b.city, 80),
    state: (str(b.state, 2) || '').toUpperCase() || null, zip: str(b.zip, 10), units: int(b.units, { min: 0, max: 10000 }), experience_deals: int(b.experience_deals, { min: 0, max: 10000 }),
    credit_range: oneOf(b.credit_range, CREDIT_RANGES), lead_source: str(b.lead_source, 120), app_date: date(b.app_date), target_close_date: date(b.target_close_date), closed_date: date(b.closed_date),
    dead_reason: str(b.dead_reason, 300), exit_strategy: text(b.exit_strategy, 2000)
  };
  DEAL_NUM.forEach(k => { o[k] = num(b[k], { min: 0, max: 1e10 }); });
  if (!o.name) o.name = `${o.property_address || o.city || 'New deal'} — ${LOAN_TYPES[o.loan_type]}`;
  return o;
}

module.exports = (app) => {
  const db = app.locals.db; const cfg = app.locals.config;
  const getDeal = (id) => db.prepare("SELECT d.*, c.first_name || ' ' || COALESCE(c.last_name,'') borrower, c.first_name, c.last_name, c.email c_email, co.name entity FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id LEFT JOIN companies co ON co.id = d.company_id WHERE d.id = ?").get(id);
  const withCsrf = (d, res) => Object.assign(d, { _csrf: res.locals.csrf });
  const contacts = () => db.prepare('SELECT id, first_name, last_name, type FROM contacts ORDER BY first_name').all();
  const companies = () => db.prepare('SELECT id, name FROM companies ORDER BY name').all();

  // ---- Pipeline ----------------------------------------------------------------------------
  app.get('/pipeline', (req, res) => {
    const view = req.query.view === 'table' ? 'table' : 'kanban';
    const stage = oneOf(req.query.stage, STAGES), lt = oneOf(req.query.loan_type, Object.keys(LOAN_TYPES)), showClosed = req.query.closed === '1';
    let sql = "SELECT d.*, c.first_name || ' ' || COALESCE(c.last_name,'') borrower, u.name assignee, (SELECT COUNT(*) FROM conditions x WHERE x.deal_id = d.id AND x.status IN ('requested','received','reviewed')) open_conds FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id LEFT JOIN users u ON u.id = d.assigned_to WHERE 1=1"; const p = [];
    if (stage) { sql += ' AND d.stage = ?'; p.push(stage); }
    if (lt) { sql += ' AND d.loan_type = ?'; p.push(lt); }
    const deals = db.prepare(sql + ' ORDER BY d.target_close_date IS NULL, d.target_close_date, d.id').all(...p);
    const filters = html`<form class="filters" method="get"><input type="hidden" name="view" value="${view}"><select name="stage"><option value="">All stages</option>${STAGES.map(s => html`<option ${s === stage ? 'selected' : ''}>${s}</option>`)}</select>
<select name="loan_type"><option value="">All loan types</option>${Object.entries(LOAN_TYPES).map(([k, v]) => html`<option value="${k}" ${k === lt ? 'selected' : ''}>${v}</option>`)}</select>${view === 'kanban' ? html`<label class="check"><input type="checkbox" name="closed" value="1" ${showClosed ? 'checked' : ''}> show Closed/Dead</label>` : ''}<button class="btn small">Filter</button></form>`;
    const head = html`<div class="page-head"><h1>Pipeline</h1><div><nav class="seg"><a href="/pipeline?view=kanban" class="${view === 'kanban' ? 'active' : ''}">Kanban</a><a href="/pipeline?view=table" class="${view === 'table' ? 'active' : ''}">Table</a></nav> <a class="btn" href="/deals/new">+ New deal</a></div></div>${filters}`;
    if (view === 'table') {
      return res.page('Pipeline', '/pipeline', html`${head}<table class="card"><thead><tr><th>Deal</th><th>Stage</th><th>Type</th><th>Borrower</th><th class="num">Loan</th><th>Assigned</th><th>App date</th><th>Target close</th><th class="num">Open conds</th></tr></thead><tbody>
${deals.map(d => html`<tr><td><a href="/deals/${d.id}">${d.name}</a>${demoTag(d)}${d.source === 'intake' && !d.intake_reviewed ? html` ${badge('NEW', 'hot')}` : ''}</td><td><span class="${stageClass(d.stage)}">${d.stage}</span></td><td>${LOAN_TYPES[d.loan_type]}</td><td>${d.borrower || '—'}</td><td class="num">${money(d.loan_amount)}</td><td>${d.assignee || '—'}</td><td>${fmtDate(d.app_date)}</td><td>${fmtDate(d.target_close_date)}</td><td class="num">${d.open_conds}</td></tr>`)}
</tbody><tfoot><tr><th colspan="4">${deals.length} deals</th><th class="num">${money(deals.reduce((a, d) => a + (d.loan_amount || 0), 0))}</th><th colspan="4"></th></tr></tfoot></table>`);
    }
    const cols = (stage ? [stage] : STAGES.filter(s => showClosed || OPEN_STAGES.includes(s)));
    res.page('Pipeline', '/pipeline', html`${head}<div class="kanban">${cols.map(s => { const list = deals.filter(d => d.stage === s); return html`<section class="col"><h3><span class="${stageClass(s)}">${s}</span> <small>${list.length} · ${money(list.reduce((a, d) => a + (d.loan_amount || 0), 0))}</small></h3>
${list.map(d => html`<article class="kcard"><a href="/deals/${d.id}"><strong>${d.name}</strong></a>${demoTag(d)}${d.source === 'intake' && !d.intake_reviewed ? html` ${badge('NEW', 'hot')}` : ''}<div class="small muted">${d.borrower || '—'} · ${LOAN_TYPES[d.loan_type]}</div><div class="small">${money(d.loan_amount)} · close ${fmtDate(d.target_close_date)}${d.open_conds ? html` · ${d.open_conds} open cond.` : ''}</div>
<form method="post" action="/deals/${d.id}/stage" class="kmove">${csrfInput(res.locals.csrf)}<select name="stage" aria-label="Move stage">${STAGES.map(x => html`<option ${x === d.stage ? 'selected' : ''}>${x}</option>`)}</select><button class="btn tiny">Move</button></form></article>`)}</section>`; })}</div>`);
  });

  app.post('/deals/:id/stage', (req, res, next) => {
    const d = db.prepare('SELECT id, stage FROM deals WHERE id = ?').get(req.params.id); if (!d) return next();
    const s = oneOf(req.body.stage, STAGES); if (!s || s === d.stage) return res.redirect(backTo(req, '/deals/' + d.id));
    db.prepare("UPDATE deals SET stage = ?, updated_at = datetime('now'), closed_date = CASE WHEN ? = 'Closed' AND closed_date IS NULL THEN ? ELSE closed_date END, app_date = CASE WHEN ? = 'Application' AND app_date IS NULL THEN ? ELSE app_date END WHERE id = ?").run(s, s, todayISO(), s, todayISO(), d.id);
    model.log(db, { entity_type: 'deal', entity_id: d.id, action: 'stage.changed', detail: `${d.stage} → ${s}`, user_id: req.user.id });
    const r = app.locals.engine.onStageChange(d.id, d.stage, s, { userId: req.user.id });
    const msgs = r && r.messages ? r.messages : [];
    req.flash(`Moved to ${s}.` + (r && !r.skipped ? ` Automation: ${r.tasks} task(s), portal update posted${msgs.length ? `, ${msgs.length} message(s) → Outbox (${msgs.map(m => m.status).join(', ')})` : ''}.` : '')); res.redirect(backTo(req, '/deals/' + d.id));
  });

  // ---- Deal CRUD -------------------------------------------------------------------------------
  app.get('/deals/new', (req, res) => res.page('New deal', '/pipeline', html`<h1>New deal</h1>${dealForm(res.locals.csrf, { contact_id: int(req.query.contact_id), stage: 'Lead', loan_type: 'dscr', state: 'FL', units: 1 }, contacts(), companies())}`));
  app.post('/deals', (req, res) => {
    const d = readDeal(req.body);
    const id = db.prepare(`INSERT INTO deals (name, contact_id, company_id, stage, loan_type, transaction_type, property_type, property_address, city, state, zip, units, purchase_price, as_is_value, rehab_budget, arv, monthly_rent, payoff, loan_amount, experience_deals, credit_range, liquidity, lead_source, app_date, target_close_date, closed_date, dead_reason, exit_strategy, assigned_to, updated_at)
      VALUES (@name,@contact_id,@company_id,@stage,@loan_type,@transaction_type,@property_type,@property_address,@city,@state,@zip,@units,@purchase_price,@as_is_value,@rehab_budget,@arv,@monthly_rent,@payoff,@loan_amount,@experience_deals,@credit_range,@liquidity,@lead_source,@app_date,@target_close_date,@closed_date,@dead_reason,@exit_strategy,@assigned_to,datetime('now'))`).run({ ...d, assigned_to: req.user.id }).lastInsertRowid;
    model.seedChecklist(db, id);
    model.log(db, { entity_type: 'deal', entity_id: id, action: 'deal.created', detail: 'Deal created: ' + d.name, user_id: req.user.id });
    req.flash('Deal created with a ' + LOAN_TYPES[d.loan_type] + ' document checklist.'); res.redirect('/deals/' + id);
  });
  app.get('/deals/:id/edit', (req, res, next) => { const d = getDeal(req.params.id); if (!d) return next(); res.page('Edit deal', '/pipeline', html`<h1>Edit deal</h1>${dealForm(res.locals.csrf, d, contacts(), companies())}`); });
  app.post('/deals/:id', (req, res, next) => {
    const old = getDeal(req.params.id); if (!old) return next();
    const d = readDeal(req.body);
    db.prepare(`UPDATE deals SET name=@name, contact_id=@contact_id, company_id=@company_id, stage=@stage, loan_type=@loan_type, transaction_type=@transaction_type, property_type=@property_type, property_address=@property_address, city=@city, state=@state, zip=@zip, units=@units,
      purchase_price=@purchase_price, as_is_value=@as_is_value, rehab_budget=@rehab_budget, arv=@arv, monthly_rent=@monthly_rent, payoff=@payoff, loan_amount=@loan_amount, experience_deals=@experience_deals, credit_range=@credit_range, liquidity=@liquidity,
      lead_source=@lead_source, app_date=@app_date, target_close_date=@target_close_date, closed_date=@closed_date, dead_reason=@dead_reason, exit_strategy=@exit_strategy, updated_at=datetime('now') WHERE id=@id`).run({ ...d, id: old.id });
    if (old.stage !== d.stage) { model.log(db, { entity_type: 'deal', entity_id: old.id, action: 'stage.changed', detail: `${old.stage} → ${d.stage}`, user_id: req.user.id }); app.locals.engine.onStageChange(old.id, old.stage, d.stage, { userId: req.user.id }); }
    if (old.loan_type !== d.loan_type) req.flash('Saved. Loan type changed — review the document checklist (Underwriting tab); add items as needed.');
    else req.flash('Deal saved.');
    model.log(db, { entity_type: 'deal', entity_id: old.id, action: 'deal.updated', detail: 'Deal details updated', user_id: req.user.id });
    res.redirect('/deals/' + old.id);
  });
  app.post('/deals/:id/reviewed', (req, res) => {
    db.prepare('UPDATE deals SET intake_reviewed = 1 WHERE id = ?').run(req.params.id);
    model.log(db, { entity_type: 'deal', entity_id: Number(req.params.id), action: 'intake.reviewed', detail: 'Intake marked reviewed', user_id: req.user.id });
    res.redirect('/deals/' + req.params.id);
  });

  app.get('/deals/:id', (req, res, next) => {
    const d = getDeal(req.params.id); if (!d) return next(); withCsrf(d, res);
    const tasks = db.prepare('SELECT * FROM tasks WHERE deal_id = ? ORDER BY done, due_date').all(d.id);
    const notes = db.prepare("SELECT n.*, u.name user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE entity_type = 'deal' AND entity_id = ? ORDER BY n.id DESC").all(d.id);
    const acts = db.prepare("SELECT a.*, u.name user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id WHERE entity_type = 'deal' AND entity_id = ? ORDER BY a.id DESC LIMIT 40").all(d.id);
    const cond = db.prepare("SELECT status, COUNT(*) n FROM conditions WHERE deal_id = ? GROUP BY status").all(d.id).reduce((o, r) => (o[r.status] = r.n, o), {});
    const an = model.getAnalysis(d); const out = model.runAnalysis(an.strategy, an.inputs[an.strategy], d);
    const payments = db.prepare('SELECT * FROM payments WHERE deal_id = ? ORDER BY id DESC').all(d.id);
    res.page(d.name, '/pipeline', html`${subnav(d, '')}
${d.source === 'intake' && !d.intake_reviewed ? html`<div class="flash hot"><strong>New intake from the public form.</strong> Review it, confirm consent before contacting, then mark reviewed. <form method="post" action="/deals/${d.id}/reviewed" class="inline">${csrfInput(res.locals.csrf)}<button class="btn small">Mark reviewed</button></form></div>` : ''}
<div class="grid2"><section class="card"><div class="card-head"><h2>Deal details</h2><a class="btn small ghost" href="/deals/${d.id}/edit">Edit</a></div><dl class="dl">
<dt>Borrower</dt><dd>${d.contact_id ? html`<a href="/contacts/${d.contact_id}">${d.borrower}</a>` : '—'}</dd><dt>Vesting</dt><dd>${d.entity ? html`<a href="/companies/${d.company_id}">${d.entity}</a>` : 'Individual / TBD'}</dd>
<dt>Property</dt><dd>${[d.property_address, d.city, d.state, d.zip].filter(Boolean).join(', ') || '—'} · ${d.property_type || ''}${d.units ? ' · ' + d.units + ' unit(s)' : ''}</dd>
<dt>Loan</dt><dd>${LOAN_TYPES[d.loan_type]} · ${(TX.find(t => t[0] === d.transaction_type) || [, '—'])[1]} · ${money(d.loan_amount)} requested</dd>
<dt>Values</dt><dd>Price ${money(d.purchase_price)} · As-is ${money(d.as_is_value)} · Rehab ${money(d.rehab_budget)} · ARV ${money(d.arv)} · Rent ${money(d.monthly_rent)}/mo${d.payoff ? html` · Payoff ${money(d.payoff)}` : ''}</dd>
<dt>Borrower profile</dt><dd>${d.experience_deals == null ? '—' : d.experience_deals + ' projects'} · Credit ${d.credit_range || '—'} (self-reported) · Liquidity ${money(d.liquidity)}</dd>
<dt>Exit</dt><dd>${d.exit_strategy || '—'}</dd><dt>Key dates</dt><dd>Created ${fmtDate(d.created_at)} · App ${fmtDate(d.app_date)} · Target close ${fmtDate(d.target_close_date)}${d.closed_date ? html` · Closed ${fmtDate(d.closed_date)}` : ''}</dd>
<dt>Source</dt><dd>${d.lead_source || '—'}${d.source === 'intake' ? ' (public intake)' : ''}</dd>${d.dead_reason ? html`<dt>Dead reason</dt><dd>${d.dead_reason}</dd>` : ''}</dl></section>
<section class="card"><h2>At a glance</h2><div class="kpis mini">
<div class="kpi"><span>${A.STRATS[an.strategy]}</span><strong>${an.strategy === 'dscr' ? (out.result.dscr ? out.result.dscr.toFixed(2) + 'x DSCR' : '—') : an.strategy === 'flip' ? money(out.result.profit) + ' profit' : an.strategy === 'brrrr' ? money(out.result.cashLeftInDeal) + ' left in' : money(out.result.cashFlowMonthly) + '/mo'}</strong><small>${an.isDefault ? 'Using starter assumptions' : 'Saved ' + fmtDateTime(an.savedAt)} · <a href="/deals/${d.id}/analyze">open analyzer</a></small></div>
<div class="kpi"><span>Checklist</span><strong>${(cond.cleared || 0)} cleared</strong><small>${cond.requested || 0} requested · ${cond.received || 0} received · ${cond.reviewed || 0} in review · ${cond.open || 0} not yet requested</small></div>
<div class="kpi"><span>Fees</span><strong>${payments.filter(p => p.status === 'requested').length} unpaid</strong><small>${payments.filter(p => p.status === 'paid').length} paid · <a href="/deals/${d.id}/payments">manage</a></small></div></div>
<p><a class="btn small" href="/deals/${d.id}/estimate?s=${an.strategy}" target="_blank" rel="noopener">Printable estimate</a> <a class="btn small ghost" href="/deals/${d.id}/scenario.txt">Scenario-desk export</a> <a class="btn small ghost" href="/templates?deal_id=${d.id}">Templates for this deal</a></p></section>
${portalPanel(db, app.locals.engine, d, res.locals.csrf)}${dealOutbox(db, d.id)}
${tasksBlock(res.locals.csrf, tasks, { dealId: d.id })}${notesBlock(res.locals.csrf, 'deal', d.id, notes)}${activityBlock(acts)}</div>`);
  });

  // ---- Analyzer -------------------------------------------------------------------------------
  app.get('/deals/:id/analyze', (req, res, next) => {
    const d = getDeal(req.params.id); if (!d) return next(); withCsrf(d, res);
    const an = model.getAnalysis(d); const s = oneOf(req.query.s, Object.keys(A.STRATS), an.strategy);
    const inputs = an.inputs[s]; const out = model.runAnalysis(s, inputs, d);
    res.page('Analyzer · ' + d.name, '/pipeline', html`${subnav(d, '/analyze')}
<div class="notice"><strong>Educational estimate — support only.</strong> Uses common rule-of-thumb sizing (ported from the tested DealSheet Lab calculators). Every lender sets its own guidelines; this is not a credit decision, quote, or commitment to lend. ${an.isDefault ? html`<strong>Starter assumptions</strong> (rate, taxes, insurance, fees) are placeholders — replace with actual quotes/bills and save.` : ''}</div>
<nav class="tabs">${Object.entries(A.STRATS).map(([k, v]) => html`<a href="/deals/${d.id}/analyze?s=${k}" class="${k === s ? 'active' : ''}">${v}</a>`)}</nav>
<div class="grid2 analyzer"><form method="post" action="/deals/${d.id}/analyze" class="card form-grid">${csrfInput(res.locals.csrf)}<input type="hidden" name="strategy" value="${s}">
<h2 class="span2">Inputs</h2>${Object.keys(inputs).map(k => field('in_' + k, model.FIELD_LABELS[k] || k, { type: 'number', step: 'any', value: inputs[k] }))}
<div class="span2"><button class="btn">Recalculate & save</button> <a class="btn ghost" href="/deals/${d.id}/estimate?s=${s}" target="_blank" rel="noopener">Printable estimate</a></div></form>
<section class="card"><h2>Results — ${A.STRATS[s]}</h2>${A.resultTable(s, out.result)}</section></div>
${out.memo ? html`<section class="card"><h2>Deal memo (rule-based template)</h2>${A.memoBlock(out.memo)}</section>` : ''}`);
  });
  app.post('/deals/:id/analyze', (req, res, next) => {
    const d = getDeal(req.params.id); if (!d) return next();
    const s = oneOf(req.body.strategy, Object.keys(A.STRATS)); if (!s) return res.status(400).send('Bad strategy');
    const an = model.getAnalysis(d); const saved = d.analysis_json ? JSON.parse(d.analysis_json) : {};
    const inp = {}; Object.keys(an.inputs[s]).forEach(k => { const v = num(req.body['in_' + k], { min: -1e10, max: 1e10 }); inp[k] = v == null ? an.inputs[s][k] : v; });
    saved.inputs = Object.assign({}, saved.inputs || {}, { [s]: inp }); saved.strategy = s; saved.savedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    db.prepare("UPDATE deals SET analysis_json = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(saved), d.id);
    model.log(db, { entity_type: 'deal', entity_id: d.id, action: 'analysis.saved', detail: A.STRATS[s] + ' analysis saved', user_id: req.user.id });
    res.redirect(`/deals/${d.id}/analyze?s=${s}`);
  });

  // Printable term-sheet-style ESTIMATE
  app.get('/deals/:id/estimate', (req, res, next) => {
    const d = getDeal(req.params.id); if (!d) return next();
    const an = model.getAnalysis(d); const s = oneOf(req.query.s, Object.keys(A.STRATS), an.strategy);
    const inputs = an.inputs[s]; const out = model.runAnalysis(s, inputs, d); const st = model.getSettings(db);
    const lo = [st.lo_name, st.lo_title, st.nmls_id && 'NMLS #' + st.nmls_id, st.company_name && (st.company_name + (st.company_nmls_id ? ' NMLS #' + st.company_nmls_id : '')), st.phone].filter(Boolean).join(' · ');
    res.send('<!doctype html>' + html`<html><head><meta charset="utf-8"><title>Estimate — ${d.name}</title><link rel="stylesheet" href="/static/app.css"><link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><meta name="robots" content="noindex"></head><body class="print-doc">${demoBanner(cfg.demoMode)}
<div class="noprint toolbar"><button class="btn" data-print>Print / save PDF</button> <a class="btn ghost" href="/deals/${d.id}/analyze?s=${s}">Back to analyzer</a>
<p class="small">Internal draft. Sharing this with a borrower is borrower-facing material — get sponsoring-broker compliance approval of this format first, and add any required disclosures.</p></div>
<div class="estimate"><div class="stamp">ESTIMATE — NOT A COMMITMENT TO LEND</div>
<h1>Preliminary financing estimate (illustrative)</h1><p class="muted">Prepared ${fmtDate(todayISO())}${an.isDefault ? ' · uses starter assumptions' : ''}</p>
<table class="kv"><tbody><tr><th>Prepared for</th><td>${d.entity || d.borrower || '—'}</td></tr><tr><th>Property</th><td>${[d.property_address, d.city, d.state].filter(Boolean).join(', ') || '—'} (${d.property_type || '—'})</td></tr>
<tr><th>Scenario</th><td>${A.STRATS[s]} · ${LOAN_TYPES[d.loan_type]}</td></tr></tbody></table>
<h2>Illustrative figures</h2>${A.resultTable(s, out.result)}
<h2>Assumptions used</h2><table class="kv small"><tbody>${Object.keys(inputs).map(k => html`<tr><th>${model.FIELD_LABELS[k] || k}</th><td>${inputs[k]}</td></tr>`)}</tbody></table>
${out.memo ? html`<h2>Items to review</h2><ul>${out.memo.risks.concat(out.memo.stress.map(x => x[0] + ': ' + x[1])).map(t => html`<li>${t}</li>`)}</ul>` : ''}
<div class="disclaimer"><p><strong>This is not a loan offer, approval, rate lock, Loan Estimate, or commitment to lend.</strong> It is an educational illustration based on the assumptions shown, which may be incomplete or inaccurate. Actual terms, if any, are available only after a complete application and are subject to underwriting, credit review, property valuation, title, insurance and the lender's program guidelines, which vary and change. Business-purpose investment property financing only. Not financial, legal or tax advice.</p>
<p>${lo || '[Loan officer name · NMLS # · Company · Company NMLS # · required state disclosures]'} ${st.state_disclosures || ''}</p></div></div><script src="/static/app.js"></script></body></html>`);
  });

  // ---- Underwriting workspace ---------------------------------------------------------------
  app.get('/deals/:id/underwriting', (req, res, next) => {
    const d = getDeal(req.params.id); if (!d) return next(); withCsrf(d, res);
    const conds = db.prepare('SELECT c.*, (SELECT COUNT(*) FROM files f WHERE f.condition_id = c.id) n_files FROM conditions c WHERE deal_id = ? ORDER BY kind DESC, sort, id').all(d.id);
    const flags = d.redflags_json ? JSON.parse(d.redflags_json) : {};
    const notes = db.prepare("SELECT n.*, u.name user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE entity_type = 'deal_uw' AND entity_id = ? ORDER BY n.id DESC").all(d.id);
    const counts = COND_STATUSES.map(s => [s, conds.filter(c => c.status === s).length]);
    const rf = ref.redFlags(); const sections = [...new Set(rf.map(r => r.section))];
    const common = ref.commonConditions();
    const row = (c) => html`<tr class="st-${c.status}"><td>${c.title}${c.requirement === 'C' ? html` <span class="badge muted" title="${ref.REQ_LABEL.C}">if applicable</span>` : ''}${c.kind === 'condition' ? html` <span class="badge">condition</span>` : ''}${c.borrower_visible ? '' : html` <span class="badge muted" title="Not shown on the borrower portal">internal</span>`}<div class="small muted">${c.category || ''}${c.n_files ? html` · <a href="/deals/${d.id}/documents">${c.n_files} file(s)</a>` : ''}</div></td>
<td><form method="post" action="/conditions/${c.id}" class="cond-form">${csrfInput(res.locals.csrf)}<select name="status">${COND_STATUSES.map(s => html`<option ${s === c.status ? 'selected' : ''}>${s}</option>`)}</select><input name="note" value="${c.note || ''}" placeholder="Internal note (never shown to borrower)" maxlength="500">
<input type="hidden" name="bv_present" value="1"><label class="check tiny-check" title="Show this item (in borrower wording) on the borrower status portal and in automated reminders"><input type="checkbox" name="borrower_visible" value="1" ${c.borrower_visible ? 'checked' : ''}> Borrower sees</label>
<input name="borrower_text" value="${c.borrower_text || ''}" placeholder="Borrower-facing wording (optional)" maxlength="300"><button class="btn tiny">Save</button></form></td>
<td class="small">${c.requested_at ? html`Req ${fmtDate(c.requested_at)}<br>` : ''}${c.received_at ? html`Rcvd ${fmtDate(c.received_at)}<br>` : ''}${c.cleared_at ? html`Clr ${fmtDate(c.cleared_at)}` : ''}</td></tr>`;
    res.page('Underwriting · ' + d.name, '/pipeline', html`${subnav(d, '/underwriting')}
<div class="notice"><strong>Underwriting support workspace — not a credit decision.</strong> Tracks documents and conditions and helps you prepare files and escalate questions. Actual conditions and decisions come only from the lender's underwriting through company systems.</div>
<div class="kpis mini">${counts.map(([s, n]) => html`<div class="kpi st-${s}"><span>${s}</span><strong>${n}</strong></div>`)}</div>
<div class="toolbar"><form method="post" action="/deals/${d.id}/conditions/bulk" class="inline">${csrfInput(res.locals.csrf)}<input type="hidden" name="from" value="open"><input type="hidden" name="to" value="requested"><button class="btn small">Mark all "open" items as requested</button></form>
<a class="btn small ghost" href="/deals/${d.id}/scenario.txt">Download scenario-desk summary (.txt)</a> <a class="btn small ghost" href="/deals/${d.id}/documents">Send upload link</a></div>
<section class="card"><h2>Document checklist & conditions</h2><p class="small muted">Seeded from the ${LOAN_TYPES[d.loan_type]} column of the document requirement matrix. Status flow: open → requested → received → reviewed → cleared (or waived).</p>
<table class="conds"><thead><tr><th>Item</th><th>Status / note</th><th>Dates</th></tr></thead><tbody>${conds.map(row)}</tbody></table>
<form method="post" action="/deals/${d.id}/conditions" class="row-form">${csrfInput(res.locals.csrf)}<input name="title" placeholder="Add a condition or document (as issued by underwriting)" maxlength="300" required list="common-conds"><datalist id="common-conds">${common.map(c => html`<option value="${c.text}">`)}</datalist>
<select name="category"><option>Borrower / entity</option><option>Property / valuation</option><option>Rehab / construction</option><option>Closing</option><option>Other</option></select><button class="btn small">Add</button></form></section>
<div class="grid2"><section class="card"><h2>Red-flag checklist (escalate, don't decide)</h2><p class="small muted">Checking an item means "ask underwriting/compliance". It does not mean wrongdoing. Never coach a borrower to hide or alter information.</p>
<form method="post" action="/deals/${d.id}/redflags">${csrfInput(res.locals.csrf)}${sections.map(sec => html`<h4>${sec}</h4>${rf.filter(r => r.section === sec).map(r => html`<label class="check"><input type="checkbox" name="${r.key}" value="1" ${flags[r.key] ? 'checked' : ''}> ${r.text}</label>`)}`)}
${field('rf_note', 'Escalation note', { type: 'textarea', value: flags.note || '' })}<button class="btn small">Save red-flag review</button></form></section>
${notesBlock(res.locals.csrf, 'deal_uw', d.id, notes, 'Underwriting notes')}</div>`);
  });
  app.post('/conditions/:id', (req, res, next) => {
    const c = db.prepare('SELECT * FROM conditions WHERE id = ?').get(req.params.id); if (!c) return next();
    const st = oneOf(req.body.status, COND_STATUSES, c.status); const note = str(req.body.note, 500);
    const stamp = { requested: 'requested_at', received: 'received_at', reviewed: 'reviewed_at', cleared: 'cleared_at' }[st];
    db.prepare(`UPDATE conditions SET status = ?, note = ?${stamp && st !== c.status ? `, ${stamp} = datetime('now')` : ''} WHERE id = ?`).run(st, note, c.id);
    if (req.body.bv_present) db.prepare('UPDATE conditions SET borrower_visible = ?, borrower_text = ? WHERE id = ?').run(bool(req.body.borrower_visible), str(req.body.borrower_text, 300), c.id);
    db.prepare("UPDATE deals SET updated_at = datetime('now') WHERE id = ?").run(c.deal_id);
    if (st !== c.status) model.log(db, { entity_type: 'deal', entity_id: c.deal_id, action: 'condition.status', detail: `${c.title}: ${c.status} → ${st}`, user_id: req.user.id });
    res.redirect(backTo(req, '/deals/' + c.deal_id + '/underwriting'));
  });
  app.post('/deals/:id/conditions', (req, res) => {
    const title = text(req.body.title, 300); const cat = str(req.body.category, 60);
    if (title) { db.prepare("INSERT INTO conditions (deal_id, kind, category, title, status, requested_at, sort) VALUES (?, 'condition', ?, ?, 'requested', datetime('now'), 1000)").run(req.params.id, cat, title); model.log(db, { entity_type: 'deal', entity_id: Number(req.params.id), action: 'condition.added', detail: 'Condition added: ' + title, user_id: req.user.id }); }
    res.redirect('/deals/' + req.params.id + '/underwriting');
  });
  app.post('/deals/:id/conditions/bulk', (req, res) => {
    const from = oneOf(req.body.from, COND_STATUSES), to = oneOf(req.body.to, COND_STATUSES);
    if (from && to) { const r = db.prepare(`UPDATE conditions SET status = ?${to === 'requested' ? ", requested_at = datetime('now')" : ''} WHERE deal_id = ? AND status = ?`).run(to, req.params.id, from); model.log(db, { entity_type: 'deal', entity_id: Number(req.params.id), action: 'condition.bulk', detail: `${r.changes} item(s) ${from} → ${to}`, user_id: req.user.id }); }
    res.redirect('/deals/' + req.params.id + '/underwriting');
  });
  app.post('/deals/:id/redflags', (req, res) => {
    const o = {}; ref.redFlags().forEach(r => { if (req.body[r.key]) o[r.key] = 1; }); o.note = text(req.body.rf_note, 3000) || ''; o.reviewedAt = new Date().toISOString();
    db.prepare('UPDATE deals SET redflags_json = ? WHERE id = ?').run(JSON.stringify(o), req.params.id);
    model.log(db, { entity_type: 'deal', entity_id: Number(req.params.id), action: 'redflags.saved', detail: `Red-flag review saved (${Object.keys(o).filter(k => k.startsWith('rf')).length} flagged)`, user_id: req.user.id });
    req.flash('Red-flag review saved.'); res.redirect('/deals/' + req.params.id + '/underwriting');
  });

  // Scenario-desk summary (strips NPI: initials only, city/state only)
  app.get('/deals/:id/scenario.txt', (req, res, next) => {
    const d = getDeal(req.params.id); if (!d) return next();
    const st = model.getSettings(db); const an = model.getAnalysis(d);
    const ds = model.runAnalysis('dscr', an.inputs.dscr, d).result; const fl = model.runAnalysis('flip', an.inputs.flip, d).result;
    const initials = [d.first_name, d.last_name].filter(Boolean).map(x => x[0].toUpperCase() + '.').join('') || 'Lead #' + d.id;
    const val = d.transaction_type === 'purchase' ? d.purchase_price : (d.as_is_value || d.purchase_price);
    const outstanding = db.prepare("SELECT title, status FROM conditions WHERE deal_id = ? AND status IN ('open','requested','received','reviewed') ORDER BY sort").all(d.id);
    const flags = d.redflags_json ? JSON.parse(d.redflags_json) : {}; const flagged = ref.redFlags().filter(r => flags[r.key]);
    const L = [
      `SCENARIO REQUEST — ${todayISO()}`, `LO: ${st.lo_name || '{{LO_NAME}}'} | NMLS #${st.nmls_id || '{{NMLS_ID}}'} | ${st.company_name || '{{COMPANY}}'}`,
      `Borrower ref: ${initials} (deal #${d.id})   Vesting: ${d.company_id ? 'LLC/entity' : 'individual/TBD'}   Business purpose: ${'{{Y/N, basis}}'}`, '',
      `PROGRAM REQUESTED: ${LOAN_TYPES[d.loan_type]}   TRANSACTION: ${(TX.find(t => t[0] === d.transaction_type) || [, ''])[1]}   Target close: ${d.target_close_date || 'TBD'}`, '',
      `PROPERTY: ${[d.city, d.state].filter(Boolean).join(', ')} | ${d.property_type || '?'}, ${d.units || '?'} unit(s) | Flood zone: {{Y/N/unknown}} | STR: {{Y/N}}`,
      `VALUES: Price ${money(d.purchase_price)} | As-is ${money(d.as_is_value)} | Rehab ${money(d.rehab_budget)} | ARV ${money(d.arv)} | Payoff ${money(d.payoff)}`,
      `LOAN ASK: ${money(d.loan_amount)} -> LTV ${val && d.loan_amount ? pct(d.loan_amount / val * 100) : 'n/a'} | LTC ${d.loan_amount && (d.purchase_price || 0) + (d.rehab_budget || 0) ? pct(d.loan_amount / ((d.purchase_price || 0) + (d.rehab_budget || 0)) * 100) : 'n/a'} | Loan-to-ARV ${d.arv && d.loan_amount ? pct(d.loan_amount / d.arv * 100) : 'n/a'}`,
      `INCOME (rentals): Rent ${money(d.monthly_rent)}/mo | PITIA est. ${money(ds.pitia)} | DSCR est. ${ds.dscr ? ds.dscr.toFixed(2) + 'x' : 'n/a'} (rent / PITIA; assumptions in DealDesk)`,
      ['flip', 'bridge', 'ground_up'].includes(d.loan_type) ? `FLIP EST.: loan ${money(fl.loan)} (${fl.loanLimitedBy}) | profit ${money(fl.profit)} | max offer by rule ${money(fl.mao)}` : null,
      `BORROWER (self-reported): Experience ${d.experience_deals == null ? '?' : d.experience_deals} deals | Liquidity ${money(d.liquidity)} | Credit range ${d.credit_range || '?'}`,
      `EXIT: ${d.exit_strategy || '?'}`, '',
      'QUESTIONS FOR THE DESK:', '1. {{e.g., Is this property type/condition eligible?}}', '2. {{e.g., Max leverage given experience level?}}', '3. ', '',
      `OUTSTANDING ITEMS (${outstanding.length}):`, ...outstanding.map(o => `- [${o.status}] ${o.title}`), '',
      flagged.length ? 'ITEMS TO ESCALATE (from red-flag review — questions, not conclusions):' : null, ...flagged.map(f => '- ' + f.text), flags.note ? 'Note: ' + flags.note : null, '',
      'Estimates are educational and generated by DealDesk OS from stated assumptions. Not a credit decision. Strip NPI before sending unless the desk\'s secure system requires it.'
    ].filter(x => x !== null);
    model.log(db, { entity_type: 'deal', entity_id: d.id, action: 'scenario.exported', detail: 'Scenario-desk summary exported', user_id: req.user.id });
    res.type('text/plain').set('Content-Disposition', `attachment; filename="scenario-deal-${d.id}.txt"`).send(L.join('\n'));
  });

  // ---- Documents --------------------------------------------------------------------------------
  app.get('/deals/:id/documents', (req, res, next) => {
    const d = getDeal(req.params.id); if (!d) return next(); withCsrf(d, res);
    const files = db.prepare('SELECT f.*, c.title cond_title FROM files f LEFT JOIN conditions c ON c.id = f.condition_id WHERE f.deal_id = ? ORDER BY f.id DESC').all(d.id);
    const links = db.prepare('SELECT * FROM upload_links WHERE deal_id = ? ORDER BY id DESC').all(d.id);
    const conds = db.prepare("SELECT id, title, status FROM conditions WHERE deal_id = ? ORDER BY sort, id").all(d.id);
    const newLink = req.session.newLink && req.session.newLink.dealId === d.id ? req.session.newLink.url : null; delete req.session.newLink;
    const now = new Date();
    res.page('Documents · ' + d.name, '/pipeline', html`${subnav(d, '/documents')}
<div class="grid2"><section class="card"><h2>Borrower upload link</h2>
<p class="small">Creates a secure, expiring link (token stored hashed; shown once) where the borrower can upload checklist items without logging in. Items currently <em>requested</em> appear first. Files go to server disk outside the web root.</p>
${newLink ? html`<div class="flash ok"><strong>Copy this link now — it won't be shown again:</strong><div class="copyrow"><input readonly value="${newLink}" id="newlink"><button class="btn small" data-copy="#newlink">Copy</button></div><span class="small">Send it yourself through an approved channel. ${BRAND} does not send email/SMS in v1.</span></div>` : ''}
<form method="post" action="/deals/${d.id}/links" class="row-form">${csrfInput(res.locals.csrf)}<input name="label" placeholder="Label (e.g. initial docs)" maxlength="80"><select name="days">${[3, 7, 14, 30].map(n => html`<option value="${n}" ${n === cfg.uploadLinkDays ? 'selected' : ''}>${n} days</option>`)}</select><button class="btn small">Create link</button></form>
<table><thead><tr><th>Link</th><th>Expires</th><th>Uploads</th><th></th></tr></thead><tbody>${links.map(l => { const live = !l.revoked && new Date(l.expires_at) > now; return html`<tr><td>${l.label || 'Link #' + l.id} ${live ? badge('active', 'ok') : badge(l.revoked ? 'revoked' : 'expired', 'muted')}</td><td>${fmtDateTime(l.expires_at.replace('T', ' ').slice(0, 19))}</td><td class="num">${l.upload_count}</td><td>${live ? html`<form method="post" action="/links/${l.id}/revoke" class="inline">${csrfInput(res.locals.csrf)}<button class="btn tiny ghost">Revoke</button></form>` : ''}</td></tr>`; })}</tbody></table></section>
<section class="card"><h2>Upload a file (staff)</h2><form method="post" action="/deals/${d.id}/files" enctype="multipart/form-data" class="form-grid">${csrfInput(res.locals.csrf)}
${field('condition_id', 'Checklist item', { type: 'select', options: [['', '— not linked —'], ...conds.map(c => [c.id, c.title + ' (' + c.status + ')'])] })}
<label class="field"><span>File</span><input type="file" name="file" required></label><div class="span2"><button class="btn small">Upload</button> <span class="small muted">Allowed: ${up.ALLOWED.join(', ')} · max ${cfg.maxUploadMb} MB</span></div></form></section></div>
<section class="card"><h2>Files (${files.length})</h2><table><thead><tr><th>File</th><th>Checklist item</th><th>Via</th><th>Size</th><th>Uploaded</th><th></th></tr></thead><tbody>${files.map(f => html`<tr><td><a href="/files/${f.id}/download">${f.original_name}</a></td><td>${f.cond_title || '—'}</td><td>${f.uploaded_via === 'borrower_link' ? 'Borrower link' : 'Staff'}</td><td class="num">${Math.ceil(f.size / 1024)} KB</td><td>${fmtDateTime(f.created_at)}</td>
<td><form method="post" action="/files/${f.id}/delete" class="inline" data-confirm="Delete this file permanently?">${csrfInput(res.locals.csrf)}<button class="btn tiny ghost">Delete</button></form></td></tr>`)}</tbody></table>${files.length ? '' : html`<p class="muted">No files yet.</p>`}</section>`);
  });
  app.post('/deals/:id/links', (req, res, next) => {
    const d = getDeal(req.params.id); if (!d) return next();
    const days = oneOf(int(req.body.days), [3, 7, 14, 30], cfg.uploadLinkDays); const token = randomToken(32);
    const exp = new Date(Date.now() + days * 864e5).toISOString();
    db.prepare('INSERT INTO upload_links (deal_id, token_hash, label, expires_at, created_by) VALUES (?,?,?,?,?)').run(d.id, sha256(token), str(req.body.label, 80), exp, req.user.id);
    const base = (model.getSettings(db).public_base_url || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
    req.session.newLink = { dealId: d.id, url: `${base}/u/${token}` };
    model.log(db, { entity_type: 'deal', entity_id: d.id, action: 'uploadlink.created', detail: `Upload link created (${days} days)`, user_id: req.user.id });
    res.redirect('/deals/' + d.id + '/documents');
  });
  app.post('/links/:id/revoke', (req, res, next) => {
    const l = db.prepare('SELECT * FROM upload_links WHERE id = ?').get(req.params.id); if (!l) return next();
    db.prepare('UPDATE upload_links SET revoked = 1 WHERE id = ?').run(l.id);
    model.log(db, { entity_type: 'deal', entity_id: l.deal_id, action: 'uploadlink.revoked', detail: 'Upload link revoked', user_id: req.user.id });
    res.redirect('/deals/' + l.deal_id + '/documents');
  });
  app.post('/deals/:id/files', (req, res, next) => {
    const d = getDeal(req.params.id); if (!d) return next();
    up.uploader(cfg.maxUploadMb)(req, res, (err) => {
      if (err) { req.flash(err.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${cfg.maxUploadMb} MB.` : 'Upload failed.', 'err'); return res.redirect('/deals/' + d.id + '/documents'); }
      if (!verifyCsrf(req)) return res.status(403).send('Invalid or missing security token.');
      const bad = up.validate(req.file); if (bad) { req.flash(bad, 'err'); return res.redirect('/deals/' + d.id + '/documents'); }
      let condId = int(req.body.condition_id); if (condId && !db.prepare('SELECT id FROM conditions WHERE id = ? AND deal_id = ?').get(condId, d.id)) condId = null;
      const st = up.store(cfg.uploadDir, req.file);
      db.prepare("INSERT INTO files (deal_id, condition_id, original_name, stored_name, mime, size, sha256, uploaded_via) VALUES (?,?,?,?,?,?,?,'staff')").run(d.id, condId, st.original, st.stored, st.mime, req.file.size, st.sha);
      if (condId) db.prepare("UPDATE conditions SET status = 'received', received_at = datetime('now') WHERE id = ? AND status IN ('open','requested')").run(condId);
      model.log(db, { entity_type: 'deal', entity_id: d.id, action: 'file.uploaded', detail: 'Staff upload: ' + st.original, user_id: req.user.id });
      db.prepare("UPDATE deals SET updated_at = datetime('now') WHERE id = ?").run(d.id);
      req.flash('Uploaded ' + st.original + '.'); res.redirect('/deals/' + d.id + '/documents');
    });
  });
  app.get('/files/:id/download', (req, res, next) => {
    const f = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id); if (!f) return next();
    const p = path.join(cfg.uploadDir, path.basename(f.stored_name)); if (!fs.existsSync(p)) return res.status(410).send('File is missing from storage.');
    model.log(db, { entity_type: 'deal', entity_id: f.deal_id, action: 'file.downloaded', detail: 'Downloaded ' + f.original_name, user_id: req.user.id });
    res.set('Content-Type', f.mime || 'application/octet-stream').set('X-Content-Type-Options', 'nosniff');
    res.attachment(f.original_name); fs.createReadStream(p).pipe(res);
  });
  app.post('/files/:id/delete', (req, res, next) => {
    const f = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id); if (!f) return next();
    try { fs.unlinkSync(path.join(cfg.uploadDir, path.basename(f.stored_name))); } catch (e) { /* already gone */ }
    db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
    model.log(db, { entity_type: 'deal', entity_id: f.deal_id, action: 'file.deleted', detail: 'Deleted ' + f.original_name, user_id: req.user.id });
    res.redirect('/deals/' + f.deal_id + '/documents');
  });

  // ---- Appraisal / fee payments -------------------------------------------------------------------
  app.get('/deals/:id/payments', (req, res, next) => {
    const d = getDeal(req.params.id); if (!d) return next(); withCsrf(d, res);
    const pays = db.prepare('SELECT * FROM payments WHERE deal_id = ? ORDER BY id DESC').all(d.id);
    const mode = stripe.mode(cfg.stripeKey);
    res.page('Payments · ' + d.name, '/pipeline', html`${subnav(d, '/payments')}
<div class="notice">Stripe status: <strong>${mode === 'test' ? 'TEST mode connected' : mode === 'blocked-live' ? 'live key detected — disabled in v1' : 'not configured (manual payment links)'}</strong>. Stripe has no monthly fee but charges a per-transaction fee on each payment; there is no $0 way to process cards. Confirm with your sponsor/lender who may collect appraisal fees and how (many lenders require the appraisal management company or lender portal to collect them).</div>
<div class="grid2"><section class="card"><h2>Request appraisal / fee payment</h2><form method="post" action="/deals/${d.id}/payments" class="form-grid">${csrfInput(res.locals.csrf)}
${field('kind', 'Type', { type: 'select', options: [['appraisal', 'Appraisal fee'], ['other', 'Other third-party fee']] })}${field('amount', 'Amount ($)', { type: 'number', step: '0.01', required: true })}
${field('description', 'Description', { value: 'Appraisal fee — ' + model.propertyShort(d), cls: 'span2', max: 120 })}
${mode === 'test' ? field('use_stripe', 'Create a Stripe TEST payment link automatically', { type: 'checkbox', value: 1, cls: 'span2' }) : ''}
${field('payment_url', 'Payment link (https) — paste from your AMC/lender portal or Stripe', { type: 'url', cls: 'span2', placeholder: 'https://…', help: mode === 'test' ? 'Leave blank if creating a Stripe test link.' : 'Stripe not configured: paste a link created elsewhere.' })}
<div class="span2"><button class="btn">Record payment request</button></div></form></section>
<section class="card"><h2>Requests</h2><table><thead><tr><th>Item</th><th class="num">Amount</th><th>Status</th><th>Link</th><th>Dates</th><th>Update</th></tr></thead><tbody>${pays.map(p => html`<tr><td>${p.description}${p.is_demo ? html` <span class="badge demo">DEMO</span>` : ''}<div class="small muted">${p.provider === 'stripe' ? 'Stripe ' + (p.stripe_mode || '') : 'Manual link'}</div></td><td class="num">${money(p.amount_cents / 100, 2)}</td><td>${badge(p.status, p.status === 'paid' ? 'ok' : p.status === 'requested' ? 'warn' : 'muted')}</td>
<td>${p.payment_url ? html`<div class="copyrow"><input readonly value="${p.payment_url}" id="pl${p.id}"><button class="btn tiny" data-copy="#pl${p.id}">Copy</button></div>` : '—'}</td><td class="small">Req ${fmtDate(p.requested_at)}${p.paid_at ? html`<br>Paid ${fmtDate(p.paid_at)}` : ''}${p.refunded_at ? html`<br>Refunded ${fmtDate(p.refunded_at)}` : ''}</td>
<td><form method="post" action="/payments/${p.id}/status" class="inline">${csrfInput(res.locals.csrf)}<select name="status">${PAY_STATUSES.map(s => html`<option ${s === p.status ? 'selected' : ''}>${s}</option>`)}</select><button class="btn tiny">Save</button></form></td></tr>`)}</tbody></table>${pays.length ? '' : html`<p class="muted">No payment requests yet.</p>`}</section></div>`);
  });
  app.post('/deals/:id/payments', async (req, res, next) => {
    try {
      const d = getDeal(req.params.id); if (!d) return next();
      const amount = num(req.body.amount, { min: 0, max: 100000 }); const desc = str(req.body.description, 120) || 'Appraisal fee';
      const kind = oneOf(req.body.kind, ['appraisal', 'other'], 'appraisal'); let link = url(req.body.payment_url);
      if (!amount || amount < 1) { req.flash('Enter an amount of at least $1.', 'err'); return res.redirect('/deals/' + d.id + '/payments'); }
      if (req.body.payment_url && !link) { req.flash('Payment link must be a valid https:// URL.', 'err'); return res.redirect('/deals/' + d.id + '/payments'); }
      const cents = Math.round(amount * 100);
      const id = db.prepare("INSERT INTO payments (deal_id, kind, description, amount_cents, status, provider, payment_url) VALUES (?,?,?,?, 'requested', 'manual', ?)").run(d.id, kind, desc, cents, link).lastInsertRowid;
      if (req.body.use_stripe && !link && stripe.mode(cfg.stripeKey) === 'test') {
        try {
          const pl = await stripe.createPaymentLink({ amountCents: cents, description: desc, dealId: d.id, paymentId: id }, { key: cfg.stripeKey, fetchImpl: cfg.stripeFetch });
          db.prepare("UPDATE payments SET provider = 'stripe', stripe_mode = ?, stripe_payment_link_id = ?, stripe_price_id = ?, payment_url = ? WHERE id = ?").run(pl.livemode ? 'live' : 'test', pl.linkId, pl.priceId, pl.url, id);
        } catch (e) { req.flash('Saved, but Stripe link creation failed: ' + e.message + '. Paste a link manually.', 'err'); }
      }
      model.log(db, { entity_type: 'deal', entity_id: d.id, action: 'payment.requested', detail: `${desc}: ${money(amount, 2)} requested`, user_id: req.user.id });
      if (!req.session.flash) req.flash('Payment request recorded. Send the link yourself through an approved channel.');
      res.redirect('/deals/' + d.id + '/payments');
    } catch (e) { next(e); }
  });
  app.post('/payments/:id/status', (req, res, next) => {
    const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id); if (!p) return next();
    const st = oneOf(req.body.status, PAY_STATUSES, p.status);
    db.prepare(`UPDATE payments SET status = ?${st === 'paid' && p.status !== 'paid' ? ", paid_at = datetime('now')" : ''}${st === 'refunded' && p.status !== 'refunded' ? ", refunded_at = datetime('now')" : ''} WHERE id = ?`).run(st, p.id);
    if (st !== p.status) model.log(db, { entity_type: 'deal', entity_id: p.deal_id, action: 'payment.status', detail: `${p.description}: ${p.status} → ${st}`, user_id: req.user.id });
    res.redirect('/deals/' + p.deal_id + '/payments');
  });
};
