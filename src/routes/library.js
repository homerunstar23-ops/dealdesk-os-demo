'use strict';
// Templates library (merge fields, copy-to-clipboard only) + compliance reference.
const { marked } = require('marked');
const { html, raw, str, text, int, oneOf } = require('../lib/util');
const { field, csrfInput, badge } = require('../views/layout');
const model = require('../lib/model');
const ref = require('../reference');
const { fullName } = require('./crm').helpers;

const EXTRA_DOCS = [
  { slug: 'consent-and-disclosure-rules', title: 'Consent & disclosure rules (lead gen)', rel: '02-lead-gen/consent-and-disclosure-rules.md' },
  { slug: 'red-flags', title: 'Red flags — escalate to underwriting/compliance', rel: '03-underwriting-support/red-flags.md' },
  { slug: 'follow-up-cadences', title: 'Follow-up cadences', rel: '01-pipeline-assistant/follow-up-cadences.md' },
  { slug: 'multi-touch-sequences', title: 'Multi-touch sequences', rel: '02-lead-gen/multi-touch-sequences.md' },
  { slug: 'doc-collection-checklists', title: 'Document collection checklists', rel: '01-pipeline-assistant/doc-collection-checklists.md' }
];

module.exports = (app) => {
  const db = app.locals.db;

  app.get('/templates', (req, res) => {
    const dealId = int(req.query.deal_id), contactId = int(req.query.contact_id), cat = str(req.query.cat, 100);
    const fields = model.mergeFields(db, { dealId, contactId });
    const deal = dealId && db.prepare('SELECT id, name, contact_id FROM deals WHERE id = ?').get(dealId);
    const cid = contactId || (deal && deal.contact_id);
    const contact = cid && db.prepare('SELECT * FROM contacts WHERE id = ?').get(cid);
    const all = db.prepare('SELECT * FROM templates ORDER BY category, id').all();
    const cats = [...new Set(all.map(t => t.category))];
    const list = cat ? all.filter(t => t.category === cat) : all;
    const deals = db.prepare("SELECT id, name FROM deals WHERE stage NOT IN ('Dead') ORDER BY name").all();
    const contacts = db.prepare('SELECT id, first_name, last_name FROM contacts ORDER BY first_name').all();
    const missingProfile = !fields.LO_NAME || !fields.NMLS_ID;
    res.page('Templates', '/templates', html`<div class="page-head"><h1>Templates library</h1></div>
<div class="notice"><strong>Copy-to-clipboard library.</strong> Automated messages (category "Automation" / "Nurture sequences") are edited on the <a href="/automations#templates">Automations</a> page and always go through the <a href="/outbox">Outbox</a>. Use only approved channels and only with the right consent: texts require prior express written consent; marketing email needs your disclosure block and a CAN-SPAM footer with a physical address and opt-out. Sponsor compliance must approve scripts before use. Never put SSNs, DOBs or account numbers in email/text.</div>
${missingProfile ? html`<div class="flash warn">Your name/NMLS/company are not set, so signature merge fields stay as {{PLACEHOLDERS}}. <a href="/settings">Fill in your profile</a>.</div>` : ''}
${contact && contact.dnc ? html`<div class="flash err"><strong>${fullName(contact)} is marked DO NOT CONTACT.</strong> Do not use marketing templates for this contact.</div>` : ''}
<form class="filters" method="get"><label>Deal <select name="deal_id"><option value="">—</option>${deals.map(d => html`<option value="${d.id}" ${d.id === dealId ? 'selected' : ''}>${d.name}</option>`)}</select></label>
<label>or contact <select name="contact_id"><option value="">—</option>${contacts.map(c => html`<option value="${c.id}" ${c.id === contactId ? 'selected' : ''}>${fullName(c)}</option>`)}</select></label>
<label>Category <select name="cat"><option value="">All</option>${cats.map(c => html`<option ${c === cat ? 'selected' : ''}>${c}</option>`)}</select></label><button class="btn small">Fill merge fields</button></form>
${contact ? html`<p class="small">Filling for <strong>${fullName(contact)}</strong>: ${contact.email_consent ? badge('Email consent ✓', 'ok') : badge('No email consent', 'muted')} ${contact.sms_consent ? badge('SMS consent ✓', 'ok') : badge('No SMS consent — do not text', 'err')}</p>` : ''}
<div class="tpl-grid">${list.map(t => {
      const subj = t.subject ? model.applyMerge(t.subject, fields) : null; const body = model.applyMerge(t.body, fields);
      const left = (((subj || '') + body).match(/\{\{[^}]+\}\}/g) || []).length; const id = 't' + t.id;
      const smsBlocked = t.channel === 'sms' && contact && !contact.sms_consent;
      return html`<article class="card tpl"><header><strong>${t.name}</strong> ${badge(t.channel)} ${left ? badge(left + ' placeholder(s) to fill', 'warn') : badge('ready', 'ok')}</header>
${smsBlocked ? html`<p class="small red">No SMS consent on file for this contact — do not send this text.</p>` : ''}
${subj ? html`<label class="small">Subject</label><div class="copyrow"><input readonly id="${id}s" value="${subj}"><button class="btn tiny" data-copy="#${id}s">Copy</button></div>` : ''}
<textarea readonly id="${id}" rows="${Math.min(10, Math.max(3, Math.ceil(body.length / 70)))}">${body}</textarea>
<div class="tpl-foot"><button class="btn small" data-copy="#${id}">Copy text</button> <span class="small muted">Source: ${t.source_doc || 'custom'}</span></div></article>`;
    })}</div>
<section class="card"><h2>Add a custom template</h2><form method="post" action="/templates" class="form-grid">${csrfInput(res.locals.csrf)}
${field('name', 'Name', { required: true, max: 120 })}${field('channel', 'Channel', { type: 'select', options: ['email', 'sms', 'call', 'dm'] })}
${field('category', 'Category', { value: 'Custom', max: 60 })}${field('subject', 'Subject (email)', { max: 200 })}
${field('body', 'Body — use merge fields like {{FIRST_NAME}}, {{PROPERTY_SHORT}}, {{STAGE}}, {{DISCLOSURE_BLOCK}}', { type: 'textarea', rows: 5, cls: 'span2' })}
<div class="span2"><button class="btn small">Save template</button></div></form>
<p class="small muted">Available merge fields: ${['FIRST_NAME', 'LAST_NAME', 'BORROWER', 'PROPERTY_SHORT', 'LOAN_TYPE', 'STAGE', 'CLOSE_DATE', 'ITEM_LIST', 'CONDITION_LIST', 'LO_NAME', 'LO_FIRST', 'TITLE', 'NMLS_ID', 'COMPANY_NAME', 'COMPANY_SHORT', 'COMPANY_NMLS_ID', 'PHONE', 'PHYSICAL_ADDRESS', 'STATE_LICENSE_DISCLOSURES', 'DISCLOSURE_BLOCK', 'CAN_SPAM_FOOTER', 'BOOKING_LINK', 'TOOL_LINK', 'DATE'].map(f => '{{' + f + '}}').join(' ')}</p></section>`);
  });
  app.post('/templates', (req, res) => {
    const name = str(req.body.name, 120), body = text(req.body.body, 5000);
    if (name && body) db.prepare('INSERT INTO templates (code, category, name, channel, subject, body, source_doc) VALUES (NULL,?,?,?,?,?,NULL)').run(str(req.body.category, 60) || 'Custom', name, oneOf(req.body.channel, ['email', 'sms', 'call', 'dm'], 'email'), str(req.body.subject, 200), body);
    req.flash(name && body ? 'Template saved.' : 'Name and body are required.', name && body ? 'ok' : 'err'); res.redirect('/templates');
  });

  // ---- Compliance reference ---------------------------------------------------------------------
  const docs = () => ref.complianceDocs().map(d => ({ slug: d.slug, title: d.title, md: d.md }))
    .concat(EXTRA_DOCS.map(e => ({ slug: e.slug, title: e.title, md: ref.toolkitDoc(e.rel) })));
  app.get('/compliance', (req, res) => {
    const st = model.getSettings(db);
    const all = docs();
    res.page('Compliance', '/compliance', html`<h1>Compliance reference</h1>
<div class="flash warn"><strong>Responsibility note.</strong> ${st.lo_name || 'The licensed loan officer using this system'} remains responsible for licensing, sponsorship (sponsoring-broker approval of outside business activities and all marketing), RESPA, TCPA, CAN-SPAM, fair lending (ECOA/Reg B, Fair Housing Act, UDAAP) and state rules. Get sponsoring-broker compliance sign-off before any public or borrower-facing use of this system, its intake form, upload links, estimates or templates. This material is educational — not legal advice.</div>
<div class="grid2"><section class="card"><h2>Compliance guides</h2><ul class="list">${all.slice(0, ref.complianceDocs().length).map(d => html`<li><a href="/compliance/${d.slug}">${d.title}</a></li>`)}</ul></section>
<section class="card"><h2>Related playbooks</h2><ul class="list">${EXTRA_DOCS.map(d => html`<li><a href="/compliance/${d.slug}">${d.title}</a></li>`)}</ul>
<h3>Built-in guardrails in DealDesk OS</h3><ul class="small"><li>No SSN / full DOB fields anywhere; SSN-like numbers in free text are auto-redacted.</li><li>Consent (email/SMS + date + method) and DNC flags on every contact; DNC and SMS-consent warnings on templates.</li><li>No outbound email/SMS in v1 — copy-to-clipboard only.</li><li>Analyzer, estimates and memos labeled educational, "not a commitment to lend".</li><li>Underwriting workspace tracks items; it never approves or declines.</li><li>Activity log of logins, stage changes, uploads, downloads and payments.</li></ul></section></div>`);
  });
  app.get('/compliance/:slug', (req, res, next) => {
    const d = docs().find(x => x.slug === req.params.slug); if (!d) return next();
    res.page(d.title, '/compliance', html`<p><a href="/compliance">← Compliance reference</a></p><article class="card prose">${raw(marked.parse(d.md))}</article>`);
  });
};
