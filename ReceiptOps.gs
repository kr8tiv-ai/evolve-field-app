/**
 * ============================================================================
 *  EVOLVE RECEIPT OPS  —  router-health alerts + verified, QuickBooks-ready
 *  receipt bookkeeping with a 3-day discrepancy report.
 * ----------------------------------------------------------------------------
 *  THE RULES (from Todd):
 *   - Every receipt photo is stored and NEVER deleted (already true: Drive
 *     "02 Receipts & Expenses").
 *   - The receipt itself is the SOURCE OF TRUTH. The date/items/totals typed in
 *     the app are checked against what the receipt actually says; the router
 *     (per claude-router-task.md) flags any mismatch into the Issue column.
 *   - Every line item is filed and verified. Every total + date verified.
 *   - Any discrepancies are emailed to Matt + Todd once every 3 days.
 *   - The 📒 Receipt Log is structured so it can be exported and imported into
 *     QuickBooks (Date / Vendor / Category / Subtotal / GST / Total / etc.).
 *   - If the filing router stops, the owner is alerted (hourly watch).
 *
 *  Reuses ss_(), appLog_(), CONFIG from Code.gs (same project). Uses only
 *  existing scopes (Sheets + ScriptApp + MailApp).
 *
 *  ONE-TIME:  Run ▸ EV_installReceiptOps
 * ============================================================================
 */
var RECEIPT_OPS = {
  NOTIFY:                'manager@yourcompany.com', // operator only — discrepancy report + router-down alert (Todd gets only the morning digest)
  LOG_SHEET:             '🗒 App Log',
  RECEIPT_SHEET:         '📒 Receipt Log',
  TZ:                    'America/Edmonton',
  ROUTER_STALE_HOURS:    16,   // router runs 7/13/19 (max ~12h overnight gap); 16h = genuinely late
  BACKLOG_MIN_AGE_HOURS: 6,
  ALERT_COOLDOWN_HOURS:  12,
  REPORT_EVERY_DAYS:     3
};

// QuickBooks-friendly columns: one row per receipt. (Per-material line items also
// go to Price Log by the router; this is the bookkeeping ledger of record.)
const RCPT_LOG_HEADERS = [
  'Date', 'Vendor', 'Category', 'Subtotal', 'GST / Tax', 'Total', 'Payment method',
  'Line items', 'Qty', 'Unit price', 'Job / reason', 'Source (Inbox ID)', 'Photo link',
  'Filed by', 'Issue / discrepancy', 'Created'
];

function EVR_esc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/** Create the rich, QuickBooks-ready Receipt Log tab (idempotent). */
function EV_setupReceiptLog() {
  var ss = ss_();
  var sh = ss.getSheetByName(RECEIPT_OPS.RECEIPT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(RECEIPT_OPS.RECEIPT_SHEET);
    sh.getRange(1, 1, 1, RCPT_LOG_HEADERS.length).setValues([RCPT_LOG_HEADERS]);
    sh.getRange(1, 1, 1, RCPT_LOG_HEADERS.length).setFontWeight('bold').setBackground('#13301c').setFontColor('#9ef0b0');
    sh.setFrozenRows(1);
    sh.setColumnWidth(8, 380);  // Line items
    sh.setColumnWidth(15, 300); // Issue / discrepancy
  }
  return RECEIPT_OPS.RECEIPT_SHEET + ' ready (' + RCPT_LOG_HEADERS.length + ' columns, QuickBooks-ready).';
}

/** Hours since the Claude router last wrote to the App Log (null if never). */
function EVR_lastRouterHrs_() {
  var sh = ss_().getSheetByName(RECEIPT_OPS.LOG_SHEET);
  if (!sh) return null;
  var lr = sh.getLastRow(); if (lr < 2) return null;
  var start = Math.max(2, lr - 400);
  var v = sh.getRange(start, 1, lr - start + 1, 2).getValues(), newest = null;
  for (var i = 0; i < v.length; i++) {
    if (/claude/i.test(String(v[i][1] || '')) && v[i][0]) {
      var d = (Object.prototype.toString.call(v[i][0]) === '[object Date]') ? v[i][0] : new Date(v[i][0]);
      if (!isNaN(d.getTime()) && (!newest || d.getTime() > newest.getTime())) newest = d;
    }
  }
  return newest ? (new Date().getTime() - newest.getTime()) / 3600000 : null;
}

/** Count NEW App Inbox rows older than minAgeHours (captures waiting to be filed). */
function EVR_newBacklog_(minAgeHours) {
  var sh = ss_().getSheetByName(CONFIG.INBOX_SHEET);
  if (!sh) return 0;
  var lr = sh.getLastRow(); if (lr < 2) return 0;
  var v = sh.getRange(2, 1, lr - 1, 14).getValues(), n = 0, now = new Date().getTime();
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][10] || '').toUpperCase() !== 'NEW') continue;
    var ts = v[i][0] ? new Date(v[i][0]) : null;
    var ageH = (ts && !isNaN(ts.getTime())) ? (now - ts.getTime()) / 3600000 : 999;
    if (ageH >= minAgeHours) n++;
  }
  return n;
}

/** Hourly: alert Matt + Todd if the filing router has gone quiet. Deduped + heartbeat. */
function EV_routerWatch() {
  try {
    var hrs = EVR_lastRouterHrs_();
    var backlog = EVR_newBacklog_(RECEIPT_OPS.BACKLOG_MIN_AGE_HOURS);
    appLog_('RouterWatch', 'Heartbeat — last router run ' + (hrs === null ? 'never' : Math.round(hrs) + 'h') + ' ago, NEW backlog ' + backlog + '.');

    var stale = (hrs === null) || (hrs >= RECEIPT_OPS.ROUTER_STALE_HOURS);
    if (!stale) return 'ok (router ' + Math.round(hrs) + 'h ago)';

    var props = PropertiesService.getScriptProperties();
    var last = Number(props.getProperty('ROUTERWATCH_LAST_ALERT') || 0);
    var nowMs = new Date().getTime();
    if (nowMs - last < RECEIPT_OPS.ALERT_COOLDOWN_HOURS * 3600000) return 'stale, but within alert cooldown';

    var subject = 'Evolve ALERT: the filing router looks DOWN';
    var body = 'The Claude filing router has not run in ' + (hrs === null ? 'a long while' : Math.round(hrs) + 'h') +
      (backlog > 0 ? (' and ' + backlog + ' field capture(s) are waiting') : '') + '.\n\n' +
      'Receipts and captures will not be classified, verified, or filed until it runs again ' +
      '(the photos are still safely stored). Start or re-run the scheduled router so the backlog clears.\n\n— Evolve Router Watch';
    MailApp.sendEmail(RECEIPT_OPS.NOTIFY, subject, body);
    props.setProperty('ROUTERWATCH_LAST_ALERT', String(nowMs));
    appLog_('RouterWatch', 'ALERT emailed to ' + RECEIPT_OPS.NOTIFY + ' (router ' + (hrs === null ? 'never' : Math.round(hrs) + 'h') + ', backlog ' + backlog + ').');
    return 'ALERTED';
  } catch (err) {
    try { appLog_('RouterWatch', 'ERROR: ' + err); } catch (e) {}
    throw err;
  }
}

/** Every 3 days: email Matt + Todd a receipt check — discrepancies the router flagged, plus a clean count. */
function EV_receiptReport() {
  try {
    var sh = ss_().getSheetByName(RECEIPT_OPS.RECEIPT_SHEET);
    if (!sh) { EV_setupReceiptLog(); }
    sh = ss_().getSheetByName(RECEIPT_OPS.RECEIPT_SHEET);
    var lr = sh.getLastRow();
    var props = PropertiesService.getScriptProperties();
    var last = Number(props.getProperty('RECEIPTREPORT_LAST') || 0);
    var nowMs = new Date().getTime();

    var issues = [], filedSince = 0;
    if (lr >= 2) {
      var v = sh.getRange(2, 1, lr - 1, RCPT_LOG_HEADERS.length).getValues();
      for (var i = 0; i < v.length; i++) {
        var created = v[i][15] ? new Date(v[i][15]).getTime() : 0;
        if (created > last) filedSince++;
        var issue = String(v[i][14] || '').trim();
        if (issue && (created > last || created === 0)) {
          issues.push({ date: v[i][0], vendor: v[i][1], total: v[i][5], issue: issue, src: v[i][11] });
        }
      }
    }

    var H = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;color:#111">';
    H += '<div style="background:#0b3d2e;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-size:18px;font-weight:bold">📒 Evolve Receipt Check</div>';
    H += '<div style="border:1px solid #d9e2dc;border-top:0;padding:16px 18px;border-radius:0 0 10px 10px">';
    H += '<p style="margin:0 0 10px"><b>' + filedSince + '</b> receipt(s) filed since the last check (' +
      Utilities.formatDate(new Date(), RECEIPT_OPS.TZ, 'MMM d, yyyy') + ').</p>';
    if (!issues.length) {
      H += '<p style="color:#1a7f37;font-weight:bold">All verified against the receipts — no discrepancies. ✔</p>';
    } else {
      H += '<p style="color:#b3261e;font-weight:bold">' + issues.length + ' receipt(s) need a look (the receipt is the source of truth):</p><ul style="font-size:14px">';
      issues.forEach(function (x) {
        H += '<li style="margin:4px 0"><b>' + EVR_esc_(x.vendor) + '</b> · ' + EVR_esc_(x.date) + ' · ' + EVR_esc_(x.total) +
          ' — ' + EVR_esc_(x.issue) + (x.src ? (' <span style="color:#777">[' + EVR_esc_(x.src) + ']</span>') : '') + '</li>';
      });
      H += '</ul>';
    }
    H += '<p style="font-size:12px;color:#667;background:#f4f7f5;border-radius:8px;padding:10px 12px;margin-top:12px">' +
      'Every receipt photo is stored and never deleted; the 📒 Receipt Log is the QuickBooks-ready ledger. This check runs every ' +
      RECEIPT_OPS.REPORT_EVERY_DAYS + ' days. — Evolve</p></div></div>';

    MailApp.sendEmail({ to: RECEIPT_OPS.NOTIFY, subject: 'Evolve receipt check — ' + (issues.length ? (issues.length + ' to review') : 'all clean'), htmlBody: H, body: H.replace(/<[^>]+>/g, ' '), name: 'Evolve Eco Blasting' });
    props.setProperty('RECEIPTREPORT_LAST', String(nowMs));
    appLog_('Receipt', '3-day receipt check emailed to ' + RECEIPT_OPS.NOTIFY + ' — ' + filedSince + ' filed, ' + issues.length + ' issue(s).');
    return filedSince + ' filed, ' + issues.length + ' issues';
  } catch (err) {
    try { appLog_('Receipt', 'Report ERROR: ' + err); } catch (e) {}
    throw err;
  }
}

/** One-time installer (idempotent): Receipt Log tab + hourly router watch + 3-day report. */
function EV_installReceiptOps() {
  EV_setupReceiptLog();
  ['EV_routerWatch', 'EV_receiptReport'].forEach(function (fn) {
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t); });
  });
  ScriptApp.newTrigger('EV_routerWatch').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('EV_receiptReport').timeBased().everyDays(RECEIPT_OPS.REPORT_EVERY_DAYS).atHour(8).create();
  appLog_('Receipt', 'Installed: 📒 Receipt Log + hourly router watch + ' + RECEIPT_OPS.REPORT_EVERY_DAYS + '-day discrepancy report to ' + RECEIPT_OPS.NOTIFY + '.');
  return 'Receipt Ops installed — Receipt Log tab, hourly router watch, ' + RECEIPT_OPS.REPORT_EVERY_DAYS + '-day report to ' + RECEIPT_OPS.NOTIFY + '.';
}
