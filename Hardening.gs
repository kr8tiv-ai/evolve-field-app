/**
 * ============================================================================
 *  EVOLVE HARDENING LAYER  (added 2026-06-18)
 * ----------------------------------------------------------------------------
 *  One module that fixes the data-integrity findings from the system audit and
 *  makes the books fail-safe. Apps Script shares one flat global namespace, so
 *  every function here is callable from Code.gs / AutoServer.gs / Filing.gs /
 *  OcrFill.gs / ReceiptOps.gs. Existing files were given small surgical hooks
 *  that call into this module.
 *
 *  WHAT IT FIXES (audit IDs):
 *   A-1  Robust money parser — a $1,250.00 total is read as 1250.00, never 1.25.
 *   A-2  Financial block — a receipt with no usable / inconsistent total is HELD
 *        out of Expenses & P&L (never a wrong number on the books).
 *   B-2  Receipt -> job link + idempotent per-job cost roll-up to Job P&L.
 *   B-3  Provenance — every filed business row carries its Submission ID, so
 *   D-1  every filer is idempotent (a re-run never duplicates a row).
 *   B-4  Action Items raised server-side, deduped by a stable key.
 *   C-1  Nothing dead-ends: REVIEW captures also become a "review & file" To-Do.
 *   E-1  Header-row detection by signature (survives banner/layout changes).
 *   E-4  setup()/installers refuse to run while YOUR_* placeholders remain.
 *   F-3  insight router action (upsert with fingerprint dedupe).
 *   F-5  rotateRouterSecret() helper.
 *
 *  The PURE helpers (no SpreadsheetApp / Date.now dependency) are written so they
 *  also run under Node for unit testing — see tests/receipt.test.js.
 * ============================================================================
 */

/* ---------------------------------------------------------------------------
 *  MONEY PARSING  (pure — unit-tested)
 * ------------------------------------------------------------------------- */

/** Parse ONE money string/number to a Number, or NaN. Handles "$1,250.00",
 *  "1.250,00" (EU), "250,00", "1,250", bare "1250.00". Thousands separators are
 *  removed; the LAST separator present is treated as the decimal point. */
function EV_amount_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  if (v == null) return NaN;
  var m = String(v).match(/-?\$?\s*\d[\d.,\s]*\d|-?\$?\s*\d/);
  if (!m) return NaN;
  var raw = m[0].replace(/[\s$]/g, '');
  var neg = raw.charAt(0) === '-';
  raw = raw.replace(/^-/, '');
  var lastDot = raw.lastIndexOf('.'), lastComma = raw.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) raw = raw.replace(/\./g, '').replace(',', '.').replace(/,/g, ''); // EU 1.250,00
    else raw = raw.replace(/,/g, '');                                                          // NA 1,250.00
  } else if (lastComma >= 0) {
    // only commas present: a single trailing ",dd" is a decimal; otherwise thousands
    if (/^\d{1,3}(?:,\d{3})+$/.test(raw)) raw = raw.replace(/,/g, '');         // 1,250 / 12,345,678
    else if (/,\d{2}$/.test(raw)) raw = raw.replace(/,/g, '.');                 // 250,00
    else raw = raw.replace(/,/g, '');
  }
  var n = parseFloat(raw);
  if (isNaN(n)) return NaN;
  return neg ? -n : n;
}

/** Normalize OCR number text: NBSP -> space, and collapse space-grouped thousands
 *  that carry a decimal tail into one token ("1 250,00" -> "1250,00",
 *  "1 234 567.89" -> "1234567.89") so French/space-grouped totals parse correctly. */
function EV_normNums_(s) {
  var t = String(s == null ? '' : s).replace(/ /g, ' '), prev;
  do { prev = t; t = t.replace(/(\d)[ ](\d{3}(?:[ ]\d{3})*[.,]\d{2})(?!\d)/g, '$1$2'); } while (t !== prev);
  return t;
}

/** Every money amount in a string, as Numbers. moneyOnly=true keeps only tokens that
 *  carry a $ or a 2-digit decimal (. or ,) — so "TOTAL ITEMS: 5", dates, and percents
 *  don't count, while comma-decimal ("250,00") and thousands ("1,250.00") do. Negative
 *  signs and parentheses are preserved (refunds read as negative). */
function EV_amounts_(s, moneyOnly) {
  var str = EV_normNums_(s), out = [], m;
  // FIX (2026-07-08, re-applied 2026-07-11 after a stale-copy push reverted it): integer body allows
  // '.' grouping so a EU-format total like "1.234,56" is ONE token (was split into 1.23 + 4.56 →
  // booked $4.56). EV_amount_ resolves separators. Verified: all NA formats unchanged (0 regressions).
  var re = /(\()?\s*(\$)?\s*(-?\d[\d.,]*\d|-?\d)\s*(\))?/g;
  while ((m = re.exec(str)) !== null) {
    if (!m[3]) continue;
    var paren = m[1] && m[4], hasDollar = !!m[2], tok = m[3];
    // a 2-digit decimal tail (. or ,) that is NOT just a thousands group means real cents
    var hasCents = /[.,]\d{2}$/.test(tok) && !/^\-?\d{1,3}(?:[, ]\d{3})+$/.test(tok);
    if (moneyOnly && !hasDollar && !hasCents) continue;
    var n = EV_amount_(tok);
    if (isNaN(n)) continue;
    out.push(paren ? -Math.abs(n) : n);   // (45.00) == -45.00 (refund/credit)
  }
  return out;
}

/** Pick the receipt TOTAL from OCR text lines. Prefers a TOTAL-keyword line
 *  (grand/balance/amount due, or a plain "total" that is not subtotal/tax/change/
 *  savings/discount) — taking its amount even if written as a bare whole number with
 *  no $ ("TOTAL 1250"); else the largest $-amount; else the largest 2-decimal amount.
 *  Refund/negative totals are kept negative (the financial gate then HOLDs them).
 *  Returns a 2-decimal string, or '' if nothing money-like was found. */
function EV_pickTotal_(lines) {
  if (typeof lines === 'string') lines = String(lines).split(/\r?\n/);
  var strong = [], dollars = [], cents = [];
  for (var i = 0; i < lines.length; i++) {
    var ln = EV_normNums_(String(lines[i] || '')), low = ln.toLowerCase();
    var money = EV_amounts_(ln, true);
    money.forEach(function (n) { cents.push(n); });
    var dm, re = /\$\s*-?\d[\d,]*(?:\.\d{1,2})?/g;
    while ((dm = re.exec(ln)) !== null) { var dn = EV_amount_(dm[0]); if (!isNaN(dn)) dollars.push(dn); }
    var isTotal = /(grand\s*total|total\s*due|balance\s*due|amount\s*due|total\s*amount|\btotal\b)/.test(low);
    // exclude not just tax/subtotal lines but count/invoice/order lines so an item count or an
    // invoice number sharing a "total" line can't be mistaken for the total.
    var isNoise = /(sub[\s-]*total|subtotal|saving|discount|reward|loyal|points|earned|change|tender|cash\b|card\b|debit|credit\b|previous|balance\s*forward|\btax\b|taxe|g\.?s\.?t|h\.?s\.?t|p\.?s\.?t|tps|tvq|tvh|\bitems?\b|\bunits?\b|\bpieces?\b|\bpcs\b|number\s*of|\bqty\b|quantit|\bcount\b|invoice|\binv\b|\bref\b|\border\b|#)/.test(low);
    if (isTotal && !isNoise) {
      if (money.length) {
        money.forEach(function (n) { strong.push(n); });   // prefer real $/decimal money tokens
      } else {
        // bare-integer total ("TOTAL 1250"): accept ONLY when the line has exactly one integer and it
        // is not a 4-digit year — so an item count / invoice# / date can never win as the total.
        var ints = EV_amounts_(ln, false).filter(function (n) { return !(n >= 1900 && n <= 2099 && Math.floor(n) === n); });
        if (ints.length === 1) strong.push(ints[0]);
      }
    }
  }
  function pick(arr) { var max = arr[0]; for (var i = 1; i < arr.length; i++) if (arr[i] > max) max = arr[i]; return max; }
  if (strong.length) return pick(strong).toFixed(2);   // (keeps a lone negative total negative)
  if (dollars.length) return pick(dollars).toFixed(2);
  if (cents.length) return pick(cents).toFixed(2);
  return '';
}

/** Pick the GST/HST/PST/tax amount from OCR text lines (the amount on a tax line
 *  that isn't the subtotal/total line). Returns a 2-decimal string or ''. */
function EV_pickGst_(lines) {
  if (typeof lines === 'string') lines = String(lines).split(/\r?\n/);
  var found = [];
  for (var i = 0; i < lines.length; i++) {
    var ln = EV_normNums_(String(lines[i] || '')), low = ln.toLowerCase();
    if (!/\b(g\.?s\.?t|h\.?s\.?t|p\.?s\.?t|tps|tvq|tvh|tax|taxe)\b/.test(low)) continue;
    if (/sub[\s-]*total|subtotal|\btotal\b/.test(low)) continue;
    var amts = EV_amounts_(ln, true);
    if (amts.length) found.push(Math.max.apply(null, amts));
  }
  return found.length ? Math.max.apply(null, found).toFixed(2) : '';
}

/* ---------------------------------------------------------------------------
 *  FINANCIAL BLOCK  (pure — unit-tested)  [A-2]
 * ------------------------------------------------------------------------- */

/** Returns a non-empty reason string when a receipt's TOTAL is not trustworthy
 *  enough to enter Expenses / P&L. '' means safe to book. This is the gate that
 *  keeps a wrong or missing dollar amount off the financial ledger. */
function EV_receiptFinancialIssue_(details) {
  details = details || {};
  var tot = EV_amount_(details.total != null ? details.total : details.amount);
  if (isNaN(tot)) return 'no usable total could be read — held out of Expenses/P&L until a real total is entered';
  if (tot <= 0) return 'total reads ' + tot + ' — held out of Expenses/P&L until a real total is entered';
  if (tot > 100000) return 'total $' + tot + ' is implausibly large — held for a human to confirm';
  var sub = EV_amount_(details.subtotal);
  var gst = EV_amount_(details.gst != null ? details.gst : details.tax);
  if (!isNaN(sub) && !isNaN(gst) && Math.abs((sub + gst) - tot) > 0.02) {
    return 'subtotal ' + sub.toFixed(2) + ' + GST ' + gst.toFixed(2) + ' = ' + (sub + gst).toFixed(2) +
           ' does not equal total ' + tot.toFixed(2) + ' — held until the receipt is reconciled';
  }
  return '';
}

/* ---------------------------------------------------------------------------
 *  HEADER-ROW DETECTION BY SIGNATURE  [E-1]   (pure — unit-tested)
 * ------------------------------------------------------------------------- */

/** Given a 2-D array of cell values and a list of header-name substrings,
 *  return the 0-based index of the row that best matches (the header), or -1.
 *  Survives banner/layout changes instead of assuming a fixed offset. */
function EV_headerIndex_(values, keys, scanN) {
  if (!values || !values.length) return -1;
  var limit = Math.min(scanN || 30, values.length), best = -1, bestHits = 0;
  for (var r = 0; r < limit; r++) {
    var joined = values[r].map(function (x) { return String(x).toLowerCase(); }).join('|');
    var hits = 0;
    for (var k = 0; k < keys.length; k++) if (joined.indexOf(String(keys[k]).toLowerCase()) >= 0) hits++;
    if (hits > bestHits) { bestHits = hits; best = r; }
  }
  return bestHits >= 2 ? best : -1;
}

/** First data row index (0-based) after the detected header; -1 if no header. */
function EV_dataStart_(values, keys, scanN) {
  var h = EV_headerIndex_(values, keys, scanN);
  return h < 0 ? -1 : h + 1;
}

/** Exact (case-insensitive, trimmed) column lookup, with a safe substring fallback that
 *  never returns a "sub<name>" column. Use for 'Total' so it can't match 'Subtotal'. */
function EV_colExact_(header, name) {
  var lc = String(name).toLowerCase();
  for (var c = 0; c < header.length; c++) if (String(header[c]).trim().toLowerCase() === lc) return c;
  for (var c2 = 0; c2 < header.length; c2++) {
    var h = String(header[c2]).toLowerCase();
    if (h.indexOf(lc) >= 0 && h.indexOf('sub' + lc) < 0 && !/sub[\s-]*total/.test(h)) return c2;
  }
  return -1;
}

/* ---------------------------------------------------------------------------
 *  SUBMISSION-ID PROVENANCE + IDEMPOTENCY  [B-3 / D-1]
 * ------------------------------------------------------------------------- */

/** Append a "· SubID:<sub>" provenance token to a Notes-style value (so every
 *  filed business row is traceable to its capture and re-runs can detect it). */
function EV_withSub_(noteVal, sub) {
  var base = String(noteVal == null ? '' : noteVal);
  if (!sub) return base;
  if (base.indexOf('SubID:' + sub) >= 0) return base;
  return (base ? base + ' · ' : '') + 'SubID:' + sub;
}

/** Strip a leading "TAG: " (e.g. "BEFORE: https://…") from a photo link WITHOUT
 *  eating a bare URL's own "https:" scheme. Returns the clean URL. */
function EV_cleanLink_(s) {
  return String(s == null ? '' : s).replace(/^[A-Za-z][A-Za-z ]*:\s+(?=https?:\/\/)/, '').trim();
}

/** Has this Submission ID already been filed into a tab? Scans the whole used
 *  range for the bare id or the "SubID:<id>" token. Makes every filer idempotent. */
function EV_subAlreadyFiled_(book, suffix, sub) {
  if (!sub) return false;
  try {
    var sh = EV_sheetEndingWith_(book, suffix); if (!sh) return false;
    var lr = sh.getLastRow(), lc = sh.getLastColumn(); if (lr < 2) return false;
    var v = sh.getRange(1, 1, lr, lc).getValues();
    // Boundary-safe: the id must not be a prefix of a longer id (SUB-…-5 vs SUB-…-57).
    var esc = String(sub).replace(/[.*+?^${}()|[\]\\\-]/g, '\\$&');
    var re = new RegExp(esc + '(?![0-9A-Za-z])');
    for (var r = 1; r < v.length; r++) {
      for (var c = 0; c < v[r].length; c++) {
        if (re.test(String(v[r][c]))) return true;
      }
    }
  } catch (e) {}
  return false;
}

/** Insert OR update the Receipt Log row for a submission id (Source column 12), so a
 *  held-then-corrected receipt ends as ONE correct ledger row instead of a stale HELD
 *  row plus a suppressed correction. Matches Source exactly (no substring). */
function EV_upsertReceiptLog_(book, sub, rowValues) {
  try {
    var rl = EV_sheetEndingWith_(book, 'Receipt Log'); if (!rl) return false;
    if (sub) {
      var lr = rl.getLastRow();
      if (lr >= 2) {
        var src = rl.getRange(2, 12, lr - 1, 1).getValues(); // col 12 = Source (Inbox ID)
        for (var i = 0; i < src.length; i++) {
          if (String(src[i][0]) === String(sub)) { rl.getRange(i + 2, 1, 1, rowValues.length).setValues([rowValues]); return true; }
        }
      }
    }
    rl.appendRow(rowValues);
    return true;
  } catch (e) { try { appLog_('Receipt', 'Receipt Log upsert failed for ' + sub + ': ' + e); } catch (_e) {} return false; }
}

/* ---------------------------------------------------------------------------
 *  RECEIPT -> JOB LINK + ROLL-UP  [B-2]
 * ------------------------------------------------------------------------- */

/** Best-effort: find the Job ID for a receipt by typed job / customer match
 *  against Dispatch, else by booked-date proximity (±2 days). Returns '' if none. */
function EV_matchJobId_(book, details, dateVal) {
  try {
    var disp = EV_sheetEndingWith_(book, 'Dispatch'); if (!disp) return '';
    var v = disp.getDataRange().getValues();
    var hr = EV_headerIndex_(v, ['customer', 'job id', 'status']); if (hr < 0) return '';
    var H = v[hr];
    var ciJob = EV_colIndex_(H, 'Job ID'), ciCust = EV_colIndex_(H, 'Customer'), ciDate = EV_colIndex_(H, 'Date');
    if (ciJob < 0) return '';
    var wantJob = EV_norm_(details.job || details.jobid || '');
    var wantCust = EV_norm_(details.customer || details.client || '');
    var rd = (typeof EV_toDate_ === 'function') ? EV_toDate_(dateVal) : null;
    for (var r = hr + 1; r < v.length; r++) {
      var jid = String(v[r][ciJob] || '').trim(); if (!jid) continue;
      if (wantJob && EV_norm_(jid) === wantJob) return jid;
      if (wantCust && ciCust >= 0 && EV_norm_(v[r][ciCust]) === wantCust) return jid;
    }
    if (rd instanceof Date && ciDate >= 0) {
      for (var r2 = hr + 1; r2 < v.length; r2++) {
        var jid2 = String(v[r2][ciJob] || '').trim(); if (!jid2) continue;
        var dd = (typeof EV_toDate_ === 'function') ? EV_toDate_(v[r2][ciDate]) : null;
        if (dd instanceof Date && Math.abs(dd.getTime() - rd.getTime()) <= 2 * 86400000) return jid2;
      }
    }
  } catch (e) {}
  return '';
}

/** Idempotent: recompute each Job P&L row's actual Material / Fuel cost as the
 *  SUM of Receipt Log rows tagged with that Job ID (source of truth = receipts).
 *  SET (not increment), so it self-corrects and never double-counts. Only writes
 *  the Material and Fuel/equip actual columns; never touches formula columns.
 *  Returns the number of Job P&L rows updated. */
function EV_rollupJobCosts_(book) {
  try {
    book = book || SpreadsheetApp.openById(EV_FILER_SS_ID);
    var rl = EV_sheetEndingWith_(book, 'Receipt Log'); if (!rl) return 0;
    var jp = EV_sheetEndingWith_(book, 'Job P&L'); if (!jp) return 0;
    var rv = rl.getDataRange().getValues(); if (rv.length < 2) return 0;
    var rh = EV_headerIndex_(rv, ['vendor', 'total', 'job']); if (rh < 0) return 0;
    var RH = rv[rh];
    // EV_colExact_ for 'Total' so it can't substring-match the 'Subtotal' column (which would roll
    // up pre-GST amounts and undercount every job's actual cost by the GST).
    var ciJob = EV_colIndex_(RH, 'Job'), ciTot = EV_colExact_(RH, 'Total'), ciCat = EV_colIndex_(RH, 'Category');
    if (ciJob < 0 || ciTot < 0) return 0;
    var mat = {}, fuel = {};
    for (var r = rh + 1; r < rv.length; r++) {
      var jid = String(rv[r][ciJob] || '').trim(); if (!jid) continue;
      var amt = EV_amount_(rv[r][ciTot]); if (isNaN(amt)) continue;
      var cat = String((ciCat >= 0 ? rv[r][ciCat] : '') || '').toLowerCase();
      if (/fuel|diesel|gasolin|petro|propane|\bgas\b/.test(cat)) fuel[jid] = (fuel[jid] || 0) + amt;
      else mat[jid] = (mat[jid] || 0) + amt;
    }
    var jv = jp.getDataRange().getValues();
    var jh = EV_headerIndex_(jv, ['job id', 'material', 'revenue']); if (jh < 0) return 0;
    var JH = jv[jh];
    var cJob = EV_colIndex_(JH, 'Job ID'), cMat = EV_colIndex_(JH, 'Material'), cFuel = EV_colIndex_(JH, 'Fuel');
    if (cJob < 0 || cMat < 0) return 0;
    var n = 0;
    for (var jr = jh + 1; jr < jv.length; jr++) {
      var id = String(jv[jr][cJob] || '').trim(); if (!id) continue;
      // Fill-only-if-blank: never overwrite a human-entered actual (fail-safe). Clear the
      // cell to let the receipts-derived sum repopulate.
      var curMat = String(jv[jr][cMat] == null ? '' : jv[jr][cMat]).trim();
      if (mat[id] != null && curMat === '') { jp.getRange(jr + 1, cMat + 1).setValue(Math.round(mat[id] * 100) / 100); n++; }
      if (cFuel >= 0 && fuel[id] != null) {
        var curFuel = String(jv[jr][cFuel] == null ? '' : jv[jr][cFuel]).trim();
        if (curFuel === '') jp.getRange(jr + 1, cFuel + 1).setValue(Math.round(fuel[id] * 100) / 100);
      }
    }
    if (n) { try { appLog_('Brain', 'Job P&L actual costs rolled up from receipts for ' + n + ' job(s).'); } catch (e) {} }
    return n;
  } catch (e) { try { appLog_('Brain', 'Job roll-up error: ' + e); } catch (_e) {} return 0; }
}

/* ---------------------------------------------------------------------------
 *  ACTION ITEMS — raised server-side, keyed dedupe  [B-4]
 * ------------------------------------------------------------------------- */

/** Append an Action Item only if no OPEN row already exists for the same key.
 *  key is a stable id (ECO-Q-… / Job ID / a slug). Returns true if it wrote one. */
function EV_raiseActionItem_(book, key, alert, type, relates, dueStr, owner) {
  try {
    var sh = EV_sheetEndingWith_(book, 'Action Items'); if (!sh) return false;
    var v = sh.getDataRange().getValues();
    var hr = EV_headerIndex_(v, ['alert', 'type', 'status']); if (hr < 0) return false;
    var H = v[hr];
    var ciAlert = EV_colIndex_(H, 'Alert'), ciRel = EV_colIndex_(H, 'Relates'),
        ciStatus = EV_colIndex_(H, 'Status'), ciNotes = EV_colIndex_(H, 'Notes');
    var k = 'KEY:' + key;
    for (var r = hr + 1; r < v.length; r++) {
      var st = String((ciStatus >= 0 ? v[r][ciStatus] : '') || '').toLowerCase();
      var blob = v[r].join(' | ');
      if (blob.indexOf(k) >= 0 && !/done|closed|resolved|complete/.test(st)) return false; // already open
    }
    var ref = EV_appendToTab_(book, 'Action Items', ['alert', 'type', 'status'], {
      'Date raised': EV_today_(), 'Alert': alert, 'Type': type || 'Auto', 'Relates to': relates || '',
      'Due': dueStr || '', 'Owner': owner || 'Matt', 'Status': 'Open',
      'Notes': 'KEY:' + key
    });
    // ensure the key token is present even if 'Notes' header differs
    if (ref) { try { appLog_('Autopilot', 'Action Item raised: ' + alert + ' [KEY:' + key + ']'); } catch (e) {} }
    return !!ref;
  } catch (e) { return false; }
}

/** Raise the money-loop / follow-through Action Items server-side, each deduped by a
 *  stable key (B-4) so the same item never piles up. Mirrors the sweep's email findings
 *  into the Action Items tab so nothing depends on the AI coordinator running. */
function EV_raiseSweepActionItems_(book) {
  try {
    book = book || SpreadsheetApp.openById(EV_FILER_SS_ID);
    var n = 0;
    EV_dispatchJobs_().forEach(function (j) {
      var who = EV_norm_(j.customer) || 'job';
      if (j.deposit && (!j.date || /tbd/i.test(j.date))) n += EV_raiseActionItem_(book, 'sched-' + who, 'Deposit received for ' + j.customer + ' but not scheduled', 'Money loop', j.customer, '', 'Todd') ? 1 : 0;
      if (/complete/i.test(j.status) && !j.invoiced) n += EV_raiseActionItem_(book, 'inv-' + who, 'Job complete for ' + j.customer + ' — not invoiced', 'Money loop', j.customer, '', 'Matt') ? 1 : 0;
      if (j.invoiced && !j.paid) n += EV_raiseActionItem_(book, 'paid-' + who, 'Invoice out for ' + j.customer + ' — not marked paid', 'Money loop', j.customer, '', 'Matt') ? 1 : 0;
    });
    EV_quotes_().forEach(function (q) {
      // Skip resolved/dead quotes - don't raise "unanswered" or "expiring" reminders for won/void/duplicate/cold/paid/booked quotes (2026-07 fix).
      if (/won|void|duplicate|cold|dead|lost|paid|booked|confirmed|on hold|expired|declined|cancel/i.test(String(q.status || ''))) return;
      if (/sent/i.test(q.status) && q.dateObj && EV_daysBetween_(q.dateObj, EV_now_()) >= 7) n += EV_raiseActionItem_(book, q.no + '-unanswered', 'Quote ' + q.no + ' (' + q.client + ') unanswered 7+ days', 'Quote', q.no, '', 'Matt') ? 1 : 0;
      if (q.validDate) { var dl = EV_daysBetween_(EV_now_(), q.validDate); if (dl >= 0 && dl <= 7) n += EV_raiseActionItem_(book, q.no + '-expiring', 'Quote ' + q.no + ' (' + q.client + ') expires in ' + dl + 'd', 'Quote', q.no, q.validUntil, 'Matt') ? 1 : 0; }
    });
    EV_leads_().forEach(function (l) { if (EV_isPast_(l.nextDateObj)) n += EV_raiseActionItem_(book, 'lead-' + EV_norm_(l.lead), 'Lead ' + l.lead + ' has a past-due next action', 'Lead', l.lead, l.nextDate, 'Matt') ? 1 : 0; });
    if (n) { try { appLog_('Autopilot', 'Raised ' + n + ' Action Item(s) from the sweep (deduped by key).'); } catch (e) {} }
    return n;
  } catch (e) { return 0; }
}

/* ---------------------------------------------------------------------------
 *  INSIGHT ROUTER ACTION  [F-3]
 * ------------------------------------------------------------------------- */

/** Upsert an Insights row from the router, deduped by a fingerprint of type+title
 *  so the same observation never duplicates. b = {type,title,detail,score}. */
function upsertInsight_(b) {
  try {
    var book = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    if (typeof EV_setupBrain === 'function') EV_setupBrain();
    var sh = EV_sheetEndingWith_(book, 'Insights'); if (!sh) return { ok: false, error: 'No Insights tab' };
    var fp = String(b.type || '') + '|' + String(b.title || '');
    var v = sh.getDataRange().getValues();
    for (var r = 1; r < v.length; r++) {
      if ((String(v[r][2] || '') + '|' + String(v[r][3] || '')) === fp) {
        sh.getRange(r + 1, 5).setValue(b.detail || v[r][4]);
        if (b.score != null) sh.getRange(r + 1, 6).setValue(b.score);
        return { ok: true, updated: true, row: r + 1 };
      }
    }
    var idn = Utilities.formatDate(new Date(), 'America/Edmonton', 'yyMMddHHmmss');
    sh.appendRow(['INS-' + idn, Utilities.formatDate(new Date(), 'America/Edmonton', 'yyyy-MM-dd HH:mm'),
      b.type || 'router', b.title || '', b.detail || '', b.score != null ? b.score : 50, 'New', b.note || 'via router']);
    return { ok: true, inserted: true };
  } catch (e) { return { ok: false, error: String(e) }; }
}

/* ---------------------------------------------------------------------------
 *  PLACEHOLDER PREFLIGHT  [E-4]
 * ------------------------------------------------------------------------- */

/** Scan the deploy-time config for unfilled YOUR_* placeholders. Returns a list
 *  of human-readable problems ([] = ready). Installers call this and refuse to
 *  run while anything is unfilled, so the safety nets never silently misfire. */
function EV_preflight_() {
  var problems = [];
  function chk(label, val) {
    var s = String(val == null ? '' : val);
    if (!s || /^YOUR_|yourcompany\.com/i.test(s)) problems.push(label + ' is still a placeholder (' + (s || 'empty') + ')');
  }
  try { chk('CONFIG.SPREADSHEET_ID', CONFIG.SPREADSHEET_ID); } catch (e) { problems.push('CONFIG missing'); }
  try { chk('CONFIG.DRIVE.ROOT', CONFIG.DRIVE && CONFIG.DRIVE.ROOT); } catch (e) {}
  try { chk('EV_FILER_SS_ID', EV_FILER_SS_ID); } catch (e) {}
  try { chk('EV_BACKUP.SS_ID', EV_BACKUP.SS_ID); } catch (e) {}
  try { chk('EV_BACKUP.ROOT_FOLDER_ID', EV_BACKUP.ROOT_FOLDER_ID); } catch (e) {}
  try { chk('NOTIFY_OWNER_EMAIL', NOTIFY_OWNER_EMAIL); } catch (e) {}
  return problems;
}

/** Throw with a clear message if the project still has placeholders. */
function EV_requireConfigured_() {
  var p = EV_preflight_();
  if (p.length) throw new Error('Configuration incomplete — fill these before installing triggers:\n - ' + p.join('\n - '));
  return true;
}

/* ---------------------------------------------------------------------------
 *  EMAIL-REPLY CLASSIFICATION  (feedback loop)  — pure, unit-tested
 * ------------------------------------------------------------------------- */

/** Short slug for keys/dedupe. */
function EV_slug_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }

/** Classify a single reply line into how the system should incorporate it.
 *  Returns {type, quote}. type ∈ approval|done|fix|correction|request|feedback. */
function EV_classifyReply_(text) {
  var t = String(text || '').trim(), low = t.toLowerCase();
  var quote = (t.match(/ECO-Q-\d{6}-\d{1,3}/i) || [])[0] || '';
  if (/^(done|finished|complete[d]?)\b/.test(low)) return { type: 'done', quote: quote };
  if (quote && /\b(approve|approved|go ahead|send it|yes,? send|looks good|ship it|sign off|accept(ed)?|do it)\b/.test(low)) return { type: 'approval', quote: quote };
  if (/\b(broken|not working|doesn'?t work|isn'?t working|won'?t work|\bbug\b|\berror\b|crash|fix (this|the|it|that)|\bfailed\b|glitch|stopped working)\b/.test(low)) return { type: 'fix', quote: quote };
  if (/\b(actually|correction|should be|that'?s wrong|is wrong|change .+ to |the (total|amount|price|date|vendor|customer|address)\b.*(is|was|should|wrong|not))\b/.test(low) || /\bnot\s*\$?\d/.test(low)) return { type: 'correction', quote: quote };
  if (/\b(can (we|you)|could (we|you)|please (add|make|build|set up)|feature|would be (nice|good|great|helpful)|i want|we (need|should)|add (a|an|the)|build (a|an|the)|make it|it should|let'?s add|wish it|set up)\b/.test(low)) return { type: 'request', quote: quote };
  return { type: 'feedback', quote: quote };
}

/* ---------------------------------------------------------------------------
 *  SECRET ROTATION  [F-5]
 * ------------------------------------------------------------------------- */

/** Rotate the router shared secret and print the new one. Run from the editor
 *  after any suspected exposure, then update the scheduled router's secret. */
function rotateRouterSecret() {
  var p = PropertiesService.getScriptProperties();
  var s = Utilities.getUuid();
  p.setProperty('ROUTER_SECRET', s);
  Logger.log('NEW ROUTER_SECRET = ' + s + '  (update the scheduled router with this value)');
  try { appLog_('Security', 'ROUTER_SECRET rotated ' + new Date()); } catch (e) {}
  return s;
}

/* ---------------------------------------------------------------------------
 *  SELF-TEST (run from the editor: EV_selfTestHardening)
 * ------------------------------------------------------------------------- */
function EV_selfTestHardening() {
  var results = EV_hardeningChecks_();
  var pass = results.filter(function (r) { return r.ok; }).length;
  Logger.log(pass + '/' + results.length + ' checks passed.\n' +
    results.map(function (r) { return (r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : ' — got ' + r.got + ', want ' + r.want); }).join('\n'));
  return { pass: pass, total: results.length, results: results };
}

/** The pure assertions — shared by the editor self-test and the Node test harness. */
function EV_hardeningChecks_() {
  var R = [];
  function eq(name, got, want) { R.push({ name: name, ok: String(got) === String(want), got: got, want: want }); }
  // A-1: the bug case and friends
  eq('amount $1,250.00', EV_amount_('$1,250.00'), 1250);
  eq('amount 12,345.67', EV_amount_('12,345.67'), 12345.67);
  eq('amount 250.00', EV_amount_('250.00'), 250);
  eq('amount 1.250,00 (EU)', EV_amount_('1.250,00'), 1250);
  eq('amount 250,00', EV_amount_('250,00'), 250);
  eq('amount bare 1250', EV_amount_('1250'), 1250);
  eq('pickTotal comma total', EV_pickTotal_(['Item A 40.00', 'TOTAL  $1,250.00']), '1250.00');
  eq('pickTotal ignores subtotal', EV_pickTotal_(['SUBTOTAL 1,190.48', 'GST 59.52', 'TOTAL 1,250.00']), '1250.00');
  eq('pickTotal no-$ keyword', EV_pickTotal_(['BALANCE DUE 1250.00']), '1250.00');
  eq('pickGst', EV_pickGst_(['SUBTOTAL 1,190.48', 'GST 5% 59.52', 'TOTAL 1,250.00']), '59.52');
  // review fixes: bare-integer total, French, refunds, savings-line noise
  eq('pickTotal bare integer total', EV_pickTotal_(['SUBTOTAL 1190.48', 'GST 59.52', 'TOTAL 1250']), '1250.00');
  eq('pickTotal French comma-decimal', EV_pickTotal_(['TOTAL 250,00 $']), '250.00');
  eq('pickTotal French space-grouped', EV_pickTotal_(['Sous-total 1 190,48 $', 'TPS 59,52 $', 'TOTAL 1 250,00 $']), '1250.00');
  eq('amount space+comma EU', EV_amount_('1 250,00'), 1250);
  eq('pickTotal refund negative', EV_pickTotal_(['REFUND', 'TOTAL -45.00']), '-45.00');
  eq('gate holds refund', EV_receiptFinancialIssue_({ total: '-45.00' }) !== '', true);
  eq('pickTotal ignores savings line', EV_pickTotal_(['TOTAL SAVINGS 40.00', 'TOTAL 12.60']), '12.60');
  eq('normNums collapses grouped', EV_normNums_('1 250,00'), '1250,00');
  // round-2: bare-integer total must not pick item counts / invoice#s / years
  eq('pickTotal ignores "TOTAL ITEMS SOLD 1500"', EV_pickTotal_(['TOTAL ITEMS SOLD 1500', 'TOTAL 12.60']), '12.60');
  eq('pickTotal ignores "Total items 1450"', EV_pickTotal_(['Nozzle 7.60', 'Total items 1450', 'TOTAL 12.60']), '12.60');
  eq('pickTotal ignores "TOTAL UNITS 1450"', EV_pickTotal_(['TOTAL UNITS 1450', 'TOTAL 12.60']), '12.60');
  eq('pickTotal holds invoice# on total line', EV_pickTotal_(['GRAND TOTAL invoice 88213']), '');
  eq('pickTotal holds date+int total line', EV_pickTotal_(['TOTAL 2026-06-14 1250']), '');
  eq('pickTotal still reads clean bare total', EV_pickTotal_(['TOTAL 1250']), '1250.00');
  // round-2: exact column match so 'Total' != 'Subtotal' (which a substring match would hit first)
  eq('colExact Total != Subtotal', EV_colExact_(['Date', 'Vendor', 'Category', 'Subtotal', 'GST / Tax', 'Total'], 'Total'), 5);
  eq('colExact prefers exact over Subtotal', EV_colExact_(['Subtotal', 'Total'], 'Total'), 1);
  // reply classification (feedback loop)
  eq('reply approval', EV_classifyReply_('Approved, go ahead with ECO-Q-061426-01').type, 'approval');
  eq('reply approval quote', EV_classifyReply_('yes send ECO-Q-061426-01').quote, 'ECO-Q-061426-01');
  eq('reply fix', EV_classifyReply_('the receipt scanner is broken, fix it').type, 'fix');
  eq('reply request', EV_classifyReply_('can you add a tab for equipment maintenance').type, 'request');
  eq('reply correction', EV_classifyReply_('actually that total should be $48.20 not $42').type, 'correction');
  eq('reply done', EV_classifyReply_('done follow up with Al').type, 'done');
  eq('reply feedback default', EV_classifyReply_('great work this week').type, 'feedback');
  // A-2: financial block
  eq('block: no total', EV_receiptFinancialIssue_({ vendor: 'X' }) !== '', true);
  eq('block: zero total', EV_receiptFinancialIssue_({ total: '0.00' }) !== '', true);
  eq('block: math mismatch', EV_receiptFinancialIssue_({ subtotal: '100', gst: '5', total: '250' }) !== '', true);
  eq('pass: clean receipt', EV_receiptFinancialIssue_({ subtotal: '1190.48', gst: '59.52', total: '1250.00' }), '');
  eq('pass: total only', EV_receiptFinancialIssue_({ total: '42.80' }), '');
  // B-3: provenance token + idempotency reasoning
  eq('withSub appends', EV_withSub_('Field app', 'SUB-1'), 'Field app · SubID:SUB-1');
  eq('withSub no dup', EV_withSub_('x · SubID:SUB-1', 'SUB-1'), 'x · SubID:SUB-1');
  // E-1: header detection
  eq('headerIndex finds row', EV_headerIndex_([['banner', ''], ['', ''], ['Date', 'Vendor', 'Total']], ['date', 'vendor', 'total']), 2);
  eq('headerIndex none', EV_headerIndex_([['a', 'b'], ['c', 'd']], ['date', 'vendor', 'total']), -1);
  // B-6: link de-tagging never eats a bare URL scheme
  eq('cleanLink strips tag', EV_cleanLink_('BEFORE: https://drive.google.com/x'), 'https://drive.google.com/x');
  eq('cleanLink keeps bare url', EV_cleanLink_('https://drive.google.com/x'), 'https://drive.google.com/x');
  return R;
}
