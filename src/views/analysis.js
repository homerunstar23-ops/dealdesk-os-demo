'use strict';
// Result tables for each analyzer strategy (formatting only — math lives in lib/calc.js).
const { html, money, pct, ratio } = require('../lib/util');
const STRATS = { dscr: 'DSCR rental loan', flip: 'Fix & flip', brrrr: 'BRRRR / cash-out refi', rental: 'Rental cash flow' };
const yes = (b) => (b ? 'Yes' : 'No');

function rows(strategy, r) {
  switch (strategy) {
    case 'dscr': return [
      ['Loan amount', money(r.loan)], ['LTV', pct(r.ltvPct)], ['Principal & interest / mo', money(r.pi, 2)], ['Taxes + insurance + HOA + other / mo', money(r.taxesM + r.insuranceM + r.hoaM + r.otherM, 2)],
      ['PITIA / mo', money(r.pitia, 2)], ['DSCR (rent ÷ PITIA)', ratio(r.dscr), r.meetsTarget ? 'good' : 'bad'], ['Rent − PITIA / mo', money(r.monthlyMargin, 2)],
      ['Rent needed for target DSCR', money(r.rentNeededForTarget)], ['Max loan at target DSCR', money(r.maxLoanDscr)], ['Max loan at max LTV', money(r.maxLoanLtv)],
      ['Max loan (lower of the two)', money(r.maxLoan) + ' — limited by ' + r.maxLoanLimitedBy], ['Down payment', money(r.down)], ['Points', money(r.points)], ['Closing costs (est.)', money(r.closing)], ['Est. cash to close', money(r.cashToClose)]];
    case 'flip': return [
      ['Loan amount', money(r.loan) + ' — limited by ' + r.loanLimitedBy], ['By purchase/rehab %', money(r.loanByParts)], ['By max LTC', money(r.loanByLtc)], ['By max loan-to-ARV', money(r.loanByArv)],
      ['Loan-to-cost', pct(r.ltcPct)], ['Loan-to-ARV', pct(r.ltvArvPct)], ['Points', money(r.points)], ['Lender fees', money(r.lenderFees)], ['Interest (full loan, full hold)', money(r.interest)],
      ['Buy closing', money(r.buyClosing)], ['Holding', money(r.holding)], ['Selling costs', money(r.selling)], ['Total project cost', money(r.totalCost)],
      ['Projected profit', money(r.profit), r.profit > 0 ? 'good' : 'bad'], ['Profit margin (of ARV)', pct(r.profitMarginPct)], ['Cash needed', money(r.cashNeeded)], ['ROI on cash', pct(r.roiPct)], ['Annualized ROI', pct(r.annualizedRoiPct)],
      ['Max offer by rule (ARV × rule% − rehab)', money(r.mao)], ['Passes the rule?', yes(r.passesRule) + ' (' + money(r.ruleGap) + ' gap)', r.passesRule ? 'good' : 'bad']];
    case 'brrrr': return [
      ['Bridge loan', money(r.bridgeLoan)], ['Bridge points + interest', money(r.bridgePoints + r.bridgeInterest)], ['All-in cost', money(r.allInCost)], ['Cash invested', money(r.cashInvested)],
      ['Refi loan', money(r.refiLoan)], ['Refi costs', money(r.refiCosts)], ['Net cash back at refi', money(r.netProceeds)], ['Cash left in deal', money(r.cashLeftInDeal), r.cashLeftInDeal <= 0 ? 'good' : ''],
      ['Cash recovered', pct(r.cashRecoveredPct)], ['Refi covers bridge payoff?', yes(r.refiCoversBridge), r.refiCoversBridge ? 'good' : 'bad'], ['Refi PITIA / mo', money(r.pitia, 2)], ['DSCR after refi', ratio(r.dscr)],
      ['Cash flow / mo', money(r.cashFlowMonthly, 2), r.cashFlowMonthly >= 0 ? 'good' : 'bad'], ['Cash-on-cash', r.infiniteReturn ? 'All cash out — not meaningful' : pct(r.cocPct)], ['Equity after refi', money(r.equityAfterRefi)], ['All-in ÷ ARV', pct(r.allInToArvPct)]];
    case 'rental': return [
      ['Gross scheduled income / yr', money(r.gsi)], ['Vacancy', money(r.vacancy)], ['Effective gross income', money(r.egi)], ['Operating expenses', money(r.opex)], ['NOI', money(r.noi)], ['Cap rate', pct(r.capRatePct, 2)],
      ['Loan', money(r.loan)], ['P&I / mo', money(r.piMonthly, 2)], ['Cash flow / mo', money(r.cashFlowMonthly, 2), r.cashFlowMonthly >= 0 ? 'good' : 'bad'], ['Cash flow / yr', money(r.cashFlowAnnual)],
      ['Cash invested', money(r.cashInvested)], ['Cash-on-cash', pct(r.cocPct)], ['DSCR (NOI ÷ debt service)', ratio(r.dscrNoi)], ['Gross rent multiplier', r.grm == null ? '—' : r.grm.toFixed(1)],
      ['Rent-to-price (1% rule)', pct(r.rentToPricePct, 2) + (r.onePctRule ? ' — meets' : ' — below')], ['Break-even occupancy', pct(r.breakEvenOccPct)], ['Expense ratio', pct(r.expenseRatioPct)]];
  }
  return [];
}
function resultTable(strategy, r) {
  return html`<table class="results"><tbody>${rows(strategy, r).map(([k, v, cls]) => html`<tr class="${cls || ''}"><th>${k}</th><td>${v}</td></tr>`)}</tbody></table>`;
}
function memoBlock(m) {
  if (!m) return '';
  return html`<div class="memo"><h3>${m.headline}</h3>
<div class="grid2"><div><h4>Strengths</h4><ul>${(m.strengths.length ? m.strengths : ['None flagged by the template.']).map(t => html`<li>${t}</li>`)}</ul></div>
<div><h4>Risks / watch items</h4><ul>${(m.risks.length ? m.risks : ['None flagged by the template.']).map(t => html`<li>${t}</li>`)}</ul></div></div>
<h4>Stress tests</h4><ul>${m.stress.map(s => html`<li>${s[0]}: <strong>${s[1]}</strong></li>`)}</ul>
<h4>Questions lenders typically ask</h4><ul>${m.questions.map(q => html`<li>${q}</li>`)}</ul>
<p class="muted small">${m.disclaimer}</p></div>`;
}
module.exports = { STRATS, rows, resultTable, memoBlock };
