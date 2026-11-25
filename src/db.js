'use strict';
// SQLite schema for DealDesk OS. One file DB; WAL mode; foreign keys on.
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const STAGES = ['Lead', 'Application', 'Processing', 'Underwriting', 'Conditionally Approved', 'Clear to Close', 'Closed', 'Dead'];
const OPEN_STAGES = STAGES.filter(s => s !== 'Closed' && s !== 'Dead');
const LOAN_TYPES = { dscr: 'DSCR rental', flip: 'Fix & flip', bridge: 'Bridge', ground_up: 'Ground-up', cashout: 'Cash-out refi' };
const CONTACT_TYPES = ['borrower', 'broker', 'agent', 'wholesaler', 'partner', 'title/escrow', 'insurance', 'other'];
const COND_STATUSES = ['open', 'requested', 'received', 'reviewed', 'cleared', 'waived'];
const OUTBOX_STATUSES = ['queued', 'held', 'sent', 'failed', 'blocked', 'canceled'];
const PAY_STATUSES = ['requested', 'paid', 'refunded', 'canceled'];
const CREDIT_RANGES = ['760+', '720-759', '680-719', '640-679', '600-639', 'Below 600', 'Not sure'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login_at TEXT);
CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT, state TEXT, website TEXT, notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL DEFAULT 'borrower', first_name TEXT NOT NULL, last_name TEXT,
  email TEXT, phone TEXT, company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  lead_source TEXT, tags TEXT, city TEXT, state TEXT,
  email_consent INTEGER NOT NULL DEFAULT 0, email_consent_at TEXT,
  sms_consent INTEGER NOT NULL DEFAULT 0, sms_consent_at TEXT, consent_method TEXT,
  dnc INTEGER NOT NULL DEFAULT 0, opted_out_at TEXT, notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  stage TEXT NOT NULL DEFAULT 'Lead', loan_type TEXT NOT NULL DEFAULT 'dscr', transaction_type TEXT DEFAULT 'purchase',
  property_address TEXT, city TEXT, state TEXT, zip TEXT, property_type TEXT, units INTEGER,
  purchase_price REAL, as_is_value REAL, rehab_budget REAL, arv REAL, monthly_rent REAL, payoff REAL,
  loan_amount REAL, experience_deals INTEGER, credit_range TEXT, liquidity REAL, exit_strategy TEXT,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL, lead_source TEXT,
  app_date TEXT, target_close_date TEXT, closed_date TEXT, dead_reason TEXT,
  analysis_json TEXT, redflags_json TEXT, source TEXT NOT NULL DEFAULT 'manual', intake_reviewed INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, body TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY, entity_type TEXT, entity_id INTEGER, action TEXT NOT NULL, detail TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, ip TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, due_date TEXT, done INTEGER NOT NULL DEFAULT 0, done_at TEXT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE, deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL, is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS conditions (
  id INTEGER PRIMARY KEY, deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'doc', category TEXT, title TEXT NOT NULL, requirement TEXT,
  status TEXT NOT NULL DEFAULT 'open', borrower_visible INTEGER NOT NULL DEFAULT 1,
  requested_at TEXT, received_at TEXT, reviewed_at TEXT, cleared_at TEXT, note TEXT, sort INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS upload_links (
  id INTEGER PRIMARY KEY, deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL, label TEXT, expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT, upload_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY, deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  condition_id INTEGER REFERENCES conditions(id) ON DELETE SET NULL, original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE, mime TEXT, size INTEGER, sha256 TEXT, uploaded_via TEXT NOT NULL,
  link_id INTEGER REFERENCES upload_links(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'appraisal', description TEXT, amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested', provider TEXT NOT NULL DEFAULT 'manual', payment_url TEXT,
  stripe_payment_link_id TEXT, stripe_price_id TEXT, stripe_mode TEXT,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT, refunded_at TEXT, note TEXT, is_demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, category TEXT, name TEXT NOT NULL, channel TEXT, subject TEXT,
  body TEXT NOT NULL, source_doc TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(done, due_date);
CREATE INDEX IF NOT EXISTS idx_cond_deal ON conditions(deal_id);
CREATE INDEX IF NOT EXISTS idx_act_entity ON activities(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(entity_type, entity_id);
`;

const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS portal_links (
  id INTEGER PRIMARY KEY, deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL, token_enc TEXT NOT NULL, verify_mode TEXT NOT NULL DEFAULT 'email_phone4',
  revoked INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0, last_viewed_at TEXT, view_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS portal_updates (
  id INTEGER PRIMARY KEY, deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE, body TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'staff', rule_key TEXT, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, channel TEXT NOT NULL, to_addr TEXT, contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL, enrollment_id INTEGER, subject TEXT, body TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'transactional', basis TEXT, status TEXT NOT NULL, reason TEXT, rule_key TEXT, template_code TEXT,
  dedupe_key TEXT UNIQUE, send_after TEXT, created_at TEXT NOT NULL, updated_at TEXT, sent_at TEXT, transport TEXT, provider_id TEXT, error TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, send_after);
CREATE TABLE IF NOT EXISTS automation_rules (key TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, config_json TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS automation_runs (id INTEGER PRIMARY KEY, rule_key TEXT NOT NULL, ran_at TEXT NOT NULL, summary TEXT, count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  dedupe_key TEXT UNIQUE, created_at TEXT NOT NULL, read_at TEXT);
CREATE TABLE IF NOT EXISTS sequences (
  id INTEGER PRIMARY KEY, key TEXT UNIQUE, name TEXT NOT NULL, audience TEXT, steps_json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id INTEGER PRIMARY KEY, sequence_id INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  step INTEGER NOT NULL DEFAULT 0, next_at TEXT, status TEXT NOT NULL DEFAULT 'active', stop_reason TEXT,
  enrolled_at TEXT NOT NULL, updated_at TEXT);
`;
// Adds v2 columns to v1 tables (idempotent).
const V2_COLUMNS = {
  contacts: [['timezone', 'TEXT'], ['unsub_token', 'TEXT'], ['email_opt_out_at', 'TEXT'], ['sms_opt_out_at', 'TEXT'], ['replied_at', 'TEXT']],
  conditions: [['borrower_text', 'TEXT']],
  files: [['portal_link_id', 'INTEGER']],
  deals: [['stage_changed_at', 'TEXT']]
};
function migrate(db) {
  db.exec(SCHEMA_V2);
  for (const [table, cols] of Object.entries(V2_COLUMNS)) {
    const have = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    cols.forEach(([c, type]) => { if (!have.includes(c)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${c} ${type}`); });
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_unsub ON contacts(unsub_token)');
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

module.exports = { OUTBOX_STATUSES, openDb, STAGES, OPEN_STAGES, LOAN_TYPES, CONTACT_TYPES, COND_STATUSES, PAY_STATUSES, CREDIT_RANGES };
