/**
 * Node test harness for the Evolve hardening layer.
 * Loads the PURE functions from Hardening.gs + OcrFill.gs into a sandbox with
 * Apps Script globals stubbed, then proves the receipt-money logic against real
 * receipt OCR-text fixtures — the financial path that must be correct to the cent.
 *
 *   node tests/run-tests.js     (exit 0 = all pass, 1 = any fail)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = {
  Logger: { log: () => {} },
  appLog_: () => ({ ok: true }),
  console,
};
vm.createContext(ctx);

// Load only files whose top level is pure function declarations (no Apps Script calls at load).
for (const f of ['Hardening.gs', 'OcrFill.gs']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInContext(src, ctx, { filename: f });
}

let pass = 0, fail = 0;
const fails = [];
function check(name, got, want) {
  const ok = String(got) === String(want);
  if (ok) pass++; else { fail++; fails.push(`  ✗ ${name}\n      got:  ${got}\n      want: ${want}`); }
}
function truthy(name, got) { check(name, !!got, true); }

// ---- 1) Built-in pure assertions shared with the Apps Script editor self-test ----
console.log('— Hardening.gs built-in checks —');
for (const r of ctx.EV_hardeningChecks_()) check('selftest: ' + r.name, r.ok, true);

// ---- 2) Real-world receipt OCR fixtures (the A-1 regression battery) ----
console.log('— Receipt OCR fixtures (EV_parseReceipt_) —');

const FIXTURES = [
  {
    name: 'Sil Industrial Minerals — abrasive media, comma thousands (the bug case)',
    text: [
      'SIL INDUSTRIAL MINERALS INC',
      'Edmonton, AB',
      'Invoice #  88213',
      'Date 2026-06-12',
      'Black Beauty 20/40   40 bags   1,190.48',
      'SUBTOTAL        1,190.48',
      'GST 5%             59.52',
      'TOTAL          $1,250.00',
    ].join('\n'),
    total: '1250.00', gst: '59.52',
  },
  {
    name: 'Fuel / diesel fill, no thousands',
    text: ['PETRO-CANADA', 'Nisku AB', '06/11/2026', 'Diesel 142.5L', 'Subtotal 178.10', 'GST 8.91', 'TOTAL  $187.01'].join('\n'),
    total: '187.01', gst: '8.91',
  },
  {
    name: 'Small shop supply, line item > nothing, total has no $',
    text: ['HOME DEPOT', 'Tape, gloves', 'SUBTOTAL 40.76', 'GST 2.04', 'TOTAL 42.80'].join('\n'),
    total: '42.80', gst: '2.04',
  },
  {
    name: 'Line item larger than a comma-mangled total would be (max-trap)',
    text: ['ABRASIVES DEPOT', 'Garnet 80 mesh  pallet  3,400.00', 'SUBTOTAL 3,400.00', 'GST 170.00', 'GRAND TOTAL $3,570.00'].join('\n'),
    total: '3570.00', gst: '170.00',
  },
  {
    name: 'Change/tendered trap — must not pick "CASH TENDERED"',
    text: ['QUICK MART', 'Item 12.00', 'TOTAL 12.60', 'CASH TENDERED 20.00', 'CHANGE 7.40'].join('\n'),
    total: '12.60', gst: '',
  },
  {
    name: 'Balance due wording, no $ sign',
    text: ['SUPPLY CO', 'Materials', 'BALANCE DUE 1450.00'].join('\n'),
    total: '1450.00',
  },
  {
    name: 'Big invoice, five-figure total with commas',
    text: ['BULK MEDIA LTD', 'Bulk garnet 22,000kg', 'SUBTOTAL 11,761.90', 'GST 588.10', 'TOTAL DUE  $12,350.00'].join('\n'),
    total: '12350.00', gst: '588.10',
  },
  {
    name: 'Whole-dollar total, no $ and no decimals (review HIGH #1 — TOTAL 1250)',
    text: ['MEDIA CO', 'Black Beauty 40 bags 1190.48', 'SUBTOTAL 1190.48', 'GST 59.52', 'TOTAL 1250'].join('\n'),
    total: '1250.00',
  },
  {
    name: 'French receipt, space-grouped thousands + comma decimal',
    text: ['FOURNITURES INDUSTRIELLES', 'Sous-total 1 190,48 $', 'TPS 59,52 $', 'TOTAL 1 250,00 $'].join('\n'),
    total: '1250.00', gst: '59.52',
  },
  {
    name: 'Quantity that must NOT be read as the total',
    text: ['SHOP', 'Bolts qty 40', 'SUBTOTAL 11.90', 'GST 0.60', 'TOTAL $12.50'].join('\n'),
    total: '12.50', gst: '0.60',
  },
];

for (const fx of FIXTURES) {
  const parsed = ctx.EV_parseReceipt_(fx.text);
  if (fx.total != null) check(`${fx.name} → total`, parsed.total, fx.total);
  if (fx.gst != null) check(`${fx.name} → gst`, parsed.gst, fx.gst);
}

// ---- 3) Prove the OLD parser WAS broken on the bug case (regression guard) ----
console.log('— Regression guard: old grammar would have undercounted —');
(function () {
  const text = 'TOTAL  $1,250.00';
  // old grammar:
  const re = /(?:grand total|amount due|balance due|total)\b[^0-9$]{0,25}\$?\s*([0-9]{1,5}[.,][0-9]{2})/ig;
  let m, old = [];
  while ((m = re.exec(text))) old.push(parseFloat(m[1].replace(',', '.')));
  const oldTotal = old.length ? Math.max.apply(null, old).toFixed(2) : '';
  check('old parser undercounts $1,250.00 (documents the bug)', oldTotal, '1.25');
  check('new parser fixes it', ctx.EV_parseReceipt_(text).total, '1250.00');
})();

// ---- 4) End-to-end financial decision: parse → block/book ----
console.log('— Financial gate (EV_receiptFinancialIssue_) —');
function decide(details) { return ctx.EV_receiptFinancialIssue_(details) === '' ? 'BOOK' : 'HOLD'; }
check('clean $1,250 receipt books', decide({ subtotal: '1190.48', gst: '59.52', total: '1250.00' }), 'BOOK');
check('missing total is held', decide({ vendor: 'X', total: '' }), 'HOLD');
check('inconsistent math is held', decide({ subtotal: '100.00', gst: '5.00', total: '250.00' }), 'HOLD');
check('typed comma total books at full value', ctx.EV_amount_('$1,250.00'), 1250);
check('refund/negative total is held (not booked positive)', decide({ total: ctx.EV_pickTotal_(['REFUND', 'TOTAL -45.00']) }), 'HOLD');
check('bare-integer total no longer undercounts', ctx.EV_parseReceipt_('SUBTOTAL 1190.48\nGST 59.52\nTOTAL 1250').total, '1250.00');

// ---- summary ----
console.log('\n' + '='.repeat(60));
if (fail) {
  console.log(`FAILED — ${pass} passed, ${fail} failed:\n` + fails.join('\n'));
  process.exit(1);
} else {
  console.log(`ALL PASS — ${pass} assertions green.`);
  process.exit(0);
}
