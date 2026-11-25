// Run: node tests/test_calc.js   — verifies the calculator math against hand-worked values.
const C = require('../src/lib/calc.js');
const M = require('../src/lib/memo.js');
let pass = 0, fail = 0;
function near(name, got, want, tol = 0.01) {
  const ok = got !== null && Math.abs(got - want) <= tol;
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ': got ' + (got === null ? null : (+got).toFixed(4)) + ' want ' + want);
}
function is(name, got, want) { const ok = got === want; ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + ': ' + got); }

// Payment: $225,000 at 7.5% / 30yr amortizing = $1,573.23 (standard amortization table value)
near('P&I 225k 7.5% 30y', C.payment(225000, 7.5, 30, false), 1573.23, 0.01);
near('P&I 100k 6% 30y', C.payment(100000, 6, 30, false), 599.55, 0.01);
near('IO 225k 7.5%', C.payment(225000, 7.5, 30, true), 1406.25, 0.001);
near('0% rate', C.payment(120000, 0, 10, false), 1000, 1e-9);
near('loanFromPayment inverse', C.loanFromPayment(C.payment(225000, 7.5, 30, false), 7.5, 30, false), 225000, 0.001);
near('loanFromPayment IO', C.loanFromPayment(1406.25, 7.5, 30, true), 225000, 1e-6);

// DSCR example
const d = C.dscr({ price: 300000, ltvPct: 75, ratePct: 7.5, amortYears: 30, interestOnly: false, taxesAnnual: 4800,
  insuranceAnnual: 2400, hoaMonthly: 0, otherMonthly: 0, rent: 2600, targetDscr: 1.25, maxLtvPct: 80, pointsPct: 1, closingPct: 2 });
near('DSCR loan', d.loan, 225000);
near('DSCR PITIA', d.pitia, 2173.23, 0.01);
near('DSCR ratio', d.dscr, 2600 / 2173.2326, 0.0001);
// max PI at 1.25x = 2600/1.25 - 600 = 1480 -> loan = 1480 * (1-1.00625^-360)/0.00625
const maxLoanWant = 1480 * (1 - Math.pow(1.00625, -360)) / 0.00625;
near('DSCR max loan at 1.25x', d.maxLoanDscr, maxLoanWant, 0.01);
near('DSCR max loan approx', d.maxLoanDscr, 211666.09, 0.01);
is('DSCR limited by', d.maxLoanLimitedBy, 'DSCR');
near('DSCR cash to close', d.cashToClose, 75000 + 2250 + 6000);
near('Rent needed for 1.25x', d.rentNeededForTarget, 2173.2326 * 1.25, 0.01);
is('DSCR meets target', d.meetsTarget, false);

// Flip example
const f = C.flip({ purchase: 200000, rehab: 50000, arv: 350000, months: 6, purchaseFinPct: 90, rehabFinPct: 100,
  maxLtcPct: 90, maxArvPct: 70, pointsPct: 2, lenderFees: 1500, ratePct: 11, buyClosingPct: 2, holdingMonthly: 800, sellingPct: 7 });
// byParts=230000, byLtc=225000, byArv=245000 -> 225000 (LTC)
near('Flip loan', f.loan, 225000); is('Flip limited by', f.loanLimitedBy, 'LTC cap');
near('Flip points', f.points, 4500);
near('Flip interest', f.interest, 225000 * 0.11 / 12 * 6); // 12375
near('Flip total cost', f.totalCost, 250000 + 4000 + 4500 + 1500 + 12375 + 4800 + 24500); // 301675
near('Flip profit', f.profit, 350000 - 301675); // 48325
near('Flip cash needed', f.cashNeeded, 250000 + 4000 + 4500 + 1500 + 12375 + 4800 - 225000); // 52175
near('Flip ROI %', f.roiPct, 48325 / 52175 * 100, 0.0001);
near('Flip MAO', f.mao, 350000 * 0.7 - 50000); // 195000
is('Flip passes 70%', f.passesRule, false);

// Rental example
const r = C.rental({ price: 250000, downPct: 25, closingPct: 3, upfrontRehab: 5000, ratePct: 7, amortYears: 30, interestOnly: false,
  rent: 2200, otherIncome: 0, vacancyPct: 5, taxesAnnual: 3600, insuranceAnnual: 1800, hoaMonthly: 0, utilitiesMonthly: 0,
  maintPct: 5, capexPct: 5, mgmtPct: 8 });
// GSI 26400, vac 1320, EGI 25080, opex = 3600+1800+ 26400*0.10 + 25080*0.08 = 5400+2640+2006.4 = 10046.4, NOI 15033.6
near('Rental EGI', r.egi, 25080); near('Rental opex', r.opex, 10046.4); near('Rental NOI', r.noi, 15033.6);
near('Cap rate', r.capRatePct, 15033.6 / 250000 * 100, 1e-6);
const pi = C.payment(187500, 7, 30, false); // 1247.44
near('Rental P&I', pi, 1247.44, 0.01);
near('Rental CF annual', r.cashFlowAnnual, 15033.6 - pi * 12, 1e-6);
near('Rental cash invested', r.cashInvested, 62500 + 7500 + 5000);
near('CoC %', r.cocPct, (15033.6 - pi * 12) / 75000 * 100, 1e-6);
is('1% rule', r.onePctRule, false);

// BRRRR example
const b = C.brrrr({ purchase: 150000, rehab: 50000, rehabMonths: 5, arv: 280000, bridgeFinPct: 85, bridgePointsPct: 2, bridgeRatePct: 11,
  buyClosingPct: 2, holdingMonthly: 600, refiLtvPct: 75, refiCostsPct: 3, refiRatePct: 7.25, refiAmortYears: 30, refiInterestOnly: false,
  taxesAnnual: 3000, insuranceAnnual: 2100, hoaMonthly: 0, rent: 2300, vacancyPct: 5, maintPct: 5, capexPct: 5, mgmtPct: 8 });
// bridge 170000, pts 3400, int 170000*.11/12*5=7791.667, buyClose 3000, hold 3000 -> allIn 217191.667, cashInv 47191.667
near('BRRRR all-in', b.allInCost, 217191.6667, 0.001);
near('BRRRR cash invested', b.cashInvested, 47191.6667, 0.001);
near('BRRRR refi loan', b.refiLoan, 210000);
near('BRRRR net proceeds', b.netProceeds, 210000 - 6300 - 170000); // 33700
near('BRRRR cash left', b.cashLeftInDeal, 47191.6667 - 33700, 0.001);
const rpi = C.payment(210000, 7.25, 30, false);
near('BRRRR PITIA', b.pitia, rpi + 250 + 175, 1e-6);
near('BRRRR cash flow', b.cashFlowMonthly, 2300 - (rpi + 425) - 2300 * 0.23, 1e-6);

// Memo engine smoke tests
const m1 = M.memo('flip', { purchase: 200000, rehab: 50000, arv: 350000, months: 6, purchaseFinPct: 90, rehabFinPct: 100, maxLtcPct: 90, maxArvPct: 70, pointsPct: 2, lenderFees: 1500, ratePct: 11, buyClosingPct: 2, holdingMonthly: 800, sellingPct: 7, experienceDeals: 0, reservesMonths: 2 });
is('Memo flags 70% rule miss', m1.risks.some(t => /70% rule/.test(t)), true);
is('Memo flags no experience', m1.risks.some(t => /No completed projects/.test(t)), true);
is('Memo has 3 stress tests', m1.stress.length, 3);
is('Memo has disclaimer', /not a loan offer/.test(m1.disclaimer), true);
const txt = M.toText(m1);
is('Memo text never says "you qualify"', /you qualify|approved|guarantee/i.test(txt), false);
const m2 = M.memo('dscr', { price: 300000, ltvPct: 75, ratePct: 7.5, amortYears: 30, taxesAnnual: 4800, insuranceAnnual: 2400, rent: 2600, targetDscr: 1.25, maxLtvPct: 80, experienceDeals: 4, reservesMonths: 8 });
is('DSCR memo flags below target', m2.risks.some(t => /below the 1.25x/.test(t)), true);
const m3 = M.memo('brrrr', { purchase: 150000, rehab: 50000, rehabMonths: 5, arv: 280000, bridgeFinPct: 85, bridgePointsPct: 2, bridgeRatePct: 11, buyClosingPct: 2, holdingMonthly: 600, refiLtvPct: 75, refiCostsPct: 3, refiRatePct: 7.25, refiAmortYears: 30, taxesAnnual: 3000, insuranceAnnual: 2100, rent: 2300, vacancyPct: 5, maintPct: 5, capexPct: 5, mgmtPct: 8 });
is('BRRRR memo headline', /BRRRR/.test(m3.headline), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
