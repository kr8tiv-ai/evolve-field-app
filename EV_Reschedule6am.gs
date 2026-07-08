function EV_setDigest6am() {
  EV_deleteTriggers_(['EV_morningDigest','EV_personalDigest']);
  ScriptApp.newTrigger('EV_morningDigest').timeBased().atHour(6).nearMinute(0).everyDays(1).create();
  return EV_listTriggers();
  }

  function EV_testDigestToMatt() {
    var html = EV_buildMorningDigestHtml_();   // FIX 2026-07-08: use the CANONICAL v2 builder so the test matches what the 6 AM trigger actually sends (was V3 → test didn't match prod)
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
    case 'setupSafety':    return { ok: true, fn: fn, result: (typeof setupSafety === 'function') ? setupSafety() : 'setupSafety missing' };
    case 'flhaSelfTest':   return { ok: true, fn: fn, result: (typeof EV_flhaSelfTest_ === 'function') ? EV_flhaSelfTest_() : 'EV_flhaSelfTest_ missing' };
    case 'hazardSelfTest': return { ok: true, fn: fn, result: (typeof EV_hazardSelfTest_ === 'function') ? EV_hazardSelfTest_() : 'EV_hazardSelfTest_ missing' };
    case 'writeStartHere': return { ok: true, fn: fn, result: EV_writeStartHere() };
    case 'writeQandA':     return { ok: true, fn: fn, result: EV_writeQandA() };
    case 'writeHours':     return { ok: true, fn: fn, result: EV_writeHours() };
    case 'previewDigest':  return { ok: true, fn: fn, result: EV_previewDigest() };
    case 'testDigestSend': return { ok: true, fn: fn, result: EV_sendTestDigest_(body.to) };
    case 'renderV2':       return { ok: true, fn: fn, result: (function(){ try { return EV_buildMorningDigestHtml_(); } catch(e){ return 'V2 ERROR: '+e; } })() };
    case 'renderV3direct': return { ok: true, fn: fn, result: (function(){ try { return EV_buildDigestV3_(); } catch(e){ return 'V3 THREW: '+e; } })() };
    case 'whatMorningSends':return { ok: true, fn: fn, result: (function(){ try{ EV_buildMorningDigestHtml_(); return 'V2 (canonical Borealis digest) — EV_morningDigest builds this at 6 AM. (V3/V1 builders exist but are not wired to any send.)'; }catch(e){ return 'V2 builder THREW: '+e; } })() };
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