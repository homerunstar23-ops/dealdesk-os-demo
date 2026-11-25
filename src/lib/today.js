'use strict';
// v3 "Today" queue: one ranked list of next-best actions built only from the app's own data.
// Sources: new online applications, overdue / due-today tasks, documents waiting for review, outbox
// messages waiting for approval, deals ready to move, items the borrower still owes, stale deals,
// unpaid fee requests, and investors with no "expected next step" date. Done / Skip hide an item for today.
const { todayISO, money, fmtDate } = require('./util');
const { LOAN_TYPES, OPEN_STAGES } = require('../db');
const gates = require('./gates');
const P = require('./plain');
const model = require('./model');

const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
const dayOf = (ts) => (ts ? String(ts).replace('T', ' ').slice(0, 10) : null);
const agoText = (n) => n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;

function buildActions(db, { today = todayISO(), includeDismissed = false } = {}) {
  const dismissed = new Set(db.prepare('SELECT item_key FROM today_dismissals WHERE day = ?').all(today).map(r => r.item_key));
  const out = [];
  const push = (a) => { if (includeDismissed || !dismissed.has(a.key)) out.push(a); };
  const openIn = OPEN_STAGES.map(() => '?').join(',');
  const who = (r) => r.first_name || 'the investor';

  // 1. New online applications (intake) not reviewed yet
  db.prepare(`SELECT d.id, d.name, d.loan_type, d.loan_amount, d.created_at, c.id cid, c.first_name, c.phone, c.email, c.dnc FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id
    WHERE d.source = 'intake' AND d.intake_reviewed = 0 AND d.stage IN (${openIn}) ORDER BY d.created_at`).all(...OPEN_STAGES).forEach(r => {
    const age = Math.max(0, daysBetween(dayOf(r.created_at), today));
    push({ key: `intake:${r.id}`, kind: 'intake', icon: '📥', score: 100 + Math.min(age, 10) * 2, dealId: r.id,
      title: `Call ${who(r)} about the new application`,
      why: `${who(r)} sent a ${LOAN_TYPES[r.loan_type] || ''} request${r.loan_amount ? ' for ' + money(r.loan_amount) : ''} ${agoText(age)}. Fast follow-up wins deals.`,
      doHref: `/deals/${r.id}`, doText: 'Open the application', call: r.phone && !r.dnc ? r.phone : null, doneText: 'Done — I reached out', done: 'intake_reviewed' });
  });
  // 2. Overdue + due-today tasks
  db.prepare(`SELECT t.id, t.title, t.due_date, t.deal_id, d.name deal_name, c.first_name FROM tasks t LEFT JOIN deals d ON d.id = t.deal_id LEFT JOIN contacts c ON c.id = t.contact_id
    WHERE t.done = 0 AND t.due_date IS NOT NULL AND t.due_date <= ? ORDER BY t.due_date`).all(today).forEach(t => {
    const late = daysBetween(t.due_date, today);
    push({ key: `task:${t.id}`, kind: late > 0 ? 'overdue' : 'task', icon: late > 0 ? '⏰' : '✅', score: late > 0 ? 90 + Math.min(late, 15) : 70, dealId: t.deal_id,
      title: t.title, why: (late > 0 ? `Was due ${fmtDate(t.due_date)} (${late} day${late > 1 ? 's' : ''} late)` : 'Due today') + (t.deal_name ? ` · ${t.deal_name}` : t.first_name ? ` · ${t.first_name}` : ''),
      doHref: t.deal_id ? `/deals/${t.deal_id}` : '/tasks', doText: t.deal_id ? 'Open the deal' : 'Open tasks', doneText: 'Done', done: 'task' });
  });
  // 3. Documents the borrower sent that need a look
  db.prepare(`SELECT d.id, d.name, c.first_name, COUNT(*) n, MIN(x.received_at) first_at FROM conditions x JOIN deals d ON d.id = x.deal_id LEFT JOIN contacts c ON c.id = d.contact_id
    WHERE x.status = 'received' AND d.stage IN (${openIn}) GROUP BY d.id ORDER BY first_at`).all(...OPEN_STAGES).forEach(r => {
    push({ key: `review:${r.id}:${r.n}`, kind: 'review', icon: '📄', score: 80, dealId: r.id,
      title: `Look at ${r.n} new document${r.n > 1 ? 's' : ''} from ${who(r)}`, why: `${r.name} · they uploaded it and it needs a quick review.`,
      doHref: `/deals/${r.id}/underwriting`, doText: 'Open the checklist', doneText: 'Done — I reviewed them', done: 'docs_reviewed' });
  });
  // 4. Outbox approvals
  const held = db.prepare("SELECT COUNT(*) n FROM outbox WHERE status = 'held'").get().n;
  if (held) push({ key: `outbox:${held}`, kind: 'outbox', icon: '✉️', score: 75, title: `Approve ${held} message${held > 1 ? 's' : ''} waiting to go out`,
    why: 'Automated updates are held until you read them. Automated sending is ' + (model.getSettings(db).automated_sending === '1' ? 'ON.' : 'OFF, so approved messages are simulated, not sent.'),
    doHref: '/outbox?status=held', doText: 'Read & approve', doneText: 'Hide for today', done: 'hide' });
  // 5. Deals ready to move + 7. borrower owes items + 10. no expected date
  const open = db.prepare(`SELECT d.*, c.first_name FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id WHERE d.stage IN (${openIn}) ORDER BY d.id`).all(...OPEN_STAGES);
  open.forEach(d => {
    const g = gates.gateFor(db, d);
    if (g.next && g.ready && g.checks.length) push({ key: `move:${d.id}:${d.stage}`, kind: 'move', icon: '🚀', score: 60, dealId: d.id,
      title: `Move ${d.name.replace(/^DEMO /, '')} to "${P.STAGE_PLAIN[g.next]}"`, why: `Everything for "${P.STAGE_PLAIN[d.stage]}" is checked off.`,
      doHref: `/deals/${d.id}/next`, doText: 'Move it forward', doneText: 'Hide for today', done: 'hide' });
  });
  db.prepare(`SELECT d.id, d.name, c.first_name, COUNT(*) n, MIN(x.requested_at) oldest FROM conditions x JOIN deals d ON d.id = x.deal_id LEFT JOIN contacts c ON c.id = d.contact_id
    WHERE x.status = 'requested' AND x.borrower_visible = 1 AND d.stage IN (${openIn}) GROUP BY d.id`).all(...OPEN_STAGES).forEach(r => {
    const age = r.oldest ? daysBetween(dayOf(r.oldest), today) : 0; if (age < 3) return;
    push({ key: `nudge:${r.id}`, kind: 'nudge', icon: '👋', score: 50 + Math.min(age, 20), dealId: r.id,
      title: `Nudge ${who(r)} about ${r.n} missing item${r.n > 1 ? 's' : ''}`, why: `Asked ${age} days ago · ${r.name}. Their status page already lists exactly what's needed.`,
      doHref: `/templates?deal_id=${r.id}`, doText: 'Pick a reminder message', doneText: 'Done — I reminded them', done: 'hide' });
  });
  const cutoff = new Date(Date.now() - 7 * 864e5).toISOString().replace('T', ' ').slice(0, 19);
  open.filter(d => (d.updated_at || d.created_at) < cutoff).forEach(d => {
    const age = daysBetween(dayOf(d.updated_at || d.created_at), today);
    push({ key: `stale:${d.id}`, kind: 'stale', icon: '🕸️', score: 40 + Math.min(age, 30) / 2, dealId: d.id,
      title: `Check in on ${d.name.replace(/^DEMO /, '')}`, why: `No changes in ${age} days. A quick call keeps it moving.`,
      doHref: `/deals/${d.id}`, doText: 'Open the deal', doneText: 'Done — I checked in', done: 'touch' });
  });
  db.prepare("SELECT p.id, p.deal_id, p.description, p.amount_cents, p.requested_at FROM payments p JOIN deals d ON d.id = p.deal_id WHERE p.status = 'requested'").all().forEach(p => {
    const age = daysBetween(dayOf(p.requested_at), today); if (age < 2) return;
    push({ key: `fee:${p.id}`, kind: 'fee', icon: '💳', score: 35, dealId: p.deal_id, title: `Follow up on an unpaid fee: ${p.description}`,
      why: `${money(p.amount_cents / 100, 2)} requested ${agoText(age)}.`, doHref: `/deals/${p.deal_id}/payments`, doText: 'Open fees', doneText: 'Hide for today', done: 'hide' });
  });
  open.forEach(d => {
    if (d.stage === 'Lead' || d.next_step_date && d.next_step_date >= today) return;
    if (!db.prepare('SELECT id FROM portal_links WHERE deal_id = ? AND revoked = 0').get(d.id)) return;
    push({ key: `eta:${d.id}`, kind: 'eta', icon: '📅', score: d.next_step_date ? 30 : 20, dealId: d.id,
      title: `Tell ${who(d)} when to expect the next step`, why: d.next_step_date ? `The date you gave (${fmtDate(d.next_step_date)}) has passed.` : 'Their status page has no expected date yet.',
      doHref: `/deals/${d.id}#next-step`, doText: 'Set the date', doneText: 'Hide for today', done: 'hide' });
  });
  return out.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

// Done: performs the item's own action (when there is a safe one) and hides it for today.
function complete(db, key, { userId, today = todayISO(), kind = 'done' } = {}) {
  const [type, id] = String(key).split(':'); const n = Number(id);
  if (kind === 'done') {
    if (type === 'task' && n) db.prepare("UPDATE tasks SET done = 1, done_at = datetime('now') WHERE id = ? AND done = 0").run(n);
    if (type === 'intake' && n) { db.prepare('UPDATE deals SET intake_reviewed = 1 WHERE id = ?').run(n); model.log(db, { entity_type: 'deal', entity_id: n, action: 'intake.reviewed', detail: 'Intake marked reviewed (Today)', user_id: userId }); }
    if (type === 'review' && n) { const r = db.prepare("UPDATE conditions SET status = 'reviewed', reviewed_at = datetime('now') WHERE deal_id = ? AND status = 'received'").run(n); model.log(db, { entity_type: 'deal', entity_id: n, action: 'condition.bulk', detail: `${r.changes} item(s) received → reviewed (Today)`, user_id: userId }); }
    if (type === 'stale' && n) { db.prepare("UPDATE deals SET updated_at = datetime('now') WHERE id = ?").run(n); model.log(db, { entity_type: 'deal', entity_id: n, action: 'deal.checked_in', detail: 'Checked in (Today)', user_id: userId }); }
  }
  db.prepare('INSERT OR REPLACE INTO today_dismissals (item_key, day, kind, user_id) VALUES (?,?,?,?)').run(String(key).slice(0, 120), today, kind, userId || null);
}

module.exports = { buildActions, complete };
