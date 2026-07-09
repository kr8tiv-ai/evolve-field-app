/**
 * ============================================================================
 *  EVOLVE FIELD APP — SAFETY / FLHA MODULE
 *  Field Level Hazard Assessment (Alberta OHS aligned)
 * ----------------------------------------------------------------------------
 *  WHAT THIS IS
 *    A phone-first, mostly-tap FLHA the crew completes every morning at the job
 *    or shop BEFORE work starts. It is deliberately conclusive: it cannot be
 *    submitted without hazards, controls, a site-specific note, the equipment
 *    checklist answered, and at least one VERIFIED worker sign-off.
 *
 *  WHY IT'S LEGALLY DEFENSIBLE (Alberta OHS Code Part 2, s.7–10; Act s.3(2))
 *    - Assesses the site + hazards BEFORE work (s.7), written + dated + kept.
 *    - Workers are involved and each SIGNS with their OWN PIN (s.8) — every
 *      signature is HMAC-verified server-side against that worker's login and
 *      stamped with a server timestamp, so it is attributable and cannot be
 *      back-dated or forged from the client.
 *    - Controls are prompted in hierarchy order (eliminate→substitute→
 *      engineering→administrative→PPE) (s.9).
 *    - Young / new workers: a signature = a per-worker attestation that they
 *      understand the hazards, are trained for the task, and have the PPE.
 *
 *  INTEGRATION ON SUBMIT
 *    (a) logs one row into the "🦺 FLHA" tab of the ops workbook, with each
 *        signer + timestamp as proof;
 *    (b) renders a branded PDF and stores it to Drive ("08 Safety - FLHA
 *        Records", created on demand);
 *    (c) emails matt@ + todd@evolveecoblasting.com via the SAME mailer the
 *        morning digest uses (sendEmail_ in Code.js).
 *
 *  Reuses Code.js helpers: CONFIG, ss_(), sign_(), findUser_(), checkToken_(),
 *  sendEmail_(), styleHeaderRow_(), appLog_(), stripDataUrl_().
 *
 *  One-time: Run ▸ setupSafety (creates the 🦺 FLHA tab). It also self-creates
 *  on first submit, so this is optional.
 * ============================================================================
 */

var SAFETY = {
  TAB: '🦺 FLHA',
  DRIVE_FOLDER_NAME: '08 Safety - FLHA Records',
  TAB_HAZARD: '⚠️ Hazard Reports',
  TZ: (typeof CONFIG !== 'undefined' && CONFIG.TIMEZONE) ? CONFIG.TIMEZONE : 'America/Edmonton',
  SIG_MAX_AGE_MS: 18 * 60 * 60 * 1000,   // a sign-off is valid for the shift it was made in, not forever
  EMAIL_TO: ['manager@yourcompany.com', 'todd@evolveecoblasting.com'],
  // brand palette (matches the Evolve quote/invoice)
  BRAND: { void: '#0a0a0a', lime: '#39ff14', aurora: '#4ade80', silver: '#e6e8ea', dim: '#9fb3a5', ink: '#111111' }
};

var FLHA_HEADERS = [
  'Timestamp', 'FLHA ID', 'Date', 'Location', 'Job / Task', 'Field or Shop',
  'Crew Present', 'Hazards Identified', 'Overall Risk', 'Controls / Mitigations',
  'Job-Specific Hazards & Controls', 'Equipment Checklist', 'PPE On Site',
  'Emergency Info', 'Signatures (verified)', 'Sign-offs', 'Submitted By',
  'PDF Link', 'Status', 'Device', 'Weather', 'Site Photos',
  'Start Time', 'New/Young Worker', 'Notes'
];

var HAZARD_HEADERS = [
  'Timestamp', 'Report ID', 'Severity', 'Hazard Type', 'Location', 'Description',
  'Reported By', 'Photos', 'Emailed To', 'Status', 'Device'
];

/* ----------------------------------------------------------------------------
 *  ONE-TIME SETUP  (Run ▸ setupSafety)  — also auto-runs on first submit
 * --------------------------------------------------------------------------*/
function setupSafety() {
  var a = flhaSheet_(true);
  var b = hazardSheet_(true);
  return 'Safety tabs ready: "' + SAFETY.TAB + '" (' + FLHA_HEADERS.length + ' cols) + "' + SAFETY.TAB_HAZARD + '" (' + HAZARD_HEADERS.length + ' cols).';
}

/** Ensure a header row matches `headers` (adds missing trailing columns without disturbing existing data). */
function ensureHeaders_(sh, headers) {
  var lastCol = sh.getLastColumn();
  var cur = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var same = cur.length >= headers.length && headers.every(function (h, i) { return String(cur[i]) === h; });
  if (!same) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (typeof styleHeaderRow_ === 'function') styleHeaderRow_(sh, headers.length);
    sh.setFrozenRows(1);
  }
}

function flhaSheet_(createIfMissing) {
  var ss = (typeof ss_ === 'function') ? ss_() : SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sh = ss.getSheetByName(SAFETY.TAB);
  if (!sh && createIfMissing) {
    sh = ss.insertSheet(SAFETY.TAB);
    sh.getRange(1, 1, 1, FLHA_HEADERS.length).setValues([FLHA_HEADERS]);
    if (typeof styleHeaderRow_ === 'function') styleHeaderRow_(sh, FLHA_HEADERS.length);
    sh.setFrozenRows(1);
    sh.setColumnWidth(4, 240); sh.setColumnWidth(5, 200); sh.setColumnWidth(8, 300);
    sh.setColumnWidth(10, 300); sh.setColumnWidth(11, 320); sh.setColumnWidth(12, 300); sh.setColumnWidth(15, 360);
  }
  if (sh) ensureHeaders_(sh, FLHA_HEADERS);   // migrate older 20-col tab to include Weather + Site Photos
  return sh;
}

function hazardSheet_(createIfMissing) {
  var ss = (typeof ss_ === 'function') ? ss_() : SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sh = ss.getSheetByName(SAFETY.TAB_HAZARD);
  if (!sh && createIfMissing) {
    sh = ss.insertSheet(SAFETY.TAB_HAZARD);
    sh.getRange(1, 1, 1, HAZARD_HEADERS.length).setValues([HAZARD_HEADERS]);
    if (typeof styleHeaderRow_ === 'function') styleHeaderRow_(sh, HAZARD_HEADERS.length);
    sh.setFrozenRows(1);
    sh.setColumnWidth(5, 240); sh.setColumnWidth(6, 400); sh.setColumnWidth(8, 260);
  }
  if (sh) ensureHeaders_(sh, HAZARD_HEADERS);
  return sh;
}

function flhaFolder_() {
  var root = DriveApp.getFolderById(CONFIG.DRIVE.ROOT);
  var it = root.getFoldersByName(SAFETY.DRIVE_FOLDER_NAME);
  return it.hasNext() ? it.next() : root.createFolder(SAFETY.DRIVE_FOLDER_NAME);
}

function flhaNowStamp_() { return Utilities.formatDate(new Date(), SAFETY.TZ, 'yyyy-MM-dd HH:mm') + ' MT'; }
function flhaEsc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ----------------------------------------------------------------------------
 *  SIGN-OFF  — each worker authenticates with their OWN name + PIN.
 *  Returns a server-timestamped, HMAC-signed token proving THIS worker signed.
 *  The client collects these; the server re-verifies every one at submit, so a
 *  signature can never be forged or attributed to someone who didn't sign.
 * --------------------------------------------------------------------------*/
function apiFlhaSign(name, pin) {
  name = String(name || '').trim();
  pin = String(pin || '').trim();

  // Brute-force throttle (mirror of apiLogin): 6 wrong tries locks this name 10 min.
  var cache = CacheService.getScriptCache();
  var key = 'flhasign_' + name.toLowerCase();
  var fails = Number(cache.get(key) || 0);
  if (fails >= 6) return { ok: false, error: 'Too many tries. Wait 10 minutes.' };

  var user = (typeof findUser_ === 'function') ? findUser_(name) : null;
  if (!user) return { ok: false, error: 'Name not found. Ask Todd or Matt to add you.' };
  if (String(user.active) !== 'Yes') return { ok: false, error: 'This login is disabled.' };
  if (String(user.pin) !== pin) {
    cache.put(key, String(fails + 1), 600);
    return { ok: false, error: 'Wrong PIN.' };
  }
  cache.remove(key);

  var ts = Date.now();
  var sig = sign_(user.name + '|' + ts + '|flha');   // reuses Code.js AUTH_SECRET HMAC
  return { ok: true, name: user.name, role: user.role, ts: ts, sig: sig };
}

/** Re-verify a collected signature. Valid only if the HMAC matches AND it's fresh. */
function flhaVerifySig_(s) {
  if (!s || !s.name || !s.ts || !s.sig) return null;
  if (sign_(String(s.name) + '|' + String(s.ts) + '|flha') !== s.sig) return null;
  if (Date.now() - Number(s.ts) > SAFETY.SIG_MAX_AGE_MS) return null;
  return { name: String(s.name), role: String(s.role || ''), ts: Number(s.ts) };
}

/* ----------------------------------------------------------------------------
 *  SUBMIT  — the conclusive step.
 *  payload = {
 *    token,                         // submitter (crew lead) session
 *    flha: {
 *      location, date, jobTask, place ('Field'|'Shop'),
 *      hazards:[..], otherHazards, risk ('Low'|'Medium'|'High'), riskAck (bool),
 *      controls:[..], controlsNote, jobHazards (site-specific, required),
 *      equip:{ setup, whipChecks, oRings, compressor, containment, deadman, couplings, mitigated },
 *      ppe:[..], emergency:{ hospital, muster, firstAid, notes }, changeNote
 *    },
 *    signatures:[{name,role,ts,sig}, ...],
 *    device
 *  }
 * --------------------------------------------------------------------------*/
function apiFlhaSubmit(payload) {
  // Public entry point — options are server-controlled only (never taken from the client).
  return flhaSubmitCore_(payload, { emailTo: SAFETY.EMAIL_TO, status: 'SUBMITTED' });
}

function flhaSubmitCore_(payload, opts) {
  opts = opts || {};
  var EMAIL_TO = opts.emailTo || SAFETY.EMAIL_TO;
  var STATUS = opts.status || 'SUBMITTED';
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    var submitter = (typeof checkToken_ === 'function') ? checkToken_(payload && payload.token) : null;
    if (!submitter) return { ok: false, error: 'Session expired — please sign in again.' };

    var f = (payload && payload.flha) || {};

    // ---- validate (server-side, defensive — the client validates too) ----
    var miss = [];
    if (!String(f.location || '').trim()) miss.push('location');
    if (!String(f.jobTask || '').trim()) miss.push('job/task');
    if (!(f.hazards && f.hazards.length) && !String(f.otherHazards || '').trim()) miss.push('at least one hazard');
    if (!(f.controls && f.controls.length) && !String(f.controlsNote || '').trim()) miss.push('at least one control');
    if (String(f.jobHazards || '').trim().length < 4) miss.push('a site-specific note');
    if (miss.length) return { ok: false, error: 'Incomplete FLHA — missing: ' + miss.join(', ') + '.' };

    if (String(f.risk || '') === 'High' && !f.riskAck) {
      return { ok: false, error: 'High risk selected — a supervisor acknowledgement is required before submitting.' };
    }

    // ---- verify every signature; keep only genuine ones ----
    var sigsIn = (payload && payload.signatures) || [];
    var verified = [], seen = {};
    for (var i = 0; i < sigsIn.length; i++) {
      var v = flhaVerifySig_(sigsIn[i]);
      if (v && !seen[v.name.toLowerCase()]) { seen[v.name.toLowerCase()] = 1; verified.push(v); }
    }
    if (!verified.length) return { ok: false, error: 'At least one verified worker sign-off is required. Have each worker sign with their own PIN.' };

    // ---- build the record ----
    var now = new Date();
    var subId = 'FLHA-' + Utilities.formatDate(now, SAFETY.TZ, 'yyMMdd-HHmmss') +
                '-' + ('00' + Math.floor(Math.random() * 1000)).slice(-3);
    var dateStr = String(f.date || '').trim() || Utilities.formatDate(now, SAFETY.TZ, 'yyyy-MM-dd');

    var sigLines = verified.map(function (s) {
      return s.name + (s.role ? ' (' + s.role + ')' : '') + ' — signed ' +
             Utilities.formatDate(new Date(s.ts), SAFETY.TZ, 'yyyy-MM-dd HH:mm') + ' MT';
    });
    var crewNames = verified.map(function (s) { return s.name; }).join(', ');

    var hazardsStr = (f.hazards || []).join(' · ') + (f.otherHazards ? (' · Other: ' + f.otherHazards) : '');
    var controlsStr = (f.controls || []).join(' · ') + (f.controlsNote ? ((f.controls && f.controls.length ? ' · ' : '') + f.controlsNote) : '');
    // Equipment/pre-work checklist: the client sends a pre-built "Label: value · …" string
    // (grouped checklist). Fall back to the legacy object form (self-test / old clients).
    var eq = f.equip;
    var equipStr = (typeof eq === 'string') ? eq : [
      ['Equipment set up', eq && eq.setup], ['Whip checks', eq && eq.whipChecks], ['O-rings inspected', eq && eq.oRings],
      ['Compressor', eq && eq.compressor], ['Containment', eq && eq.containment], ['Deadman/safety valves', eq && eq.deadman],
      ['Couplings secure', eq && eq.couplings], ['Risks mitigated', eq && eq.mitigated]
    ].map(function (p) { return p[0] + ': ' + (p[1] || '—'); }).join(' · ');
    var em = f.emergency || {};
    var emergencyStr = [
      em.hospital ? ('Hospital: ' + em.hospital) : '',
      em.muster ? ('Muster: ' + em.muster) : '',
      em.firstAid ? ('First aid: ' + em.firstAid) : '',
      em.contact ? ('Contact: ' + em.contact) : '',
      em.notes ? em.notes : ''
    ].filter(String).join(' · ');

    // site photos (links already uploaded by the client via apiUploadPhoto)
    var photoLinks = [];
    (payload.photoLinks || []).forEach(function (l) {
      var url = String(l).replace(/^[A-Za-z][A-Za-z ]*:\s+/, '');
      if (/^https?:\/\//i.test(url)) photoLinks.push(url);
    });

    var record = {
      id: subId, dateStr: dateStr, startTime: f.startTime || '', location: f.location, jobTask: f.jobTask, place: f.place || '',
      weather: f.weather || '', hazardsStr: hazardsStr, risk: f.risk || '', controlsStr: controlsStr,
      jobHazards: f.jobHazards || '', equipStr: equipStr, ppeStr: (f.ppe || []).join(' · '),
      emergencyStr: emergencyStr, youngWorker: f.youngWorker || '', sigLines: sigLines, crewNames: crewNames, photoLinks: photoLinks,
      submitter: submitter.name, notes: f.notes || '', changeNote: f.changeNote || f.notes || ''
    };

    // ---- (b) PDF → Drive ----
    var pdfUrl = '';
    try {
      var html = flhaPdfHtml_(record);
      var pdfBlob = Utilities.newBlob(html, 'text/html', subId + '.html').getAs('application/pdf').setName(subId + '.pdf');
      var file = flhaFolder_().createFile(pdfBlob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      pdfUrl = file.getUrl();
    } catch (ePdf) {
      try { appLog_('Safety', 'FLHA PDF build failed for ' + subId + ': ' + ePdf); } catch (_) {}
    }

    // ---- (a) log the row ----
    var sh = flhaSheet_(true);
    sh.appendRow([
      now, subId, dateStr, f.location || '', f.jobTask || '', f.place || '',
      crewNames, hazardsStr, f.risk || '', controlsStr, f.jobHazards || '',
      equipStr, (f.ppe || []).join(' · '), emergencyStr, sigLines.join('\n'),
      verified.length, submitter.name, pdfUrl, STATUS, (payload && payload.device) || '',
      f.weather || '', photoLinks.join('\n'), f.startTime || '', f.youngWorker || '', f.notes || ''
    ]);

    // ---- (c) ONE branded email to matt@ + todd@ via the shared mailer, PDF attached ----
    var emailOk = false;
    try {
      var subject = (STATUS === 'SELF-TEST' ? '[SELF-TEST] ' : '') + 'FLHA — ' + (f.jobTask || 'Job') + ' — ' + (f.location || '') + ' — ' + dateStr;
      var pdfFileId = pdfUrl ? ((/[-\w]{25,}/.exec(pdfUrl) || [])[0] || '') : '';
      var mail = sendEmail_({
        to: EMAIL_TO,
        subject: subject,
        htmlBody: flhaEmailHtml_(record, pdfUrl),
        body: 'FLHA ' + subId + ' submitted by ' + submitter.name + '. Signed by: ' + crewNames + '. PDF: ' + (pdfUrl || 'n/a'),
        attachmentFileId: pdfFileId
      });
      emailOk = !!(mail && mail.ok);
    } catch (eMail) {
      try { appLog_('Safety', 'FLHA email failed for ' + subId + ': ' + eMail); } catch (_) {}
    }

    try { appLog_('Safety', 'FLHA ' + subId + ' filed (' + verified.length + ' sign-off(s): ' + crewNames + '), PDF ' + (pdfUrl ? 'saved' : 'FAILED') + ', email ' + (emailOk ? 'sent' : 'FAILED') + '.'); } catch (_) {}

    return {
      ok: true, id: subId, pdfUrl: pdfUrl, signers: verified.map(function (s) { return s.name; }),
      emailed: emailOk,
      message: 'FLHA logged and emailed to Todd & Matt. Signed by ' + crewNames + '. Stay safe out there.'
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/* ----------------------------------------------------------------------------
 *  PDF + EMAIL HTML  — branded to the Evolve quote/invoice (dark Boreal Void,
 *  Cyber Lime underline, Aurora Neon accents, uppercase tracked headings,
 *  diamond bullets). Self-contained inline styles; renders to PDF via getAs().
 * --------------------------------------------------------------------------*/
var FLHA_B = { void: '#0a0a0a', panel: '#111511', lime: '#39ff14', aurora: '#4ade80', silver: '#e6e8ea', dim: '#9fb3a5', line: 'rgba(255,255,255,.12)' };

function flhaRiskColor_(risk) { return risk === 'High' ? '#ff4d4d' : (risk === 'Medium' ? '#ffb020' : (risk === 'Low' ? FLHA_B.aurora : FLHA_B.dim)); }

/** ' · '-joined string → diamond-bulleted inline chips. */
function flhaChips_(str, accent) {
  var arr = String(str || '').split(' · ').map(function (x) { return x.trim(); }).filter(String);
  if (!arr.length) return '<span style="color:' + FLHA_B.dim + '">—</span>';
  return arr.map(function (x) {
    return '<span style="display:inline-block;background:rgba(74,222,128,.10);border:1px solid rgba(74,222,128,.30);color:' + (accent || FLHA_B.silver) + ';border-radius:20px;padding:5px 12px;margin:0 6px 6px 0;font-size:12.5px"><span style="color:' + FLHA_B.lime + '">&#9670;</span>&nbsp;' + flhaEsc_(x) + '</span>';
  }).join('');
}

/** "Label: Yes · Label: N/A · …" → two-column check grid. */
function flhaEquipGrid_(equipStr) {
  var items = String(equipStr || '').split(' · ').map(function (x) { return x.trim(); }).filter(String);
  if (!items.length) return '<span style="color:' + FLHA_B.dim + '">—</span>';
  var cells = items.map(function (it) {
    var idx = it.lastIndexOf(':');
    var label = idx > 0 ? it.slice(0, idx).trim() : it, val = idx > 0 ? it.slice(idx + 1).trim() : '';
    var ok = /^yes$/i.test(val), na = /^n\/?a$/i.test(val);
    var mark = ok ? '<span style="color:' + FLHA_B.lime + '">✔</span>' : (na ? '<span style="color:' + FLHA_B.dim + '">–</span>' : '<span style="color:#ff4d4d">✗</span>');
    return '<td style="width:50%;padding:7px 10px;border:1px solid ' + FLHA_B.line + ';font-size:12.5px;color:' + FLHA_B.silver + '">' + mark + '&nbsp;&nbsp;' + flhaEsc_(label) + '<span style="float:right;color:' + FLHA_B.dim + '">' + flhaEsc_(val) + '</span></td>';
  });
  var rows = '';
  for (var i = 0; i < cells.length; i += 2) rows += '<tr>' + cells[i] + (cells[i + 1] || '<td style="border:1px solid ' + FLHA_B.line + '"></td>') + '</tr>';
  return '<table style="width:100%;border-collapse:collapse;margin-top:4px">' + rows + '</table>';
}

function flhaSection_(title, inner) {
  return '<div style="margin:20px 0 6px"><span style="display:inline-block;width:22px;height:3px;background:' + FLHA_B.lime + ';vertical-align:middle;margin-right:9px"></span>' +
    '<span style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:' + FLHA_B.aurora + ';font-weight:bold">' + flhaEsc_(title) + '</span></div>' +
    '<div style="font-size:13.5px;color:' + FLHA_B.silver + ';line-height:1.6">' + inner + '</div>';
}

function flhaMetaCell_(label, val) {
  return '<td style="padding:9px 12px;border:1px solid ' + FLHA_B.line + ';vertical-align:top">' +
    '<div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:' + FLHA_B.aurora + '">' + flhaEsc_(label) + '</div>' +
    '<div style="font-size:14px;color:' + FLHA_B.silver + ';margin-top:2px">' + (val ? flhaEsc_(val) : '—') + '</div></td>';
}

function flhaPdfHtml_(r) {
  var riskColor = flhaRiskColor_(r.risk);
  var sigCards = (r.sigLines || []).map(function (l) {
    return '<div style="display:inline-block;border:1px solid rgba(57,255,20,.35);background:rgba(57,255,20,.06);border-radius:10px;padding:10px 14px;margin:0 8px 8px 0;min-width:220px">' +
      '<div style="color:' + FLHA_B.lime + ';font-size:13px;font-weight:bold">✔ ' + flhaEsc_(String(l).split(' — ')[0]) + '</div>' +
      '<div style="color:' + FLHA_B.dim + ';font-size:11px;margin-top:2px">' + flhaEsc_(String(l).split(' — ').slice(1).join(' — ')) + '</div></div>';
  }).join('');
  var photos = (r.photoLinks && r.photoLinks.length)
    ? r.photoLinks.map(function (u, i) { return '<a href="' + flhaEsc_(u) + '" style="display:inline-block;color:' + FLHA_B.lime + ';border:1px solid ' + FLHA_B.line + ';border-radius:8px;padding:8px 12px;margin:0 8px 8px 0;text-decoration:none;font-size:12.5px">📷 Site photo ' + (i + 1) + '</a>'; }).join('')
    : '';
  return '' +
  '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
  '<body style="margin:0;background:' + FLHA_B.void + '">' +
  '<div style="background:' + FLHA_B.void + ';font-family:Arial,Helvetica,sans-serif;color:' + FLHA_B.silver + ';padding:0;margin:0">' +
  '<div style="max-width:760px;margin:0 auto;padding:26px 30px">' +
    // header
    '<div style="padding-bottom:14px;border-bottom:3px solid ' + FLHA_B.lime + ';margin-bottom:6px">' +
      '<table style="width:100%"><tr>' +
        '<td style="vertical-align:top">' +
          '<div style="font-size:12px;letter-spacing:.30em;color:' + FLHA_B.lime + ';font-weight:bold">EVOLVE ECO BLASTING</div>' +
          '<div style="font-size:27px;letter-spacing:.02em;color:#fff;font-weight:bold;margin-top:4px">FIELD LEVEL HAZARD ASSESSMENT</div>' +
        '</td>' +
        '<td style="vertical-align:top;text-align:right;white-space:nowrap">' +
          '<div style="font-size:11px;color:' + FLHA_B.dim + '">RECORD</div>' +
          '<div style="font-size:14px;color:' + FLHA_B.aurora + ';font-weight:bold">' + flhaEsc_(r.id) + '</div>' +
          '<div style="font-size:10.5px;color:' + FLHA_B.dim + ';margin-top:6px">Alberta OHS Code<br>Part 2 &middot; s.7&ndash;10</div>' +
        '</td>' +
      '</tr></table>' +
    '</div>' +
    // risk banner
    '<div style="margin:16px 0;border:1px solid ' + riskColor + ';background:rgba(255,255,255,.03);border-radius:10px;padding:12px 16px">' +
      '<table style="width:100%"><tr>' +
        '<td style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:' + FLHA_B.dim + '">Overall risk after controls</td>' +
        '<td style="text-align:right;font-size:20px;font-weight:bold;letter-spacing:.05em;color:' + riskColor + '">' + flhaEsc_((r.risk || '—').toUpperCase()) + '</td>' +
      '</tr></table>' +
    '</div>' +
    // meta grid
    '<table style="width:100%;border-collapse:collapse">' +
      '<tr>' + flhaMetaCell_('Date', r.dateStr) + flhaMetaCell_('Start time', r.startTime) + flhaMetaCell_('Field / Shop', r.place) + '</tr>' +
      '<tr>' + flhaMetaCell_('Weather', r.weather) + flhaMetaCell_('New / young worker', r.youngWorker) + flhaMetaCell_('Crew present', r.crewNames) + '</tr>' +
      '<tr>' + flhaMetaCell_('Location', r.location) + '<td colspan="2" style="padding:9px 12px;border:1px solid ' + FLHA_B.line + '"><div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:' + FLHA_B.aurora + '">Job / Task</div><div style="font-size:14px;color:' + FLHA_B.silver + ';margin-top:2px">' + (r.jobTask ? flhaEsc_(r.jobTask) : '—') + '</div></td></tr>' +
    '</table>' +
    flhaSection_('Hazards identified', flhaChips_(r.hazardsStr)) +
    flhaSection_('Controls / mitigations  (eliminate -> substitute -> engineer -> admin -> PPE)', flhaChips_(r.controlsStr)) +
    flhaSection_('Job-specific hazards & what we did', '<div style="white-space:pre-wrap;border-left:2px solid ' + FLHA_B.aurora + ';padding-left:12px">' + flhaEsc_(r.jobHazards || '—') + '</div>') +
    flhaSection_('Pre-work checklist (equipment · pressure · site · containment)', flhaEquipGrid_(r.equipStr)) +
    flhaSection_('PPE on site', flhaChips_(r.ppeStr)) +
    (r.emergencyStr ? flhaSection_('Emergency / site info', flhaEsc_(r.emergencyStr)) : '') +
    (photos ? flhaSection_('Site photos', photos) : '') +
    (r.notes ? flhaSection_('Notes', '<div style="white-space:pre-wrap">' + flhaEsc_(r.notes) + '</div>') : '') +
    flhaSection_('Worker sign-off (verified)', '<div style="color:' + FLHA_B.dim + ';font-size:12px;margin-bottom:8px">Each worker signed with their own PIN — confirming they understand the hazards, are trained for their task, and have the proper PPE. Signatures are server-timestamped and cannot be back-dated.</div>' + sigCards) +
    '<div style="margin-top:24px;padding-top:12px;border-top:1px solid ' + FLHA_B.line + ';color:' + FLHA_B.dim + ';font-size:10.5px;line-height:1.6">' +
      'Submitted by ' + flhaEsc_(r.submitter) + ' &middot; Generated ' + flhaEsc_(flhaNowStamp_()) + '<br>Retain &ge; 5 years (silica / lead exposure records 10+ years). WWW.EVOLVEECOBLASTING.COM &middot; Serving Edmonton &amp; Greater Alberta' +
    '</div>' +
  '</div></div>' +
  '</body></html>';
}

function flhaEmailHtml_(r, pdfUrl) {
  var riskColor = flhaRiskColor_(r.risk);
  return '' +
  '<div style="background:' + FLHA_B.void + ';font-family:Arial,Helvetica,sans-serif;max-width:660px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid ' + FLHA_B.line + '">' +
    '<div style="padding:20px 24px;border-bottom:3px solid ' + FLHA_B.lime + '">' +
      '<div style="color:' + FLHA_B.lime + ';font-size:12px;letter-spacing:.28em;font-weight:bold">EVOLVE ECO BLASTING · SAFETY</div>' +
      '<div style="color:#fff;font-size:23px;font-weight:bold;margin-top:4px">FLHA SUBMITTED</div>' +
      '<div style="color:' + FLHA_B.dim + ';font-size:13px;margin-top:3px">' + flhaEsc_(r.jobTask) + ' · ' + flhaEsc_(r.location) + ' · ' + flhaEsc_(r.dateStr) + '</div>' +
    '</div>' +
    '<div style="padding:18px 24px;color:' + FLHA_B.silver + ';font-size:14px;line-height:1.6">' +
      '<table style="width:100%;margin-bottom:6px"><tr>' +
        '<td style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:' + FLHA_B.dim + '">Overall risk</td>' +
        '<td style="text-align:right;font-size:17px;font-weight:bold;color:' + riskColor + '">' + flhaEsc_((r.risk || '—').toUpperCase()) + '</td>' +
      '</tr></table>' +
      '<p style="margin:6px 0"><span style="color:' + FLHA_B.aurora + '">Signed by (verified):</span> <b style="color:#fff">' + flhaEsc_(r.crewNames) + '</b></p>' +
      '<div style="margin-top:12px"><div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:' + FLHA_B.aurora + ';margin-bottom:4px">Hazards</div>' + flhaChips_(r.hazardsStr) + '</div>' +
      '<div style="margin-top:12px"><div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:' + FLHA_B.aurora + ';margin-bottom:4px">Controls</div>' + flhaChips_(r.controlsStr) + '</div>' +
      '<div style="margin-top:12px"><div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:' + FLHA_B.aurora + ';margin-bottom:4px">Job-specific</div><div style="white-space:pre-wrap">' + flhaEsc_(r.jobHazards || '—') + '</div></div>' +
      ((r.photoLinks && r.photoLinks.length) ? ('<div style="margin-top:12px"><div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:' + FLHA_B.aurora + ';margin-bottom:4px">Site photos</div>' + r.photoLinks.map(function (u, i) { return '<a href="' + flhaEsc_(u) + '" style="color:' + FLHA_B.lime + ';margin-right:12px">📷 Photo ' + (i + 1) + '</a>'; }).join('') + '</div>') : '') +
      (pdfUrl ? ('<p style="margin:18px 0 4px"><a href="' + pdfUrl + '" style="background:' + FLHA_B.lime + ';color:#000;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;letter-spacing:.04em">OPEN SIGNED PDF</a></p>') : '') +
      '<p style="margin:16px 0 0;font-size:11.5px;color:' + FLHA_B.dim + '">Record ' + flhaEsc_(r.id) + ' · logged to the 🦺 FLHA tab · signatures server-timestamped · PDF also attached.</p>' +
    '</div>' +
  '</div>';
}

/* ----------------------------------------------------------------------------
 *  SELF-TEST  — exercises the WHOLE pipeline (verify sig → sheet row → PDF →
 *  Drive → email) end-to-end, but emails ONLY manager@yourcompany.com and marks the
 *  row STATUS='SELF-TEST' so it never spams the owners. Reachable via the
 *  secret-gated router: POST {secret, action:'maint', fn:'flhaSelfTest'}.
 *  The one test row it writes is clearly labelled and safe to delete.
 * --------------------------------------------------------------------------*/
function EV_flhaSelfTest_() {
  var users = readUserNames_ ? readUserNames_() : [];
  var who = (users && users.length) ? users[0] : 'Todd';   // any real, active user
  var ts = Date.now();
  var payload = {
    token: makeToken_(who),
    device: 'self-test/server',
    signatures: [{ name: who, role: 'admin', ts: ts, sig: sign_(who + '|' + ts + '|flha') }],
    flha: {
      location: 'SELF-TEST — shop', date: Utilities.formatDate(new Date(), SAFETY.TZ, 'yyyy-MM-dd'),
      startTime: Utilities.formatDate(new Date(), SAFETY.TZ, 'HH:mm'),
      jobTask: 'FLHA pipeline self-test', place: 'Shop', weather: 'Clear',
      hazards: ['Respirable dust (silica-free media)', 'Noise', 'Compressed air / hose whip'],
      otherHazards: '', risk: 'Low', riskAck: false,
      controls: ['Silica-free media', 'Whip checks + deadman', 'Supplied-air blast hood'],
      controlsNote: 'Automated self-test — verifies sheet + Drive + email wiring.',
      jobHazards: 'Self-test record — confirms the FLHA logs, stores a PDF and emails correctly.',
      equip: 'Whip checks on EVERY hose connection: Yes · O-rings checked / inspected: Yes · Compressor: air filters blown out: Yes · Blast radius secured: Yes · Abrasive media adequately contained: Yes · Water on site (hydration): Yes · SDS available (media & coatings): N/A',
      ppe: ['Blast hood / supplied air', 'Hearing protection', 'Eye / face'],
      youngWorker: 'No', notes: 'Self-test note.',
      emergency: { hospital: 'n/a (test)', muster: 'n/a', firstAid: 'n/a', contact: '911' }
    }
  };
  return flhaSubmitCore_(payload, { emailTo: ['manager@yourcompany.com'], status: 'SELF-TEST' });
}

/* ============================================================================
 *  HAZARD / ISSUE ESCALATION  — a fast lane to make management aware of a
 *  hazard, near-miss or problem. Emails matt@ + todd@ IMMEDIATELY and logs to
 *  the "⚠️ Hazard Reports" tab. Not an FLHA — no sign-off, just "flag it now."
 *  payload = { token, severity, hazardType, location, description, photoLinks[], device }
 * ==========================================================================*/
function apiHazardReport(payload) {
  return hazardReportCore_(payload, { emailTo: SAFETY.EMAIL_TO, status: 'OPEN' });
}

function hazardReportCore_(payload, opts) {
  opts = opts || {};
  var EMAIL_TO = opts.emailTo || SAFETY.EMAIL_TO;
  var STATUS = opts.status || 'OPEN';
  try {
    var reporter = (typeof checkToken_ === 'function') ? checkToken_(payload && payload.token) : null;
    if (!reporter) return { ok: false, error: 'Session expired — please sign in again.' };

    var desc = String((payload && payload.description) || '').trim();
    if (desc.length < 3) return { ok: false, error: 'Please describe the hazard or issue.' };
    var severity = String((payload && payload.severity) || 'Medium').trim();
    var hazardType = String((payload && payload.hazardType) || '').trim();
    var location = String((payload && payload.location) || '').trim();

    var photoLinks = [];
    (payload.photoLinks || []).forEach(function (l) {
      var url = String(l).replace(/^[A-Za-z][A-Za-z ]*:\s+/, '');
      if (/^https?:\/\//i.test(url)) photoLinks.push(url);
    });

    var now = new Date();
    var repId = 'HZ-' + Utilities.formatDate(now, SAFETY.TZ, 'yyMMdd-HHmmss') + '-' + ('00' + Math.floor(Math.random() * 1000)).slice(-3);

    // log the row
    var sh = hazardSheet_(true);
    sh.appendRow([now, repId, severity, hazardType, location, desc, reporter.name, photoLinks.join('\n'), EMAIL_TO.join(', '), STATUS, (payload && payload.device) || '']);

    // email management immediately
    var emailOk = false;
    try {
      var subj = (STATUS === 'SELF-TEST' ? '[SELF-TEST] ' : '') + '⚠️ HAZARD (' + severity.toUpperCase() + ') — ' + (hazardType || 'Issue') + (location ? (' — ' + location) : '');
      var mail = sendEmail_({ to: EMAIL_TO, subject: subj, htmlBody: hazardEmailHtml_({ id: repId, severity: severity, hazardType: hazardType, location: location, desc: desc, reporter: reporter.name, photoLinks: photoLinks }),
        body: severity + ' hazard reported by ' + reporter.name + ': ' + desc });
      emailOk = !!(mail && mail.ok);
    } catch (e) { try { appLog_('Safety', 'Hazard email failed ' + repId + ': ' + e); } catch (_) {} }

    try { appLog_('Safety', 'HAZARD REPORT ' + repId + ' [' + severity + '] by ' + reporter.name + ' — email ' + (emailOk ? 'sent' : 'FAILED') + '.'); } catch (_) {}
    return { ok: true, id: repId, emailed: emailOk, message: 'Reported to management. Matt & Todd have been emailed. Thank you for flagging it.' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function hazardEmailHtml_(r) {
  var sevColor = /crit/i.test(r.severity) ? '#ff2d2d' : (/high/i.test(r.severity) ? '#ff4d4d' : (/med/i.test(r.severity) ? '#ffb020' : FLHA_B.aurora));
  return '' +
  '<div style="background:' + FLHA_B.void + ';font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid ' + sevColor + '">' +
    '<div style="padding:18px 22px;border-bottom:3px solid ' + sevColor + '">' +
      '<div style="color:' + FLHA_B.lime + ';font-size:12px;letter-spacing:.24em;font-weight:bold">EVOLVE ECO BLASTING · SAFETY ESCALATION</div>' +
      '<div style="color:#fff;font-size:22px;font-weight:bold;margin-top:4px">⚠️ HAZARD REPORTED</div>' +
      '<div style="color:' + sevColor + ';font-size:15px;font-weight:bold;margin-top:4px;letter-spacing:.05em">' + flhaEsc_((r.severity || '').toUpperCase()) + (r.hazardType ? (' · ' + flhaEsc_(r.hazardType)) : '') + '</div>' +
    '</div>' +
    '<div style="padding:18px 22px;color:' + FLHA_B.silver + ';font-size:14px;line-height:1.6">' +
      (r.location ? ('<p style="margin:0 0 8px"><span style="color:' + FLHA_B.aurora + '">Location:</span> ' + flhaEsc_(r.location) + '</p>') : '') +
      '<p style="margin:0 0 8px"><span style="color:' + FLHA_B.aurora + '">Reported by:</span> ' + flhaEsc_(r.reporter) + '</p>' +
      '<div style="margin:12px 0;padding:14px 16px;background:rgba(255,255,255,.03);border-left:3px solid ' + sevColor + ';border-radius:6px;white-space:pre-wrap;color:#fff">' + flhaEsc_(r.desc) + '</div>' +
      ((r.photoLinks && r.photoLinks.length) ? ('<div>' + r.photoLinks.map(function (u, i) { return '<a href="' + flhaEsc_(u) + '" style="color:' + FLHA_B.lime + ';margin-right:12px">📷 Photo ' + (i + 1) + '</a>'; }).join('') + '</div>') : '') +
      '<p style="margin:16px 0 0;font-size:11.5px;color:' + FLHA_B.dim + '">Report ' + flhaEsc_(r.id) + ' · logged to the ⚠️ Hazard Reports tab · ' + flhaEsc_(flhaNowStamp_()) + '</p>' +
    '</div>' +
  '</div>';
}

/** Self-test the hazard escalation pipeline (emails the manager only, STATUS=SELF-TEST). */
function EV_hazardSelfTest_() {
  var users = readUserNames_ ? readUserNames_() : [];
  var who = (users && users.length) ? users[0] : 'Todd';
  return hazardReportCore_({
    token: makeToken_(who), device: 'self-test/server',
    severity: 'High', hazardType: 'Equipment', location: 'SELF-TEST — shop',
    description: 'Automated self-test of the hazard escalation email + log pipeline. Safe to ignore/delete.',
    photoLinks: []
  }, { emailTo: ['manager@yourcompany.com'], status: 'SELF-TEST' });
}
