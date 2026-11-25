'use strict';
// Seeds: admin user (from env), default settings, template library (from lo-toolkit), and FAKE demo data.
const autoTemplates = require('./lib/auto-templates');
const bcrypt = require('bcryptjs');
const ref = require('./reference');
const model = require('./lib/model');
const { todayISO } = require('./lib/util');

const DEFAULT_SETTINGS = {
  lo_name: '', lo_title: 'Loan Officer', nmls_id: '', company_name: '', company_short: '', company_nmls_id: '', phone: '',
  physical_address: '', state_disclosures: '', booking_link: '', tool_link: '', public_base_url: 'http://localhost:4100',
  public_brand: 'Investor Loan Scenario Desk', appraisal_default_cents: '0',
  // v2 automation
  automated_sending: '0', quiet_start: '8', quiet_end: '21', digest_email: ''
};

function ensureBase(db, { adminEmail, adminPassword, adminName } = {}) {
  const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if (!users) {
    if (!adminEmail || !adminPassword) throw new Error('No users yet: set ADMIN_EMAIL and ADMIN_PASSWORD (run `npm run setup` to generate them).');
    if (adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
    db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'admin')").run(adminEmail, adminName || 'Admin', bcrypt.hashSync(adminPassword, 12));
  }
  const insS = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(DEFAULT_SETTINGS).forEach(([k, v]) => insS.run(k, v));
  const insT = db.prepare('INSERT OR IGNORE INTO templates (code, category, name, channel, subject, body, source_doc) VALUES (?,?,?,?,?,?,?)');
  ref.templates().forEach(t => insT.run(t.code, t.category, t.name, t.channel, t.subject || (t.channel === 'email' ? 'Update on {{PROPERTY_SHORT}}' : null), t.body, t.source_doc));
  autoTemplates.forEach(t => insT.run(t.code, t.category, t.name, t.channel, t.subject, t.body, t.source_doc));
  const insQ = db.prepare('INSERT OR IGNORE INTO sequences (key, name, audience, steps_json, active) VALUES (?,?,?,?,1)');
  autoTemplates.SEQUENCES.forEach(q => insQ.run(q.key, q.name, q.audience, JSON.stringify(q.steps)));
}

function addDays(n) { const d = new Date(todayISO() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function daysAgoTs(n) { const d = new Date(Date.now() - n * 864e5); return d.toISOString().replace('T', ' ').slice(0, 19); }

function seedDemo(db) {
  if (db.prepare("SELECT value FROM settings WHERE key = 'demo_seeded'").get()) return false;
  const adminId = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get().id;
  const tx = db.transaction(() => {
    const co = db.prepare('INSERT INTO companies (name, kind, state, notes, is_demo) VALUES (?,?,?,?,1)');
    const C1 = co.run('DEMO Coastal Example Holdings LLC', 'Borrower LLC', 'FL', 'Fake demo entity.').lastInsertRowid;
    const C2 = co.run('DEMO Sunrise Sample Rentals LLC', 'Borrower LLC', 'FL', 'Fake demo entity.').lastInsertRowid;
    const C3 = co.run('DEMO Placeholder Realty', 'Brokerage', 'FL', 'Fake demo brokerage.').lastInsertRowid;
    const C4 = co.run('DEMO Example Title & Escrow', 'Title/escrow', 'FL', 'Fake demo title company.').lastInsertRowid;

    const ct = db.prepare(`INSERT INTO contacts (type, first_name, last_name, email, phone, company_id, lead_source, tags, city, state, email_consent, email_consent_at, sms_consent, sms_consent_at, consent_method, dnc, notes, is_demo, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`);
    const P = (type, fn, ln, n, company, src, tags, city, ec, sc, dnc, created) => ct.run(type, fn, ln, `${fn.toLowerCase()}.${ln.toLowerCase()}@example.com`, `(561) 555-01${String(n).padStart(2, '0')}`, company, src, tags, city, 'FL', ec, ec ? daysAgoTs(created) : null, sc, sc ? daysAgoTs(created) : null, ec || sc ? 'Web form checkbox (demo)' : null, dnc, 'Fake demo contact — not a real person.', daysAgoTs(created)).lastInsertRowid;
    const avery = P('borrower', 'Avery', 'Sample', 1, C1, 'DSCR calculator', 'investor,repeat', 'Jupiter', 1, 1, 0, 60);
    const jordan = P('borrower', 'Jordan', 'Example', 2, C2, 'Referral — agent', 'investor,brrrr', 'West Palm Beach', 1, 0, 0, 45);
    const riley = P('borrower', 'Riley', 'Placeholder', 3, null, 'Deal checklist download', 'new-investor', 'Lake Worth Beach', 1, 0, 0, 20);
    const casey = P('borrower', 'Casey', 'Testcase', 4, null, 'Public intake form', 'flipper', 'Stuart', 1, 1, 0, 2);
    const morgan = P('borrower', 'Morgan', 'Mockley', 5, null, 'LinkedIn', 'builder', 'Port St. Lucie', 1, 0, 0, 90);
    const taylor = P('agent', 'Taylor', 'Fakename', 6, C3, 'Networking event', 'partner,agent', 'Palm Beach Gardens', 1, 0, 0, 120);
    const quinn = P('wholesaler', 'Quinn', 'Dummy', 7, null, 'Inbound call', 'wholesaler', 'Boca Raton', 0, 0, 1, 30);
    const sam = P('partner', 'Sam', 'Sampleton', 8, C4, 'Existing relationship', 'title', 'Palm Beach Gardens', 1, 0, 0, 200);
    const drew = P('borrower', 'Drew', 'Notreal', 9, null, 'Referral — past client', 'investor', 'Tequesta', 1, 1, 0, 150);
    P('broker', 'Blake', 'Imaginary', 10, null, 'Conference', 'broker', 'Fort Lauderdale', 0, 0, 0, 75);

    const dl = db.prepare(`INSERT INTO deals (name, contact_id, company_id, stage, loan_type, transaction_type, property_address, city, state, zip, property_type, units, purchase_price, as_is_value, rehab_budget, arv, monthly_rent, payoff, loan_amount, experience_deals, credit_range, liquidity, exit_strategy, assigned_to, lead_source, app_date, target_close_date, closed_date, dead_reason, source, intake_reviewed, is_demo, created_at, updated_at)
      VALUES (@name,@contact_id,@company_id,@stage,@loan_type,@transaction_type,@property_address,@city,'FL',@zip,@property_type,@units,@purchase_price,@as_is_value,@rehab_budget,@arv,@monthly_rent,@payoff,@loan_amount,@experience_deals,@credit_range,@liquidity,@exit_strategy,${adminId},@lead_source,@app_date,@target_close_date,@closed_date,@dead_reason,@source,@intake_reviewed,1,@created_at,@created_at)`);
    const base = { company_id: null, transaction_type: 'purchase', zip: null, property_type: 'Single family', units: 1, purchase_price: null, as_is_value: null, rehab_budget: null, arv: null, monthly_rent: null, payoff: null, loan_amount: null, experience_deals: 2, credit_range: '720-759', liquidity: null, exit_strategy: null, lead_source: null, app_date: null, target_close_date: null, closed_date: null, dead_reason: null, source: 'manual', intake_reviewed: 1 };
    const D = (o) => dl.run(Object.assign({}, base, o)).lastInsertRowid;
    const d1 = D({ name: 'DEMO 101 Example Way — DSCR purchase', contact_id: riley, stage: 'Lead', loan_type: 'dscr', property_address: '101 Example Way', city: 'Lake Worth Beach', zip: '33460', purchase_price: 310000, monthly_rent: 2650, loan_amount: 232500, experience_deals: 0, credit_range: '680-719', liquidity: 95000, exit_strategy: 'Long-term hold', lead_source: 'Deal checklist download', created_at: daysAgoTs(6) });
    const d2 = D({ name: 'DEMO 22 Sample Ct — Fix & flip', contact_id: casey, stage: 'Lead', loan_type: 'flip', property_address: '22 Sample Ct', city: 'Stuart', zip: '34994', purchase_price: 240000, rehab_budget: 65000, arv: 420000, loan_amount: 274500, experience_deals: 3, credit_range: '720-759', liquidity: 80000, exit_strategy: 'Sell after rehab (~6 months)', lead_source: 'Public intake form', source: 'intake', intake_reviewed: 0, created_at: daysAgoTs(1) });
    const d3 = D({ name: 'DEMO 7 Placeholder Ln — Cash-out refi', contact_id: avery, company_id: C1, stage: 'Application', loan_type: 'cashout', transaction_type: 'cashout', property_address: '7 Placeholder Ln', city: 'Jupiter', zip: '33458', property_type: '2-4 unit', units: 2, as_is_value: 560000, monthly_rent: 4300, payoff: 210000, loan_amount: 392000, experience_deals: 9, credit_range: '760+', liquidity: 150000, exit_strategy: 'Hold; cash-out for next acquisition', lead_source: 'DSCR calculator', app_date: addDays(-4), target_close_date: addDays(26), created_at: daysAgoTs(12) });
    const d4 = D({ name: 'DEMO 455 Mock Blvd — Fix & flip', contact_id: jordan, company_id: C2, stage: 'Processing', loan_type: 'flip', property_address: '455 Mock Blvd', city: 'West Palm Beach', zip: '33407', purchase_price: 200000, rehab_budget: 50000, arv: 350000, loan_amount: 225000, experience_deals: 4, credit_range: '720-759', liquidity: 70000, exit_strategy: 'Sell; backup plan rent + DSCR refi', lead_source: 'Referral — agent', app_date: addDays(-10), target_close_date: addDays(14), created_at: daysAgoTs(18) });
    const d5 = D({ name: 'DEMO 18 Fictional Dr — Bridge', contact_id: drew, stage: 'Underwriting', loan_type: 'bridge', property_address: '18 Fictional Dr', city: 'Tequesta', zip: '33469', purchase_price: 480000, rehab_budget: 20000, arv: 560000, loan_amount: 375000, experience_deals: 6, credit_range: '760+', liquidity: 210000, exit_strategy: 'Refinance into DSCR loan after lease-up', lead_source: 'Referral — past client', app_date: addDays(-16), target_close_date: addDays(9), created_at: daysAgoTs(25) });
    const d6 = D({ name: 'DEMO 3 Sampleton St — DSCR purchase', contact_id: avery, company_id: C1, stage: 'Conditionally Approved', loan_type: 'dscr', property_address: '3 Sampleton St', city: 'Palm Beach Gardens', zip: '33410', purchase_price: 300000, monthly_rent: 2600, loan_amount: 225000, experience_deals: 9, credit_range: '760+', liquidity: 150000, exit_strategy: 'Long-term hold', lead_source: 'DSCR calculator', app_date: addDays(-21), target_close_date: addDays(5), created_at: daysAgoTs(30) });
    const d7 = D({ name: 'DEMO 900 Notreal Ave — Fix & flip', contact_id: jordan, company_id: C2, stage: 'Clear to Close', loan_type: 'flip', property_address: '900 Notreal Ave', city: 'Riviera Beach', zip: '33404', purchase_price: 185000, rehab_budget: 45000, arv: 330000, loan_amount: 207000, experience_deals: 4, credit_range: '720-759', liquidity: 70000, exit_strategy: 'Sell after rehab', lead_source: 'Referral — agent', app_date: addDays(-30), target_close_date: addDays(2), created_at: daysAgoTs(38) });
    D({ name: 'DEMO 64 Example Cir — DSCR purchase', contact_id: drew, stage: 'Closed', loan_type: 'dscr', property_address: '64 Example Cir', city: 'Tequesta', zip: '33469', purchase_price: 275000, monthly_rent: 2450, loan_amount: 206250, experience_deals: 5, credit_range: '760+', liquidity: 120000, exit_strategy: 'Long-term hold', lead_source: 'Referral — past client', app_date: addDays(-70), target_close_date: addDays(-35), closed_date: addDays(-36), created_at: daysAgoTs(80) });
    D({ name: 'DEMO 12 Imaginary Rd — Ground-up', contact_id: morgan, stage: 'Dead', loan_type: 'ground_up', property_address: '12 Imaginary Rd', city: 'Port St. Lucie', zip: '34983', property_type: 'Lot / new construction', purchase_price: 90000, rehab_budget: 310000, arv: 520000, loan_amount: 340000, experience_deals: 1, credit_range: '680-719', liquidity: 60000, exit_strategy: 'Build and sell', lead_source: 'LinkedIn', dead_reason: 'Borrower paused project (demo)', created_at: daysAgoTs(50) });
    const d10 = D({ name: 'DEMO 5 Mockingbird Pl — Ground-up', contact_id: morgan, stage: 'Processing', loan_type: 'ground_up', property_address: '5 Mockingbird Pl', city: 'Port St. Lucie', zip: '34986', property_type: 'Lot / new construction', purchase_price: 85000, rehab_budget: 295000, arv: 510000, loan_amount: 323000, experience_deals: 2, credit_range: '720-759', liquidity: 110000, exit_strategy: 'Build and sell; backup: rent', lead_source: 'LinkedIn', app_date: addDays(-8), target_close_date: addDays(40), created_at: daysAgoTs(15) });

    [d1, d2, d3, d4, d5, d6, d7, d10].forEach(id => model.seedChecklist(db, id));
    // Move some checklist items along so the underwriting views have realistic states.
    const setStatus = (dealId, status, n, offset = 0) => db.prepare(`UPDATE conditions SET status = ?, requested_at = datetime('now','-5 days'), received_at = CASE WHEN ? IN ('received','reviewed','cleared') THEN datetime('now','-2 days') END, reviewed_at = CASE WHEN ? IN ('reviewed','cleared') THEN datetime('now','-1 days') END, cleared_at = CASE WHEN ? = 'cleared' THEN datetime('now') END WHERE id IN (SELECT id FROM conditions WHERE deal_id = ? ORDER BY sort LIMIT ? OFFSET ?)`).run(status, status, status, status, dealId, n, offset);
    setStatus(d3, 'requested', 6); setStatus(d4, 'cleared', 4); setStatus(d4, 'received', 3, 4); setStatus(d4, 'requested', 5, 7);
    setStatus(d5, 'cleared', 8); setStatus(d5, 'reviewed', 4, 8); setStatus(d5, 'requested', 3, 12);
    setStatus(d6, 'cleared', 14); setStatus(d6, 'received', 2, 14); setStatus(d6, 'requested', 1, 16);
    setStatus(d7, 'cleared', 30); setStatus(d10, 'requested', 8);
    const uc = db.prepare("INSERT INTO conditions (deal_id, kind, category, title, status, requested_at, sort) VALUES (?, 'condition', ?, ?, ?, datetime('now','-1 days'), 100)");
    uc.run(d6, 'Property / valuation', 'Insurance binder: correct mortgagee clause and coverage amount', 'requested');
    uc.run(d6, 'Closing', 'Wire instructions verified by phone with title at a known number', 'requested');
    uc.run(d5, 'Borrower / entity', 'Letter of explanation for large deposit (demo)', 'received');

    const tk = db.prepare('INSERT INTO tasks (title, due_date, contact_id, deal_id, assigned_to, is_demo) VALUES (?,?,?,?,?,1)');
    tk.run('Call Casey re: new intake — 3 scenario questions (F-1)', addDays(0), casey, d2, adminId);
    tk.run('Send DSCR checklist + upload link to Riley', addDays(-2), riley, d1, adminId);
    tk.run('Follow up on outstanding items (S-4)', addDays(-1), jordan, d4, adminId);
    tk.run('Confirm insurance binder with agent', addDays(0), avery, d6, adminId);
    tk.run('Friday weekly status update (S-2)', addDays(3), drew, d5, adminId);
    tk.run('Quarterly check-in with Taylor (partner)', addDays(10), taylor, null, adminId);
    tk.run('Order appraisal once fee is paid', addDays(1), morgan, d10, adminId);
    const doneT = tk.run('Send closing wire-safety note (S-5)', addDays(-1), jordan, d7, adminId).lastInsertRowid;
    db.prepare("UPDATE tasks SET done = 1, done_at = datetime('now') WHERE id = ?").run(doneT);

    const nt = db.prepare("INSERT INTO notes (entity_type, entity_id, body, user_id, created_at) VALUES (?,?,?,?,?)");
    nt.run('deal', d4, 'DEMO: Borrower confirmed contractor bid is final. Draw schedule requested.', adminId, daysAgoTs(3));
    nt.run('deal', d6, 'DEMO: Appraisal came in at contract price; rent schedule supports the lease.', adminId, daysAgoTs(2));
    nt.run('deal_uw', d5, 'DEMO: Scenario desk asked for 2 prior flip settlement statements to verify experience.', adminId, daysAgoTs(4));
    nt.run('contact', taylor, 'DEMO: Agent works with several investor clients; prefers email. No referral fees (RESPA).', adminId, daysAgoTs(20));
    nt.run('contact', quinn, 'DEMO: Asked to be placed on do-not-call list. Marked DNC.', adminId, daysAgoTs(10));

    const py = db.prepare("INSERT INTO payments (deal_id, kind, description, amount_cents, status, provider, payment_url, requested_at, paid_at, is_demo) VALUES (?,?,?,?,?,'manual',?,?,?,1)");
    py.run(d6, 'appraisal', 'Appraisal fee (demo)', 65000, 'paid', 'https://example.com/demo-payment-link', daysAgoTs(14), daysAgoTs(13));
    py.run(d10, 'appraisal', 'Appraisal fee — ground-up (demo)', 85000, 'requested', 'https://example.com/demo-payment-link', daysAgoTs(3), null);
    py.run(d4, 'appraisal', 'Appraisal fee — as-is + ARV (demo)', 72500, 'requested', 'https://example.com/demo-payment-link', daysAgoTs(1), null);

    model.log(db, { entity_type: 'deal', entity_id: d2, action: 'intake.created', detail: 'DEMO intake submitted via public form' });
    model.log(db, { entity_type: 'deal', entity_id: d6, action: 'stage.changed', detail: 'Underwriting → Conditionally Approved', user_id: adminId });
    model.log(db, { entity_type: 'deal', entity_id: d4, action: 'file.uploaded', detail: 'DEMO: borrower uploaded Scope of work + rehab budget' });
    model.setSetting(db, 'demo_seeded', new Date().toISOString());
  });
  tx();
  return true;
}

function deleteDemo(db) {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM notes WHERE (entity_type IN ('deal','deal_uw') AND entity_id IN (SELECT id FROM deals WHERE is_demo = 1)) OR (entity_type = 'contact' AND entity_id IN (SELECT id FROM contacts WHERE is_demo = 1))").run();
    db.prepare("DELETE FROM activities WHERE (entity_type = 'deal' AND entity_id IN (SELECT id FROM deals WHERE is_demo = 1)) OR (entity_type = 'contact' AND entity_id IN (SELECT id FROM contacts WHERE is_demo = 1))").run();
    db.prepare('DELETE FROM outbox WHERE contact_id IN (SELECT id FROM contacts WHERE is_demo = 1) OR deal_id IN (SELECT id FROM deals WHERE is_demo = 1)').run();
    db.prepare('DELETE FROM sequence_enrollments WHERE contact_id IN (SELECT id FROM contacts WHERE is_demo = 1)').run();
    db.prepare('DELETE FROM notifications WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = 1)').run();
    db.prepare('DELETE FROM tasks WHERE is_demo = 1 OR deal_id IN (SELECT id FROM deals WHERE is_demo = 1) OR contact_id IN (SELECT id FROM contacts WHERE is_demo = 1)').run();
    db.prepare('DELETE FROM deals WHERE is_demo = 1').run();
    db.prepare('DELETE FROM contacts WHERE is_demo = 1').run();
    db.prepare('DELETE FROM companies WHERE is_demo = 1').run();
  });
  tx();
}

// v2 demo: status portal, automation runs and outbox entries (all fake, nothing is sent).
function seedDemoV2(db, engine, now = new Date()) {
  if (db.prepare("SELECT value FROM settings WHERE key = 'demo_v2_seeded'").get()) return false;
  const deal = (prefix) => db.prepare("SELECT * FROM deals WHERE is_demo = 1 AND name LIKE ?").get('DEMO ' + prefix + '%');
  const person = (fn) => db.prepare("SELECT * FROM contacts WHERE is_demo = 1 AND first_name = ?").get(fn);
  const d6 = deal('3 Sampleton'), d2 = deal('22 Sample'), d7 = deal('900 Notreal'), d3 = deal('7 Placeholder'), d1 = deal('101 Example');
  if (!d6) { model.setSetting(db, 'demo_v2_seeded', 'skipped'); return false; }
  const ago = (days, h = 0) => new Date(now.getTime() - days * 864e5 - h * 36e5).toISOString().replace('T', ' ').slice(0, 19);
  // borrower wording + internal-only items on the demo portal deal
  db.prepare("UPDATE conditions SET borrower_visible = 0 WHERE deal_id = ? AND title LIKE 'Wire instructions verified%'").run(d6.id);
  db.prepare("UPDATE conditions SET borrower_text = 'Insurance binder from your agent showing the lender as mortgagee and the coverage amount', note = 'DEMO internal: agent slow to respond; coverage short by $20k on first draft' WHERE deal_id = ? AND title LIKE 'Insurance binder%'").run(d6.id);
  engine.createPortalLink(d6.id, { verifyMode: 'email_phone4', token: engine.demoToken ? engine.demoToken('avery-3-sampleton') : null });
  // v3: LO-entered expected next-step date shown on the investor's status page (demo)
  const eta = new Date(now.getTime() + 4 * 864e5).toISOString().slice(0, 10);
  db.prepare('UPDATE deals SET next_step_date = ?, next_step_note = ? WHERE id = ?').run(eta, 'We expect to review your uploaded items with the lender', d6.id);
  const upd = db.prepare("INSERT INTO portal_updates (deal_id, body, source, rule_key, created_at) VALUES (?,?,?,?,?)");
  upd.run(d6.id, 'We received your scenario. A licensed loan officer will review it and follow up.', 'automation', 'intake_ack', ago(30));
  upd.run(d6.id, 'Your file moved to "Application". Thanks for the documents so far.', 'automation', 'stage_change', ago(21));
  upd.run(d6.id, 'Appraisal has been ordered through the lender\'s process. We will let you know when the report is back.', 'staff', null, ago(14));
  upd.run(d6.id, 'Your file moved to "Underwriting review". The underwriter is reviewing the file.', 'automation', 'stage_change', ago(9));
  upd.run(d6.id, 'Your file moved to "Conditions issued". Please see the items below — upload them right on this page.', 'automation', 'stage_change', ago(2));
  db.prepare('UPDATE deals SET stage_changed_at = ? WHERE id = ?').run(ago(2).replace(' ', 'T') + 'Z', d6.id);
  if (d2) engine.onIntake(d2.id, { now });
  if (d7) engine.onStageChange(d7.id, 'Conditionally Approved', 'Clear to Close', { now });
  const riley = person('Riley'), taylor = person('Taylor'), quinn = person('Quinn');
  // enrollments backdated so the first step comes due now
  const back = new Date(now.getTime() - 3 * 864e5);
  if (riley && d1) engine.enroll('investor-lead-21', riley.id, d1.id, back);
  if (taylor) engine.enroll('partner-30', taylor.id, null, back);
  if (quinn) engine.enroll('partner-30', quinn.id, null, back);
  if (d3) db.prepare("UPDATE conditions SET requested_at = ? WHERE deal_id = ? AND status = 'requested'").run(ago(5, 2), d3.id);
  engine.processDocReminders(now);
  engine.processSequences(now);
  engine.staleDeals(now);
  model.setSetting(db, 'demo_v2_seeded', now.toISOString());
  return true;
}

module.exports = { ensureBase, seedDemo, seedDemoV2, deleteDemo, DEFAULT_SETTINGS };
