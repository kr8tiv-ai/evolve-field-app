/**
 * ============================================================================
 *  EVOLVE DRIVE INTAKE  (added 2026-06-19)
 * ----------------------------------------------------------------------------
 *  Turns a Drive "drop folder" of loose receipt/quote photos (e.g. the pile Todd
 *  dumped in "Evolve temp") into captured, OCR'd, filed data — for FREE.
 *
 *  For each new image in the drop folder it: OCRs it (Google Drive native OCR on
 *  JPEG/PNG/PDF; HEIC via the Drive thumbnail), reads vendor/date/total with the
 *  hardened parser, content-classifies it (receipt / quote / other), creates a
 *  normal 📥 App Inbox row (Status NEW) so the EXISTING gated filer routes it
 *  (receipt -> Expenses + Receipt Log w/ GST separated; quote -> Quotes), then
 *  moves the file to a "✅ Filed" subfolder so it is never processed twice.
 *
 *  FAIL-SAFE: a file that can't be OCR'd is STILL captured (App Inbox row + photo
 *  link, marked for review) — never skipped, never lost. Append-only; the financial
 *  gate still HOLDs anything with an unreadable total.
 *
 *  SETUP: set EV_DRIVE_INTAKE.FOLDER_ID to the drop folder, then run
 *  EV_installDriveIntake (hourly). One-shot: EV_driveIntakeNow().
 * ============================================================================
 */
var EV_DRIVE_INTAKE = {
  FOLDER_ID:    'YOUR_DROP_FOLDER_ID',   // the Drive folder crew/owner drop loose receipts into
  FILED_SUBFOLDER: '✅ Filed by app',
  MAX_PER_RUN:  25,                       // stay well within Drive OCR's per-user rate limit
  TZ:           'America/Edmonton'
};

function EV_driveIntakeNow() { return EV_driveIntake_(); }

function EV_installDriveIntake() {
  if (String(EV_DRIVE_INTAKE.FOLDER_ID).indexOf('YOUR_') === 0) throw new Error('Set EV_DRIVE_INTAKE.FOLDER_ID to the drop folder first.');
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'EV_driveIntake_') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('EV_driveIntake_').timeBased().everyHours(1).create();
  return 'Drive intake installed (hourly) on folder ' + EV_DRIVE_INTAKE.FOLDER_ID;
}

/** New fixed-length submission id (matches Code.gs format; no id is a prefix of another). */
function EV_newSubId_() {
  return 'SUB-' + Utilities.formatDate(new Date(), EV_DRIVE_INTAKE.TZ, 'yyMMdd-HHmmss') + '-' + ('00' + Math.floor(Math.random() * 1000)).slice(-3);
}

/** Get OCR text from a Drive file: native OCR on the bytes; if that yields nothing
 *  (e.g. HEIC), fall back to the Drive-generated JPEG thumbnail. Returns '' if unreadable. */
function EV_ocrDriveFile_(file) {
  try {
    var blob = file.getBlob();
    var r = EV_driveOcr_(blob.getBytes(), blob.getContentType());
    if (r && r.text && r.text.trim()) return r.text;
  } catch (e) {}
  try {
    var thumb = file.getThumbnail(); // JPEG, works for HEIC/HEIF where native OCR won't
    if (thumb) { var r2 = EV_driveOcr_(thumb.getBytes(), 'image/jpeg'); if (r2 && r2.text) return r2.text; }
  } catch (e2) {}
  return '';
}

/** Classify OCR text into an App Inbox category. */
function EV_classifyDoc_(text) {
  var t = String(text || '').toLowerCase();
  if (/scope of work|quote\s*#|contract value|project value|deposit\s*\(\d|quotation/.test(t)) return 'quote';
  if (/interac|e-?transfer|etransfer|sent you|deposited|payment received|paid in full/.test(t)) return 'quick'; // payment note -> let the router judge
  if (/total|subtotal|gst|hst|invoice|receipt|cash|visa|mastercard|debit|\$\s*\d/.test(t)) return 'receipt';
  return 'receipt'; // a drop-folder default; the financial gate HOLDs it if the total is unreadable
}

function EV_intakeFiledFolder_(drop) {
  var it = drop.getFoldersByName(EV_DRIVE_INTAKE.FILED_SUBFOLDER);
  return it.hasNext() ? it.next() : drop.createFolder(EV_DRIVE_INTAKE.FILED_SUBFOLDER);
}

/** Append a NEW 📥 App Inbox row shaped like a normal capture, so the existing filer routes it. */
function EV_inboxAppendFromDrive_(book, category, summary, fields, photoLink, by) {
  var inbox = EV_sheetEndingWith_(book, 'App Inbox'); if (!inbox) return null;
  var H = inbox.getRange(1, 1, 1, inbox.getLastColumn()).getValues()[0];
  var sub = EV_newSubId_();
  var rowObj = {
    'Timestamp': new Date(), 'Captured By': by || 'Drive intake', 'Category': category,
    'Summary': summary || '', 'Details': JSON.stringify(fields || {}), 'Photo': photoLink || '',
    'Status': 'NEW', 'Submission': sub, 'Raw Category': category
  };
  var arr = new Array(H.length).fill('');
  for (var key in rowObj) { if (rowObj.hasOwnProperty(key)) { var ci = EV_colIndex_(H, key); if (ci >= 0) arr[ci] = EV_safeCell_(rowObj[key]); } }
  inbox.appendRow(arr);
  return sub;
}

/** Main intake pass. Returns a summary object. */
function EV_driveIntake_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return JSON.stringify({ skipped: 'locked' });
  try {
    if (String(EV_DRIVE_INTAKE.FOLDER_ID).indexOf('YOUR_') === 0) return JSON.stringify({ error: 'drop folder not configured' });
    var book = SpreadsheetApp.openById(EV_FILER_SS_ID);
    var drop = DriveApp.getFolderById(EV_DRIVE_INTAKE.FOLDER_ID);
    var filed = EV_intakeFiledFolder_(drop);
    // Collect ids FIRST (moving a file mid-getFiles()-iteration can skip the next one).
    var it = drop.getFiles(), ids = [];
    while (it.hasNext()) { var ff = it.next(); var mm = String(ff.getMimeType() || ''); if (mm.indexOf('image/') === 0 || mm === 'application/pdf') ids.push(ff.getId()); }
    var processed = 0, captured = 0, review = 0, names = [];
    for (var k = 0; k < ids.length && processed < EV_DRIVE_INTAKE.MAX_PER_RUN; k++) {
      var f; try { f = DriveApp.getFileById(ids[k]); } catch (eGet) { continue; }
      processed++;
      var link = f.getUrl();
      var text = EV_ocrDriveFile_(f);
      var cat = EV_classifyDoc_(text);
      var parsed = {}; try { parsed = (text ? EV_parseReceipt_(text) : {}); } catch (e) { parsed = {}; }
      var fields = {
        vendor: parsed.vendor || '', total: parsed.total || '', gst: parsed.gst || '', date: parsed.date || '',
        about: cat, source: 'Drive intake (' + f.getName() + ')', ocr_chars: String(text).length
      };
      var summary = (parsed.vendor ? parsed.vendor : f.getName()) + (parsed.total ? (' $' + parsed.total) : '');
      try {
        var sub = EV_inboxAppendFromDrive_(book, cat === 'receipt' ? 'Receipt / Expense' : (cat === 'quote' ? 'Build a Quote' : 'Quick Capture'), summary, fields, link, 'Drive intake');
        captured++;
        if (!text) review++;
        // move out of the drop folder so it isn't reprocessed
        try { f.moveTo(filed); } catch (eMove) { try { filed.addFile(f); drop.removeFile(f); } catch (e2) {} }
        names.push(f.getName() + '->' + cat + (text ? '' : ' (no OCR)'));
      } catch (eRow) { /* leave the file in place to retry next run */ }
    }
    if (captured) { try { EV_fileInbox_(); } catch (e) {} } // route the new rows immediately
    var msg = 'Drive intake: ' + captured + ' captured (' + review + ' need review), ' + processed + ' scanned [' + names.join('; ').slice(0, 250) + ']';
    if (processed) { try { appLog_('DriveIntake', msg); } catch (e) {} }
    return JSON.stringify({ captured: captured, review: review, scanned: processed });
  } catch (err) {
    try { appLog_('DriveIntake', 'ERROR: ' + err); } catch (e) {}
    return JSON.stringify({ error: String(err) });
  } finally { try { lock.releaseLock(); } catch (e) {} }
}
