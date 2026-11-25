'use strict';
const { html, raw, esc } = require('../lib/util');
const BRAND = 'DealDesk OS';

const NAV = [['/', 'Dashboard'], ['/pipeline', 'Pipeline'], ['/contacts', 'Contacts'], ['/companies', 'Companies'], ['/tasks', 'Tasks'], ['/outbox', 'Outbox'], ['/automations', 'Automations'], ['/templates', 'Templates'], ['/compliance', 'Compliance'], ['/settings', 'Settings']];

function internalFooter(s = {}) {
  const who = s.lo_name || 'The licensed loan officer using this system';
  return html`<footer class="site-footer"><p><strong>Internal support tool — not a credit decision system.</strong> Analyses, estimates and checklists in ${BRAND} are educational/support aids only. They are not loan offers, approvals, rate quotes or commitments to lend, and do not replace underwriters, attorneys, compliance staff or company systems.</p>
<p><strong>Responsibility:</strong> ${who} remains responsible for licensing, sponsorship, RESPA, TCPA, CAN-SPAM, fair lending (ECOA/FHA/UDAAP) and state rules. Get sponsoring-broker compliance sign-off before any public or borrower-facing use. Never store SSNs, full dates of birth, or bank/credit account numbers here.</p>
<p class="muted">${BRAND} · a DealSheet Lab project · v2</p></footer>`;
}

const demoBanner = (on) => on ? html`<div class="demo-banner" role="status">DEMO — fake data only, do not enter real borrower info</div>` : '';

function page({ title, user, csrf, active, body, settings = {}, flash, demoMode = process.env.DEMO_MODE === '1' }) {
  return '<!doctype html>' + html`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · ${BRAND}</title><link rel="stylesheet" href="/static/app.css"><link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><meta name="robots" content="noindex,nofollow"><meta name="csrf-token" content="${csrf || ''}"></head>
<body>${demoBanner(demoMode)}<header class="topbar"><a class="brand" href="/"><span class="logo">DD</span> ${BRAND}</a>
${user ? html`<nav>${NAV.map(([href, label]) => html`<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`)}</nav>
<div class="who"><a class="btn small ghost" href="/apply" target="_blank" rel="noopener">Public intake form ↗</a> <span>${user.name}</span>
<form method="post" action="/logout" class="inline"><input type="hidden" name="_csrf" value="${csrf}"><button class="link">Log out</button></form></div>` : ''}
</header>
<main class="wrap">${flash ? html`<div class="flash ${flash.type || ''}">${flash.msg}</div>` : ''}${raw(String(body))}</main>
${internalFooter(settings)}<script src="/static/app.js"></script></body></html>`;
}

function publicPage({ title, body, settings = {}, demoMode = process.env.DEMO_MODE === '1' }) {
  const lo = [settings.lo_name, settings.nmls_id && 'NMLS #' + settings.nmls_id, settings.company_name && (settings.company_name + (settings.company_nmls_id ? ' NMLS #' + settings.company_nmls_id : ''))].filter(Boolean).join(' · ');
  return '<!doctype html>' + html`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><link rel="stylesheet" href="/static/app.css"><link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><meta name="robots" content="noindex,nofollow"></head>
<body class="public">${demoBanner(demoMode)}<header class="topbar"><span class="brand"><span class="logo">DD</span> ${settings.public_brand || 'Investor Loan Scenario Desk'}</span></header>
<main class="wrap narrow">${raw(String(body))}</main>
<footer class="site-footer"><p>${lo || 'Licensed loan officer contact information will appear here.'}</p>
<p>Submitting information is not a loan application under any lender's process, and is not an approval, rate quote, or commitment to lend. Business-purpose investment property financing only. All loans are subject to lender underwriting, credit review, property valuation and program guidelines, which vary by lender. ${settings.state_disclosures || ''}</p>
<p>Please do <strong>not</strong> send Social Security numbers, full dates of birth, or bank/credit account numbers through this site.</p></footer>
<script src="/static/app.js"></script></body></html>`;
}

const stageClass = (s) => 'stage stage-' + String(s).toLowerCase().replace(/[^a-z]+/g, '-');
const badge = (s, cls = '') => html`<span class="badge ${cls}">${s}</span>`;
const demoTag = (r) => r && r.is_demo ? html` <span class="badge demo" title="Fake demo data">DEMO</span>` : '';

// Form field helper. opts: {type, value, options:[[v,l]], required, step, help, cls}
function field(name, label, opts = {}) {
  const v = opts.value == null ? '' : opts.value;
  let input;
  if (opts.type === 'select') input = html`<select name="${name}" id="f-${name}" ${opts.required ? raw('required') : ''}>${(opts.options || []).map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return html`<option value="${ov}" ${String(ov) === String(v) ? raw('selected') : ''}>${ol}</option>`; })}</select>`;
  else if (opts.type === 'textarea') input = html`<textarea name="${name}" id="f-${name}" rows="${opts.rows || 3}" maxlength="${opts.max || 5000}">${v}</textarea>`;
  else if (opts.type === 'checkbox') return html`<label class="check ${opts.cls || ''}"><input type="checkbox" name="${name}" value="1" ${v ? raw('checked') : ''} ${opts.required ? raw('required') : ''}> <span>${opts.labelHtml ? raw(opts.labelHtml) : label}</span></label>`;
  else input = html`<input type="${opts.type || 'text'}" name="${name}" id="f-${name}" value="${v}" ${opts.required ? raw('required') : ''} ${opts.step ? raw('step="' + esc(opts.step) + '"') : ''} ${opts.placeholder ? raw('placeholder="' + esc(opts.placeholder) + '"') : ''} ${opts.max ? raw('maxlength="' + esc(opts.max) + '"') : ''} ${opts.autocomplete ? raw('autocomplete="' + esc(opts.autocomplete) + '"') : ''}>`;
  return html`<label class="field ${opts.cls || ''}" for="f-${name}"><span>${label}${opts.required ? html`<em>*</em>` : ''}</span>${input}${opts.help ? html`<small>${opts.help}</small>` : ''}</label>`;
}
const csrfInput = (t) => html`<input type="hidden" name="_csrf" value="${t}">`;

module.exports = { page, publicPage, demoBanner, BRAND, stageClass, badge, demoTag, field, csrfInput };
