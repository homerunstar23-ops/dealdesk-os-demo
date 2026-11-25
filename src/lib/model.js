'use strict';
// Data-access + business helpers shared by routes, seed and tests.
const C = require('./calc');
const M = require('./memo');
const ref = require('../reference');
const { STAGES, OPEN_STAGES, LOAN_TYPES } = require('../db');
const { todayISO } = require('./util');

function log(db, { entity_type = null, entity_id = null, action, detail = null, user_id = null, ip = null }) {
  db.prepare('INSERT INTO activities (entity_type, entity_id, action, detail, user_id, ip) VALUES (?,?,?,?,?,?)').run(entity_type, entity_id, action, detail, user_id, ip);
}

function getSettings(db) { const o = {}; db.prepare('SELECT key, value FROM settings').all().forEach(r => { o[r.key] = r.value; }); return o; }
function setSetting(db, k, v) { db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v); }

// Creates the document checklist for a deal from the toolkit's requirement matrix.
function seedChecklist(db, dealId) {
  const d = db.prepare('SELECT loan_type, transaction_type FROM deals WHERE id = ?').get(dealId);
  const exists = db.prepare("SELECT COUNT(*) n FROM conditions WHERE deal_id = ? AND kind = 'doc'").get(dealId).n;
  if (exists) return 0;
  const ins = db.prepare("INSERT INTO conditions (deal_id, kind, category, title, requirement, status, sort) VALUES (?, 'doc', ?, ?, ?, 'open', ?)");
  const items = ref.checklistFor(d.loan_type, d.transaction_type);
  items.forEach((it, i) => ins.run(dealId, it.category, it.title, it.requirement, i));
  return items.length;
}

function propertyShort(d) { return [d.property_address, d.city].filter(Boolean).join(', ') || d.name; }

// ---- Deal analyzer --------------------------------------------------------------------------
function defaultStrategy(d) { return (d.loan_type === 'dscr' || d.loan_type === 'cashout') ? 'dscr' : 'flip'; }
function analysisDefaults(d) {
  const price = d.purchase_price || d.as_is_value || 0;
  const value = d.as_is_value || d.purchase_price || 0;
  const rent = d.monthly_rent || 0;
  return {
    dscr: { price: d.transaction_type === 'purchase' ? price : value, rent, ltvPct: d.loan_amount && price ? Math.round(d.loan_amount / (d.transaction_type === 'purchase' ? price : value) * 1000) / 10 : 75, ratePct: 7.5, amortYears: 30, interestOnly: 0, taxesAnnual: Math.round(price * 0.015), insuranceAnnual: Math.round(price * 0.008), hoaMonthly: 0, otherMonthly: 0, targetDscr: 1.25, maxLtvPct: 80, pointsPct: 1, closingPct: 2 },
    flip: { purchase: d.purchase_price || 0, rehab: d.rehab_budget || 0, arv: d.arv || 0, months: 6, purchaseFinPct: 90, rehabFinPct: 100, maxLtcPct: 90, maxArvPct: 70, pointsPct: 2, lenderFees: 1500, ratePct: 11, buyClosingPct: 2, holdingMonthly: 800, sellingPct: 7, rulePct: 70 },
    brrrr: { purchase: d.purchase_price || 0, rehab: d.rehab_budget || 0, rehabMonths: 5, arv: d.arv || 0, bridgeFinPct: 85, bridgePointsPct: 2, bridgeRatePct: 11, buyClosingPct: 2, holdingMonthly: 600, refiLtvPct: 75, refiCostsPct: 3, refiRatePct: 7.25, refiAmortYears: 30, refiInterestOnly: 0, taxesAnnual: Math.round((d.arv || price) * 0.012), insuranceAnnual: Math.round((d.arv || price) * 0.008), hoaMonthly: 0, rent, vacancyPct: 5, maintPct: 5, capexPct: 5, mgmtPct: 8 },
    rental: { price, downPct: 25, closingPct: 3, upfrontRehab: 0, ratePct: 7.25, amortYears: 30, interestOnly: 0, rent, otherIncome: 0, vacancyPct: 5, taxesAnnual: Math.round(price * 0.015), insuranceAnnual: Math.round(price * 0.008), hoaMonthly: 0, utilitiesMonthly: 0, maintPct: 5, capexPct: 5, mgmtPct: 8 }
  };
}
const FIELD_LABELS = {
  price: 'Price / value ($)', rent: 'Monthly rent ($)', ltvPct: 'Loan-to-value (%)', ratePct: 'Interest rate (%)', amortYears: 'Amortization (years)', interestOnly: 'Interest-only (1 = yes)', taxesAnnual: 'Property taxes / yr ($)', insuranceAnnual: 'Insurance / yr ($)', hoaMonthly: 'HOA / mo ($)', otherMonthly: 'Other monthly ($)', targetDscr: 'Target DSCR (x)', maxLtvPct: 'Max LTV (%)', pointsPct: 'Points (%)', closingPct: 'Closing costs (% of price)',
  purchase: 'Purchase price ($)', rehab: 'Rehab budget ($)', arv: 'After-repair value ($)', months: 'Hold (months)', purchaseFinPct: 'Purchase financed (%)', rehabFinPct: 'Rehab financed (%)', maxLtcPct: 'Max loan-to-cost (%)', maxArvPct: 'Max loan-to-ARV (%)', lenderFees: 'Lender fees ($)', buyClosingPct: 'Buy closing (% of price)', holdingMonthly: 'Holding costs / mo ($)', sellingPct: 'Selling costs (% of ARV)', rulePct: 'Max-offer rule (% of ARV)',
  rehabMonths: 'Rehab months', bridgeFinPct: 'Bridge financed (% of cost)', bridgePointsPct: 'Bridge points (%)', bridgeRatePct: 'Bridge rate (%)', refiLtvPct: 'Refi LTV (% of ARV)', refiCostsPct: 'Refi costs (% of loan)', refiRatePct: 'Refi rate (%)', refiAmortYears: 'Refi amortization (yrs)', refiInterestOnly: 'Refi interest-only (1 = yes)', vacancyPct: 'Vacancy (%)', maintPct: 'Maintenance (% of rent)', capexPct: 'CapEx reserve (% of rent)', mgmtPct: 'Management (%)',
  downPct: 'Down payment (%)', upfrontRehab: 'Upfront rehab ($)', otherIncome: 'Other income / mo ($)', utilitiesMonthly: 'Utilities / mo ($)'
};
function getAnalysis(d) {
  const saved = d.analysis_json ? JSON.parse(d.analysis_json) : {};
  const defs = analysisDefaults(d);
  const inputs = {}; Object.keys(defs).forEach(k => { inputs[k] = Object.assign({}, defs[k], (saved.inputs || {})[k] || {}); });
  return { strategy: saved.strategy || defaultStrategy(d), inputs, savedAt: saved.savedAt || null, isDefault: !saved.inputs };
}
function runAnalysis(strategy, p, deal) {
  const q = Object.assign({}, p);
  if (deal && deal.experience_deals != null) q.experienceDeals = deal.experience_deals; // used by the memo's experience check ['interestOnly', 'refiInterestOnly'].forEach(k => { if (k in q) q[k] = !!Number(q[k]); });
  const result = C[strategy](q);
  const memo = ['dscr', 'flip', 'brrrr'].includes(strategy) ? M.memo(strategy, q) : null;
  return { result, memo };
}

// ---- Dashboard --------------------------------------------------------------------------------
function dashboard(db) {
  const today = todayISO();
  const byStage = STAGES.map(s => { const r = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(loan_amount),0) v FROM deals WHERE stage = ?').get(s); return { stage: s, count: r.n, value: r.v }; });
  const openValue = byStage.filter(s => OPEN_STAGES.includes(s.stage)).reduce((a, s) => a + s.value, 0);
  const openCount = byStage.filter(s => OPEN_STAGES.includes(s.stage)).reduce((a, s) => a + s.count, 0);
  const taskSel = `SELECT t.*, d.name deal_name, c.first_name || ' ' || COALESCE(c.last_name,'') contact_name FROM tasks t LEFT JOIN deals d ON d.id = t.deal_id LEFT JOIN contacts c ON c.id = t.contact_id WHERE t.done = 0 AND `;
  const overdue = db.prepare(taskSel + 't.due_date < ? ORDER BY t.due_date').all(today);
  const dueToday = db.prepare(taskSel + 't.due_date = ? ORDER BY t.id').all(today);
  const newIntakes = db.prepare("SELECT d.*, c.first_name, c.last_name FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id WHERE d.source = 'intake' AND d.intake_reviewed = 0 ORDER BY d.created_at DESC").all();
  const outstanding = db.prepare(`SELECT d.id, d.name, d.stage, SUM(CASE WHEN c.status IN ('requested') THEN 1 ELSE 0 END) requested, SUM(CASE WHEN c.status = 'received' THEN 1 ELSE 0 END) received, SUM(CASE WHEN c.status = 'reviewed' THEN 1 ELSE 0 END) reviewed, COUNT(*) total_open
     FROM conditions c JOIN deals d ON d.id = c.deal_id WHERE c.status IN ('requested','received','reviewed') AND d.stage NOT IN ('Closed','Dead') GROUP BY d.id ORDER BY total_open DESC`).all();
  const outstandingTotal = outstanding.reduce((a, r) => a + r.total_open, 0);
  const unpaid = db.prepare("SELECT p.*, d.name deal_name FROM payments p JOIN deals d ON d.id = p.deal_id WHERE p.status = 'requested' ORDER BY p.requested_at").all();
  const recent = db.prepare("SELECT a.*, u.name user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.action NOT IN ('login','logout') ORDER BY a.id DESC LIMIT 8").all();
  return { today, byStage, openValue, openCount, overdue, dueToday, newIntakes, outstanding, outstandingTotal, unpaid, recent };
}

// ---- Merge fields for templates -----------------------------------------------------------
function mergeFields(db, { dealId, contactId } = {}) {
  const s = getSettings(db);
  const f = {
    LO_NAME: s.lo_name, LO_FIRST: (s.lo_name || '').split(' ')[0] || null, TITLE: s.lo_title, NMLS_ID: s.nmls_id, COMPANY_NAME: s.company_name,
    COMPANY_SHORT: s.company_short, COMPANY_NMLS_ID: s.company_nmls_id, PHONE: s.phone, PHYSICAL_ADDRESS: s.physical_address,
    STATE_LICENSE_DISCLOSURES: s.state_disclosures, STATE_DISCLOSURES: s.state_disclosures, BOOKING_LINK: s.booking_link, TOOL_LINK: s.tool_link, DATE: todayISO()
  };
  if (s.lo_name || s.nmls_id) f.DISCLOSURE_BLOCK = [s.lo_name, s.lo_title, s.nmls_id && 'NMLS #' + s.nmls_id, s.company_name && (s.company_name + (s.company_nmls_id ? ' NMLS #' + s.company_nmls_id : '')), s.phone, s.state_disclosures].filter(Boolean).join(' | ');
  if (s.physical_address) f.CAN_SPAM_FOOTER = s.physical_address + ' | Reply "unsubscribe" to opt out.';
  let d = null, c = null;
  if (dealId) d = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (d && d.contact_id && !contactId) contactId = d.contact_id;
  if (contactId) c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
  if (c) Object.assign(f, { FIRST_NAME: c.first_name, LAST_NAME: c.last_name, BORROWER: [c.first_name, c.last_name].filter(Boolean).join(' ') });
  if (d) {
    // Borrower-facing lists only: borrower-visible items, borrower wording, never internal notes.
    const open = db.prepare("SELECT kind, COALESCE(NULLIF(borrower_text, ''), title) t FROM conditions WHERE deal_id = ? AND status = 'requested' AND borrower_visible = 1 ORDER BY sort, id").all(d.id);
    const bullets = (rows) => rows.length ? rows.map(r => '- ' + r.t).join('\n') : '- Nothing outstanding right now';
    Object.assign(f, { PROPERTY_SHORT: propertyShort(d), LOAN_TYPE: LOAN_TYPES[d.loan_type], STAGE: d.stage, CLOSE_DATE: d.target_close_date,
      ITEM_LIST: bullets(open), CONDITION_LIST: bullets(open.filter(r => r.kind === 'condition').length ? open.filter(r => r.kind === 'condition') : open), ITEM_COUNT: String(open.length) });
  }
  Object.keys(f).forEach(k => { if (f[k] == null || f[k] === '') delete f[k]; });
  return f;
}
function applyMerge(text, fields) { return (text || '').replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (fields[k] != null ? fields[k] : m)); }

module.exports = { log, getSettings, setSetting, seedChecklist, propertyShort, analysisDefaults, FIELD_LABELS, getAnalysis, runAnalysis, defaultStrategy, dashboard, mergeFields, applyMerge };
