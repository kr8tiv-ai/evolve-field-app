/**
 * Node tests for the PURE Intelligence helpers (GST split, margins, win rate,
 * quote accuracy, price change). node tests/intelligence.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const ctx = { Logger: { log: () => {} }, appLog_: () => ({ ok: true }), console };
vm.createContext(ctx);
for (const f of ['Hardening.gs', 'Intelligence.gs']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });

let pass = 0, fail = 0; const fails = [];
function eq(name, got, want) { const ok = String(got) === String(want); if (ok) pass++; else { fail++; fails.push(`  ✗ ${name}\n      got:  ${got}\n      want: ${want}`); } }
function j(o) { return JSON.stringify(o); }

// GST separation (Alberta 5% incl.) — must reproduce the $1,250 split exactly
eq('gstSplit 1250', j(ctx.EV_gstSplit_(1250, 5)), j({ subtotal: 1190.48, gst: 59.52 }));
eq('gstSplit 187.01', j(ctx.EV_gstSplit_(187.01, 5)), j({ subtotal: 178.10, gst: 8.91 }));
eq('gstSplit 42.80', j(ctx.EV_gstSplit_(42.80, 5)), j({ subtotal: 40.76, gst: 2.04 }));
eq('gstSplit zero -> null', ctx.EV_gstSplit_(0, 5), null);

// ensureGst: estimate when only a total; respect a real typed GST
eq('ensureGst total only (estimated)', j(ctx.EV_ensureGst_({ total: '1250' })), j({ subtotal: 1190.48, gst: 59.52, estimated: true }));
eq('ensureGst typed gst (not estimated)', j(ctx.EV_ensureGst_({ total: '1250.00', gst: '59.52' })), j({ subtotal: 1190.48, gst: 59.52, estimated: false }));
eq('ensureGst comma total', j(ctx.EV_ensureGst_({ total: '$1,250.00' })), j({ subtotal: 1190.48, gst: 59.52, estimated: true }));
eq('ensureGst no total -> null', ctx.EV_ensureGst_({ vendor: 'X' }), null);

// margins
eq('margin 1000/600', j(ctx.EV_marginCalc_(1000, 600)), j({ profit: 400, margin: 40 }));
eq('margin no revenue', j(ctx.EV_marginCalc_(0, 600)), j({ profit: -600, margin: null }));

// win rate
const wr = ctx.EV_winRateCalc_([{ status: 'Won', total: 1000 }, { status: 'Lost', total: 500 }, { status: 'Sent', total: 800 }, { status: 'Accepted - deposit in', total: 2000 }]);
eq('winRate won', wr.won, 2);
eq('winRate lost', wr.lost, 1);
eq('winRate open', wr.open, 1);
eq('winRate rate %', wr.rate, 67); // 2 won / 3 decided
eq('winRate wonValue', wr.wonValue, 3000);

// quote accuracy
const qa = ctx.EV_quoteAccuracyCalc_([{ quoted: 6.9, actual: 7.59 }, { quoted: 3.75, actual: 3.75 }]);
eq('quoteAccuracy n', qa.n, 2);
eq('quoteAccuracy avg variance', qa.avgVariancePct, 5);
eq('quoteAccuracy none -> null', ctx.EV_quoteAccuracyCalc_([{ quoted: '', actual: '' }]), null);

// pct change
eq('pctChange +10%', ctx.EV_pctChange_(110, 100), 10);
eq('pctChange -25%', ctx.EV_pctChange_(75, 100), -25);
eq('pctChange zero prev -> null', ctx.EV_pctChange_(75, 0), null);

console.log('\n' + '='.repeat(60));
if (fail) { console.log(`FAILED — ${pass} passed, ${fail} failed:\n` + fails.join('\n')); process.exit(1); }
else { console.log(`ALL PASS — ${pass} assertions green.`); process.exit(0); }
