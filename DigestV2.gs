/* ============================================================================
 *  EVOLVE MORNING DIGEST — v2 builder  (2026-06-22, Claude)
 *  Surgical add-on: the old builder was renamed EV_buildMorningDigestHtml_v1_.
 *  EV_morningDigest()/EV_testDigestToMatt() call EV_buildMorningDigestHtml_(),
 *  which now resolves to the v2 builder below. Reuses ALL existing data
 *  fetchers (EV_dispatchJobs_/EV_quotes_/EV_actionItems_/EV_leads_/...).
 *  Goals: correct dollars, no repetition, dead statuses excluded from active
 *  sections, richer + on-brand (borealis/aurora + neon-green), live numbers.
 * ========================================================================== */

/* ---- money: parse anything ($, commas, bare number, blank) -> clean string ---- */
function EV_money2_(n) {
  var v = (typeof EV_amount_ === 'function') ? EV_amount_(n) : Number(n);
  if (v == null || isNaN(v)) v = Number(n);
  if (v == null || isNaN(v)) return '$0.00';
  var neg = v < 0; v = Math.abs(Math.round(v * 100) / 100);
  var p = v.toFixed(2).split('.');
  p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-$' : '$') + p[0] + '.' + p[1];
}
/* returns '' when there is no real amount (so blanks/garbage don't render) */
function EV_moneyMaybe_(v) {
  var n = (typeof EV_amount_ === 'function') ? EV_amount_(v) : Number(v);
  if (n == null || isNaN(n) || n === 0) return '';
  return EV_money2_(n);
}
function EV_amt_(v) {
  var n = (typeof EV_amount_ === 'function') ? EV_amount_(v) : Number(v);
  return (n == null || isNaN(n)) ? NaN : n;
}

/* ---- status classification (drives exclusion of dead items) ---- */
function EV_isDead_(s) {
  return /\b(cold|dead|closed|lost|declin|reject|cancel|canceled|cancelled|on[\s\-]?hold|hold|stalled|stale|inactive|archiv|dormant|abandon|no[\s\-]*response|out\s*of\s*active|not\s*pursuing|passed|junk|void|written[\s\-]?off|duplicate|superseded)\b/i.test(String(s || ''));
}
function EV_isWon_(s) {
  return /\b(won|booked|approv|accepted|deposit|complete|completed|paid|invoiced|scheduled|in\s*progress)\b/i.test(String(s || ''));
}
/* obvious test/self/system noise that should never reach a "needs a human" list */
function EV_isNoise_(s) {
  var v = String(s || '');
  // system/webhook/test noise
  if (/\b(test|alert_ignore|sync_variant|printful|stripe\s*session|example\.com|action:\s*failed|cs_test|pi_test)\b/i.test(v)) return true;
  // auto-reply / signature / delivery-notice lines that slip the sender guard — unambiguous, won't appear in a genuine instruction
  // (added 2026-07-08 to stop pleasantry/auto-reply lines becoming junk "FEEDBACK" To-Dos)
  if (/(out of office|automatic reply|auto[- ]?reply|this is an automated|do not reply|no[- ]?reply|sent from my |get outlook|unsubscribe|read receipt|delivery status notification|message wasn'?t delivered|undeliverable)/i.test(v)) return true;
  return false;
}
function EV_isSelfQuote_(client) {
  return /evolve\s*eco|^evolve\b/i.test(String(client || ''));
}

/* ---- design tokens (borealis / aurora) ---- */
var EV_UI = {
  ink: '#0c2a22', body: '#16352b', soft: '#5b7268', line: '#e0ebe5',
  green: '#1a7f37', neon: '#15c46b', teal: '#0e8f7e', purple: '#6d5cae',
  amber: '#b26a00', red: '#c0392b', cardbg: '#ffffff', wash: '#f3faf6'
};
var EV_JOKES = [
  'Coffee in, abrasive out. In that order.',
  'The books are balanced; the well is still haunted.',
  'Rust never sleeps — luckily, neither does the server.',
  'Another day, another substrate to profile.',
  'Quotes do not close themselves. Sadly.',
  'Make dust, not excuses.',
  'Today’s forecast: 100% chance of follow-ups.',
  'Blast first, invoice second, brag third.'
];

/* themed card (light body so reused light cards stay cohesive) */
function EV_v2card_(emoji, title, inner, accent) {
  accent = accent || EV_UI.green;
  return '<div style="margin:14px 0;background:' + EV_UI.cardbg + ';border:1px solid ' + EV_UI.line +
    ';border-left:5px solid ' + accent + ';border-radius:10px;padding:14px 16px;box-shadow:0 1px 2px rgba(12,42,34,.04);">' +
    '<div style="font-size:12px;font-weight:bold;color:' + accent + ';letter-spacing:.6px;text-transform:uppercase;margin-bottom:8px;">' +
    emoji + ' ' + title + '</div>' + inner + '</div>';
}
/* a scoreboard stat tile */
function EV_v2tile_(value, label, accent) {
  return '<td style="padding:6px;" width="25%" valign="top"><div style="background:#0e2a22;border:1px solid #1c473a;border-radius:10px;padding:12px 10px;text-align:center;">' +
    '<div style="font-size:22px;font-weight:bold;color:' + (accent || EV_UI.neon) + ';line-height:1.1;">' + value + '</div>' +
    '<div style="font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:#9fc7b6;margin-top:4px;">' + label + '</div></div></td>';
}
function EV_v2pill_(text, bg, fg) {
  return '<span style="display:inline-block;background:' + bg + ';color:' + fg +
    ';font-size:10px;font-weight:bold;letter-spacing:.4px;padding:1px 7px;border-radius:10px;vertical-align:middle;">' + text + '</span>';
}

/* ====================== THE BUILDER (v2) ====================== */
function EV_buildMorningDigestHtml_() {
  var jobs = EV_dispatchJobs_(), quotes = EV_quotes_(), actions = EV_actionItems_(),
      leads = EV_leads_(), todos = EV_todoItems_(), inbox = EV_inboxOpen_(), wx = EV_weather_();
  var now = EV_now_();
  var joke = EV_JOKES[(new Date().getDate()) % EV_JOKES.length];

  // ---------- classify quotes (exclude self/test + dead; split won vs active) ----------
  var realQuotes = quotes.filter(function (q) { return !EV_isSelfQuote_(q.client); });
  var activeQuotes = realQuotes.filter(function (q) { return !EV_isDead_(q.status) && !EV_isWon_(q.status); });
  var wonQuotes = realQuotes.filter(function (q) { return !EV_isDead_(q.status) && EV_isWon_(q.status); });
  var priced = activeQuotes.filter(function (q) { return !isNaN(EV_amt_(q.total)); })
    .map(function (q) { return { q: q, amt: EV_amt_(q.total) }; })
    .sort(function (a, b) { return b.amt - a.amt; });
  var pipeline = priced.reduce(function (s, x) { return s + x.amt; }, 0);

  // ---------- classify jobs (active only, deduped) ----------
  var seenJob = {};
  var activeJobs = jobs.filter(function (j) {
    if (EV_isDead_(j.status) || /paid|complete|closed/i.test(String(j.status))) return false;
    var k = (String(j.customer) + '|' + String(j.quote)).toLowerCase().trim();
    if (seenJob[k]) return false; seenJob[k] = 1; return true;
  });
  var doneJobs = jobs.filter(function (j) { return /paid|complete/i.test(String(j.status)) && !EV_isDead_(j.status); });

  // ---------- overdue / attention ----------
  var overdueActions = actions.filter(function (a) { return EV_isPast_(a.dueDate) && !EV_isDead_(a.alert) && !EV_isNoise_(a.alert); });
  var pastLeads = leads.filter(function (l) { return !EV_isDead_(l.status) && !EV_isWon_(l.status) && EV_isPast_(l.nextDateObj); });
  var overdueCount = overdueActions.length + pastLeads.length;

  // ---------- ONE THING ----------
  var topThing = '';
  if (overdueActions.length) topThing = '<b>Overdue:</b> ' + EV_esc_(overdueActions[0].alert) + ' <span style="color:' + EV_UI.soft + ';">(' + EV_esc_(overdueActions[0].owner) + ', was due ' + EV_esc_(overdueActions[0].due) + ')</span>';
  if (!topThing) { var stuck = inbox.filter(function (x) { return x.ageH != null && x.ageH >= 24; }); if (stuck.length) topThing = 'A field submission has been stuck ' + stuck[0].ageH + 'h: ' + EV_esc_(stuck[0].summary) + '.'; }
  if (!topThing && pastLeads.length) topThing = '<b>Chase a lead:</b> ' + EV_esc_(pastLeads[0].lead) + ' — ' + EV_esc_(pastLeads[0].nextAction) + '.';
  if (!topThing && priced.length) topThing = 'Biggest open quote: <b>' + EV_esc_(priced[0].q.client) + '</b> at ' + EV_money2_(priced[0].amt) + '. Nudge it forward.';
  if (!topThing) topThing = 'Nothing is on fire. Enjoy the coffee, then go make some dust.';

  var H = [];
  H.push('<div style="background:#eef3f0;padding:18px 0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">');
  H.push('<div style="max-width:680px;margin:0 auto;">');

  // ===== AURORA HEADER =====
  H.push('<div style="background:linear-gradient(135deg,#06231c 0%,#0b3d2e 45%,#0e5a52 72%,#2a6f5e 100%);border-radius:14px 14px 0 0;padding:22px 22px 18px;">');
  H.push('<div style="font-size:11px;letter-spacing:3px;color:#7fe9b4;text-transform:uppercase;font-weight:bold;">Evolve Eco Blasting</div>');
  H.push('<div style="font-size:25px;font-weight:800;color:#ffffff;letter-spacing:.3px;margin-top:3px;">Morning Digest</div>');
  H.push('<div style="font-size:13px;color:#bfe9d4;margin-top:4px;">' + EV_esc_(EV_todayStr_()) + '</div>');
  H.push('<div style="font-size:13px;color:#eafff4;margin-top:10px;font-style:italic;border-top:1px solid rgba(127,233,180,.25);padding-top:9px;">“' + EV_esc_(joke) + '”</div>');
  H.push('</div>');

  // ===== SCOREBOARD =====
  H.push('<div style="background:#0b3d2e;padding:8px 10px 12px;">');
  H.push('<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;"><tr>');
  H.push(EV_v2tile_(EV_money2_(pipeline).replace('.00', ''), 'Active pipeline', EV_UI.neon));
  H.push(EV_v2tile_(String(activeQuotes.length), 'Open quotes', '#7fe9b4'));
  H.push(EV_v2tile_(String(wonQuotes.length), 'Won / booked', '#7fe9b4'));
  H.push(EV_v2tile_(String(overdueCount), 'Need chasing', overdueCount ? '#ff9b6b' : '#7fe9b4'));
  H.push('</tr></table></div>');

  // ===== BODY WRAP =====
  H.push('<div style="background:#f6faf8;border:1px solid ' + EV_UI.line + ';border-top:0;border-radius:0 0 14px 14px;padding:6px 16px 16px;">');

  // ONE THING
  H.push(EV_v2card_('🎯', 'One thing not to drop today', '<div style="font-size:15px;color:' + EV_UI.body + ';line-height:1.45;">' + topThing + '</div>', EV_UI.amber));

  // ===== NEEDS FOLLOW-THROUGH (deduped, dead excluded, capped) =====
  var seenFt = {}, ft = [];
  function addFt(key, rank, html) {
    key = String(key).toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenFt[key]) return; seenFt[key] = 1; ft.push({ r: rank, html: html });
  }
  overdueActions.forEach(function (a) {
    if (/^\s*lead\b.*past[\s-]*due next action/i.test(a.alert)) return; // leads loop covers it
    if (/^\s*quote\s+eco-.*unanswered/i.test(a.alert)) return;          // quotes loop covers it
    addFt('a:' + a.alert, 0, EV_v2pill_('OVERDUE', '#fbe3df', EV_UI.red) + ' ' + EV_esc_(a.alert) +
      ' <span style="color:' + EV_UI.soft + ';">(' + EV_esc_(a.owner) + ', due ' + EV_esc_(a.due) + ')</span>');
  });
  activeQuotes.forEach(function (q) {
    if (!/sent|resent|await|pending/i.test(String(q.status)) || !q.dateObj) return;
    var d = EV_daysBetween_(q.dateObj, now); if (d < 3) return;
    var amt = EV_moneyMaybe_(q.total);
    addFt('q:' + q.no, d >= 7 ? 1 : 2, (d >= 7 ? EV_v2pill_(d + 'd', '#fff1d6', EV_UI.amber) + ' ' : '') +
      'Quote ' + EV_esc_(q.no) + ' — ' + EV_esc_(q.client) + (amt ? ' (' + amt + ')' : '') + ' sent ' + d + 'd ago, no reply yet');
  });
  pastLeads.forEach(function (l) {
    addFt('l:' + l.lead, 1, 'Lead <b>' + EV_esc_(l.lead) + '</b>: ' + EV_esc_(l.nextAction || 'follow up') +
      ' <span style="color:' + EV_UI.soft + ';">(due ' + EV_esc_(l.nextDate) + ')</span>');
  });
  activeQuotes.forEach(function (q) {
    if (!q.validDate) return; var dl = EV_daysBetween_(now, q.validDate);
    if (dl >= 0 && dl <= 7) addFt('e:' + q.no, 1, EV_v2pill_('EXPIRES ' + dl + 'd', '#ede7fb', EV_UI.purple) +
      ' Quote ' + EV_esc_(q.no) + ' (' + EV_esc_(q.client) + ') expires soon');
  });
  ft.sort(function (a, b) { return a.r - b.r; });
  if (ft.length) {
    var shown = ft.slice(0, 12);
    var more = ft.length > 12 ? '<div style="font-size:12px;color:' + EV_UI.soft + ';margin-top:6px;">+' + (ft.length - 12) + ' more open item(s).</div>' : '';
    H.push(EV_v2card_('🪝', 'Needs follow-through', '<ul style="margin:0;padding-left:18px;font-size:14px;color:' + EV_UI.body + ';line-height:1.5;">' +
      shown.map(function (x) { return '<li style="margin:5px 0;">' + x.html + '</li>'; }).join('') + '</ul>' + more, EV_UI.red));
  }

  // ===== PIPELINE & OBSERVATIONS (computed LIVE so figures are always current) =====
  var obs = [];
  if (priced.length) {
    var top = priced.slice(0, 3);
    var top3sum = top.reduce(function (s, x) { return s + x.amt; }, 0);
    var topPct = pipeline > 0 ? Math.round(top3sum / pipeline * 100) : 0;
    obs.push('<b>' + EV_money2_(pipeline) + '</b> in active pipeline across <b>' + activeQuotes.length + '</b> open quote' + (activeQuotes.length === 1 ? '' : 's') + '.');
    obs.push('Top 3 = <b>' + EV_money2_(top3sum) + '</b> (' + topPct + '% of pipeline): ' +
      top.map(function (x) { return EV_esc_(x.q.client) + ' ' + EV_money2_(x.amt); }).join(' · ') + '.');
    if (priced[0]) {
      var bigPct = pipeline > 0 ? Math.round(priced[0].amt / pipeline * 100) : 0;
      obs.push('Biggest single quote: <b>' + EV_esc_(priced[0].q.client) + '</b> at ' + EV_money2_(priced[0].amt) + ' (' + bigPct + '% of pipeline) — single-threaded risk if it slips.');
    }
  }
  if (wonQuotes.length) {
    var wsum = wonQuotes.reduce(function (s, q) { var a = EV_amt_(q.total); return s + (isNaN(a) ? 0 : a); }, 0);
    obs.push('Recently won / booked: <b>' + wonQuotes.length + '</b> quote' + (wonQuotes.length === 1 ? '' : 's') + (wsum > 0 ? ' worth ' + EV_money2_(wsum) : '') + ' — convert deposits to scheduled dates.');
  }
  if (overdueCount) obs.push('<b>' + overdueCount + '</b> item' + (overdueCount === 1 ? '' : 's') + ' past their follow-up date (see above).');
  if (obs.length) {
    H.push(EV_v2card_('📊', 'Pipeline & observations', '<ul style="margin:0;padding-left:18px;font-size:14px;color:' + EV_UI.body + ';line-height:1.5;">' +
      obs.map(function (o) { return '<li style="margin:5px 0;">' + o + '</li>'; }).join('') + '</ul>', EV_UI.teal));
  }

  // ===== QUOTES OUT (active only, money normalized, biggest first) =====
  if (priced.length || activeQuotes.length) {
    var qsorted = activeQuotes.slice().sort(function (a, b) {
      var x = EV_amt_(a.total), y = EV_amt_(b.total);
      return (isNaN(y) ? -1 : y) - (isNaN(x) ? -1 : x);
    });
    var qrows = qsorted.slice(0, 14).map(function (q) {
      var amt = EV_moneyMaybe_(q.total);
      var sqft = (q.sqft && String(q.sqft).trim() && String(q.sqft).trim() !== '-') ? (' · ' + EV_esc_(q.sqft) + ' sq ft') : '';
      var exp = q.validDate ? EV_daysBetween_(now, q.validDate) : null;
      var expTxt = (exp != null && exp >= 0) ? ' · <span style="color:' + EV_UI.soft + ';">expires ' + exp + 'd</span>' : '';
      return '<li style="margin:6px 0;"><b>' + EV_esc_(q.no) + '</b> · ' + EV_esc_(q.client) +
        (amt ? ' · <b style="color:' + EV_UI.green + ';">' + amt + '</b>' : '') + sqft +
        '<div style="font-size:12px;color:' + EV_UI.soft + ';">' + EV_esc_(q.status) + expTxt + '</div></li>';
    }).join('');
    H.push(EV_v2card_('🧾', 'Quotes out (' + activeQuotes.length + ' active)', '<ul style="margin:0;padding-left:18px;font-size:14px;color:' + EV_UI.body + ';list-style:none;">' + qrows + '</ul>', EV_UI.green));
  }

  // ===== JOBS ON THE BOARD (active only, deduped) + recently closed mention =====
  if (activeJobs.length) {
    var jrows = activeJobs.map(function (j) {
      function chk(v) { return v && String(v).trim() && !/^(no|n|0|—|-)$/i.test(String(v).trim()) ? '✔' : '—'; }
      var money = 'Deposit ' + chk(j.deposit) + ' · Invoiced ' + chk(j.invoiced) + ' · Paid ' + chk(j.paid);
      var l2 = [j.week, j.date, j.time].filter(function (s) { return s && String(s).trim() && String(s).trim() !== 'TBD'; }).join(' · ');
      var l3 = [j.address, j.crew ? ('crew: ' + j.crew) : '', j.quote].filter(function (s) { return s && String(s).trim(); }).join(' · ');
      return '<div style="padding:8px 0;border-bottom:1px solid ' + EV_UI.line + ';">' +
        '<div style="font-weight:bold;color:' + EV_UI.ink + ';">' + EV_esc_(j.customer) +
        ' <span style="font-weight:normal;">' + EV_v2pill_(EV_esc_(j.status || '—'), '#e6f4ec', EV_UI.green) + '</span></div>' +
        (l2 ? '<div style="font-size:13px;color:' + EV_UI.body + ';">' + EV_esc_(l2) + '</div>' : '') +
        (l3 ? '<div style="font-size:13px;color:' + EV_UI.body + ';">' + EV_esc_(l3) + '</div>' : '') +
        (j.notes ? '<div style="font-size:12px;color:' + EV_UI.soft + ';">' + EV_esc_(j.notes) + '</div>' : '') +
        '<div style="font-size:12px;color:' + EV_UI.soft + ';">' + money + '</div></div>';
    }).join('');
    var closedLine = doneJobs.length ? '<div style="font-size:12px;color:' + EV_UI.soft + ';margin-top:8px;">✅ Recently closed: ' +
      doneJobs.slice(0, 4).map(function (j) { return EV_esc_(j.customer) + ' (' + EV_esc_(j.status) + ')'; }).join(' · ') + '</div>' : '';
    H.push(EV_v2card_('📅', 'Jobs on the board (' + activeJobs.length + ' active)', jrows + closedLine, EV_UI.green));
  }

  // ===== WEATHER (themed) =====
  if (wx && wx.length) {
    var wrows = wx.map(function (d) {
      var col = d.verdict === 'Good blast day' ? EV_UI.green : (d.verdict === 'Marginal' ? EV_UI.amber : EV_UI.red);
      return '<tr><td style="padding:4px 8px;font-weight:bold;color:' + EV_UI.ink + ';">' + EV_esc_(d.label) + '</td>' +
        '<td style="padding:4px 8px;color:' + EV_UI.body + ';">' + EV_esc_(d.sky) + ', ' + d.tmax + '/' + d.tmin + '&deg;C</td>' +
        '<td style="padding:4px 8px;color:' + EV_UI.body + ';">rain ' + d.pp + '% · wind ' + d.wind + '</td>' +
        '<td style="padding:4px 8px;color:' + col + ';font-weight:bold;">' + d.verdict + '</td></tr>';
    }).join('');
    H.push(EV_v2card_('🌤️', 'Weather — Edmonton 5-day', '<table style="border-collapse:collapse;font-size:13px;width:100%;">' + wrows + '</table>' +
      '<div style="font-size:11px;color:' + EV_UI.soft + ';margin-top:6px;">Outdoor wet-process work — rain, high wind, and cold are scheduling risks.</div>', EV_UI.teal));
  }

  // ===== BUSINESS BRAIN (Insights tab) — filtered to avoid stale/duplicated pipeline figures =====
  try {
    var ins = (typeof EV_insightsForDigest_ === 'function') ? EV_insightsForDigest_(8) : [];
    ins = ins.filter(function (x) { return !/pipeline|concentrat|win\s*rate|top\s*customer/i.test(String(x.title) + ' ' + String(x.detail)); });
    if (ins.length) {
      var bli = ins.slice(0, 4).map(function (x) {
        return '<li style="margin:5px 0;"><b>' + EV_esc_(x.title) + '</b>' + (x.detail ? ' <span style="color:' + EV_UI.soft + ';">— ' + EV_esc_(x.detail) + '</span>' : '') + '</li>';
      }).join('');
      H.push(EV_v2card_('🧠', 'Business brain — what the numbers say', '<ul style="margin:0;padding-left:18px;font-size:14px;color:' + EV_UI.body + ';line-height:1.5;">' + bli + '</ul>', EV_UI.purple));
    }
  } catch (e) {}

  // ===== reuse existing richness (captured / autopilot / shipped) =====
  try { H.push(EV_capturedCard_() || ''); } catch (e) {}
  try { H.push(EV_activityCard_() || ''); } catch (e) {}
  // 'Recent upgrades' card intentionally removed 2026-07-06 (per Matt: those are done - nothing new to show).

  // ===== TO-DO (reuse existing card) =====
  try { H.push(EV_todoCard_(todos) || ''); } catch (e) {}

  // ===== REMINDERS (standing) =====
  H.push(EV_v2card_('📌', 'Reminders', '<ul style="margin:0;padding-left:18px;font-size:14px;color:' + EV_UI.body + ';line-height:1.5;">' +
    '<li style="margin:5px 0;">Collect small payments <b>UPFRONT</b>. We do <b>NOT</b> take any job under <b>$350</b> (our minimum).</li>' +
    '<li style="margin:5px 0;">We now offer a <b>3% referral fee</b>, added to the cost of referred jobs — mention it to happy customers.</li>' +
    '<li style="margin:5px 0;">When quoting <b>any</b> customer, always collect their <b>email address</b> — needed for quotes, invoices, and receipts.</li>' +
    '</ul>', EV_UI.purple));

  // ===== SYSTEM HEALTH (compact, summarized — no 49× repetition) =====
  var yKey = EV_fmt_(new Date(now.getTime() - 86400000), 'yyyyMMdd');
  var hb = 0; try { hb = EV_heartbeatsOn_(yKey); } catch (e) {}
  var byStatus = {}, oldest = 0;
  inbox.forEach(function (x) { byStatus[x.status] = (byStatus[x.status] || 0) + 1; if (x.ageH != null && x.ageH > oldest) oldest = x.ageH; });
  var inboxTxt = inbox.length ? (Object.keys(byStatus).map(function (k) { return byStatus[k] + ' ' + k; }).join(', ') + (oldest ? ' · oldest ' + oldest + 'h' : '')) : 'clean — nothing waiting';
  var hbTxt = hb >= 3 ? (hb + ' logged — healthy') : (hb + ' logged — server triggers warming up');
  var shBits = '<li style="margin:3px 0;">Auto-send: server-side (Apps Script), runs whether the PC is on or off.</li>' +
    '<li style="margin:3px 0;">Dispatch heartbeats yesterday: ' + hbTxt + '.</li>' +
    '<li style="margin:3px 0;">App Inbox needing a human: ' + inboxTxt + '.</li>';
  H.push(EV_v2card_('🩺', 'System health', '<ul style="margin:0;padding-left:18px;font-size:13px;color:' + EV_UI.body + ';">' + shBits + '</ul>', EV_UI.soft));

  // ===== FOOTER =====
  H.push('<div style="font-size:12px;color:' + EV_UI.soft + ';background:#eaf2ee;border-radius:10px;padding:11px 13px;margin-top:14px;line-height:1.5;">' +
    'Reply to this email with anything to add, change, or mark done — it’s logged to the workbook automatically within the hour. ' +
    'Sent server-side by Evolve Autopilot at 6 AM, every day.</div>');

  H.push('</div></div></div>'); // body / container / page
  return H.join('');
}

/* v2 build marker: 2026-06-22 push-resync */
