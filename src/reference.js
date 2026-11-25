'use strict';
// Loads the reference content (doc matrix, conditions, red flags, templates, compliance docs)
// from the lo-toolkit copy in /reference so the app and the toolkit stay in sync.
const fs = require('fs');
const path = require('path');

const REF = path.join(__dirname, '..', 'reference', 'lo-toolkit');
const read = (p) => fs.readFileSync(path.join(REF, p), 'utf8');
const MATRIX_COLS = ['dscr', 'flip', 'bridge', 'ground_up', 'cashout'];
const REQ_LABEL = { R: 'Typically required', C: 'If applicable', P: 'Depends on purchase vs. refi', '—': 'Not typical' };

function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}

function docMatrix() {
  const lines = read('03-underwriting-support/Document-Requirement-Matrix.csv').trim().split(/\r?\n/).slice(1);
  return lines.map(l => {
    const c = parseCsvLine(l);
    const req = {}; MATRIX_COLS.forEach((k, i) => { req[k] = (c[i + 2] || '—').trim(); });
    return { category: c[0], title: c[1], req };
  });
}

// Which checklist items apply to a deal (loan type + transaction).
function checklistFor(loanType, transactionType) {
  const refi = transactionType === 'refi' || transactionType === 'cashout' || loanType === 'cashout';
  return docMatrix().filter(d => {
    const r = d.req[loanType] || '—';
    if (r === 'R' || r === 'C') return true;
    if (r === 'P') {
      if (/purchase contract/i.test(d.title)) return !refi;
      if (/mortgage statement|payoff/i.test(d.title)) return refi;
      return true;
    }
    return false;
  }).map(d => ({ category: d.category, title: d.title, requirement: d.req[loanType] === 'P' ? 'R' : d.req[loanType] }));
}

function bulletSections(file) {
  const out = []; let section = 'General';
  read(file).split(/\r?\n/).forEach(line => {
    const h = line.match(/^##\s+(.*)/); if (h) { section = h[1].trim(); return; }
    const b = line.match(/^-\s+(?:\[ \]\s+)?(.*)/);
    if (b && !/^\*\*/.test(b[1])) out.push({ section, text: b[1].trim() });
  });
  return out;
}
const commonConditions = () => bulletSections('03-underwriting-support/common-conditions-checklist.md');
const redFlags = () => bulletSections('03-underwriting-support/red-flags.md').map((f, i) => ({ key: 'rf' + (i + 1), ...f }));

function stripMd(s) { return s.replace(/\*\*/g, '').replace(/^>\s?/gm, '').trim(); }

function templates() {
  const T = [];
  // Status updates (table rows S-1..S-8) -> email + text templates
  read('01-pipeline-assistant/status-update-templates.md').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\|\s*(S-\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/);
    if (!m) return;
    const [, code, when, email, text] = m;
    let subject = null, body = email.trim();
    const sm = body.match(/^Subject:\s*([^.]+(?:—[^."]*)?)\.\s*(.*)$/);
    if (sm) { subject = sm[1].trim(); body = sm[2].trim(); }
    T.push({ code: code + '-email', category: 'Status updates', name: code + ' ' + when.trim() + ' (email)', channel: 'email', subject, body: stripMd(body.replace(/^"|"$/g, '')), source_doc: '01-pipeline-assistant/status-update-templates.md' });
    const t = text.trim();
    if (t && t !== '—') T.push({ code: code + '-text', category: 'Status updates', name: code + ' ' + when.trim() + ' (text, consented only)', channel: 'sms', subject: null, body: t.replace(/^"|"$/g, ''), source_doc: '01-pipeline-assistant/status-update-templates.md' });
  });
  // Follow-up emails F-1..F-5
  const fu = read('01-pipeline-assistant/follow-up-cadences.md');
  const f1 = fu.match(/\*\*F-1 — ([^*]+)\*\*\s*\nSubject: ([^\n]+)\n>\s*([^\n]+)/);
  if (f1) T.push({ code: 'F-1', category: 'Follow-up cadence', name: 'F-1 ' + f1[1].trim(), channel: 'email', subject: f1[2].trim(), body: f1[3].trim(), source_doc: '01-pipeline-assistant/follow-up-cadences.md' });
  for (const m of fu.matchAll(/\*\*(F-[2-5]) — ([^*]+)\*\*:\s*"([^\n]+)"/g)) {
    T.push({ code: m[1], category: 'Follow-up cadence', name: m[1] + ' ' + m[2].trim(), channel: 'email', subject: null, body: m[3].trim(), source_doc: '01-pipeline-assistant/follow-up-cadences.md' });
  }
  // Outreach scripts: ### headings followed by optional Subject + quoted lines
  const os = read('02-lead-gen/outreach-scripts.md');
  let cur = null; let group = '';
  const flush = () => { if (cur && cur.body.length) T.push({ code: 'O-' + cur.id, category: 'Outreach scripts — ' + group, name: cur.id + ' ' + cur.name, channel: /text/i.test(group) ? 'sms' : (/call/i.test(group) ? 'call' : (/linkedin/i.test(group) ? 'dm' : 'email')), subject: cur.subject, body: cur.body.join('\n'), source_doc: '02-lead-gen/outreach-scripts.md' }); cur = null; };
  os.split(/\r?\n/).forEach(line => {
    let m;
    if ((m = line.match(/^## \d+\.\s*(.*)/))) { flush(); group = m[1].replace(/\(.*\)/, '').trim(); if (/^Text/i.test(group)) cur = { id: '4', name: 'Text (prior express written consent only)', subject: null, body: [] }; return; }
    if ((m = line.match(/^### (\w+)\.\s*(.*)/))) { flush(); cur = { id: m[1], name: m[2].trim(), subject: null, body: [] }; return; }
    if (!cur) return;
    if ((m = line.match(/^Subject:\s*(.*)/))) { cur.subject = m[1].trim(); return; }
    if (/^>/.test(line)) cur.body.push(stripMd(line).replace(/^"|"$/g, ''));
  });
  flush();
  return T;
}

const COMPLIANCE_DIR = '04-compliance-reference';
function complianceDocs() {
  return fs.readdirSync(path.join(REF, COMPLIANCE_DIR)).filter(f => f.endsWith('.md')).sort((a, b) => (a === 'README.md' ? -1 : b === 'README.md' ? 1 : a.localeCompare(b)))
    .map(f => { const md = read(COMPLIANCE_DIR + '/' + f); const t = (md.match(/^#\s+(.*)/m) || [, f])[1]; return { slug: f.replace(/\.md$/, ''), file: f, title: t, md }; });
}
function toolkitDoc(rel) { return read(rel); }

module.exports = { docMatrix, checklistFor, commonConditions, redFlags, templates, complianceDocs, toolkitDoc, REQ_LABEL, MATRIX_COLS };
