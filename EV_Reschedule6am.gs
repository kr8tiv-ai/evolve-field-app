function EV_setDigest6am() {
  EV_deleteTriggers_(['EV_morningDigest','EV_personalDigest']);
  ScriptApp.newTrigger('EV_morningDigest').timeBased().atHour(6).nearMinute(0).everyDays(1).create();
  return EV_listTriggers();
  }

  function EV_testDigestToMatt() {
    var html = EV_buildDigestV3_();
    var subj = 'TEST (Matt only) - Evolve Morning Digest 6 AM reschedule check ' + EV_fmt_(EV_now_(), 'MMM d HH:mm');
    EV_send_('manager@yourcompany.com', subj, html);
    return 'test digest sent to manager@yourcompany.com only';
    }


/**
 * Whitelisted maintenance dispatcher, reachable through the secret-gated router
 * doPost (action:'maint'). Runs server-side as the deploying user (Matt) with the
 * full project scopes, so it can install triggers / send the digest without the
 * Apps Script editor. Only the explicit cases below are callable.
 */
function EV_maintAction_(body) {
  var fn = String((body && body.fn) || '');
  switch (fn) {
    case 'setDigest6am':   return { ok: true, fn: fn, result: EV_setDigest6am() };
    case 'testDigestMatt': return { ok: true, fn: fn, result: EV_testDigestToMatt() };
    case 'listTriggers':   return { ok: true, fn: fn, result: EV_listTriggers() };
    case 'snapshotTriggers': return { ok: true, fn: fn, result: EV_snapshotTriggers_() };
    case 'fixTriggers':    return { ok: true, fn: fn, result: EV_fixTriggers_() };
    case 'runDigest':      return { ok: true, fn: fn, result: EV_morningDigest() };
    // Safety/FLHA maint hooks (restored 2026-07-11 — were lost in a stale-copy push; keep alongside the digest cases)
    case 'setupSafety':    return { ok: true, fn: fn, result: (typeof setupSafety === 'function') ? setupSafety() : 'setupSafety missing' };
    case 'flhaSelfTest':   return { ok: true, fn: fn, result: (typeof EV_flhaSelfTest_ === 'function') ? EV_flhaSelfTest_() : 'EV_flhaSelfTest_ missing' };
    case 'hazardSelfTest': return { ok: true, fn: fn, result: (typeof EV_hazardSelfTest_ === 'function') ? EV_hazardSelfTest_() : 'EV_hazardSelfTest_ missing' };
    case 'writeStartHere': return { ok: true, fn: fn, result: EV_writeStartHere() };
    case 'writeQandA':     return { ok: true, fn: fn, result: EV_writeQandA() };
    case 'writeHours':     return { ok: true, fn: fn, result: EV_writeHours() };
    case 'previewDigest':  return { ok: true, fn: fn, result: EV_previewDigest() };
    case 'writeChatList':  return { ok: true, fn: fn, result: EV_writeChatList_() };
    case 'writeGovernance':return { ok: true, fn: fn, result: EV_writeGovernance_() };
    case 'writeMaintenance':return { ok: true, fn: fn, result: EV_writeMaintenance_() };
    case 'digestDiag':     return { ok: true, fn: fn, result: EV_digestDiag_() };
    case 'sendCopy':       return { ok: true, fn: fn, result: EV_sendDigestCopy_(body.to) };
    case 'sysDiag':        return { ok: true, fn: fn, result: EV_sysDiag_() };
    case 'testDigestSend': return { ok: true, fn: fn, result: EV_sendTestDigest_(body.to) };
    case 'renderV2':       return { ok: true, fn: fn, result: (function(){ try { return EV_buildMorningDigestHtml_(); } catch(e){ return 'V2 ERROR: '+e; } })() };
    case 'renderV3direct': return { ok: true, fn: fn, result: (function(){ try { return EV_buildDigestV3_(); } catch(e){ return 'V3 THREW: '+e; } })() };
    case 'whatMorningSends':return { ok: true, fn: fn, result: (function(){ var h=''; try{ h=EV_buildDigestV3_(); }catch(e){ return 'V3 THREW -> fallback V2. err='+e; } return (h.indexOf('#0a0a0a')>=0?'V3 (dark) - no throw':'V2/other'); })() };
    default:               return { ok: false, error: 'maint: unknown fn ' + fn };
  }
}

/** Full snapshot of every installable trigger (handler, event type, unique id). */
function EV_snapshotTriggers_() {
  return ScriptApp.getProjectTriggers().map(function (t) {
    return { fn: t.getHandlerFunction(), type: String(t.getEventType()), id: t.getUniqueId() };
  });
}

/**
 * DEFINITIVE trigger rebuild — runs server-side as the owner from HEAD code, so the
 * recreated time-based triggers run the latest saved project code (the v2 digest), not
 * a pinned web-app version. Removes ALL EV_morningDigest / EV_personalDigest / EV_dispatchSweep
 * triggers (clearing any stale or Google-disabled ones) and recreates exactly:
 *   EV_morningDigest @ 06:00  ·  EV_dispatchSweep @ 07:05 / 13:00 / 19:00  (America/Edmonton).
 * Never touches EV_runBackup, EV_replyMonitor, EV_routerWatch, EV_syncWonJobs, etc.
 */
function EV_fixTriggers_() {
  var before = EV_snapshotTriggers_();
  var kill = { EV_morningDigest: 1, EV_personalDigest: 1, EV_dispatchSweep: 1 };
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (kill[t.getHandlerFunction()]) { ScriptApp.deleteTrigger(t); removed++; }
  });
  ScriptApp.newTrigger('EV_morningDigest').timeBased().atHour(6).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('EV_dispatchSweep').timeBased().atHour(7).nearMinute(5).everyDays(1).create();
  ScriptApp.newTrigger('EV_dispatchSweep').timeBased().atHour(13).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('EV_dispatchSweep').timeBased().atHour(19).nearMinute(0).everyDays(1).create();
  try { appLog_('Autopilot', 'Triggers rebuilt on HEAD: morningDigest@06:00, dispatchSweep@07:05/13:00/19:00 (removed ' + removed + ' old).'); } catch (e) {}
  return { removedOld: removed, before: before, after: EV_snapshotTriggers_(), timeZone: (typeof EV !== 'undefined' && EV.TZ) ? EV.TZ : 'America/Edmonton' };
}

/* ---- Diagnostics + true-copy send (added 2026-07-12 to investigate the 6 AM non-send) ---- */
function EV_digestDiag_() {
  var out = {};
  out.now = EV_fmt_(EV_now_(), 'yyyy-MM-dd HH:mm');
  out.tz = EV.TZ;
  out.digestTo = EV.DIGEST_TO;
  try {
    out.triggers = ScriptApp.getProjectTriggers().map(function (t) {
      return t.getHandlerFunction() + ' [' + String(t.getEventType()) + ']';
    });
  } catch (e) { out.trigErr = String(e); }
  try {
    var book = EV_book_();
    var sh = EV_sheetEndingWith_(book, 'App Log');
    var lr = sh.getLastRow(), lc = sh.getLastColumn();
    var start = Math.max(1, lr - 600);
    var v = sh.getRange(start, 1, lr - start + 1, lc).getDisplayValues();
    var hits = [];
    for (var i = 0; i < v.length; i++) {
      var row = v[i].join(' | ');
      if (/digest|morning/i.test(row)) hits.push(row.substring(0, 170));
    }
    out.lastLogRow = lr;
    out.digestLogTail = hits.slice(-14);
  } catch (e) { out.logErr = String(e); }
  return out;
}

function EV_sendDigestCopy_(to) {
  var html = EV_buildMorningDigestHtml_();
  var subject = 'Evolve Morning Digest - review copy (' + EV_fmt_(EV_now_(), 'MMMM d, yyyy') + ')';
  EV_send_(to || EV.MATT, subject, html);
  try { EV_makeDigestVisible_(subject); } catch (e) {}
  return { ok: true, sentTo: (to || EV.MATT), subject: subject, bytes: html.length };
}


/* ---- System diagnostic (added 2026-07-12): per-automation last-seen, errors, lock state ---- */
function EV_sysDiag_() {
  var out = { now: EV_fmt_(EV_now_(), 'yyyy-MM-dd HH:mm'), tz: EV.TZ };
  try {
    var tg = ScriptApp.getProjectTriggers();
    var counts = {};
    tg.forEach(function (t) { var f = t.getHandlerFunction(); counts[f] = (counts[f] || 0) + 1; });
    out.triggers = counts;
  } catch (e) { out.trigErr = String(e); }
  try {
    var sh = EV_sheetEndingWith_(EV_book_(), 'App Log');
    var lr = sh.getLastRow(), lc = sh.getLastColumn();
    var start = Math.max(1, lr - 900);
    var v = sh.getRange(start, 1, lr - start + 1, lc).getDisplayValues();
    var keys = ['MORNING DIGEST', 'dispatchSweep', 'sweep', 'routerWatch', 'router', 'runBackup', 'backup', 'replyMonitor', 'reply', 'driveIntake', 'receipt', 'syncWon', 'insight', 'heartbeat'];
    var lastSeen = {}, errors = [];
    for (var i = 0; i < v.length; i++) {
      var ts = String(v[i][0]), row = v[i].join(' | '), low = row.toLowerCase();
      for (var k = 0; k < keys.length; k++) { if (low.indexOf(keys[k].toLowerCase()) >= 0) lastSeen[keys[k]] = ts; }
      if (/error|fail|exception|stall|stuck|lock|throw|unable|timeout|denied|quota/i.test(row)) errors.push(ts + ' :: ' + row.substring(0, 150));
    }
    out.lastLogRow = lr;
    out.lastSeen = lastSeen;
    out.recentErrors = errors.slice(-18);
  } catch (e) { out.logErr = String(e); }
  try {
    var lock = LockService.getScriptLock();
    var got = lock.tryLock(300);
    out.scriptLockFree = got;
    if (got) lock.releaseLock();
  } catch (e) { out.lockErr = String(e); }
  return out;
}
