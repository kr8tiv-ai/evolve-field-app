/**
 * ============================================================================
 *  EVOLVE AUTOPILOT  —  server-side scheduler (runs on Google's servers 24/7)
 * ----------------------------------------------------------------------------
 *  WHY THIS FILE EXISTS
 *    The digests / sweeps used to be driven by a Claude Cowork task on Todd's
 *    PC. Those only run while the Claude desktop app is open, so when the PC
 *    was asleep / the app was closed, nothing happened (the scheduler marked a
 *    run, but no email was sent and the App Log stayed empty).
 *
 *    This file moves the SCHEDULING + SENDING into the Apps Script project
 *    itself. Apps Script time-driven triggers fire on Google's infrastructure
 *    whether or not any computer is on. It reads the workbook with
 *    SpreadsheetApp, sends mail with MailApp/GmailApp, and writes its own
 *    heartbeat to the 🗒 App Log — with zero dependency on the PC.
 *
 *  WHAT RUNS
 *    EV_morningDigest   daily ~7:45 AM  (business ops email, send-only scope)
 *    EV_dispatchSweep   7 AM / 1 PM / 7 PM  (audit + heartbeat + stuck-item email)
 *    EV_replyMonitor    hourly  (reads replies, logs to To-Do, confirms)   [needs Gmail scope]
 *    EV_personalDigest  daily ~6 AM  (the funny household Daily Digest)     [needs Gmail scope]
 *
 *  ONE-TIME SETUP (from the editor)
 *    1. Run EV_installCore   -> installs morning + dispatch triggers (existing scopes).
 *    2. Add the Gmail scope to appsscript.json, then Run EV_installGmail
 *       -> installs reply monitor + personal digest (asks consent once).
 *    Re-running either installer is safe: it removes its own old triggers first.
 *
 *  Reuses helpers already defined in Code.gs: ss_(), appLog_(). Same project.
 * ============================================================================
 */

/* ============ INSTANT OWNER NOTIFICATION ON SUBMIT (added 2026-06-14, Claude) ============
   TEMPORARY monitoring feature: emails the owner on EVERY Field App submission, instantly, at
   submit time (server-side, NOT on the 7am/1pm/7pm sweep). Send-only via MailApp -> needs NO new
   Gmail permission. To DISABLE later: set NOTIFY_OWNER_ON_SUBMIT = false. */
var NOTIFY_OWNER_ON_SUBMIT = true;
var NOTIFY_OWNER_EMAIL = "manager@yourcompany.com";

function apiSubmit(payload){
  var res = apiSubmit_core_(payload);
  try { if (NOTIFY_OWNER_ON_SUBMIT && res && res.ok) { EV_notifyOwnerOnSubmit_(payload, res); } }
  catch (e) { try { appLog_("NotifyOwner", "notify error: " + e); } catch(_e){} }
  try { if (res && res.ok) { EV_fileInbox_(); } } catch (e2) {} // instant-file hook
  try { var _pp=PropertiesService.getScriptProperties(); var _lt=Number(_pp.getProperty("BRAIN_LAST")||0); if(res&&res.ok&&(Date.now()-_lt)>300000){ _pp.setProperty("BRAIN_LAST",String(Date.now())); EV_generateInsights(); } } catch(e4){} // throttled insights refresh
  return res;
}

function EV_notifyOwnerOnSubmit_(payload, res){
  payload = payload || {};
  var tz = "America/Edmonton";
  var subId = (res && res.id) ? res.id : "(no id)";
  var when = Utilities.formatDate(new Date(), tz, "EEE MMM d, yyyy h:mm a");
  var type = String(payload.category || "Submission");
  try { type = prettyCategory_(payload.category) || type; } catch(e){}
  var who = "crew";
  try { var u = checkToken_(payload.token); who = (u && u.name) ? u.name : (typeof u === "string" ? u : (payload.by || payload.user || "crew")); } catch(e){}
  var rows = [];
  function esc(s){ try { return EV_esc_(String(s)); } catch(e){ return String(s); } }
  function add(k,v){ if (v !== undefined && v !== null && String(v).trim() !== "") rows.push("<tr><td style=\"padding:3px 10px 3px 0;color:#555;vertical-align:top\"><b>"+esc(k)+"</b></td><td style=\"padding:3px 0\">"+esc(v)+"</td></tr>"); }
  add("Type", type); add("Submitted by", who); add("When", when); add("Submission ID", subId);
  if (payload.summary) add("Summary", payload.summary);
  var f = payload.fields || {};
  if (f && typeof f === "object") { Object.keys(f).forEach(function(k){ add(k, f[k]); }); }
  if (payload.gps && (payload.gps.lat || payload.gps.lng)) add("GPS", (payload.gps.lat||"")+", "+(payload.gps.lng||""));
  if (payload.gps && payload.gps.address) add("Location", payload.gps.address);
  if (payload.device) add("Device", payload.device);
  var links = (payload.photoLinks && payload.photoLinks.length) ? payload.photoLinks.slice() : [];
  var attachments = []; var fallback = "";
  for (var i=0;i<links.length;i++){
    var url = String(links[i]); var mm = url.match(/[-A-Za-z0-9_]{25,}/); var id = mm ? mm[0] : "";
    if (id) { try { attachments.push(DriveApp.getFileById(id).getBlob()); } catch(err){ fallback += "<div>Photo (attach failed): <a href=\""+esc(url)+"\">"+esc(url)+"</a></div>"; } }
    else { fallback += "<div>Photo: <a href=\""+esc(url)+"\">"+esc(url)+"</a></div>"; }
  }
  var body = "<div style=\"font-family:Arial,sans-serif;font-size:14px;color:#222\">"
    + "<h2 style=\"margin:0 0 8px\">New Field App submission</h2>"
    + "<table style=\"border-collapse:collapse\">" + rows.join("") + "</table>"
    + (attachments.length ? "<p style=\"color:#777;margin-top:12px\">"+attachments.length+" photo(s) attached.</p>" : "")
    + (fallback ? "<div style=\"margin-top:12px\">"+fallback+"</div>" : "")
    + "<p style=\"color:#999;font-size:12px;margin-top:16px\">Instant monitoring alert from the Field App (apiSubmit). Toggle off with NOTIFY_OWNER_ON_SUBMIT=false.</p></div>";
  var subject = "Evolve Field App - new " + type + " from " + who + " " + Utilities.formatDate(new Date(), tz, "h:mm a");
  var opts = { htmlBody: body, name: "Evolve Field App" };
  if (attachments.length) opts.attachments = attachments;
  MailApp.sendEmail(NOTIFY_OWNER_EMAIL, subject, body.replace(/<[^>]+>/g," "), opts);
  try { appLog_("NotifyOwner", "Instant alert sent to "+NOTIFY_OWNER_EMAIL+" for "+subId+" ("+type+", "+attachments.length+" photo attach)"); } catch(e){}
}

var EV = {
  TZ: 'America/Edmonton',
  TODD: 'todd@evolveecoblasting.com',
  MATT: 'manager@yourcompany.com',
  get DIGEST_TO() { return EV.TODD + ',' + EV.MATT; },
  SHEETS: {
    dispatch: 'Dispatch', todo: 'To-Do', actions: 'Action Items',
    quotes: 'Quotes', leads: 'Leads', inbox: '📥 App Inbox', log: '🗒 App Log'
  },
  LABEL: 'Evolve/Logged'
};

// ---------------------------------------------------------------------------
//  SMALL UTILITIES
// ---------------------------------------------------------------------------
function EV_book_() { return SpreadsheetApp.openById('YOUR_SPREADSHEET_ID'); }
function EV_sheet_(name) { return EV_book_().getSheetByName(name); }
function EV_fmt_(d, f) { return Utilities.formatDate(d, EV.TZ, f); }
function EV_now_() { return new Date(); }
function EV_todayStr_() { return EV_fmt_(EV_now_(), 'EEEE, MMMM d, yyyy'); }

function EV_esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Midnight today in Edmonton, as a Date. */
function EV_todayMidnight_() {
  var s = EV_fmt_(EV_now_(), 'yyyy/MM/dd') + ' 00:00:00';
  return new Date(s + ' ' + EV_fmt_(EV_now_(), 'XXX')); // tz-aware best effort
}

/**
 * Parse the many date string formats the workbook uses:
 *  "June 6, 2026", "2026-06-08", "08/06/2026" (day-first, as seen in the sheet).
 * Returns a Date or null. Ambiguous numeric dates are read DAY-first to match
 * the workbook's own convention; if that yields an impossible month it falls
 * back to month-first. Never throws.
 */
function EV_parseDate_(v) {
  if (v == null || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v;
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    var a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    var day = a, mon = b;                 // day-first (sheet convention)
    if (a > 12 && b <= 12) { day = a; mon = b; }
    else if (b > 12 && a <= 12) { day = b; mon = a; } // clearly month-first
    var d1 = new Date(y, mon - 1, day);
    return isNaN(d1.getTime()) ? null : d1;
  }
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Whole days from a->b (b-a). Positive = b is later. */
function EV_daysBetween_(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** Is this Date strictly before today (Edmonton)? */
function EV_isPast_(d) {
  if (!d) return false;
  var todayKey = EV_fmt_(EV_now_(), 'yyyyMMdd');
  var dKey = EV_fmt_(d, 'yyyyMMdd');
  return dKey < todayKey;
}

/** Send mail server-side, log it. opts may include {cc, replyTo}. */
function EV_send_(to, subject, html, opts) {
  opts = opts || {};
  var o = { name: 'Evolve Eco Blasting', htmlBody: html };
  if (opts.cc) o.cc = opts.cc;
  if (opts.replyTo) o.replyTo = opts.replyTo;
  MailApp.sendEmail(to, subject, html.replace(/<[^>]+>/g, ' '), o);
  try { appLog_('Autopilot', 'Sent "' + subject + '" to ' + to); } catch (e) {}
}

// ---------------------------------------------------------------------------
//  DATA EXTRACTORS  (defensive: skip banners, dividers, legends)
// ---------------------------------------------------------------------------
function EV_values_(name) {
  var sh = EV_sheet_(name);
  if (!sh) return [];
  var lc = sh.getLastColumn(), lr = sh.getLastRow();
  if (lr < 1 || lc < 1) return [];
  return sh.getRange(1, 1, lr, lc).getDisplayValues();
}

/** Dispatch booked jobs: any row with a Customer (col E). Cols A..M. */
function EV_dispatchJobs_() {
  var v = EV_values_(EV.SHEETS.dispatch), out = [];
  for (var i = 6; i < v.length; i++) { // data starts after header row 6
    var r = v[i], cust = (r[4] || '').trim();
    if (!cust || cust.toUpperCase() === 'CUSTOMER') continue;
    if (/^(THIS WEEK|WHAT'S AHEAD|STATUS KEY)/i.test((r[1] || '').trim())) continue;
    out.push({
      week: r[0], date: r[1], time: r[2], jobId: r[3], customer: cust,
      address: r[5], crew: r[6], quote: r[7], status: r[8], notes: r[9],
      deposit: r[10] || '', invoiced: r[11] || '', paid: r[12] || ''
    });
  }
  return out;
}

/** To-Do items: rows whose col A is a number (the #). */
function EV_todoItems_() {
  var v = EV_values_(EV.SHEETS.todo), out = [];
  for (var i = 6; i < v.length; i++) {
    var r = v[i], num = (r[0] || '').trim();
    if (!/^\d+$/.test(num)) continue;
    var status = (r[4] || '').trim();
    if (/^done$/i.test(status) || /^complete/i.test(status)) continue;
    out.push({ num: num, task: r[1], category: r[2], priority: (r[3] || '').trim(), status: status, due: r[6], notes: r[7] });
  }
  return out;
}

/** Open Action Items: rows with a Status of Open / In progress. Cols A..H. */
function EV_actionItems_() {
  var v = EV_values_(EV.SHEETS.actions), out = [];
  for (var i = 6; i < v.length; i++) {
    var r = v[i], status = (r[6] || '').trim();
    if (!/^(open|in progress|in-progress|blocked)$/i.test(status)) continue;
    out.push({ raised: r[0], alert: r[1], type: r[2], relates: r[3], due: r[4], owner: r[5], status: status, notes: r[7], dueDate: EV_parseDate_(r[4]) });
  }
  return out;
}

/** Outstanding quotes: rows whose col A is an ECO-Q number. Cols A..T. */
function EV_quotes_() {
  var v = EV_values_(EV.SHEETS.quotes), out = [];
  for (var i = 6; i < v.length; i++) {
    var r = v[i], no = (r[0] || '').trim();
    if (!/^ECO-Q-/i.test(no)) continue;
    out.push({ no: no, date: r[1], client: r[2], address: r[5], scope: r[6], total: r[9], status: (r[12] || '').trim(), validUntil: r[13], sqft: r[17], depth: r[19], validDate: EV_parseDate_(r[13]), dateObj: EV_parseDate_(r[1]) });
  }
  return out;
}

/** Leads: rows with a Status (col H) and a Lead name (col B). Cols A..L. */
function EV_leads_() {
  var v = EV_values_(EV.SHEETS.leads), out = [];
  for (var i = 6; i < v.length; i++) {
    var r = v[i], status = (r[7] || '').trim(), lead = (r[1] || '').trim();
    if (!lead || !status) continue;
    if (/^STATUS FLOW/i.test(lead)) continue;
    out.push({ dateIn: r[0], lead: lead, contact: r[2], phone: r[3], source: r[4], service: r[5], address: r[6], status: status, quote: r[8], nextAction: r[9], nextDate: r[10], nextDateObj: EV_parseDate_(r[10]) });
  }
  return out;
}

/** App Inbox rows still NEW or NEEDS REVIEW, with age in hours. */
function EV_inboxOpen_() {
  var v = EV_values_(EV.SHEETS.inbox), out = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i], status = (r[10] || '').trim().toUpperCase();
    if (status !== 'NEW' && status !== 'NEEDS REVIEW') continue;
    var ts = EV_parseDate_(r[0]);
    var ageH = ts ? Math.round((EV_now_().getTime() - ts.getTime()) / 3600000) : null;
    out.push({ ts: r[0], by: r[1], category: r[2], summary: r[3], status: status, id: r[13], ageH: ageH });
  }
  return out;
}

/** Count 🗒 App Log heartbeat rows written on a given yyyyMMdd (Edmonton). */
function EV_heartbeatsOn_(yyyymmdd) {
  var sh = EV_sheet_(EV.SHEETS.log);
  if (!sh) return 0;
  var lr = sh.getLastRow();
  if (lr < 1) return 0;
  var vals = sh.getRange(1, 1, lr, 3).getValues(), n = 0;
  for (var i = 0; i < vals.length; i++) {
    var ts = vals[i][0], msg = String(vals[i][2] || '');
    if (!ts) continue;
    var key = (Object.prototype.toString.call(ts) === '[object Date]') ? EV_fmt_(ts, 'yyyyMMdd') : EV_fmt_(EV_parseDate_(ts) || new Date(0), 'yyyyMMdd');
    if (key === yyyymmdd && /heartbeat/i.test(msg)) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
//  WEATHER  (open-meteo primary; UrlFetch needs script.external_request scope)
// ---------------------------------------------------------------------------
function EV_weather_() {
  try {
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=53.55&longitude=-113.49' +
      '&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max' +
      '&timezone=America%2FEdmonton&forecast_days=5&wind_speed_unit=kmh&temperature_unit=celsius';
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var d = JSON.parse(res.getContentText()).daily;
    var days = [];
    for (var i = 0; i < d.time.length; i++) {
      var tmax = Math.round(d.temperature_2m_max[i]), tmin = Math.round(d.temperature_2m_min[i]);
      var pp = d.precipitation_probability_max[i], wind = Math.round(d.wind_speed_10m_max[i]);
      var verdict = 'Good blast day';
      if (pp >= 50 || wind > 40 || tmax < 3) verdict = 'No-go';
      else if (pp >= 35 || wind > 28 || tmax < 8) verdict = 'Marginal';
      days.push({
        label: EV_fmt_(new Date(d.time[i] + 'T12:00:00'), 'EEE MMM d'),
        sky: EV_wmo_(d.weathercode[i]), tmax: tmax, tmin: tmin, pp: pp, wind: wind, verdict: verdict
      });
    }
    return days;
  } catch (e) { return null; }
}
function EV_wmo_(c) {
  var m = { 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm' };
  return m[c] || ('Code ' + c);
}

// ---------------------------------------------------------------------------
//  MORNING BUSINESS DIGEST  (send-only scope)
// ---------------------------------------------------------------------------
var EV_TAGLINES = [
  'Coffee first, abrasive media second.',
  'The books are balanced, the well is still haunted.',
  'Another day, another substrate to profile.',
  'Chase the invoice before it chases you.',
  'Dust is optional; follow-through is not.',
  'Quotes do not close themselves, sadly.',
  'Read it, act on it, then go make some dust.'
];

function EV_morningDigest() {
  try {
    var html = EV_buildMorningDigestHtml_();
    var subject = 'Evolve Morning Digest — ' + EV_fmt_(EV_now_(), 'MMMM d, yyyy');
    EV_send_(EV.DIGEST_TO, subject, html);
    appLog_('Autopilot', 'MORNING DIGEST sent server-side (' + EV_fmt_(EV_now_(), 'HH:mm') + ') — heartbeat');
    return 'sent';
  } catch (err) {
    EV_failNotify_('EV_morningDigest', err);
    throw err;
  }
}

function EV_buildMorningDigestHtml_() {
  var jobs = EV_dispatchJobs_(), quotes = EV_quotes_(), actions = EV_actionItems_(),
      leads = EV_leads_(), todos = EV_todoItems_(), inbox = EV_inboxOpen_(), wx = EV_weather_();
  var yKey = EV_fmt_(new Date(EV_now_().getTime() - 86400000), 'yyyyMMdd');
  var hb = EV_heartbeatsOn_(yKey);
  var tag = EV_TAGLINES[(new Date().getDate()) % EV_TAGLINES.length];

  // ----- ONE THING NOT TO DROP -----
  var topThing = '';
  var overdueAI = actions.filter(function (a) { return EV_isPast_(a.dueDate); });
  if (overdueAI.length) topThing = 'Overdue action item: ' + EV_esc_(overdueAI[0].alert) + ' (owner ' + EV_esc_(overdueAI[0].owner) + ', was due ' + EV_esc_(overdueAI[0].due) + ').';
  else {
    var stuck = inbox.filter(function (x) { return x.ageH != null && x.ageH >= 24; });
    if (stuck.length) topThing = 'A field submission has been stuck ' + stuck[0].ageH + 'h: ' + EV_esc_(stuck[0].summary) + '.';
  }
  if (!topThing) {
    var unpaid = jobs.filter(function (j) { return j.invoiced && !j.paid; });
    if (unpaid.length) topThing = 'Unpaid invoice on the board: ' + EV_esc_(unpaid[0].customer) + '. Chase it.';
  }
  if (!topThing && todos.length) {
    var hi = todos.filter(function (t) { return /high/i.test(t.priority); })[0];
    if (hi) topThing = 'Top priority: ' + EV_esc_(hi.task) + '.';
  }
  if (!topThing) topThing = 'Nothing is on fire. Enjoy it, then go make some dust.';

  var H = [];
  H.push('<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;color:#111;">');
  H.push('<div style="background:#0b3d2e;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;">');
  H.push('<div style="font-size:20px;font-weight:bold;letter-spacing:.5px;">EVOLVE MORNING DIGEST</div>');
  H.push('<div style="font-size:14px;opacity:.85;">' + EV_esc_(EV_todayStr_()) + ' &middot; ' + EV_esc_(tag) + '</div></div>');
  H.push('<div style="border:1px solid #d9e2dc;border-top:0;padding:18px 20px;border-radius:0 0 10px 10px;">');

  H.push(EV_card_('🎯 ONE THING NOT TO DROP TODAY', '<p style="margin:0;font-size:15px;">' + topThing + '</p>', '#fff7e6', '#e0a200'));

  // ----- SYSTEM HEALTH -----
  var sh = [];
  sh.push('Auto-send: server-side (Apps Script), independent of the PC — healthy.');
  sh.push('Dispatch heartbeats logged yesterday: ' + hb + (hb < 3 ? ' (building up — server triggers just took over)' : ' of 3.'));
  var openInbox = inbox.length;
  sh.push('App Inbox needing a human: ' + (openInbox ? openInbox + ' (' + inbox.map(function (x) { return EV_esc_(x.status) + (x.ageH != null ? ' ' + x.ageH + 'h' : ''); }).join(', ') + ')' : 'none — clean.'));
  H.push(EV_card_('🩺 SYSTEM HEALTH', '<ul style="margin:0;padding-left:18px;font-size:14px;">' + sh.map(function (x) { return '<li style="margin:3px 0;">' + x + '</li>'; }).join('') + '</ul>'));

  // ----- WEATHER -----
  if (wx && wx.length) {
    var wrows = wx.map(function (d) {
      var col = d.verdict === 'Good blast day' ? '#1a7f37' : (d.verdict === 'Marginal' ? '#b26a00' : '#b3261e');
      return '<tr><td style="padding:3px 8px;font-weight:bold;">' + EV_esc_(d.label) + '</td><td style="padding:3px 8px;">' + EV_esc_(d.sky) + ', ' + d.tmax + '/' + d.tmin + '&deg;C</td><td style="padding:3px 8px;">rain ' + d.pp + '%, wind ' + d.wind + ' km/h</td><td style="padding:3px 8px;color:' + col + ';font-weight:bold;">' + d.verdict + '</td></tr>';
    }).join('');
    H.push(EV_card_('🌤️ WEATHER — EDMONTON 5-DAY', '<table style="border-collapse:collapse;font-size:13px;width:100%;">' + wrows + '</table><div style="font-size:12px;color:#555;margin-top:6px;">Abrasive blasting is outdoor wet-process work; rain, high wind, and cold are scheduling risks.</div>'));
  }

  // ----- TODAY & THIS WEEK -----
  if (jobs.length) {
    var jrows = jobs.map(function (j) {
      var money = 'Deposit ' + (j.deposit ? '✔' : '—') + ' · Invoiced ' + (j.invoiced ? '✔' : '—') + ' · Paid ' + (j.paid ? '✔' : '—');
      return '<div style="padding:8px 0;border-bottom:1px solid #eee;"><div style="font-weight:bold;">' + EV_esc_(j.customer) + ' <span style="font-weight:normal;color:#555;">— ' + EV_esc_(j.status) + '</span></div><div style="font-size:13px;color:#444;">' + EV_esc_(j.week) + ' · ' + EV_esc_(j.date) + ' · ' + EV_esc_(j.address) + ' · ' + EV_esc_(j.quote) + '</div><div style="font-size:12px;color:#666;">' + money + '</div></div>';
    }).join('');
    H.push(EV_card_('📅 TODAY &amp; THIS WEEK', jrows));
  }

  // ----- NEEDS FOLLOW-THROUGH -----
  var ft = [];
  actions.forEach(function (a) {
    var od = EV_isPast_(a.dueDate);
    ft.push('<li style="margin:3px 0;">' + (od ? '<b style="color:#b3261e;">OVERDUE</b> · ' : '') + EV_esc_(a.alert) + ' <span style="color:#666;">(' + EV_esc_(a.owner) + ', due ' + EV_esc_(a.due) + ')</span></li>');
  });
  quotes.forEach(function (q) {
    if (/sent/i.test(q.status) && q.dateObj) {
      var days = EV_daysBetween_(q.dateObj, EV_now_());
      if (days >= 3) ft.push('<li style="margin:3px 0;">Quote ' + EV_esc_(q.no) + ' to ' + EV_esc_(q.client) + ' sent ' + days + ' days ago, no reply yet — nudge them.</li>');
    }
  });
  leads.forEach(function (l) {
    if (EV_isPast_(l.nextDateObj)) ft.push('<li style="margin:3px 0;">Lead ' + EV_esc_(l.lead) + ': next action "' + EV_esc_(l.nextAction) + '" was due ' + EV_esc_(l.nextDate) + '.</li>');
  });
  if (ft.length) H.push(EV_card_('🪝 NEEDS FOLLOW-THROUGH', '<ul style="margin:0;padding-left:18px;font-size:14px;">' + ft.join('') + '</ul>'));

  // ----- QUOTES OUT -----
  if (quotes.length) {
    var qrows = quotes.map(function (q) {
      var exp = q.validDate ? EV_daysBetween_(EV_now_(), q.validDate) : null;
      return '<li style="margin:3px 0;">' + EV_esc_(q.no) + ' · ' + EV_esc_(q.client) + ' · ' + EV_esc_(q.total) + ' · ' + EV_esc_(q.sqft) + ' sq ft · ' + EV_esc_(q.status) + (exp != null ? ' · expires in ' + exp + 'd' : '') + '</li>';
    }).join('');
    H.push(EV_card_('🧾 QUOTES OUT', '<ul style="margin:0;padding-left:18px;font-size:14px;">' + qrows + '</ul>'));
  }

  // ----- PRIORITIES -----
  if (todos.length) {
    var order = { high: 0, medium: 1, low: 2 };
    var sorted = todos.slice().sort(function (a, b) { return (order[a.priority.toLowerCase()] || 1) - (order[b.priority.toLowerCase()] || 1); });
    var prows = sorted.slice(0, 5).map(function (t) {
      return '<li style="margin:3px 0;"><b>[' + EV_esc_(t.priority || '—') + ']</b> ' + EV_esc_(t.task) + ' <span style="color:#666;">(' + EV_esc_(t.category) + ')</span></li>';
    }).join('');
    H.push(EV_card_('⭐ TOP PRIORITIES', '<ul style="margin:0;padding-left:18px;font-size:14px;">' + prows + '</ul>'));
  }

  H.push('<div style="font-size:12px;color:#667;background:#f4f7f5;border-radius:8px;padding:10px 12px;margin-top:14px;">Reply to this email with anything to add, change, or mark done — it gets logged to the workbook automatically within the hour. Sent server-side by Evolve Autopilot; it goes out whether or not any computer is on.</div>');
  H.push('</div></div>');
  return H.join('');
}

function EV_card_(title, inner, bg, accent) {
  bg = bg || '#ffffff'; accent = accent || '#0b3d2e';
  return '<div style="margin:12px 0;border-left:4px solid ' + accent + ';background:' + bg + ';border-radius:6px;padding:10px 14px;">' +
    '<div style="font-size:13px;font-weight:bold;color:' + accent + ';margin-bottom:6px;letter-spacing:.4px;">' + title + '</div>' + inner + '</div>';
}

// ---------------------------------------------------------------------------
//  DISPATCH SWEEP  (audit + heartbeat + stuck-item email; send-only scope)
// ---------------------------------------------------------------------------
function EV_dispatchSweep() {
  try { EV_fileInbox_(); } catch(_e){} // hook: server-side inbox filing (added 2026-06-13, Claude)
  try { EV_generateInsights(); } catch(_ei){} // hook: refresh business-brain insights
  try {
    var findings = EV_sweepFindings_();
    var when = EV_fmt_(EV_now_(), 'HH:mm');
    appLog_('Autopilot', 'Dispatch sweep ' + when + ' — heartbeat; ' + findings.length + ' item(s) needing attention');
    if (findings.length) {
      var html = '<div style="font-family:Arial,sans-serif;max-width:640px;color:#111;">' +
        '<div style="font-size:16px;font-weight:bold;color:#b3261e;">Evolve — items that need a human (' + EV_fmt_(EV_now_(), 'MMM d, HH:mm') + ')</div>' +
        '<ul style="font-size:14px;padding-left:18px;">' + findings.map(function (f) { return '<li style="margin:4px 0;">' + f + '</li>'; }).join('') + '</ul>' +
        '<div style="font-size:12px;color:#667;">Server-side audit (runs 7 AM, 1 PM, 7 PM whether the PC is on or off). Reply to add or resolve items.</div></div>';
      EV_send_(EV.TODD, 'Evolve sweep — ' + findings.length + ' item(s) need attention', html, { cc: EV.MATT });
    }
    return findings.length + ' findings';
  } catch (err) {
    EV_failNotify_('EV_dispatchSweep', err);
    throw err;
  }
}

/** The money-loop + escalation checks from the playbook. Read-only; returns strings. */
function EV_sweepFindings_() {
  var out = [];
  var jobs = EV_dispatchJobs_(), quotes = EV_quotes_(), actions = EV_actionItems_(),
      leads = EV_leads_(), inbox = EV_inboxOpen_();

  // Money loop (Dispatch K/L/M)
  jobs.forEach(function (j) {
    if (j.deposit && (!j.date || /tbd/i.test(j.date))) out.push('Deposit received for ' + EV_esc_(j.customer) + ' but no booked date on Dispatch — schedule it.');
    if (/complete/i.test(j.status) && !j.invoiced) out.push('Job ' + EV_esc_(j.customer) + ' is Complete but not invoiced — send the invoice.');
    if (j.invoiced && !j.paid) out.push('Invoice out for ' + EV_esc_(j.customer) + ' but not marked Paid — confirm payment.');
  });
  // Stuck inbox (escalation clocks: NEW > 6h, NEEDS REVIEW > 24h)
  inbox.forEach(function (x) {
    if (x.status === 'NEW' && x.ageH != null && x.ageH >= 6) out.push('Field submission NEW for ' + x.ageH + 'h: ' + EV_esc_(x.summary) + ' (' + EV_esc_(x.id) + ').');
    if (x.status === 'NEEDS REVIEW' && x.ageH != null && x.ageH >= 24) out.push('Field submission NEEDS REVIEW for ' + x.ageH + 'h: ' + EV_esc_(x.summary) + '.');
  });
  // Overdue action items
  actions.forEach(function (a) { if (EV_isPast_(a.dueDate)) out.push('Action item OVERDUE: ' + EV_esc_(a.alert) + ' (' + EV_esc_(a.owner) + ', due ' + EV_esc_(a.due) + ').'); });
  // Quote / lead clocks
  quotes.forEach(function (q) {
    if (q.validDate) { var dleft = EV_daysBetween_(EV_now_(), q.validDate); if (dleft >= 0 && dleft <= 7) out.push('Quote ' + EV_esc_(q.no) + ' (' + EV_esc_(q.client) + ') expires in ' + dleft + ' day(s).'); }
    if (/sent/i.test(q.status) && q.dateObj && EV_daysBetween_(q.dateObj, EV_now_()) >= 7) out.push('Quote ' + EV_esc_(q.no) + ' (' + EV_esc_(q.client) + ') unanswered 7+ days.');
  });
  leads.forEach(function (l) { if (EV_isPast_(l.nextDateObj)) out.push('Lead ' + EV_esc_(l.lead) + ' has a past-due next action (' + EV_esc_(l.nextDate) + ').'); });
  return out;
}

// ---------------------------------------------------------------------------
//  EMAIL REPLY MONITOR  (needs Gmail scope — install via EV_installGmail)
//    Reads replies to the digests / quotes, logs new items to To-Do, and
//    sends a confirmation. Dedupes with the Evolve/Logged label.
// ---------------------------------------------------------------------------
function EV_replyMonitor() {
  /*__evGuard*/ try{GmailApp.getInboxUnreadCount();}catch(__ng){try{appLog_('Trigger','EV_replyMonitor skipped: Gmail scope not authorized yet — no FAILED alert sent (pending one-time consent).');}catch(_l){}return;}
  try {
    var label = EV_getLabel_(EV.LABEL);
    var queries = [
      'subject:"Evolve Morning Digest" -label:"' + EV.LABEL + '" newer_than:7d',
      'subject:"The Daily Digest" -label:"' + EV.LABEL + '" newer_than:7d',
      'subject:"Evolve sweep" -label:"' + EV.LABEL + '" newer_than:7d',
      'subject:"New quote ECO-Q" -label:"' + EV.LABEL + '" newer_than:14d'
    ];
    var processed = 0, logged = 0;
    queries.forEach(function (q) {
      var threads = GmailApp.search(q, 0, 25);
      threads.forEach(function (th) {
        var msgs = th.getMessages();
        var newItems = [];
        msgs.forEach(function (m) {
          var from = m.getFrom();
          if (/manager@yourcompany\.com/i.test(from)) return;        // skip our own outbound
          if (m.isInChats && m.isInChats()) return;
          var items = EV_extractItems_(m.getPlainBody());
          items.forEach(function (it) { newItems.push({ text: it, from: from }); });
        });
        if (newItems.length) {
          newItems.forEach(function (n) { if (EV_addToDo_(n.text, n.from)) logged++; });
          try {
            th.reply('Logged to the Evolve workbook:\n\n' + newItems.map(function (n) { return '• ' + n.text; }).join('\n') +
              '\n\nThese are now in the To-Do tab and will surface in tomorrow\'s digest. — Evolve Autopilot');
          } catch (e) {}
        }
        th.addLabel(label);
        try { th.markRead(); } catch (e) {}
        processed++;
      });
    });
    appLog_('Autopilot', 'Reply monitor — heartbeat; processed ' + processed + ' thread(s), logged ' + logged + ' item(s)');
    return 'processed ' + processed + ', logged ' + logged;
  } catch (err) {
    EV_failNotify_('EV_replyMonitor', err);
    throw err;
  }
}

/** Pull candidate action items from a reply body: real lines, not quoted history. */
function EV_extractItems_(body) {
  if (!body) return [];
  var lines = body.split(/\r?\n/), out = [];
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].trim();
    if (!ln) continue;
    if (/^>/.test(ln)) break;                       // quoted history begins
    if (/^On .* wrote:$/i.test(ln)) break;
    if (/^(from|sent|to|subject|cc):/i.test(ln)) continue;
    if (/^[-–—]{2,}/.test(ln)) continue;
    if (ln.length < 3) continue;
    ln = ln.replace(/^[•\-\*\d\.\)\s]+/, '').trim();  // strip bullet/number prefix
    if (ln) out.push(ln);
    if (out.length >= 12) break;
  }
  return out;
}

/** Append a task to the bottom of the To-Do tab (appendRow never shifts/breaks structure). */
function EV_addToDo_(text, from) {
  try {
    var sh = EV_sheet_(EV.SHEETS.todo);
    if (!sh) return false;
    var nums = EV_todoItems_().map(function (t) { return +t.num; });
    var next = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
    var who = (from || '').replace(/.*</, '').replace(/>.*/, '') || from;
    sh.appendRow([String(next), text, 'Inbox / Reply', 'Medium', 'To Do', EV_fmt_(EV_now_(), 'MM/dd/yyyy'), '', 'Added automatically from an email reply (' + who + ')']);
    appLog_('Autopilot', 'To-Do +1 from reply: ' + text.slice(0, 80));
    return true;
  } catch (e) { return false; }
}

function EV_getLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

// ---------------------------------------------------------------------------
//  6 AM PERSONAL "THE DAILY DIGEST"  (needs Gmail scope)
//    Rebuilds the household list from the most recent digest + replies, then
//    sends a fresh, funny one. Best-effort parse; never throws.
// ---------------------------------------------------------------------------
var EV_DD_TAGLINES = [
  'Two men, one broken front door, a haunted well, and a list.',
  'The dead trees are still plotting. Stay vigilant.',
  'The kid is restoring the RV; the raccoons are unionizing.',
  'Coffee, chaos, and a to-do list that refuses to die.',
  'The front door remains a suggestion, not a barrier.'
];

function EV_personalDigest() {
  try {
    var threads = GmailApp.search('subject:"The Daily Digest"', 0, 8);
    var master = [];
    var victory = [];
    // newest digest body = current master list
    if (threads.length) {
      var newest = threads[0];
      var dmsgs = newest.getMessages();
      // master from the most recent message we (the owner) sent
      for (var i = dmsgs.length - 1; i >= 0; i--) {
        if (/manager@yourcompany\.com/i.test(dmsgs[i].getFrom())) { master = EV_listFromHtml_(dmsgs[i].getBody()); break; }
      }
      // replies newer than that -> add / complete
      threads.forEach(function (th) {
        th.getMessages().forEach(function (m) {
          if (/manager@yourcompany\.com/i.test(m.getFrom())) return;
          EV_extractItems_(m.getPlainBody()).forEach(function (it) {
            var doneMatch = it.match(/^(done|finished|completed|complete)[:\s-]+(.*)$/i);
            if (doneMatch) { victory.push(doneMatch[2]); master = master.filter(function (x) { return x.toLowerCase().indexOf(doneMatch[2].toLowerCase().slice(0, 12)) === -1; }); }
            else if (master.indexOf(it) === -1) master.push(it);
          });
        });
      });
    }
    var tag = EV_DD_TAGLINES[(new Date().getDate()) % EV_DD_TAGLINES.length];
    var html = '<div style="font-family:Arial,sans-serif;max-width:640px;color:#111;">' +
      '<div style="background:#7a4a00;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-size:19px;font-weight:bold;">☀️ THE DAILY DIGEST</div>' +
      '<div style="border:1px solid #e7ddc9;border-top:0;padding:16px 18px;border-radius:0 0 10px 10px;">' +
      '<div style="color:#7a4a00;font-size:13px;margin-bottom:10px;">' + EV_esc_(EV_todayStr_()) + ' · ' + EV_esc_(tag) + '</div>';
    if (master.length) html += '<div style="font-weight:bold;margin:6px 0;">📋 THE LIST (' + master.length + ')</div><ul style="font-size:14px;padding-left:18px;">' + master.map(function (x) { return '<li style="margin:3px 0;">' + EV_esc_(x) + '</li>'; }).join('') + '</ul>';
    else html += '<p>The list is mysteriously empty. Either you finished everything, or the raccoons ate it. Reply with items to rebuild it.</p>';
    if (victory.length) html += '<div style="font-weight:bold;margin:10px 0 4px;">✅ VICTORY LAP</div><ul style="font-size:14px;padding-left:18px;color:#1a7f37;">' + victory.map(function (x) { return '<li>' + EV_esc_(x) + '</li>'; }).join('') + '</ul>';
    html += '<div style="font-size:12px;color:#667;background:#faf6ee;border-radius:8px;padding:10px 12px;margin-top:12px;">Reply with new items from any account, and they land on tomorrow\'s list automatically. Say "done &lt;thing&gt;" to retire it. Sent server-side; it goes out whether or not the computer is on.</div></div></div>';
    EV_send_(EV.DIGEST_TO, 'The Daily Digest — ' + EV_fmt_(EV_now_(), 'EEEE, MMMM d'), html);
    appLog_('Autopilot', 'PERSONAL DAILY DIGEST sent server-side — heartbeat (' + master.length + ' items)');
    return 'sent ' + master.length + ' items';
  } catch (err) {
    EV_failNotify_('EV_personalDigest', err);
    throw err;
  }
}

/** Extract <li> text (or bulleted lines) from an HTML email body. */
function EV_listFromHtml_(html) {
  if (!html) return [];
  var out = [], m, re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  while ((m = re.exec(html)) !== null) {
    var t = m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (t && t.length > 2 && out.indexOf(t) === -1) out.push(t);
  }
  return out.slice(0, 80);
}

// ---------------------------------------------------------------------------
//  FAILURE NOTIFY  (so a silent failure becomes visible)
// ---------------------------------------------------------------------------
function EV_failNotify_(fn, err) {
  try { appLog_('Autopilot', 'ERROR in ' + fn + ': ' + (err && err.message ? err.message : err)); } catch (e) {}
  if(/authoriz/i.test(String((err&&err.message)||err)))return; try { MailApp.sendEmail(EV.MATT, 'Evolve Autopilot FAILED: ' + fn, String(err && err.stack ? err.stack : err)); } catch (e) {}
}

// ===========================================================================
//  TRIGGER INSTALLERS  (idempotent — safe to re-run)
// ===========================================================================
function EV_deleteTriggers_(names) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (names.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
}

/** Core triggers — work with the EXISTING scopes (no Gmail). Run this first. */
function EV_installCore() {
  ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction().indexOf("EV_")!==0)ScriptApp.deleteTrigger(t);});
  EV_deleteTriggers_(['EV_morningDigest', 'EV_dispatchSweep']);
  ScriptApp.newTrigger('EV_morningDigest').timeBased().atHour(7).nearMinute(45).everyDays(1).create();
  ScriptApp.newTrigger('EV_dispatchSweep').timeBased().atHour(7).nearMinute(5).everyDays(1).create();
  ScriptApp.newTrigger('EV_dispatchSweep').timeBased().atHour(13).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('EV_dispatchSweep').timeBased().atHour(19).nearMinute(0).everyDays(1).create();
  appLog_('Autopilot', 'Installed CORE triggers: morning digest 7:45, dispatch sweep 7/13/19.');
  return EV_listTriggers();
}

/** Gmail triggers — run AFTER adding the Gmail scope to appsscript.json. */
function EV_installGmail() {
  EV_deleteTriggers_(['EV_replyMonitor', 'EV_personalDigest']);
  ScriptApp.newTrigger('EV_replyMonitor').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('EV_personalDigest').timeBased().atHour(6).nearMinute(0).everyDays(1).create();
  appLog_('Autopilot', 'Installed GMAIL triggers: reply monitor hourly, personal digest 6 AM.');
  return EV_listTriggers();
}

function EV_listTriggers() {
  var out = ScriptApp.getProjectTriggers().map(function (t) {
    return t.getHandlerFunction() + ' [' + t.getEventType() + ']';
  });
  Logger.log('Triggers (' + out.length + '): ' + out.join(' | '));
  return out;
}

// ===========================================================================
//  PROOF OF AUTONOMY
//    EV_scheduleProof() installs a ONE-TIME trigger ~3 minutes out that fires
//    EV_proofRun without any human or PC involved. EV_proofRun sends a clearly
//    marked digest, writes a unique App Log line, then deletes its own trigger.
// ===========================================================================
function EV_scheduleProof() {
  EV_deleteTriggers_(['EV_proofRun']);
  var when = new Date(EV_now_().getTime() + 3 * 60 * 1000);
  ScriptApp.newTrigger('EV_proofRun').timeBased().at(when).create();
  var msg = 'PROOF trigger scheduled for ' + EV_fmt_(when, 'HH:mm:ss') + ' (fires with no PC, no app).';
  Logger.log(msg);
  appLog_('Autopilot', msg);
  return msg;
}

function EV_proofRun() {
  EV_deleteTriggers_(['EV_proofRun']); // one-shot cleanup
  var stamp = EV_fmt_(EV_now_(), 'yyyy-MM-dd HH:mm:ss');
  var html = EV_buildMorningDigestHtml_();
  html = '<div style="background:#1a7f37;color:#fff;padding:8px 12px;font-family:Arial;border-radius:6px;margin-bottom:8px;">' +
    'AUTONOMY PROOF — fired by an Apps Script time trigger on Google\'s servers at ' + stamp +
    ' (America/Edmonton). No PC, no Claude app involved.</div>' + html;
  EV_send_(EV.DIGEST_TO, 'Evolve Autopilot — autonomy proof ' + stamp, html);
  appLog_('Autopilot', 'PROOF RUN executed server-side at ' + stamp + ' — heartbeat');
  return 'proof sent ' + stamp;
}

// ===========================================================================
//  DIAGNOSTIC — run once to confirm parsing against live data
// ===========================================================================
function EV_diag() {
  var o = {
    today: EV_todayStr_(),
    dispatchJobs: EV_dispatchJobs_().length,
    quotes: EV_quotes_().map(function (q) { return q.no + '/' + q.status; }),
    openActionItems: EV_actionItems_().map(function (a) { return a.alert + ' (due ' + a.due + ', past=' + EV_isPast_(a.dueDate) + ')'; }),
    leadsPastDue: EV_leads_().filter(function (l) { return EV_isPast_(l.nextDateObj); }).map(function (l) { return l.lead; }),
    todoTop5: EV_todoItems_().slice(0, 5).map(function (t) { return t.priority + ':' + t.task; }),
    inboxOpen: EV_inboxOpen_().length,
    weatherDays: (EV_weather_() || []).length,
    sweepFindings: EV_sweepFindings_()
  };
  Logger.log(JSON.stringify(o, null, 2));
  return o;
}


function EV_purgeForeign(){var k=0;ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction().indexOf("EV_")!==0){ScriptApp.deleteTrigger(t);k++;}});Logger.log("purged "+k+" foreign triggers");return EV_listTriggers();}


/* ===================== SERVER-SIDE INBOX FILER (added 2026-06-13, Claude) =====================
   Restores autonomous filing of App Inbox NEW rows that previously depended on an external
   desktop schedule. Append-only; never deletes. Expense/Receipt -> Expenses (full mapping).
   Any other category -> NEEDS REVIEW (surfaced by the sweep) so nothing is mis-filed.
   Manual run: EV_fileInboxNow().  Install hourly schedule: EV_installFiler().
   ============================================================================================ */
var EV_FILER_SS_ID = 'YOUR_SPREADSHEET_ID';

function EV_fileInboxNow(){ return EV_fileInbox_(); }

function EV_installFiler(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction()==='EV_fileInbox_'){ ScriptApp.deleteTrigger(t); }
  });
  ScriptApp.newTrigger('EV_fileInbox_').timeBased().everyHours(1).create();
  return 'EV_fileInbox_ hourly trigger installed';
}

function EV_fmtNow_(){ return Utilities.formatDate(new Date(),'America/Edmonton','dd/MM/yyyy HH:mm:ss'); }

function EV_sheetEndingWith_(book, suffix){
  var sh=book.getSheets();
  for(var i=0;i<sh.length;i++){ if(String(sh[i].getName()).toLowerCase().indexOf(suffix.toLowerCase())>=0) return sh[i]; }
  return null;
}

function EV_colIndex_(header, name){
  for(var c=0;c<header.length;c++){ if(String(header[c]).toLowerCase().indexOf(name.toLowerCase())>=0) return c; }
  return -1;
}

function EV_findAmount_(details){
  var keys=Object.keys(details||{});
  for(var i=0;i<keys.length;i++){
    if(/amount|total|cost|price|spent|paid|sum/i.test(keys[i])){
      var n=parseFloat(String(details[keys[i]]).replace(/[^0-9.-]/g,''));
      if(!isNaN(n)) return n;
    }
  }
  return '';
}

function EV_routeCategory_(cat, details){
  var c=String(cat||'').toLowerCase();
  if(/expense|receipt/.test(c)) return 'Expenses';
  var blob=JSON.stringify(details||{}).toLowerCase();
  if(/"amount"|"total"|"vendor"|"cost"|"receipt"/.test(blob) && /expense|receipt|purchase|capture/.test(c)) return 'Expenses';
  return 'REVIEW';
}

function EV_fileExpense_(book, irow, ih, details, photo, sub){
  if (GEMINI_API_KEY && photo && (!details.vendor || !details.total)) { try { var _o=EV_ocrReceipt_(photo); if(_o){ details.vendor=details.vendor||_o.vendor; details.total=details.total||_o.total; details.category=details.category||_o.category; details.what=details.what||_o.items; } } catch(_x){} } // OCR pre-fill (gated)
  var exp=EV_sheetEndingWith_(book,'Expenses');
  var lastCol=exp.getLastColumn();
  var scanN=Math.min(20, exp.getMaxRows());
  var scan=exp.getRange(1,1,scanN,lastCol).getValues();
  var hr=-1, eh=null;
  for(var r=0;r<scan.length;r++){
    var low=scan[r].map(function(x){return String(x).toLowerCase();});
    if(low.indexOf('date')>=0 && low.join('|').indexOf('vendor')>=0){ hr=r+1; eh=scan[r]; break; }
  }
  if(hr<0){ hr=1; eh=scan[0]; }
  function gi(n){ return EV_colIndex_(eh,n); }
  var totalCol=gi('Total');
  var footer=-1;
  for(var r2=hr+1; r2<=Math.min(exp.getMaxRows(), hr+600); r2++){
    var f = totalCol>=0 ? exp.getRange(r2, totalCol+1).getFormula() : '';
    var c0 = String(exp.getRange(r2,1,1,Math.min(3,lastCol)).getValues()[0].join(' ')).toLowerCase();
    if((f && f.charAt(0)==='=') || c0.indexOf('log invoices')>=0 || c0.indexOf('top rows')>=0){ footer=r2; break; }
  }
  if(footer<0) footer=exp.getLastRow()+1;
  var target=-1;
  for(var r3=hr+1; r3<footer; r3++){
    var vals=exp.getRange(r3,1,1,lastCol).getValues()[0];
    var forms=exp.getRange(r3,1,1,lastCol).getFormulas()[0];
    var blank=true;
    for(var c=0;c<lastCol;c++){ if(String(vals[c]).trim()!=='' || String(forms[c]).trim()!==''){ blank=false; break; } }
    if(blank){ target=r3; break; }
  }
  if(target<0){ exp.insertRowBefore(footer); target=footer; }
  var rowArr=new Array(lastCol).fill('');
  function put(name,val){ var k=gi(name); if(k>=0) rowArr[k]=val; }
  var by=irow[EV_colIndex_(ih,'Captured')];
  var summary=irow[EV_colIndex_(ih,'Summary')];
  put('Date', EV_toDate_(irow[0]));
  put('Purchased by', by);
  put('What was purchased', details.item||details.what||details.purchased||summary||'');
  put('Vendor', details.vendor||details.where||details.store||'');
  put('Why', details.job||details.reference||details.why||details.notes||'');
  put('Category', details.category||details.about||'Field App');
  put('Qty', details.qty||details.quantity||'');
  put('Unit cost', details.unit||details.unitCost||'');
  put('Total', EV_findAmount_(details));
  put('Description', String(summary||'')+' | SubID:'+sub+(photo?(' | Photo:'+photo):'')+' | auto-filed '+EV_fmtNow_());
  exp.getRange(target,1,1,lastCol).setValues([rowArr]);
  return exp.getName()+'!row'+target;
}
function EV_fileInbox_(){
  var EV_FILER_LOCK_ = LockService.getScriptLock();
  if (!EV_FILER_LOCK_.tryLock(3000)) { return JSON.stringify({skipped:"locked"}); }
  try {
  var book=SpreadsheetApp.openById(EV_FILER_SS_ID);
  var inbox=EV_sheetEndingWith_(book,'App Inbox');
  if(!inbox) return 'no inbox sheet';
  var data=inbox.getDataRange().getValues();
  var ih=data[0];
  var cStatus=EV_colIndex_(ih,'Status'),
      cFiled=EV_colIndex_(ih,'Filed To'),
      cNotes=EV_colIndex_(ih,'Claude Notes'),
      cCat=EV_colIndex_(ih,'Category'),
      cDet=EV_colIndex_(ih,'Details'),
      cPhoto=EV_colIndex_(ih,'Photo'),
      cSub=EV_colIndex_(ih,'Submission');
  var filed=0, review=0, notes=[];
  for(var r=1;r<data.length;r++){
    var stt=String(data[r][cStatus]||'').trim().toUpperCase();
    if(stt!=='NEW') continue;
    var cat=String(data[r][cCat]||'');
    var sub=String(data[r][cSub]||'');
    var det={}; try{ det=JSON.parse(data[r][cDet]||'{}'); }catch(e){ det={}; }
    var photo=String(data[r][cPhoto]||'');
    var route=EV_routeCategory_(cat,det);
    try{
      if(route==='Expenses'){
        var ref=EV_fileExpense_(book,data[r],ih,det,photo,sub);
        inbox.getRange(r+1,cStatus+1).setValue('FILED');
        inbox.getRange(r+1,cFiled+1).setValue(ref);
        if(cNotes>=0) inbox.getRange(r+1,cNotes+1).setValue('Auto-filed to '+ref+' '+EV_fmtNow_());
        filed++; notes.push(sub+'->'+ref);
      } else {
        inbox.getRange(r+1,cStatus+1).setValue('NEEDS REVIEW');
        if(cNotes>=0) inbox.getRange(r+1,cNotes+1).setValue('Auto-filer: category "'+cat+'" needs routing '+EV_fmtNow_());
        review++; notes.push(sub+'->REVIEW');
      }
    }catch(err){
      if(cNotes>=0) inbox.getRange(r+1,cNotes+1).setValue('Auto-filer error: '+err);
      notes.push(sub+'->ERR:'+err);
    }
  }
  if(filed||review){ try{ appLog_('Autopilot','Inbox filer ran: '+filed+' filed, '+review+' needs-review ['+notes.join('; ').slice(0,250)+']'); }catch(e){} }
  return JSON.stringify({filed:filed, review:review, notes:notes});

  } finally { try { EV_FILER_LOCK_.releaseLock(); } catch(e){} }
}

function EV_toDate_(v){
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  var s = String(v||"").trim();
  var parts = s.split(" ");
  var dmy = (parts[0]||"").split("/");
  if (dmy.length === 3 && dmy[2].length === 4) {
    var hms = (parts[1]||"0:0:0").split(":");
    return new Date(Number(dmy[2]), Number(dmy[1])-1, Number(dmy[0]), Number(hms[0]||0), Number(hms[1]||0), Number(hms[2]||0));
  }
  var d = new Date(s);
  return isNaN(d.getTime()) ? new Date() : d;
}


/* ===================== EVOLVE BUSINESS BRAIN (added 2026-06-15, Claude) =====================
   Deterministic spend-intelligence + important/not-important rating + self-improving feedback.
   Insights appear in the auto-created "Insights" tab; rate each via the Importance dropdown and
   the engine learns which types to surface. AI layers (receipt OCR + narrative) are GATED behind
   GEMINI_API_KEY (paste a key from aistudio.google.com to enable; dormant/safe until then).
   ============================================================================================ */
var GEMINI_API_KEY = "";
var GEMINI_MODEL   = "gemini-2.0-flash";
var BRAIN_TZ       = "America/Edmonton";

function EV_ensureSheet_(book, name, headers){
  var sh=null, all=book.getSheets();
  for(var i=0;i<all.length;i++){ if(all[i].getName()===name){ sh=all[i]; break; } }
  if(!sh){ sh=book.insertSheet(name); }
  var w=headers.length;
  var first=sh.getRange(1,1,1,w).getValues()[0];
  if(first.join("")===""){ sh.getRange(1,1,1,w).setValues([headers]); sh.setFrozenRows(1); sh.getRange(1,1,1,w).setFontWeight("bold").setBackground("#13301c").setFontColor("#9ef0b0"); }
  return sh;
}

function EV_setupBrain(){
  var book=SpreadsheetApp.openById(EV_FILER_SS_ID);
  var ins=EV_ensureSheet_(book,"Insights",["ID","Date","Type","Title","Detail","Score","Importance","AI / notes"]);
  try{ var rule=SpreadsheetApp.newDataValidation().requireValueInList(["New","Important","Not important","Done"],true).setAllowInvalid(true).build(); ins.getRange(2,7,Math.max(1,ins.getMaxRows()-1),1).setDataValidation(rule); }catch(e){}
  EV_ensureSheet_(book,"Feedback",["When","Insight ID","Type","Rating","Title"]);
  EV_ensureSheet_(book,"Vendors",["Vendor (raw)","Canonical","Category","First seen","Total spend"]);
  return "brain tabs ready";
}

function EV_money_(n){ n=Math.round(Number(n)*100)/100; return "$"+n.toLocaleString(); }

function EV_brainExpenses_(book){
  var exp=EV_sheetEndingWith_(book,"Expenses"); if(!exp) return [];
  var data=exp.getDataRange().getValues(); var hr=-1,h=null;
  for(var r=0;r<Math.min(20,data.length);r++){ var low=data[r].map(function(x){return String(x).toLowerCase();}); if(low.indexOf("date")>=0 && low.join("|").indexOf("vendor")>=0){ hr=r; h=data[r]; break; } }
  if(hr<0) return [];
  function ci(n){ for(var c=0;c<h.length;c++){ if(String(h[c]).toLowerCase().indexOf(n.toLowerCase())>=0) return c; } return -1; }
  var cD=ci("Date"),cV=ci("Vendor"),cC=ci("Category"),cT=ci("Total"),cN=ci("Description"),cW=ci("What");
  var out=[];
  for(var r2=hr+1;r2<data.length;r2++){
    var row=data[r2]; var notes=String(row[cN]||"").toLowerCase(); var vendor=String(row[cV]||"").trim();
    if(notes.indexOf("seed row")>=0||notes.indexOf("baseline market")>=0||notes.indexOf("auto from price log")>=0) continue;
    if(vendor.toLowerCase().indexOf("test")>=0) continue;
    if(!vendor) continue; // skip footer/total + blank rows
    var amt=Number(row[cT]); if(isNaN(amt)||amt===0) continue;
    var dt=row[cD]; if(!(dt instanceof Date)){ try{ dt=EV_toDate_(dt); }catch(e){ dt=null; } }
    out.push({date:dt,vendor:vendor,category:String(row[cC]||"Uncategorized").trim(),amount:amt,what:String(row[cW]||"")});
  }
  return out;
}

function EV_brainWeights_(book){
  var fb=EV_sheetEndingWith_(book,"Feedback"); var w={}; if(!fb) return w;
  var d=fb.getDataRange().getValues();
  for(var r=1;r<d.length;r++){ var type=String(d[r][2]||""); var rating=String(d[r][3]||"").toLowerCase(); if(!type) continue; if(!(type in w)) w[type]=0; if(rating.indexOf("not")>=0) w[type]-=1; else if(rating.indexOf("important")>=0) w[type]+=1; }
  return w;
}

function EV_generateInsights(){
  var book=SpreadsheetApp.openById(EV_FILER_SS_ID); EV_setupBrain();
  var ins=EV_sheetEndingWith_(book,"Insights"); var fb=EV_sheetEndingWith_(book,"Feedback");
  var existing=ins.getDataRange().getValues(); var fbData=fb.getDataRange().getValues(); var logged={};
  for(var i=1;i<fbData.length;i++){ logged[String(fbData[i][1])]=true; }
  var now=new Date();
  for(var r=1;r<existing.length;r++){ var imp=String(existing[r][6]||""); var id=String(existing[r][0]||""); var low=imp.toLowerCase();
    if(id && (low.indexOf("important")>=0||low.indexOf("not")>=0) && low.indexOf("new")<0 && !logged[id]){ fb.appendRow([now,id,String(existing[r][2]||""),imp,String(existing[r][3]||"")]); logged[id]=true; } }
  var rows=EV_brainExpenses_(book); var weights=EV_brainWeights_(book);
  var mNow=now.getMonth(), yNow=now.getFullYear(); var pm=mNow===0?11:mNow-1, py=mNow===0?yNow-1:yNow;
  function inM(d,m,y){ return d&&d.getMonth()===m&&d.getFullYear()===y; }
  var spendThis=0,spendPrev=0,byV={},byC={},largest=null,seen={};
  rows.forEach(function(e){
    if(inM(e.date,mNow,yNow)){ spendThis+=e.amount; byV[e.vendor]=(byV[e.vendor]||0)+e.amount; byC[e.category]=(byC[e.category]||0)+e.amount; if(!largest||e.amount>largest.amount) largest=e; }
    else if(inM(e.date,pm,py)){ spendPrev+=e.amount; }
    if(e.date && (e.date.getFullYear()<yNow||(e.date.getFullYear()===yNow&&e.date.getMonth()<mNow))) seen[e.vendor]=true;
  });
  var cands=[];
  function add(type,title,detail,score){ cands.push({type:type,title:title,detail:detail,score:Math.max(0,Math.min(100,score+(weights[type]||0)*10))}); }
  if(spendThis>0||spendPrev>0){ var pct=spendPrev>0?Math.round((spendThis-spendPrev)/spendPrev*100):0; add("spend_month","Spend this month: "+EV_money_(spendThis),"Vs last month "+EV_money_(spendPrev)+(spendPrev>0?(" ("+(pct>=0?"+":"")+pct+"%)"):""),50+Math.min(40,Math.abs(pct))); }
  var topV=Object.keys(byV).sort(function(a,b){return byV[b]-byV[a];}).slice(0,3);
  if(topV.length){ add("top_vendor","Top vendor: "+topV[0]+" ("+EV_money_(byV[topV[0]])+")","Top: "+topV.map(function(v){return v+" "+EV_money_(byV[v]);}).join(", "),45); }
  var topC=Object.keys(byC).sort(function(a,b){return byC[b]-byC[a];})[0];
  if(topC){ var share=spendThis>0?Math.round(byC[topC]/spendThis*100):0; add("top_category","Biggest category: "+topC+" ("+EV_money_(byC[topC])+")",share+"% of this month spend",40); }
  if(largest){ add("largest","Largest expense: "+EV_money_(largest.amount)+" at "+largest.vendor,String(largest.what||""),45); }
  Object.keys(byV).forEach(function(v){ if(!seen[v]) add("new_vendor","New vendor: "+v,"First purchase "+EV_money_(byV[v])+" - check pricing vs Price Log",55); });
  var inbox=EV_sheetEndingWith_(book,"App Inbox");
  if(inbox){ var idata=inbox.getDataRange().getValues(); var ih=idata[0]; var cs=-1; for(var c=0;c<ih.length;c++){ if(String(ih[c]).toLowerCase().indexOf("status")>=0) cs=c; } var open=0; if(cs>=0){ for(var k=1;k<idata.length;k++){ var st=String(idata[k][cs]||"").toUpperCase(); if(st==="NEW"||st.indexOf("REVIEW")>=0) open++; } } if(open>0) add("backlog","Inbox backlog: "+open+" item(s) awaiting filing/review","Open App Inbox rows not yet filed",30+Math.min(40,open*5)); }
  var aiNote=""; if(GEMINI_API_KEY){ try{ aiNote=EV_geminiNarrative_(cands.map(function(c){return c.title+" - "+c.detail;}).join("\n")); }catch(e){} }
  var all=ins.getDataRange().getValues();
  for(var r3=all.length;r3>=2;r3--){ if(String(all[r3-1][6]||"").trim()==="New"){ ins.deleteRow(r3); } }
  cands.sort(function(a,b){return b.score-a.score;});
  var stamp=Utilities.formatDate(now,BRAIN_TZ,"yyyy-MM-dd HH:mm"); var idn=Utilities.formatDate(now,BRAIN_TZ,"yyMMddHHmm");
  cands.forEach(function(c,i){ ins.appendRow(["INS-"+idn+"-"+(i+1),stamp,c.type,c.title,c.detail,c.score,"New",(i===0&&aiNote)?aiNote:""]); });
  try{ appLog_("Brain","Insights refreshed: "+cands.length+" insight(s)"+(GEMINI_API_KEY?" +AI":"")); }catch(e){}
  return JSON.stringify({count:cands.length, insights:cands});
}

function apiInsights(token){
  try{ if(!checkToken_(token)) return {ok:false,error:"Session expired"}; }catch(e){ return {ok:false,error:"Session expired"}; }
  try{ var res=JSON.parse(EV_generateInsights()); return {ok:true,count:res.count,insights:res.insights}; }catch(err){ return {ok:false,error:String(err)}; }
}

function apiInsightFeedback(token, id, label){
  try{ if(!checkToken_(token)) return {ok:false,error:"Session expired"}; }catch(e){ return {ok:false,error:"Session expired"}; }
  try{ var book=SpreadsheetApp.openById(EV_FILER_SS_ID); var ins=EV_sheetEndingWith_(book,"Insights"); var d=ins.getDataRange().getValues();
    for(var r=1;r<d.length;r++){ if(String(d[r][0])===String(id)){ ins.getRange(r+1,7).setValue(label); break; } }
    EV_generateInsights(); return {ok:true};
  }catch(err){ return {ok:false,error:String(err)}; }
}

function EV_geminiNarrative_(text){
  if(!GEMINI_API_KEY) return "";
  var url="https://generativelanguage.googleapis.com/v1beta/models/"+GEMINI_MODEL+":generateContent?key="+GEMINI_API_KEY;
  var prompt="You are an analyst for a small abrasive-blasting business. From these metrics give 2 short, specific things to watch or act on:\n"+text;
  var payload={contents:[{parts:[{text:prompt}]}]};
  var resp=UrlFetchApp.fetch(url,{method:"post",contentType:"application/json",payload:JSON.stringify(payload),muteHttpExceptions:true});
  try{ var j=JSON.parse(resp.getContentText()); return j.candidates[0].content.parts[0].text; }catch(e){ return ""; }
}

function EV_ocrReceipt_(photoUrl){
  if(!GEMINI_API_KEY||!photoUrl) return null;
  try{ var m=String(photoUrl).match(/[-A-Za-z0-9_]{25,}/); if(!m) return null;
    var blob=DriveApp.getFileById(m[0]).getBlob(); var b64=Utilities.base64Encode(blob.getBytes());
    var url="https://generativelanguage.googleapis.com/v1beta/models/"+GEMINI_MODEL+":generateContent?key="+GEMINI_API_KEY;
    var prompt='Extract this receipt as strict JSON only: {"vendor":"","total":0,"gst":0,"date":"","category":"","items":""}. category one of Media / Materials, Fuel / Diesel, Equipment, Shop supplies, Other.';
    var payload={contents:[{parts:[{text:prompt},{inline_data:{mime_type:blob.getContentType(),data:b64}}]}]};
    var resp=UrlFetchApp.fetch(url,{method:"post",contentType:"application/json",payload:JSON.stringify(payload),muteHttpExceptions:true});
    var j=JSON.parse(resp.getContentText()); var txt=j.candidates[0].content.parts[0].text; var a=txt.indexOf("{"),b=txt.lastIndexOf("}");
    return (a>=0&&b>a)?JSON.parse(txt.slice(a,b+1)):null;
  }catch(e){ return null; }
}
