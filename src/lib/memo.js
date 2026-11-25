/* DealSheet Lab — rule-based "deal memo" engine (v1, runs in the browser, no paid AI APIs).
   Produces a structured, template-driven narrative from the inputs. Thresholds are common
   rules of thumb used for EDUCATION only; every lender sets its own guidelines. */
(function (root) {
  'use strict';
  var C = (typeof module !== 'undefined' && module.exports) ? require('./calc.js') : root.DSL;
  function $(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
  function pct(v, d) { return v == null ? 'n/a' : v.toFixed(d == null ? 1 : d) + '%'; }
  function x(v) { return v == null ? 'n/a' : v.toFixed(2) + 'x'; }
  function clone(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

  var BASE_QUESTIONS = [
    'What is your real estate experience (number of completed projects of this type in recent years)?',
    'How much cash and post-closing liquidity (reserves) can you document, and where is it held?',
    'Who holds title — you personally or an entity (LLC)? Are entity documents available?',
    'What is the exit strategy and timeline, and what is the backup plan if it slips?',
    'Can you provide the purchase contract, insurance quote and a recent appraisal or valuation?'
  ];

  function memo(strategy, p, opts) {
    opts = opts || {};
    var s = [], r = [], q = BASE_QUESTIONS.slice(), stress = [], headline, metrics = [];
    var exp = Number(p.experienceDeals || 0), reserves = Number(p.reservesMonths || 0);

    if (strategy === 'dscr') {
      var d = C.dscr(p), t = Number(p.targetDscr) || 1;
      headline = 'Rental (DSCR-style) loan: ' + $(d.loan) + ' on a ' + $(Number(p.price)) + ' purchase (' + pct(d.ltvPct) + ' LTV), DSCR ' + x(d.dscr) + '.';
      metrics = [['Loan amount', $(d.loan)], ['LTV', pct(d.ltvPct)], ['Monthly PITIA', $(d.pitia)], ['DSCR (rent / PITIA)', x(d.dscr)], ['Max loan at target ' + t.toFixed(2) + 'x', $(d.maxLoan) + ' (limited by ' + d.maxLoanLimitedBy + ')'], ['Est. cash to close', $(d.cashToClose)]];
      if (d.dscr >= t + 0.15) s.push('Rent covers PITIA ' + x(d.dscr) + ' — a cushion above the ' + t.toFixed(2) + 'x target used in this example.');
      else if (d.dscr >= t) s.push('Rent meets the ' + t.toFixed(2) + 'x example target (' + x(d.dscr) + '), with a thin cushion.');
      if (d.dscr < t) r.push('DSCR of ' + x(d.dscr) + ' is below the ' + t.toFixed(2) + 'x example target. Rent would need to be about ' + $(d.rentNeededForTarget) + '/mo, or the loan about ' + $(d.maxLoanDscr) + '.');
      if (d.dscr < 1) r.push('Rent does not cover the full monthly payment (DSCR under 1.00x); many lenders treat this as a separate, more restrictive category or decline it.');
      if (d.ltvPct > 75) r.push('LTV of ' + pct(d.ltvPct) + ' is on the higher side for investor rental loans; expect pricing and reserve requirements to be stricter.');
      else s.push('LTV of ' + pct(d.ltvPct) + ' leaves ' + pct(100 - d.ltvPct) + ' equity in the deal at purchase.');
      if (p.interestOnly) r.push('Interest-only payments improve DSCR now but build no equity; ask how the payment changes when the interest-only period ends.');
      q.push('Is there a signed lease, or will the lender use a market rent estimate from the appraisal (often a rent schedule form)?');
      q.push('Are the tax and insurance figures from actual bills/quotes? Is flood insurance required for this address?');
      var st1 = clone(p); st1.rent = Number(p.rent) * 0.9; var st2 = clone(p); st2.ratePct = Number(p.ratePct) + 1;
      var st3 = clone(p); st3.insuranceAnnual = Number(p.insuranceAnnual) * 1.25;
      stress = [['Rent 10% lower', 'DSCR ' + x(C.dscr(st1).dscr)], ['Rate +1 point', 'DSCR ' + x(C.dscr(st2).dscr)], ['Insurance +25%', 'DSCR ' + x(C.dscr(st3).dscr)]];
    }

    if (strategy === 'flip') {
      var f = C.flip(p);
      headline = 'Fix & flip: ' + $(Number(p.purchase)) + ' purchase + ' + $(Number(p.rehab)) + ' rehab, ' + $(Number(p.arv)) + ' ARV, est. profit ' + $(f.profit) + ' (' + pct(f.profitMarginPct) + ' of ARV).';
      metrics = [['Est. loan', $(f.loan) + ' (' + f.loanLimitedBy + ')'], ['Loan-to-cost', pct(f.ltcPct)], ['Loan-to-ARV', pct(f.ltvArvPct)], ['Total project cost', $(f.totalCost)], ['Est. profit', $(f.profit)], ['Cash needed', $(f.cashNeeded)], ['ROI on cash', pct(f.roiPct)], ['70% rule max offer', $(f.mao)]];
      if (f.passesRule) s.push('Purchase price is at or under the 70% rule max offer of ' + $(f.mao) + ' (' + $(f.ruleGap) + ' of room).');
      else r.push('Purchase is ' + $(-f.ruleGap) + ' above the 70% rule max offer of ' + $(f.mao) + '. The rule is a screening shortcut, not a lender requirement, but margins are thinner.');
      if (f.profitMarginPct >= 15) s.push('Projected profit is ' + pct(f.profitMarginPct) + ' of ARV after financing, holding and selling costs.');
      else if (f.profit > 0) r.push('Projected profit is only ' + pct(f.profitMarginPct) + ' of ARV; a modest ARV miss or rehab overrun could erase it.');
      else r.push('Projected profit is negative with these inputs.');
      if (Number(p.rehab) > Number(p.purchase) * 0.5) { r.push('Rehab is more than half the purchase price — a heavy rehab. Expect close review of the scope of work, budget and contractor.'); q.push('Can you provide a line-item scope of work and budget, and who is the contractor (license/insurance)?'); }
      if (Number(p.months) > 9) r.push('A ' + p.months + '-month hold is long for a flip; ask about loan term, extension fees and carrying costs if it runs longer.');
      if (f.loanLimitedBy === 'ARV cap') r.push('The loan is capped by the ARV limit, so the appraisal’s ARV directly drives cash needed.');
      q.push('How are rehab funds released (draw schedule, inspections, reimbursement vs. upfront)?');
      q.push('What comparable sales support the ARV?');
      var a = clone(p); a.arv = Number(p.arv) * 0.9; var b = clone(p); b.rehab = Number(p.rehab) * 1.15; var c = clone(p); c.months = Number(p.months) + 3;
      stress = [['ARV 10% lower', 'Profit ' + $(C.flip(a).profit)], ['Rehab 15% over budget', 'Profit ' + $(C.flip(b).profit)], ['3 extra months', 'Profit ' + $(C.flip(c).profit)]];
    }

    if (strategy === 'brrrr') {
      var b2 = C.brrrr(p);
      headline = 'BRRRR: all-in ' + $(b2.allInCost) + ' vs. ' + $(Number(p.arv)) + ' ARV; refi at ' + pct(Number(p.refiLtvPct), 0) + ' LTV returns ' + $(b2.netProceeds) + ', leaving ' + $(b2.cashLeftInDeal) + ' in the deal.';
      metrics = [['All-in cost', $(b2.allInCost) + ' (' + pct(b2.allInToArvPct) + ' of ARV)'], ['Cash invested', $(b2.cashInvested)], ['Refi loan', $(b2.refiLoan)], ['Cash back at refi', $(b2.netProceeds)], ['Cash left in deal', $(b2.cashLeftInDeal)], ['DSCR after refi', x(b2.dscr)], ['Monthly cash flow', $(b2.cashFlowMonthly)], ['Equity after refi', $(b2.equityAfterRefi)]];
      if (b2.cashLeftInDeal <= 0) s.push('With these inputs the refinance returns all invested cash.');
      else if (b2.cashRecoveredPct >= 75) s.push('Refinance returns about ' + pct(b2.cashRecoveredPct, 0) + ' of invested cash.');
      else r.push('Only about ' + pct(b2.cashRecoveredPct, 0) + ' of invested cash comes back at refinance; more capital stays tied up.');
      if (!b2.refiCoversBridge) r.push('The refi loan (after costs) does not fully pay off the bridge loan; extra cash is needed at refinance.');
      if (b2.dscr != null && b2.dscr < 1.0) r.push('After refi, rent does not cover PITIA (DSCR ' + x(b2.dscr) + ').');
      else if (b2.dscr != null && b2.dscr >= 1.2) s.push('After refi, DSCR is ' + x(b2.dscr) + '.');
      if (b2.cashFlowMonthly < 0) r.push('Estimated monthly cash flow is negative after reserves for vacancy, maintenance, capex and management.');
      if (b2.allInToArvPct > 80) r.push('All-in cost is ' + pct(b2.allInToArvPct) + ' of ARV; at typical refi LTVs this leaves cash in the deal.');
      q.push('What seasoning period does the refinance lender require, and does it use the appraised value or the cost basis?');
      q.push('Will the refinance be rate-and-term or cash-out, and is there a prepayment penalty on the new loan?');
      var a2 = clone(p); a2.arv = Number(p.arv) * 0.9; var b3 = clone(p); b3.refiRatePct = Number(p.refiRatePct) + 1; var c2 = clone(p); c2.rent = Number(p.rent) * 0.9;
      stress = [['ARV 10% lower', 'Cash left ' + $(C.brrrr(a2).cashLeftInDeal)], ['Refi rate +1 point', 'Cash flow ' + $(C.brrrr(b3).cashFlowMonthly) + '/mo'], ['Rent 10% lower', 'DSCR ' + x(C.brrrr(c2).dscr)]];
    }

    if (exp === 0) { r.push('No completed projects listed. Many investor lenders adjust leverage or terms for first-time investors; an experienced partner, contractor or property manager can help.'); q.push('Who is on your team (contractor, property manager, agent, attorney/title)?'); }
    else if (exp >= 3) s.push(exp + ' completed projects listed — experience is commonly a factor in investor loan terms.');
    if (reserves && reserves < 3) r.push('Only ' + reserves + ' months of reserves listed; lenders commonly ask for documented post-closing liquidity.');
    else if (reserves >= 6) s.push(reserves + ' months of reserves listed.');

    var next = ['Replace example inputs with verified numbers (contract, insurance quote, tax bill, rent comps or lease, contractor bid).',
      'Build a deal package: see the Lender-Ready Deal Package Checklist.',
      'Ask two or more lenders for their actual terms in writing; compare total cost, not just rate.',
      'Review the deal with a licensed loan officer, CPA and/or attorney before committing.'];

    return { strategy: strategy, headline: headline, metrics: metrics, strengths: s, risks: r, questions: q, stress: stress, nextSteps: next,
      disclaimer: 'Educational estimate generated from your inputs by a rule-based template. Not financial, legal or tax advice, not a loan offer, pre-approval or commitment to lend. Terms, guidelines and requirements vary by lender. Consult a licensed professional.' };
  }

  function toText(m) {
    var L = ['DEAL MEMO — EDUCATIONAL ESTIMATE', '', m.headline, '', 'KEY NUMBERS'];
    m.metrics.forEach(function (r) { L.push('- ' + r[0] + ': ' + r[1]); });
    L.push('', 'STRENGTHS'); (m.strengths.length ? m.strengths : ['None flagged by the template.']).forEach(function (t) { L.push('- ' + t); });
    L.push('', 'RISKS / WATCH ITEMS'); (m.risks.length ? m.risks : ['None flagged by the template.']).forEach(function (t) { L.push('- ' + t); });
    L.push('', 'STRESS TESTS'); m.stress.forEach(function (r) { L.push('- ' + r[0] + ': ' + r[1]); });
    L.push('', 'QUESTIONS A LENDER TYPICALLY ASKS'); m.questions.forEach(function (t) { L.push('- ' + t); });
    L.push('', 'NEXT STEPS'); m.nextSteps.forEach(function (t) { L.push('- ' + t); });
    L.push('', m.disclaimer);
    return L.join('\n');
  }

  var api = { memo: memo, toText: toText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DSLMemo = api;
})(this);
