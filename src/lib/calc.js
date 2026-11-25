/* DealSheet Lab — calculation engine (pure functions, no DOM).
   Educational estimates only. Not a loan offer or commitment to lend. */
(function (root) {
  'use strict';
  var n = function (v) { v = Number(v); return isFinite(v) ? v : 0; };

  // Monthly payment. rate = annual %, years = amortization, io = interest-only
  function payment(principal, ratePct, years, io) {
    principal = n(principal); var i = n(ratePct) / 100 / 12; var m = n(years) * 12;
    if (principal <= 0) return 0;
    if (io) return principal * i;
    if (m <= 0) return 0;
    if (i === 0) return principal / m;
    return principal * i / (1 - Math.pow(1 + i, -m));
  }
  // Loan amount supported by a monthly payment (inverse of payment)
  function loanFromPayment(pmt, ratePct, years, io) {
    pmt = n(pmt); var i = n(ratePct) / 100 / 12; var m = n(years) * 12;
    if (pmt <= 0) return 0;
    if (io) return i > 0 ? pmt / i : 0;
    if (m <= 0) return 0;
    if (i === 0) return pmt * m;
    return pmt * (1 - Math.pow(1 + i, -m)) / i;
  }
  function safeDiv(a, b) { return b ? a / b : null; }

  /* DSCR rental loan analyzer.
     DSCR here = monthly gross rent / monthly PITIA (a common lender convention;
     some lenders use net operating income instead — terms vary by lender). */
  function dscr(p) {
    var price = n(p.price), rent = n(p.rent);
    var loan = p.loanAmount != null && p.loanAmount !== '' ? n(p.loanAmount) : price * n(p.ltvPct) / 100;
    var pi = payment(loan, p.ratePct, p.amortYears, p.interestOnly);
    var tax = n(p.taxesAnnual) / 12, ins = n(p.insuranceAnnual) / 12;
    var hoa = n(p.hoaMonthly), other = n(p.otherMonthly);
    var tia = tax + ins + hoa + other;
    var pitia = pi + tia;
    var ratio = safeDiv(rent, pitia);
    var target = n(p.targetDscr) || 1;
    var maxPI = rent / target - tia;
    var maxLoanDscr = maxPI > 0 ? loanFromPayment(maxPI, p.ratePct, p.amortYears, p.interestOnly) : 0;
    var maxLoanLtv = price * n(p.maxLtvPct) / 100;
    var maxLoan = Math.min(maxLoanDscr, maxLoanLtv);
    var down = price - loan;
    var points = loan * n(p.pointsPct) / 100;
    var closing = price * n(p.closingPct) / 100;
    var cashToClose = down + points + closing;
    var rentForTarget = target * pitia;
    return {
      loan: loan, ltvPct: safeDiv(loan, price) * 100, pi: pi, taxesM: tax, insuranceM: ins,
      hoaM: hoa, otherM: other, pitia: pitia, dscr: ratio, monthlyMargin: rent - pitia,
      maxPI: Math.max(0, maxPI), maxLoanDscr: maxLoanDscr, maxLoanLtv: maxLoanLtv, maxLoan: maxLoan,
      maxLoanLimitedBy: maxLoanDscr < maxLoanLtv ? 'DSCR' : 'LTV',
      maxLoanLtvPct: safeDiv(maxLoan, price) * 100,
      rentNeededForTarget: rentForTarget, down: down, points: points, closing: closing, cashToClose: cashToClose,
      meetsTarget: ratio != null && ratio >= target
    };
  }

  /* Fix & flip analyzer. Loan = min(purchase% x purchase + rehab% x rehab,
     maxLTC% x (purchase + rehab), maxARV% x ARV). Interest is estimated on the
     full loan for the full hold (conservative); many lenders charge interest only on drawn funds. */
  function flip(p) {
    var price = n(p.purchase), rehab = n(p.rehab), arv = n(p.arv), months = n(p.months);
    var cost = price + rehab;
    var byParts = price * n(p.purchaseFinPct) / 100 + rehab * n(p.rehabFinPct) / 100;
    var byLtc = cost * n(p.maxLtcPct) / 100;
    var byArv = arv * n(p.maxArvPct) / 100;
    var loan = Math.max(0, Math.min(byParts, byLtc, byArv));
    var limitedBy = loan === byArv ? 'ARV cap' : (loan === byLtc ? 'LTC cap' : 'purchase/rehab %');
    var points = loan * n(p.pointsPct) / 100;
    var lenderFees = n(p.lenderFees);
    var interest = loan * n(p.ratePct) / 100 / 12 * months;
    var buyClosing = price * n(p.buyClosingPct) / 100;
    var holding = n(p.holdingMonthly) * months;
    var selling = arv * n(p.sellingPct) / 100;
    var financing = points + lenderFees + interest;
    var totalCost = cost + buyClosing + financing + holding + selling;
    var profit = arv - totalCost;
    var cashNeeded = cost + buyClosing + points + lenderFees + interest + holding - loan;
    var roi = safeDiv(profit, cashNeeded);
    var mao = arv * n(p.rulePct || 70) / 100 - rehab;
    return {
      loan: loan, loanLimitedBy: limitedBy, loanByParts: byParts, loanByLtc: byLtc, loanByArv: byArv,
      ltcPct: safeDiv(loan, cost) * 100, ltvArvPct: safeDiv(loan, arv) * 100,
      points: points, lenderFees: lenderFees, interest: interest, buyClosing: buyClosing, holding: holding,
      selling: selling, financingCost: financing, totalCost: totalCost, profit: profit,
      profitMarginPct: safeDiv(profit, arv) * 100, cashNeeded: cashNeeded,
      roiPct: roi == null ? null : roi * 100,
      annualizedRoiPct: roi == null || months <= 0 ? null : roi * 12 / months * 100,
      mao: mao, passesRule: price <= mao, ruleGap: mao - price
    };
  }

  /* Rental cash flow, cap rate, cash-on-cash. */
  function rental(p) {
    var price = n(p.price);
    var gsi = (n(p.rent) + n(p.otherIncome)) * 12;
    var vacancy = gsi * n(p.vacancyPct) / 100;
    var egi = gsi - vacancy;
    var rentAnnual = n(p.rent) * 12;
    var opex = n(p.taxesAnnual) + n(p.insuranceAnnual) + n(p.hoaMonthly) * 12 + n(p.utilitiesMonthly) * 12 +
      rentAnnual * (n(p.maintPct) + n(p.capexPct)) / 100 + egi * n(p.mgmtPct) / 100;
    var noi = egi - opex;
    var loan = price * (100 - n(p.downPct)) / 100;
    var pi = payment(loan, p.ratePct, p.amortYears, p.interestOnly);
    var ds = pi * 12;
    var cf = noi - ds;
    var cashInvested = price * n(p.downPct) / 100 + price * n(p.closingPct) / 100 + n(p.upfrontRehab);
    return {
      gsi: gsi, vacancy: vacancy, egi: egi, opex: opex, noi: noi, capRatePct: safeDiv(noi, price) * 100,
      loan: loan, piMonthly: pi, debtService: ds, cashFlowAnnual: cf, cashFlowMonthly: cf / 12,
      cashInvested: cashInvested, cocPct: safeDiv(cf, cashInvested) * 100, dscrNoi: safeDiv(noi, ds),
      grm: safeDiv(price, rentAnnual), onePctRule: n(p.rent) >= price * 0.01,
      rentToPricePct: safeDiv(n(p.rent), price) * 100,
      breakEvenOccPct: safeDiv(opex + ds, gsi) * 100, expenseRatioPct: safeDiv(opex, egi) * 100
    };
  }

  /* BRRRR / cash-out refi. Bridge loan funds bridgeFinPct of (purchase + rehab). */
  function brrrr(p) {
    var price = n(p.purchase), rehab = n(p.rehab), months = n(p.rehabMonths), arv = n(p.arv);
    var cost = price + rehab;
    var bridge = cost * n(p.bridgeFinPct) / 100;
    var bridgePoints = bridge * n(p.bridgePointsPct) / 100;
    var bridgeInterest = bridge * n(p.bridgeRatePct) / 100 / 12 * months;
    var buyClosing = price * n(p.buyClosingPct) / 100;
    var holding = n(p.holdingMonthly) * months;
    var allIn = cost + buyClosing + bridgePoints + bridgeInterest + holding;
    var cashInvested = allIn - bridge;
    var refiLoan = arv * n(p.refiLtvPct) / 100;
    var refiCosts = refiLoan * n(p.refiCostsPct) / 100;
    var netProceeds = refiLoan - refiCosts - bridge;     // cash returned to investor
    var cashLeft = cashInvested - netProceeds;            // <0 means more than all cash back
    var refiPI = payment(refiLoan, p.refiRatePct, p.refiAmortYears, p.refiInterestOnly);
    var tia = n(p.taxesAnnual) / 12 + n(p.insuranceAnnual) / 12 + n(p.hoaMonthly);
    var pitia = refiPI + tia;
    var rent = n(p.rent);
    var otherOpex = rent * (n(p.vacancyPct) + n(p.maintPct) + n(p.capexPct) + n(p.mgmtPct)) / 100;
    var cfMonthly = rent - pitia - otherOpex;
    return {
      bridgeLoan: bridge, bridgePoints: bridgePoints, bridgeInterest: bridgeInterest, buyClosing: buyClosing,
      holding: holding, allInCost: allIn, cashInvested: cashInvested, refiLoan: refiLoan, refiCosts: refiCosts,
      netProceeds: netProceeds, cashLeftInDeal: cashLeft, cashRecoveredPct: safeDiv(netProceeds, cashInvested) * 100,
      refiPI: refiPI, pitia: pitia, dscr: safeDiv(rent, pitia), cashFlowMonthly: cfMonthly,
      cashFlowAnnual: cfMonthly * 12,
      cocPct: cashLeft > 0 ? cfMonthly * 12 / cashLeft * 100 : null, infiniteReturn: cashLeft <= 0 && cfMonthly > 0,
      equityAfterRefi: arv - refiLoan, allInToArvPct: safeDiv(allIn, arv) * 100,
      refiCoversBridge: refiLoan - refiCosts >= bridge
    };
  }

  var api = { payment: payment, loanFromPayment: loanFromPayment, dscr: dscr, flip: flip, rental: rental, brrrr: brrrr };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DSL = api;
})(this);
