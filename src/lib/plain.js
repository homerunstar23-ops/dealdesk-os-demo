'use strict';
// v3 plain-English vocabulary for the STAFF screens. The database keeps the formal stage / status values
// (so automations, templates and reports keep working); the UI shows these friendlier words and puts the
// formal term in a tooltip. Borrower-facing wording lives in lib/stages.js and is unchanged.
const { html, raw } = require('./util');

const STAGE_PLAIN = {
  'Lead': 'New lead',
  'Application': 'Application',
  'Processing': 'Collecting documents',
  'Underwriting': 'Lender reviewing',
  'Conditionally Approved': 'Clearing final items',
  'Clear to Close': 'Ready to close',
  'Closed': 'Closed',
  'Dead': 'Inactive'
};
const STAGE_HELP = {
  'Lead': 'Someone is interested. Learn the deal and see if it may fit.',
  'Application': 'The investor is applying. Send the document list and their status page.',
  'Processing': 'Collect every document and order third-party items through the lender\'s process.',
  'Underwriting': 'The lender\'s underwriter is reviewing the file. You answer questions.',
  'Conditionally Approved': 'The lender sent a list of items (conditions) to finish before closing. Lender term: "Conditionally Approved".',
  'Clear to Close': 'The lender said the file can close. Coordinate with title.',
  'Closed': 'Done. The loan closed and funded.',
  'Dead': 'The file stopped. It can be restarted later.'
};
const COND_PLAIN = { open: 'Not asked yet', requested: 'Waiting on borrower', received: 'Got it — needs review', reviewed: 'Reviewed', cleared: 'Done', waived: 'Not needed' };
const COND_HELP = {
  open: 'On the list, but you have not asked the borrower for it yet.',
  requested: 'You asked the borrower. They still need to send it.',
  received: 'The borrower sent it. Someone needs to look at it.',
  reviewed: 'Looked at. Waiting for the lender to sign off.',
  cleared: 'Finished. Nothing more needed.',
  waived: 'Not needed for this deal.'
};
const LOAN_PLAIN = { dscr: 'Rental (DSCR)', flip: 'Fix & flip', bridge: 'Bridge', ground_up: 'Ground-up build', cashout: 'Cash-out refi' };
const LOAN_HELP = {
  dscr: 'A long-term loan on a rental. Sized mostly on the property\'s rent, not personal income.',
  flip: 'A short-term loan to buy, fix and sell a property.',
  bridge: 'A short-term loan to buy or hold a property until a longer-term plan is ready.',
  ground_up: 'A loan to build a new property from the ground up.',
  cashout: 'Refinance a property you own and take some equity out as cash.'
};
// Common glossary for tooltips.
const HELP = {
  ltv: 'Loan-to-value: the loan amount divided by the property value. Lower means more equity.',
  ltc: 'Loan-to-cost: the loan divided by the total cost (price + rehab).',
  arv: 'After-repair value: what the property may be worth after the work is done.',
  dscr: 'Debt-service coverage ratio: rent divided by the monthly payment (with taxes, insurance, HOA). 1.00x means the rent just covers it.',
  liquidity: 'Cash and reserves the investor says they have. Self-reported until the lender verifies it.',
  portal: 'A private web page where the investor sees their status, what you need from them, and what happens next.',
  outbox: 'Every automated email or text waits here. Nothing sends unless sending is turned on and consent checks pass.',
  nextStepDate: 'Your best estimate of when the next step happens. The investor sees it with a note that it is an estimate, not a promise.',
  consent: 'Only check this if the person gave you permission. It controls whether automated messages can go to them.'
};

function stageChip(stage, { long = false } = {}) {
  const plain = STAGE_PLAIN[stage] || stage;
  const cls = 'stage stage-' + String(stage).toLowerCase().replace(/[^a-z]+/g, '-');
  return html`<span class="${cls}" title="${plain === stage ? STAGE_HELP[stage] || stage : 'Lender term: ' + stage + '. ' + (STAGE_HELP[stage] || '')}">${plain}${long && plain !== stage ? html` <small>(${stage})</small>` : ''}</span>`;
}
const condChip = (st) => html`<span class="chip cond-${st}" title="${COND_HELP[st] || ''}">${COND_PLAIN[st] || st}</span>`;
// Small "?" tooltip. CSS-only (works with the strict CSP); focusable for keyboard and tap.
const tip = (text) => html`<span class="tip" tabindex="0" role="img" aria-label="${'Help: ' + text}" data-tip="${text}">?</span>`;

// Borrower-facing text guard: blocks approval / guarantee / rate language in LO-entered borrower text.
const BANNED = /\b(approved|approval|pre-?approved|guarantee[ds]?|guaranteed|commitment|committed to lend|locked|rate lock|interest rate|apr)\b|\d+(\.\d+)?\s?%/i;
function lintBorrowerText(t) { const m = String(t || '').match(BANNED); return m ? m[0] : null; }

module.exports = { STAGE_PLAIN, STAGE_HELP, COND_PLAIN, COND_HELP, LOAN_PLAIN, LOAN_HELP, HELP, stageChip, condChip, tip, lintBorrowerText, raw };
