'use strict';
// v3 "Move to next step": one button per deal. Before a deal can advance, these plain-English checks must
// pass. Checks are LO housekeeping only (is the info in, were the documents asked for, etc.). They are not
// credit decisions: anything only the lender can decide is a "you confirm" box the LO ticks.
const { todayISO } = require('./util');
const model = require('./model');
const P = require('./plain');

const NEXT = { 'Lead': 'Application', 'Application': 'Processing', 'Processing': 'Underwriting', 'Underwriting': 'Conditionally Approved', 'Conditionally Approved': 'Clear to Close', 'Clear to Close': 'Closed' };
const FLOW = ['Lead', 'Application', 'Processing', 'Underwriting', 'Conditionally Approved', 'Clear to Close', 'Closed'];

function facts(db, d) {
  const conds = db.prepare('SELECT id, kind, title, requirement, status FROM conditions WHERE deal_id = ? ORDER BY sort, id').all(d.id);
  const contact = d.contact_id ? db.prepare('SELECT id, first_name, email, phone, dnc FROM contacts WHERE id = ?').get(d.contact_id) : null;
  const portal = db.prepare('SELECT id FROM portal_links WHERE deal_id = ? AND revoked = 0').get(d.id);
  const unpaid = db.prepare("SELECT COUNT(*) n FROM payments WHERE deal_id = ? AND status = 'requested'").get(d.id).n;
  return { conds, contact, portal: !!portal, unpaid };
}

// Returns { stage, next, checks:[{key, ok, label, detail, fix:{href,text}}], confirms:[{key,label}], ready }
function gateFor(db, d) {
  const next = NEXT[d.stage] || null;
  const out = { stage: d.stage, next, checks: [], confirms: [], ready: false, step: FLOW.indexOf(d.stage) + 1, steps: FLOW.length };
  if (!next) return out;
  const f = facts(db, d); const id = d.id;
  const edit = { href: `/deals/${id}/edit`, text: 'Fill it in' };
  const add = (key, ok, label, fix, detail) => out.checks.push({ key, ok: !!ok, label, fix, detail });
  const names = (rows) => rows.slice(0, 4).map(r => r.title).join('; ') + (rows.length > 4 ? ` (+${rows.length - 4} more)` : '');
  if (d.stage === 'Lead') {
    add('borrower', f.contact, 'An investor is linked to this deal', edit);
    add('reach', f.contact && (f.contact.email || f.contact.phone), 'You have their email or phone', f.contact ? { href: `/contacts/${f.contact.id}?edit=1`, text: 'Add contact info' } : edit);
    add('address', d.property_address || d.city, 'The property address is filled in', edit);
    add('amount', d.loan_amount, 'The loan amount they want is filled in', edit);
    if (d.source === 'intake') add('reviewed', d.intake_reviewed, 'You reviewed their online application', { href: `/deals/${id}`, text: 'Review it' });
  } else if (d.stage === 'Application') {
    add('value', d.purchase_price || d.as_is_value, 'Purchase price or current value is filled in', edit);
    const asked = f.conds.filter(c => c.kind === 'doc' && c.status !== 'open').length;
    add('asked', asked > 0, 'You sent the investor their document list', { href: `/deals/${id}/underwriting`, text: 'Open the checklist' }, asked ? `${asked} item(s) asked for` : 'Nothing asked for yet');
    add('portal', f.portal, 'The investor\'s status page is turned on', { href: `/deals/${id}#portal`, text: 'Turn it on' });
    add('close', d.target_close_date, 'A target closing date is set', edit);
  } else if (d.stage === 'Processing') {
    const missing = f.conds.filter(c => c.kind === 'doc' && c.requirement !== 'C' && ['open', 'requested'].includes(c.status));
    add('docs', !missing.length, 'Every needed document is in', { href: `/deals/${id}/underwriting`, text: 'See what\'s missing' }, missing.length ? `Still missing: ${names(missing)}` : null);
    add('analysis', d.analysis_json, 'You checked the numbers in the analyzer', { href: `/deals/${id}/analyze`, text: 'Open the analyzer' });
    add('redflags', d.redflags_json, 'You did the red-flag review', { href: `/deals/${id}/underwriting`, text: 'Do the review' });
  } else if (d.stage === 'Underwriting') {
    out.confirms.push({ key: 'c_conditions', label: 'The lender\'s underwriter sent back their list of conditions (only the lender decides this)' });
  } else if (d.stage === 'Conditionally Approved') {
    const open = f.conds.filter(c => !['cleared', 'waived'].includes(c.status) && !(c.status === 'open' && c.requirement === 'C'));
    add('conds', !open.length, 'Every item on the list is done or not needed', { href: `/deals/${id}/underwriting`, text: 'See what\'s left' }, open.length ? `Still open: ${names(open)}` : null);
    add('fees', !f.unpaid, 'No unpaid fee requests', { href: `/deals/${id}/payments`, text: 'Check fees' }, f.unpaid ? `${f.unpaid} unpaid` : null);
    out.confirms.push({ key: 'c_ctc', label: 'The lender issued clear-to-close (only the lender decides this)' });
  } else if (d.stage === 'Clear to Close') {
    out.confirms.push({ key: 'c_funded', label: 'Title / escrow confirmed the loan closed and funded' });
  }
  out.ready = out.checks.every(c => c.ok);
  return out;
}

// Shared stage move (used by the classic stage dropdown and the v3 button). Returns a plain-English summary.
function moveStage(db, engine, dealId, to, { userId = null, nextStepDate, nextStepNote } = {}) {
  const d = db.prepare('SELECT id, stage FROM deals WHERE id = ?').get(dealId); if (!d || d.stage === to) return null;
  db.prepare("UPDATE deals SET stage = ?, updated_at = datetime('now'), closed_date = CASE WHEN ? = 'Closed' AND closed_date IS NULL THEN ? ELSE closed_date END, app_date = CASE WHEN ? = 'Application' AND app_date IS NULL THEN ? ELSE app_date END WHERE id = ?").run(to, to, todayISO(), to, todayISO(), d.id);
  if (nextStepDate !== undefined) db.prepare('UPDATE deals SET next_step_date = ?, next_step_note = ? WHERE id = ?').run(nextStepDate || null, nextStepNote || null, d.id);
  model.log(db, { entity_type: 'deal', entity_id: d.id, action: 'stage.changed', detail: `${d.stage} → ${to}`, user_id: userId });
  const r = engine.onStageChange(d.id, d.stage, to, { userId });
  const msgs = r && r.messages ? r.messages : [];
  return { from: d.stage, to, result: r, msg: `Moved to ${to}.` + (r && !r.skipped ? ` Automation: ${r.tasks} task(s), portal update posted${msgs.length ? `, ${msgs.length} message(s) → Outbox (${msgs.map(m => m.status).join(', ')})` : ''}.` : '') };
}

module.exports = { NEXT, FLOW, gateFor, moveStage, P };
