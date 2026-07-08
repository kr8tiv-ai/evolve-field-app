/**
 * ============================================================================
 *  EVOLVE INTELLIGENCE LAYER  (added 2026-06-19)
 * ----------------------------------------------------------------------------
 *  Turns the captured data into business intelligence and closes the
 *  downstream gaps the live workbook revealed: GST never separated, the money
 *  loop (deposit/invoice/paid) empty, Job P&L empty, and no cross-tab insight.
 *
 *  EVERYTHING IS FAIL-SAFE: deterministic (no paid API), fill-IF-BLANK (never
 *  overwrites a human value), idempotent, and wrapped so it can never break the
 *  sweep. Insights are upserted (fingerprint-deduped) and surfaced in the digest.
 *
 *  Orchestrated by EV_intelligenceSweep_() (called from EV_dispatchSweep) and the
 *  digest cards (called from EV_buildMorningDigestHtml_). One-shot maintenance:
 *  EV_intelligenceBackfill() from the editor.
 *
 *  Pure helpers (no SpreadsheetApp) are unit-tested in tests/intelligence.test.js.
 * ============================================================================
 */

var EV_GST_RATE = 5; // Alberta GST %, used to separate tax when a receipt only shows a total

/* ---------------------------------------------------------------------------
 *  PURE FINANCE HELPERS (unit-tested)
 * ------------------------------------------------------------------------- */

/** Split a GST-INCLUSIVE total into {subtotal, gst} at the given rate (Alberta 5%).
 *  gst = total * rate/(100+rate); subtotal = total - gst. Returns numbers (2dp) or null. */
function EV_gstSplit_(total, ratePct) {
  var t = EV_amount_(total); if (isNaN(t) || t <= 0) return null;
  var r = (ratePct == null ? EV_GST_RATE : ratePct);
  var gst = Math.round(t * r / (100 + r) * 100) / 100;
  var sub = Math.round((t - gst) * 100) / 100;
  return { subtotal: sub, gst: gst };
}

/** Profit + margin% from revenue and cost. marginPct is profit/revenue*100 (or null). */
function EV_marginCalc_(revenue, cost) {
  var rev = EV_amount_(revenue), c = EV_amount_(cost);
  if (isNaN(rev)) rev = 0; if (isNaN(c)) c = 0;
  var profit = Math.round((rev - c) * 100) / 100;
  var margin = rev > 0 ? Math.round(profit / rev * 10000) / 100 : null;
  return { profit: profit, margin: margin };
}

/** Quote pipeline metrics from an array of {status, total}. */
function EV_winRateCalc_(quotes) {
  var won = 0, lost = 0, open = 0, wonVal = 0, lostVal = 0, openVal = 0;
  (quotes || []).forEach(function (q) {
    var s = String(q.status || '').toLowerCase(), v = EV_amount_(q.total); if (isNaN(v)) v = 0;
    if (/won|accept|approv|booked|deposit|scheduled|complete|paid|invoiced/.test(s)) { won++; wonVal += v; }
    else if (/lost|declin|reject|dead|no\b|cancel/.test(s)) { lost++; lostVal += v; }
    else { open++; openVal += v; }
  });
  var decided = won + lost;
  return {
    won: won, lost: lost, open: open, total: (quotes || []).length,
    wonValue: Math.round(wonVal * 100) / 100, lostValue: Math.round(lostVal * 100) / 100,
    openValue: Math.round(openVal * 100) / 100,
    rate: decided > 0 ? Math.round(won / decided * 100) : null
  };
}

/** Average quoted-vs-actual $/sqft variance% from rows of {quoted, actual}. Positive = actual over quote. */
function EV_quoteAccuracyCalc_(rows) {
  var vs = [];
  (rows || []).forEach(function (r) {
    var q = EV_amount_(r.quoted), a = EV_amount_(r.actual);
    if (!isNaN(q) && q > 0 && !isNaN(a) && a > 0) vs.push((a - q) / q * 100);
  });
  if (!vs.length) return null;
  var sum = 0; vs.forEach(function (x) { sum += x; });
  return { n: vs.length, avgVariancePct: Math.round(sum / vs.length * 10) / 10 };
}

/** % change between two prices (new vs old), or null. */
function EV_pctChange_(now, prev) {
  var n = EV_amount_(now), p = EV_amount_(prev);
  if (isNaN(n) || isNaN(p) || p === 0) return null;
  return Math.round((n - p) / p * 1000) / 10;
}

/* ---------------------------------------------------------------------------
 *  GST SEPARATION  (item 1)
 * ------------------------------------------------------------------------- */

/** For a receipt details object, ensure subtotal+gst are present. If only a total
 *  exists, back-compute them at the Alberta rate and mark them estimated. Returns
 *  {subtotal, gst, estimated} or null. Used by EV_fileExpense_ and the backfill. */
function EV_ensureGst_(details) {
  var gst = EV_amount_(details.gst != null ? details.gst : details.tax);
  var sub = EV_amount_(details.subtotal);
  var tot = EV_amount_(details.total != null ? details.total : details.amount);
  if (!isNaN(gst) && !isNaN(sub)) return { subtotal: sub, gst: gst, estimated: false };
  if (!isNaN(gst) && !isNaN(tot)) return { subtotal: Math.round((tot - gst) * 100) / 100, gst: gst, estimated: false };
  var sp = EV_gstSplit_(tot, EV_GST_RATE);
  if (sp) return { subtotal: sp.subtotal, gst: sp.gst, estimated: true };
  return null;
}

/** Backfill Subtotal + GST on existing Receipt Log rows that have a Total but no split
 *  (Alberta 5% incl.), flagging them estimated. Returns count updated. Fill-if-blank. */
function EV_backfillReceiptGst_(book) {
  try {
    book = book || SpreadsheetApp.openById(EV_FILER_SS_ID);
    var rl = EV_sheetEndingWith_(book, 'Receipt Log'); if (!rl) return 0;
    var v = rl.getDataRange().getValues(); if (v.length < 2) return 0;
    var H = v[0];
    var cSub = EV_colExact_(H, 'Subtotal'), cGst = EV_colIndex_(H, 'GST'), cTot = EV_colExact_(H, 'Total'),
        cIssue = EV_colIndex_(H, 'Issue');
    if (cSub < 0 || cGst < 0 || cTot < 0) return 0;
    var n = 0;
    for (var r = 1; r < v.length; r++) {
      var hasSub = String(v[r][cSub]).trim() !== '', hasGst = String(v[r][cGst]).trim() !== '';
      if (hasSub && hasGst) continue;
      var sp = EV_gstSplit_(v[r][cTot], EV_GST_RATE); if (!sp) continue;
      if (!hasSub) rl.getRange(r + 1, cSub + 1).setValue(sp.subtotal);
      if (!hasGst) rl.getRange(r + 1, cGst + 1).setValue(sp.gst);
      if (cIssue >= 0) {
        var cur = String(v[r][cIssue] || '');
        if (cur.indexOf('GST') < 0) rl.getRange(r + 1, cIssue + 1).setValue((cur ? cur + '; ' : '') + 'GST estimated (5% incl.)');
      }
      n++;
    }
    if (n) { try { appLog_('Brain', 'GST backfill: separated subtotal/GST on ' + n + ' Receipt Log row(s).'); } catch (e) {} }
    return n;
  } catch (e) { try { appLog_('Brain', 'GST backfill error: ' + e); } catch (_e) {} return 0; }
}

/* ---------------------------------------------------------------------------
 *  JOB P&L  (items 3,4,7) — seed from accepted quotes, compute profitability
 * ------------------------------------------------------------------------- */

function EV_isAcceptedQuote_(status) { return /won|accept|approv|booked|deposit|scheduled|complete|paid|invoiced/i.test(String(status || '')); }

/** Seed a Job P&L row for each accepted quote that doesn't have one yet (idempotent by
 *  Quote No. / Job ID). Carries customer/address/sqft/blast/quoted subtotal+$sqft. */
function EV_seedJobPnL_(book) {
  try {
    book = book || SpreadsheetApp.openById(EV_FILER_SS_ID);
    var q = EV_sheetEndingWith_(book, 'Quotes'), jp = EV_sheetEndingWith_(book, 'Job P&L');
    if (!q || !jp) return 0;
    var qv = q.getDataRange().getValues(); var qh = EV_headerIndex_(qv, ['quote', 'client', 'total']); if (qh < 0) return 0;
    var QH = qv[qh];
    var qNo = EV_colIndex_(QH, 'Quote'), qClient = EV_colIndex_(QH, 'Client'), qAddr = EV_colIndex_(QH, 'Address'),
        qStatus = EV_colIndex_(QH, 'Status'), qSub = EV_colExact_(QH, 'Subtotal'), qSqft = EV_colIndex_(QH, 'Sq'),
        qPsf = EV_colIndex_(QH, '$/'), qDepth = EV_colIndex_(QH, 'Blast');
    var n = 0;
    for (var r = qh + 1; r < qv.length; r++) {
      var no = String(qv[r][qNo] || '').trim(); if (!/ECO-Q-|^\d/.test(no)) continue;
      if (!EV_isAcceptedQuote_(qv[r][qStatus])) continue;
      if (EV_subAlreadyFiled_(book, 'Job P&L', no)) continue;          // already seeded (Job ID carries the quote no)
      EV_appendToTab_(book, 'Job P&L', ['job id', 'material', 'revenue'], {
        'Job ID': no, 'Date': EV_today_(), 'Customer': qv[r][qClient] || '', 'Address': qv[r][qAddr] || '',
        'Sq ft': qSqft >= 0 ? qv[r][qSqft] : '', 'Blast type': qDepth >= 0 ? qv[r][qDepth] : '',
        'Quoted subtotal': qSub >= 0 ? qv[r][qSub] : '', 'Quoted $': qPsf >= 0 ? qv[r][qPsf] : '',
        'Notes': 'Seeded from quote ' + no
      });
      n++;
    }
    if (n) { try { appLog_('Brain', 'Job P&L seeded ' + n + ' job(s) from accepted quotes.'); } catch (e) {} }
    return n;
  } catch (e) { try { appLog_('Brain', 'Job P&L seed error: ' + e); } catch (_e) {} return 0; }
}

/** Compute Total cost / Profit / Margin% / Actual $/sqft / Verdict for Job P&L rows that
 *  have the inputs but not the outputs (fill-if-blank, never overwrites). Returns count. */
function EV_computeJobPnL_(book) {
  try {
    book = book || SpreadsheetApp.openById(EV_FILER_SS_ID);
    var jp = EV_sheetEndingWith_(book, 'Job P&L'); if (!jp) return 0;
    var v = jp.getDataRange().getValues(); var jh = EV_headerIndex_(v, ['job id', 'material', 'revenue']); if (jh < 0) return 0;
    var H = v[jh];
    var cWage = EV_colIndex_(H, 'Wage'), cMat = EV_colIndex_(H, 'Material'), cFuel = EV_colIndex_(H, 'Fuel'),
        cOther = EV_colIndex_(H, 'Other'), cTotCost = EV_colExact_(H, 'Total cost'), cRev = EV_colIndex_(H, 'Revenue'),
        cProfit = EV_colIndex_(H, 'Profit'), cMargin = EV_colIndex_(H, 'Margin'), cActPsf = EV_colIndex_(H, 'Actual $'),
        cSqft = EV_colIndex_(H, 'Sq'), cQuotedPsf = EV_colIndex_(H, 'Quoted $'), cVerdict = EV_colIndex_(H, 'Verdict');
    function blank(rv, c) { return c < 0 || String(rv[c] == null ? '' : rv[c]).trim() === ''; }
    var n = 0;
    var cJob = EV_colIndex_(H, 'Job');
    for (var r = jh + 1; r < v.length; r++) {
      var rv = v[r];
      if (cJob >= 0 && String(rv[cJob] || '').trim() === '') continue; // skip blank job rows
      var costParts = [cWage, cMat, cFuel, cOther].map(function (c) { var x = c >= 0 ? EV_amount_(rv[c]) : NaN; return isNaN(x) ? 0 : x; });
      var anyCost = [cWage, cMat, cFuel, cOther].some(function (c) { return c >= 0 && String(rv[c]).trim() !== ''; });
      var cost = costParts[0] + costParts[1] + costParts[2] + costParts[3];
      var rev = cRev >= 0 ? EV_amount_(rv[cRev]) : NaN;
      var changed = false;
      if (anyCost && cTotCost >= 0 && blank(rv, cTotCost)) { jp.getRange(r + 1, cTotCost + 1).setValue(Math.round(cost * 100) / 100); changed = true; }
      if (!isNaN(rev) && rev > 0 && anyCost) {
        var m = EV_marginCalc_(rev, cost);
        if (cProfit >= 0 && blank(rv, cProfit)) { jp.getRange(r + 1, cProfit + 1).setValue(m.profit); changed = true; }
        if (cMargin >= 0 && blank(rv, cMargin) && m.margin != null) { jp.getRange(r + 1, cMargin + 1).setValue(m.margin + '%'); changed = true; }
        var sqft = cSqft >= 0 ? EV_amount_(rv[cSqft]) : NaN;
        if (cActPsf >= 0 && blank(rv, cActPsf) && !isNaN(sqft) && sqft > 0) { jp.getRange(r + 1, cActPsf + 1).setValue(Math.round(rev / sqft * 100) / 100); changed = true; }
        if (cVerdict >= 0 && blank(rv, cVerdict) && m.margin != null) {
          var verdict = m.margin >= 45 ? 'Strong (' + m.margin + '%)' : (m.margin >= 25 ? 'OK (' + m.margin + '%)' : 'Thin (' + m.margin + '%)');
          jp.getRange(r + 1, cVerdict + 1).setValue(verdict); changed = true;
        }
      }
      if (changed) n++;
    }
    if (n) { try { appLog_('Brain', 'Job P&L computed profitability for ' + n + ' job(s).'); } catch (e) {} }
    return n;
  } catch (e) { try { appLog_('Brain', 'Job P&L compute error: ' + e); } catch (_e) {} return 0; }
}

/* ---------------------------------------------------------------------------
 *  CROSS-TAB INSIGHTS  (item 6) — everything talks to everything
 * ------------------------------------------------------------------------- */

function EV_qRows_(book) {
  var q = EV_sheetEndingWith_(book, 'Quotes'); if (!q) return [];
  var v = q.getDataRange().getValues(); var h = EV_headerIndex_(v, ['quote', 'client', 'total']); if (h < 0) return [];
  var H = v[h], cNo = EV_colIndex_(H, 'Quote'), cClient = EV_colIndex_(H, 'Client'), cTot = EV_colExact_(H, 'Total'),
      cStatus = EV_colIndex_(H, 'Status'), cPsf = EV_colIndex_(H, '$/'), cDate = EV_colIndex_(H, 'Date');
  var out = [];
  for (var r = h + 1; r < v.length; r++) { var no = String(v[r][cNo] || '').trim(); if (!/ECO-Q-|^\d/.test(no)) continue;
    out.push({ no: no, client: v[r][cClient], total: v[r][cTot], status: v[r][cStatus], psf: cPsf >= 0 ? v[r][cPsf] : '', date: cDate >= 0 ? v[r][cDate] : '' }); }
  return out;
}

/** Win rate insight + cash-flow + quote accuracy + top customers + price moves. Each upserts
 *  one Insights row (deduped). Returns the list it raised (for the digest + tests of plumbing). */
function EV_buildBiInsights_(book) {
  book = book || SpreadsheetApp.openById(EV_FILER_SS_ID);
  var raised = [];
  function up(type, title, detail, score) { try { upsertInsight_({ type: type, title: title, detail: detail, score: score }); raised.push({ type: type, title: title, detail: detail }); } catch (e) {} }

  // Win rate
  try {
    var wr = EV_winRateCalc_(EV_qRows_(book));
    if (wr.total > 0 && wr.rate != null) up('win_rate', 'Quote win rate: ' + wr.rate + '%',
      wr.won + ' won (' + EV_money_(wr.wonValue) + '), ' + wr.lost + ' lost, ' + wr.open + ' still open (' + EV_money_(wr.openValue) + ' in play)', 60);
  } catch (e) {}

  // Cash flow / AR from Dispatch money loop
  try {
    var cf = EV_cashFlow_(book);
    if (cf && cf.invoicedUnpaid > 0) {
      var cfDetail = EV_money_(cf.invoicedUnpaid) + ' invoiced but unpaid' + (cf.depositsDue > 0 ? ('; ' + cf.depositsDue + ' job(s) awaiting deposit') : '');
      up('cash_flow', 'Outstanding AR: ' + EV_money_(cf.invoicedUnpaid), cfDetail, 70);
    }
  } catch (e) {}

  // Quote accuracy (quoted vs actual $/sqft)
  try {
    var qa = EV_quoteAccuracy_(book);
    if (qa && qa.n >= 2) {
      var dir = qa.avgVariancePct >= 0 ? 'OVER quote' : 'under quote';
      up('quote_accuracy', 'Jobs run ' + Math.abs(qa.avgVariancePct) + '% ' + dir + ' on $/sqft',
        'Across ' + qa.n + ' completed jobs — ' + (qa.avgVariancePct > 8 ? 'pricing may be low for the work; review the rate table.' : 'pricing is tracking the rates well.'), 65);
    }
  } catch (e) {}

  // Top customer by quoted value
  try {
    var tc = EV_topCustomers_(book, 3);
    if (tc.length) up('top_customer', 'Top customer: ' + tc[0].name + ' (' + EV_money_(tc[0].value) + ')',
      tc.map(function (c) { return c.name + ' ' + EV_money_(c.value); }).join(', '), 50);
  } catch (e) {}

  // Vendor price move (from Price Log history)
  try {
    var pm = EV_priceMoves_(book);
    pm.slice(0, 3).forEach(function (m) {
      up('price_move', (m.pct > 0 ? 'Price UP ' : 'Price down ') + Math.abs(m.pct) + '% — ' + m.product,
        m.supplier + ': ' + EV_money_(m.prev) + ' -> ' + EV_money_(m.now) + ' per ' + (m.unit || 'unit'), 55 + Math.min(30, Math.abs(m.pct)));
    });
  } catch (e) {}

  return raised;
}

/** Money loop snapshot from Dispatch (deposit/invoiced/paid columns). */
function EV_cashFlow_(book) {
  try {
    book = book || SpreadsheetApp.openById(EV_FILER_SS_ID);
    var d = EV_sheetEndingWith_(book, 'Dispatch'); if (!d) return null;
    var v = d.getDataRange().getValues(); var h = EV_headerIndex_(v, ['customer', 'status', 'paid']); if (h < 0) return null;
    var H = v[h], cCust = EV_colIndex_(H, 'Customer'), cStatus = EV_colIndex_(H, 'Status'),
        cDep = EV_colIndex_(H, 'Deposit'), cInv = EV_colIndex_(H, 'Invoiced'), cPaid = EV_colIndex_(H, 'Paid'), cQuote = EV_colIndex_(H, 'Quote');
    var invoicedUnpaid = 0, depositsDue = 0, depositsOwed = 0, jobs = 0;
    for (var r = h + 1; r < v.length; r++) {
      var cust = String(v[r][cCust] || '').trim(); if (!cust || /^(this week|what'?s ahead|status)/i.test(cust)) continue;
      jobs++;
      var inv = cInv >= 0 ? EV_amount_(v[r][cInv]) : NaN, paid = cPaid >= 0 ? String(v[r][cPaid] || '').trim() : '';
      var dep = cDep >= 0 ? String(v[r][cDep] || '').trim() : '';
      if (!isNaN(inv) && inv > 0 && !paid) invoicedUnpaid += inv;
      if (!dep && /book|sched|accept|won/i.test(String(v[r][cStatus] || ''))) depositsDue++;
    }
    return { jobs: jobs, invoicedUnpaid: Math.round(invoicedUnpaid * 100) / 100, depositsDue: depositsDue, depositsOwed: 0 };
  } catch (e) { return null; }
}

/** Quoted-vs-actual $/sqft variance across Job P&L rows that have both. */
function EV_quoteAccuracy_(book) {
  try {
    book = book || SpreadsheetApp.openById(EV_FILER_SS_ID);
    var jp = EV_sheetEndingWith_(book, 'Job P&L'); if (!jp) return null;
    var v = jp.getDataRange().getValues(); var h = EV_headerIndex_(v, ['job id', 'material', 'revenue']); if (h < 0) return null;
    var H = v[h], cQ = EV_colIndex_(H, 'Quoted $'), cA = EV_colIndex_(H, 'Actual $');
    if (cQ < 0 || cA < 0) return null;
    var rows = [];
    for (var r = h + 1; r < v.length; r++) rows.push({ quoted: v[r][cQ], actual: v[r][cA] });
    return EV_quoteAccuracyCalc_(rows);
  } catch (e) { return null; }
}

/** Top customers by quote total (Customers tab). */
function EV_topCustomers_(book, k) {
  try {
    book = book || SpreadsheetApp.openById(EV_FILER_SS_ID);
    var c = EV_sheetEndingWith_(book, 'Customers'); if (!c) return [];
    var v = c.getDataRange().getValues(); var h = EV_headerIndex_(v, ['customer', 'status']); if (h < 0) return [];
    var H = v[h], cName = EV_colIndex_(H, 'Customer'), cTot = EV_colIndex_(H, 'Quote total');
    if (cName < 0 || cTot < 0) return [];
    var agg = {};
    for (var r = h + 1; r < v.length; r++) { var name = String(v[r][cName] || '').trim(); if (!name) continue; var val = EV_amount_(v[r][cTot]); if (isNaN(val)) val = 0; agg[name] = (agg[name] || 0) + val; }
    return Object.keys(agg).map(function (n) { return { name: n, value: Math.round(agg[n] * 100) / 100 }; })
      .sort(function (a, b) { return b.value - a.value; }).slice(0, k || 3);
  } catch (e) { return []; }
}

/** Vendor price moves: for each product in Price Log, compare the two most recent unit prices. */
function EV_priceMoves_(book) {
  try {
    book = book || SpreadsheetApp.openById(EV_FILER_SS_ID);
    var pl = EV_sheetEndingWith_(book, 'Price Log'); if (!pl) return [];
    var v = pl.getDataRange().getValues(); var h = EV_headerIndex_(v, ['supplier', 'product', 'unit price']); if (h < 0) return [];
    var H = v[h], cDate = EV_colIndex_(H, 'Date'), cSup = EV_colIndex_(H, 'Supplier'), cProd = EV_colIndex_(H, 'Product'),
        cUnit = EV_colIndex_(H, 'Unit type'), cPrice = EV_colIndex_(H, 'Unit price');
    if (cProd < 0 || cPrice < 0) return [];
    var byProd = {};
    for (var r = h + 1; r < v.length; r++) {
      var p = String(v[r][cProd] || '').trim(); if (!p) continue;
      var price = EV_amount_(v[r][cPrice]); if (isNaN(price)) continue;
      (byProd[p] = byProd[p] || []).push({ date: EV_toDate_(cDate >= 0 ? v[r][cDate] : ''), price: price, sup: cSup >= 0 ? v[r][cSup] : '', unit: cUnit >= 0 ? v[r][cUnit] : '' });
    }
    var moves = [];
    Object.keys(byProd).forEach(function (p) {
      var rows = byProd[p]; if (rows.length < 2) return;
      rows.sort(function (a, b) { return (a.date instanceof Date ? a.date.getTime() : 0) - (b.date instanceof Date ? b.date.getTime() : 0); });
      var now = rows[rows.length - 1], prev = rows[rows.length - 2];
      var pct = EV_pctChange_(now.price, prev.price);
      if (pct != null && Math.abs(pct) >= 5) moves.push({ product: p, supplier: String(now.sup || ''), now: now.price, prev: prev.price, pct: pct, unit: now.unit });
    });
    return moves.sort(function (a, b) { return Math.abs(b.pct) - Math.abs(a.pct); });
  } catch (e) { return []; }
}

/* ---------------------------------------------------------------------------
 *  PRICE WATCH refresh  (item 8) — fill %change / trend from Price Log
 * ------------------------------------------------------------------------- */
function EV_priceWatchRefresh_(book) {
  try {
    book = book || SpreadsheetApp.openById(EV_FILER_SS_ID);
    var pw = EV_sheetEndingWith_(book, 'Price Watch'); if (!pw) return 0;
    var v = pw.getDataRange().getValues(); var h = EV_headerIndex_(v, ['product', 'last price', 'change']); if (h < 0) return 0;
    var H = v[h], cLast = EV_colIndex_(H, 'Last price'), cPrev = EV_colIndex_(H, 'Previous'), cPct = EV_colIndex_(H, '% change'), cTrend = EV_colIndex_(H, 'trend');
    if (cLast < 0 || cPrev < 0) return 0;
    var n = 0;
    for (var r = h + 1; r < v.length; r++) {
      var pct = EV_pctChange_(v[r][cLast], v[r][cPrev]);
      if (pct == null) continue;
      if (cPct >= 0 && String(v[r][cPct]).trim() === '') { pw.getRange(r + 1, cPct + 1).setValue(pct + '%'); n++; }
      if (cTrend >= 0 && String(v[r][cTrend]).trim() === '') pw.getRange(r + 1, cTrend + 1).setValue(pct > 2 ? 'Up' : (pct < -2 ? 'Down' : 'Flat'));
    }
    return n;
  } catch (e) { return 0; }
}

/* ---------------------------------------------------------------------------
 *  DATA-QUALITY SWEEP  (item 10) — is everything getting filled?
 * ------------------------------------------------------------------------- */
function EV_dataQualitySweep_(book) {
  book = book || SpreadsheetApp.openById(EV_FILER_SS_ID);
  var gaps = [];
  try { var g = EV_backfillReceiptGst_(book); if (g) gaps.push(g + ' receipt(s) had GST auto-separated'); } catch (e) {}
  try { var pw = EV_priceWatchRefresh_(book); if (pw) gaps.push(pw + ' Price Watch row(s) refreshed'); } catch (e) {}
  // count gaps that need a human (don't auto-invent data)
  try {
    var leads = EV_leads_().filter(function (l) { return !String(l.nextAction || '').trim(); }).length;
    if (leads) gaps.push(leads + ' lead(s) missing a next action');
  } catch (e) {}
  try {
    var q = EV_qRows_(book).filter(function (x) { return EV_isAcceptedQuote_(x.status); });
    var jp = EV_sheetEndingWith_(book, 'Job P&L');
    if (q.length && jp) {
      var miss = q.filter(function (x) { return !EV_subAlreadyFiled_(book, 'Job P&L', x.no); }).length;
      if (miss) gaps.push(miss + ' accepted quote(s) without a Job P&L row');
    }
  } catch (e) {}
  if (gaps.length) { try { appLog_('Brain', 'Data-quality sweep: ' + gaps.join('; ') + '.'); } catch (e) {} }
  return gaps;
}

/* ---------------------------------------------------------------------------
 *  ORCHESTRATOR + DIGEST CARDS
 * ------------------------------------------------------------------------- */

/** Run the whole intelligence pass. Called from EV_dispatchSweep (wrapped). */
function EV_intelligenceSweep_() {
  var book = SpreadsheetApp.openById(EV_FILER_SS_ID);
  try { EV_seedJobPnL_(book); } catch (e) {}
  try { EV_computeJobPnL_(book); } catch (e) {}
  try { EV_dataQualitySweep_(book); } catch (e) {}
  try { EV_buildBiInsights_(book); } catch (e) {}
  return 'intelligence sweep done';
}

/** One-shot from the editor: backfill GST + seed/compute Job P&L + refresh + insights. */
function EV_intelligenceBackfill() {
  var book = SpreadsheetApp.openById(EV_FILER_SS_ID);
  var out = {
    gst: EV_backfillReceiptGst_(book), seeded: EV_seedJobPnL_(book), computed: EV_computeJobPnL_(book),
    priceWatch: EV_priceWatchRefresh_(book), insights: (EV_buildBiInsights_(book) || []).length
  };
  Logger.log('Intelligence backfill: ' + JSON.stringify(out));
  return out;
}

/** Morning-digest BI dashboard card (returns '' on no data/error so the email never breaks). */
function EV_biDashboardCard_() {
  try {
    var book = SpreadsheetApp.openById(EV_FILER_SS_ID);
    var bits = [];
    try { var wr = EV_winRateCalc_(EV_qRows_(book)); if (wr.total > 0 && wr.rate != null) bits.push('<li><b>Win rate:</b> ' + wr.rate + '% (' + wr.won + ' won, ' + wr.open + ' open · ' + EV_money_(wr.openValue) + ' in play)</li>'); } catch (e) {}
    try { var cf = EV_cashFlow_(book); if (cf && cf.invoicedUnpaid > 0) bits.push('<li><b>Money out the door:</b> ' + EV_money_(cf.invoicedUnpaid) + ' invoiced but unpaid</li>'); } catch (e) {}
    try { var qa = EV_quoteAccuracy_(book); if (qa && qa.n >= 2) bits.push('<li><b>Quote accuracy:</b> jobs run ' + Math.abs(qa.avgVariancePct) + '% ' + (qa.avgVariancePct >= 0 ? 'over' : 'under') + ' quote on $/sqft (' + qa.n + ' jobs)</li>'); } catch (e) {}
    try { var tc = EV_topCustomers_(book, 3); if (tc.length) bits.push('<li><b>Top customers:</b> ' + tc.map(function (c) { return EV_esc_(c.name) + ' ' + EV_money_(c.value); }).join(', ') + '</li>'); } catch (e) {}
    try { var pm = EV_priceMoves_(book); if (pm.length) bits.push('<li><b>Price alert:</b> ' + EV_esc_(pm[0].product) + ' ' + (pm[0].pct > 0 ? 'up' : 'down') + ' ' + Math.abs(pm[0].pct) + '% at ' + EV_esc_(String(pm[0].supplier)) + '</li>'); } catch (e) {}
    if (!bits.length) return '';
    return EV_card_('📊 BUSINESS INTELLIGENCE', '<ul style="margin:0;padding-left:18px;font-size:14px;">' + bits.join('') + '</ul>', '#eef6ff', '#1558d6');
  } catch (e) { return ''; }
}
