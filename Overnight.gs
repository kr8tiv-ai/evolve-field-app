/**
 * ============================================================================
 *  OVERNIGHT OPS MODULE  (added 2026-07-11)
 * ----------------------------------------------------------------------------
 *  Self-contained additions from the overnight system review — kept in ONE new
 *  file so nothing in the actively-edited digest/automation files is touched.
 *
 *  Exposed through a single secret-gated router action (Code.js doPost):
 *    POST { secret, action:'ops', fn:'<case>', ...args }
 *
 *  CASES
 *   ocrSelfTest      — end-to-end receipt-OCR health check: OCRs a real image
 *                      from Drive (latest in 02 Receipts, or {fileId}) and runs
 *                      the parser. Proves the scan path works before a big
 *                      receipt-loading session.
 *   receiptContext   — ONE compact fetch for the AI receipt pipeline: pending
 *                      receipt rows + Receipt Log tail + open jobs + vendor
 *                      canon. Built for a cheap Haiku extraction pass.
 *   fileReceipt      — reasoned writeback: merge corrected/decided fields into
 *                      the App Inbox row and re-run the hardened server filer
 *                      (dedupe + financial gate + Receipt Log + job match all
 *                      apply). One POST per receipt.
 *   quoteLearning    — build/refresh the "📈 Quote Learning" tab from the
 *                      Quotes tab: per-quote inputs + outcome, win-rate stats,
 *                      $/sqft vs the ~$9 driveway baseline.
 *   systemHealth     — build/refresh the "🩺 System Health" tab: live metrics
 *                      + doing-well / needs-attention / recommendations.
 *   appendSystemLog  — append a dated entry to the "🛠 System Log" tab
 *                      (created if missing). Never restructures anything.
 *
 *  Everything here is ADDITIVE: new tabs only, appends only, derived reports
 *  rebuilt only in their own tabs. No automation/digest tab is modified.
 * ============================================================================
 */

function EV_opsAction_(body) {
  var fn = String((body && body.fn) || '');
  switch (fn) {
    case 'ocrSelfTest':     return EV_ovOcrSelfTest_(body);
    case 'receiptContext':  return EV_ovReceiptContext_(body);
    case 'fileReceipt':     return EV_ovFileReceipt_(body);
    case 'quoteLearning':   return EV_ovQuoteLearning_();
    case 'systemHealth':    return EV_ovSystemHealth_();
    case 'appendSystemLog': return EV_ovAppendSystemLog_(body);
    default: return { ok: false, error: 'ops: unknown fn ' + fn };
  }
}

/* ----------------------------------------------------------------------------
 *  1 · OCR SELF-TEST  — proves receipt scanning works end-to-end server-side.
 * --------------------------------------------------------------------------*/
function EV_ovOcrSelfTest_(body) {
  try {
    var file = null;
    if (body && body.fileId) {
      file = DriveApp.getFileById(body.fileId);
    } else {
      // newest image in 02 Receipts & Expenses
      var it = DriveApp.getFolderById(CONFIG.DRIVE.RECEIPTS).getFiles();
      var newest = null, newestT = 0;
      while (it.hasNext()) {
        var f = it.next();
        var mt = String(f.getMimeType() || '');
        if (mt.indexOf('image/') !== 0 && mt !== 'application/pdf') continue;
        var t = f.getLastUpdated().getTime();
        if (t > newestT) { newestT = t; newest = f; }
      }
      file = newest;
    }
    if (!file) return { ok: false, error: 'No receipt image found in the 02 Receipts folder to test with.' };
    var bytes = file.getBlob().getBytes();
    var ocr = EV_driveOcr_(bytes, file.getMimeType());           // OcrFill.js — returns {text, http}
    var text = (ocr && typeof ocr === 'object') ? String(ocr.text || '') : String(ocr || '');
    if (!text.trim()) return { ok: false, stage: 'ocr', file: file.getName(), http: ocr && ocr.http, error: 'Drive OCR returned no text (rate limit or unsupported format).' };
    var fields = EV_parseReceipt_(text);                          // OcrFill.js — heuristic parser
    return { ok: true, file: file.getName(), chars: text.length, fields: fields,
             parserSane: !!(fields && (fields.total || fields.vendor)) };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* ----------------------------------------------------------------------------
 *  2 · RECEIPT CONTEXT  — one compact fetch for the Haiku→Sonnet pipeline.
 * --------------------------------------------------------------------------*/
function EV_ovReceiptContext_(body) {
  try {
    var book = EV_book_();
    var out = { ok: true, pending: [], receiptLogTail: [], openJobs: [], vendors: [] };

    // pending receipt-ish inbox rows (NEW or NEEDS REVIEW)
    var inbox = EV_sheetEndingWith_(book, 'App Inbox');
    if (inbox) {
      var data = inbox.getDataRange().getValues(), ih = data[0];
      var cStatus = EV_colIndex_(ih, 'Status'), cCat = EV_colIndex_(ih, 'Category'), cDet = EV_colIndex_(ih, 'Details'),
          cPhoto = EV_colIndex_(ih, 'Photo'), cSub = EV_colIndex_(ih, 'Submission'), cBy = EV_colIndex_(ih, 'Captured');
      for (var r = 1; r < data.length && out.pending.length < (body.limit || 40); r++) {
        var st = String(data[r][cStatus] || '').toUpperCase();
        if (st !== 'NEW' && st !== 'NEEDS REVIEW') continue;
        var cat = String(data[r][cCat] || '');
        if (!/receipt|expense|quick/i.test(cat)) continue;
        var det = {}; try { det = JSON.parse(data[r][cDet] || '{}'); } catch (e) {}
        out.pending.push({ id: String(data[r][cSub] || ''), status: st, category: cat, by: String(data[r][cBy] || ''),
                           fields: det, photos: String(data[r][cPhoto] || '').split('\n').filter(String) });
      }
    }

    // Receipt Log tail — dedupe context (date | vendor | total | job).
    // Read-time filter ONLY (nothing deleted): rows with no parseable total are junk from a
    // June-21 Drive-intake run that OCR'd equipment manuals as receipts — useless for dedupe.
    var rl = EV_sheetEndingWith_(book, 'Receipt Log');
    if (rl && rl.getLastRow() > 1) {
      var n = Math.min(120, rl.getLastRow() - 1);
      var v = rl.getRange(rl.getLastRow() - n + 1, 1, n, 12).getDisplayValues();
      v.forEach(function (row) {
        var t = (typeof EV_amount_ === 'function') ? EV_amount_(row[5]) : Number(row[5]);
        if (isNaN(t) || t <= 0) return;
        if (out.receiptLogTail.length >= 50) return;
        out.receiptLogTail.push({ date: row[0], vendor: row[1], total: row[5], job: row[10] || '' });
      });
    }

    // open jobs for job-matching (Dispatch: customer + quote no + status, non-complete).
    // Business tabs carry banner rows above the header — scan for the real header row.
    var disp = EV_sheetEndingWith_(book, 'Dispatch');
    if (disp && disp.getLastRow() > 1) {
      var dv = disp.getDataRange().getDisplayValues();
      var dhr = 0;
      for (var hr = 0; hr < Math.min(12, dv.length); hr++) {
        var lowJ = dv[hr].map(function (x) { return String(x).toLowerCase(); }).join('|');
        if (lowJ.indexOf('customer') >= 0 && lowJ.indexOf('status') >= 0) { dhr = hr; break; }
      }
      var dh = dv[dhr];
      var dCust = EV_colIndex_(dh, 'Customer'), dQ = EV_colIndex_(dh, 'Quote'), dStat = EV_colIndex_(dh, 'Status'), dDate = EV_colIndex_(dh, 'Date');
      for (var r2 = dhr + 1; r2 < dv.length; r2++) {
        var stt = String(dv[r2][dStat] || '');
        if (/complete|cancel|paid/i.test(stt)) continue;
        var cust = String(dv[r2][dCust] || ''); if (!cust) continue;
        out.openJobs.push({ customer: cust, quoteNo: String(dv[r2][dQ] || ''), status: stt, date: String(dv[r2][dDate] || '') });
      }
    }

    // vendor canon list (for normalization). Read-time filter only: the June-21 intake run left
    // junk "vendors" (warning-label text, UI fragments) — skip anything that can't be a vendor name.
    var ven = EV_sheetEndingWith_(book, 'Vendors');
    if (ven && ven.getLastRow() > 1) {
      var vv = ven.getRange(2, 1, Math.min(80, ven.getLastRow() - 1), 1).getDisplayValues();
      vv.forEach(function (row) {
        var nm = String(row[0] || '').trim();
        if (!nm || nm.length > 40) return;
        if (/warning|danger|advert|do not|caution|model no|grade$|^lot \d|claude|instructions/i.test(nm)) return;
        out.vendors.push(nm);
      });
    }
    return out;
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* ----------------------------------------------------------------------------
 *  3 · FILE RECEIPT  — reasoned writeback. Merges the AI's corrected fields
 *  into the App Inbox row, then re-runs the hardened filer so EVERY existing
 *  safeguard applies (dedupe, financial gate, Receipt Log mirror, job match).
 *  body = { fn:'fileReceipt', inboxId:'SUB-…', fields:{vendor,date,total,gst,
 *           subtotal,category,job,what,notes}, category? }
 * --------------------------------------------------------------------------*/
function EV_ovFileReceipt_(body) {
  try {
    if (!body || !body.inboxId) return { ok: false, error: 'inboxId required' };
    var book = EV_book_();
    var inbox = EV_sheetEndingWith_(book, 'App Inbox');
    if (!inbox) return { ok: false, error: 'No App Inbox' };
    var data = inbox.getDataRange().getValues(), ih = data[0];
    var cDet = EV_colIndex_(ih, 'Details'), cStatus = EV_colIndex_(ih, 'Status'),
        cSub = EV_colIndex_(ih, 'Submission'), cCat = EV_colIndex_(ih, 'Category'), cNotes = EV_colIndex_(ih, 'Claude Notes');
    var rowIx = -1;
    for (var r = 1; r < data.length; r++) { if (String(data[r][cSub]) === String(body.inboxId)) { rowIx = r; break; } }
    if (rowIx < 0) return { ok: false, error: 'Inbox row not found: ' + body.inboxId };

    var det = {}; try { det = JSON.parse(data[rowIx][cDet] || '{}'); } catch (e) {}
    var fields = body.fields || {};
    Object.keys(fields).forEach(function (k) { if (fields[k] != null && String(fields[k]).trim() !== '') det[k] = fields[k]; });
    inbox.getRange(rowIx + 1, cDet + 1).setValue(JSON.stringify(det));
    if (body.category && cCat >= 0) inbox.getRange(rowIx + 1, cCat + 1).setValue(body.category);
    inbox.getRange(rowIx + 1, cStatus + 1).setValue('NEW');   // re-arm for the filer
    if (cNotes >= 0) inbox.getRange(rowIx + 1, cNotes + 1).setValue('AI pipeline: fields reviewed/corrected ' + EV_fmtNow_());

    var result = EV_fileInbox_();                              // full hardened pipeline runs
    // report where this row ended up
    var st = inbox.getRange(rowIx + 1, cStatus + 1).getValue();
    var filedTo = inbox.getRange(rowIx + 1, EV_colIndex_(ih, 'Filed To') + 1).getValue();
    return { ok: true, inboxId: body.inboxId, status: String(st), filedTo: String(filedTo || ''), filerRun: String(result) };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* ----------------------------------------------------------------------------
 *  4 · QUOTE LEARNING  — "📈 Quote Learning" tab: every quote's inputs +
 *  outcome, plus stats so the engine gets smarter as quotes accumulate.
 * --------------------------------------------------------------------------*/
function EV_ovQuoteLearning_() {
  try {
    var book = EV_book_();
    var q = EV_sheetEndingWith_(book, 'Quotes');
    if (!q) return { ok: false, error: 'No Quotes tab' };
    var v = q.getDataRange().getDisplayValues();
    // find the header row by signature
    var hr = -1, h = null;
    for (var r = 0; r < Math.min(12, v.length); r++) {
      var low = v[r].map(function (x) { return String(x).toLowerCase(); }).join('|');
      if (low.indexOf('quote') >= 0 && low.indexOf('status') >= 0) { hr = r; h = v[r]; break; }
    }
    if (hr < 0) return { ok: false, error: 'Quotes header not found' };
    function ci(n) { return EV_colIndex_(h, n); }
    var cNo = ci('Quote'), cDate = ci('Date'), cClient = ci('Client') >= 0 ? ci('Client') : ci('Customer'),
        cAmt = ci('Total') >= 0 ? ci('Total') : ci('Amount'), cStat = ci('Status'),
        cSqft = ci('SQ FT') >= 0 ? ci('SQ FT') : ci('sqft'), cRate = ci('$/SQ') >= 0 ? ci('$/SQ') : ci('per sq'), cDepth = ci('BLAST') >= 0 ? ci('BLAST') : ci('Depth');

    var rows = [], won = 0, lost = 0, open = 0, wonRates = [], openRates = [], wonSum = 0;
    for (var r2 = hr + 1; r2 < v.length; r2++) {
      var no = String(v[r2][cNo] || ''); if (!no || !/ECO-Q/i.test(no)) continue;
      var stat = String(v[r2][cStat] || '');
      var outcome = /won|accept|approv|booked|deposit|complete|paid|invoiced/i.test(stat) ? 'WON'
                  : /lost|declin|dead|cancel|expired|no\b/i.test(stat) ? 'LOST' : 'OPEN';
      var amt = (typeof EV_amount_ === 'function') ? EV_amount_(v[r2][cAmt]) : Number(v[r2][cAmt]);
      var rate = cRate >= 0 ? ((typeof EV_amount_ === 'function') ? EV_amount_(v[r2][cRate]) : Number(v[r2][cRate])) : NaN;
      if (outcome === 'WON') { won++; if (!isNaN(rate) && rate > 0) wonRates.push(rate); if (!isNaN(amt)) wonSum += amt; }
      else if (outcome === 'LOST') lost++;
      else { open++; if (!isNaN(rate) && rate > 0) openRates.push(rate); }
      rows.push([no, String(v[r2][cDate] || ''), String(v[r2][cClient] || ''), cSqft >= 0 ? String(v[r2][cSqft] || '') : '',
                 cDepth >= 0 ? String(v[r2][cDepth] || '') : '', (isNaN(rate) || !rate) ? '' : rate.toFixed(2),
                 isNaN(amt) ? '' : amt.toFixed(2), stat, outcome]);
    }
    function avg(a) { return a.length ? (a.reduce(function (x, y) { return x + y; }, 0) / a.length) : 0; }
    var decided = won + lost;
    var winRate = decided ? Math.round(100 * won / decided) : 0;

    var name = '📈 Quote Learning';
    var sh = book.getSheetByName(name) || book.insertSheet(name);
    sh.clear();
    var head = [
      ['📈 QUOTE LEARNING — every quote\'s inputs + outcome, so pricing gets smarter over time', '', '', '', '', '', '', '', ''],
      ['Baseline: exposed-aggregate driveways ≈ $9.00 / sq ft. Never price below break-even (Quote Engine tab). Refresh: router POST {action:"ops", fn:"quoteLearning"}.', '', '', '', '', '', '', '', ''],
      ['SCORECARD', 'Quotes: ' + rows.length, 'Won: ' + won, 'Lost: ' + lost, 'Open: ' + open,
       'Win rate: ' + winRate + '% (' + decided + ' decided)', 'Avg WON $/sqft: ' + (wonRates.length ? ('$' + avg(wonRates).toFixed(2)) : '—'),
       'Avg OPEN $/sqft: ' + (openRates.length ? ('$' + avg(openRates).toFixed(2)) : '—'), 'Won value: $' + wonSum.toFixed(0)],
      ['HOW TO USE: when a quote WINS at a rate, that rate is proven — quote it again. When quotes sit OPEN/LOST above the baseline, the price may be high for that job type; below baseline wins may be leaving money. Add the outcome to the Quotes tab STATUS and refresh.', '', '', '', '', '', '', '', ''],
      ['Quote No', 'Date', 'Client', 'Sq Ft', 'Blast Depth', '$/Sq Ft', 'Total', 'Status (raw)', 'Outcome']
    ];
    sh.getRange(1, 1, head.length, 9).setValues(head);
    if (rows.length) sh.getRange(head.length + 1, 1, rows.length, 9).setValues(rows);
    sh.getRange(1, 1, 1, 9).merge().setBackground('#0a0a0a').setFontColor('#39ff14').setFontWeight('bold').setFontSize(12);
    sh.getRange(2, 1, 1, 9).merge().setWrap(true).setFontColor('#666666').setFontSize(10);
    sh.getRange(3, 1, 1, 9).setBackground('#e8fbe8').setFontWeight('bold');
    sh.getRange(4, 1, 1, 9).merge().setWrap(true).setFontColor('#666666').setFontSize(10);
    sh.getRange(5, 1, 1, 9).setBackground('#4ade80').setFontColor('#050505').setFontWeight('bold');
    sh.setFrozenRows(5);
    sh.setColumnWidth(3, 200); sh.setColumnWidth(8, 220);
    return { ok: true, tab: name, quotes: rows.length, won: won, lost: lost, open: open, winRate: winRate + '%',
             avgWonRate: wonRates.length ? avg(wonRates).toFixed(2) : null };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* ----------------------------------------------------------------------------
 *  5 · SYSTEM HEALTH  — "🩺 System Health" tab: live metrics + honest
 *  doing-well / needs-attention / recommendations. Non-destructive.
 * --------------------------------------------------------------------------*/
function EV_ovSystemHealth_() {
  try {
    var book = EV_book_();
    function tail(name, keyCol) {
      var sh = EV_sheetEndingWith_(book, name);
      if (!sh || sh.getLastRow() < 2) return { count: 0, last: '' };
      return { count: sh.getLastRow() - 1, last: String(sh.getRange(sh.getLastRow(), keyCol || 1).getDisplayValue() || '') };
    }
    // inbox backlog
    var backlog = 0, inbox = EV_sheetEndingWith_(book, 'App Inbox');
    if (inbox && inbox.getLastRow() > 1) {
      var st = inbox.getRange(2, 11, inbox.getLastRow() - 1, 1).getValues();
      st.forEach(function (r) { var s = String(r[0]).toUpperCase(); if (s === 'NEW' || s === 'NEEDS REVIEW') backlog++; });
    }
    var flha = tail('FLHA', 2), hz = tail('Hazard Reports', 2), rl = tail('Receipt Log', 1), exp = tail('Expenses', 1);
    var trig = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    // last router/brain activity from App Log
    var lastLog = '';
    var log = EV_sheetEndingWith_(book, 'App Log');
    if (log && log.getLastRow() > 1) lastLog = String(log.getRange(log.getLastRow(), 1).getDisplayValue()) + ' — ' + String(log.getRange(log.getLastRow(), 3).getDisplayValue()).slice(0, 90);

    var doingWell = [
      'Capture → App Inbox → auto-filer loop is idempotent (dedupe + financial gate + Receipt Log mirror) — a wrong dollar amount can\'t silently enter the books.',
      'Safety is live end-to-end: FLHA (' + flha.count + ' records) with verified PIN sign-offs, mid-shift amendments, end-of-day closeout, branded PDFs to Drive, emails to both owners.',
      'Autonomy runs server-side (' + trig.length + ' Google triggers) — digests, sweeps, reply monitor, hourly filer, Drive intake and 3-day backups fire with every PC off.',
      'Quote engine has rate tables + break-even guard, and the new 📈 Quote Learning tab now accumulates every quote\'s inputs + outcome.',
      'Receipt OCR is two-engine (Drive native + on-device Tesseract) and free — no API keys, no per-scan cost.'
    ];
    var attention = [
      'Receipt Log has ~40 junk rows from June 21 (a Drive-intake run OCR\'d equipment-manual photos as "receipts" — vendors like "DO NOT WALK", no totals) and the Vendors tab picked up matching junk names. Nothing was deleted per policy; the AI pipeline now filters them at read time. Recommend a human-reviewed cleanup — the 3-day backups preserve everything first.',
      'App Inbox backlog: ' + backlog + ' item(s) awaiting filing/review' + (backlog ? ' — worth a look.' : ' — clear. 🎉'),
      'Two sessions edit this Apps Script project: ALWAYS `clasp pull` before pushing — a stale push tonight briefly reverted live fixes (restored + re-deployed the same night).',
      'Quotes tab STATUS drives the learning loop — keep it current (Won / Lost / reason) so win-rate stats stay honest.',
      'Default admin PINs are still the documented ones — change them in 👥 App Users.',
      'Collect customer emails at quote time (also on the Tomorrow\'s Chat list) — unlocks emailed invoices/receipts.'
    ];
    var recs = [
      'Receipt pipeline: run the Haiku→Sonnet playbook (receipt-pipeline.md) on a schedule — Haiku does the cheap field-extraction pass, Sonnet decides category/job/dedupe, one `ops fileReceipt` call per receipt. Never Opus per-receipt.',
      'routerWatch/receiptReport re-parse dd/MM date strings with new Date() — can mis-read days 13–31 (false "router down"). Small parse fix, listed for the automation owner.',
      'EV_pickTotal_ takes the LARGEST amount on a TOTAL line — prefer the LAST token so a "was $X" discount line can\'t win. Small parser tweak, unit-test first.',
      'Converge trigger installers on one canonical schedule (EV_fixTriggers_) — EV_installCore still schedules the digest at 07:45 vs the live 06:00.',
      'Job P&L: join Dispatch ↔ Quotes ↔ Receipt Log for true per-job margin — the receiptContext action now exposes the pieces.',
      'Digest builders: V1/V2/V3 all exist; once the current digest work settles, consolidate test paths to whichever builder is canonical.'
    ];
    var name = '🩺 System Health';
    var sh = book.getSheetByName(name) || book.insertSheet(name);
    sh.clear();
    var rows = [
      ['🩺 SYSTEM HEALTH — overnight review ' + EV_fmt_(EV_now_(), 'yyyy-MM-dd HH:mm') + ' MT', ''],
      ['Refresh any time: router POST {action:"ops", fn:"systemHealth"}. Nothing here is edited by hand — safe to re-run.', ''],
      ['— LIVE METRICS —', ''],
      ['App Inbox backlog (NEW / NEEDS REVIEW)', String(backlog)],
      ['Receipt Log rows', String(rl.count)],
      ['Expenses rows', String(exp.count)],
      ['FLHA records', String(flha.count) + (flha.last ? ('  (latest: ' + flha.last + ')') : '')],
      ['Hazard reports', String(hz.count)],
      ['Server triggers installed', trig.join(', ')],
      ['Latest App Log entry', lastLog],
      ['— WHAT THE SYSTEM DOES WELL —', '']
    ];
    doingWell.forEach(function (d, i) { rows.push(['✅ ' + (i + 1), d]); });
    rows.push(['— WORTH SOME ATTENTION —', '']);
    attention.forEach(function (d, i) { rows.push(['👀 ' + (i + 1), d]); });
    rows.push(['— RECOMMENDATIONS (not executed — for review) —', '']);
    recs.forEach(function (d, i) { rows.push(['💡 ' + (i + 1), d]); });
    sh.getRange(1, 1, rows.length, 2).setValues(rows);
    sh.getRange(1, 1, 1, 2).merge().setBackground('#0a0a0a').setFontColor('#39ff14').setFontWeight('bold').setFontSize(12);
    sh.getRange(2, 1, 1, 2).merge().setFontColor('#666666').setFontSize(10);
    sh.setColumnWidth(1, 300); sh.setColumnWidth(2, 760);
    sh.getRange(3, 1, rows.length - 2, 2).setWrap(true);
    for (var i = 0; i < rows.length; i++) { if (String(rows[i][0]).indexOf('—') === 0) sh.getRange(i + 1, 1, 1, 2).merge().setBackground('#e8fbe8').setFontWeight('bold'); }
    sh.setFrozenRows(2);
    return { ok: true, tab: name, backlog: backlog, flha: flha.count, receiptLog: rl.count, triggers: trig.length };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* ----------------------------------------------------------------------------
 *  6 · SYSTEM LOG  — append-only maintenance journal ("🛠 System Log").
 *  body = { fn:'appendSystemLog', title, lines:[..], author }
 * --------------------------------------------------------------------------*/
function EV_ovAppendSystemLog_(body) {
  try {
    var book = EV_book_();
    var name = '🛠 System Log';
    var sh = book.getSheetByName(name);
    if (!sh) {
      sh = book.insertSheet(name);
      sh.getRange(1, 1, 1, 3).setValues([['Date', 'Entry', 'Details']]);
      sh.getRange(1, 1, 1, 3).setBackground('#4ade80').setFontColor('#050505').setFontWeight('bold');
      sh.setFrozenRows(1);
      sh.setColumnWidth(2, 260); sh.setColumnWidth(3, 780);
    }
    var lines = (body && body.lines) || [];
    sh.appendRow([EV_fmt_(EV_now_(), 'yyyy-MM-dd'), String((body && body.title) || 'System note'),
                  lines.map(function (l) { return '• ' + l; }).join('\n')]);
    sh.getRange(sh.getLastRow(), 3).setWrap(true);
    return { ok: true, tab: name, row: sh.getLastRow() };
  } catch (err) { return { ok: false, error: String(err) }; }
}
