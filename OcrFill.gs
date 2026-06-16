/**
 * ============================================================================
 *  EVOLVE OCR AUTO-FILL — read a receipt and pre-fill the form, for FREE
 * ----------------------------------------------------------------------------
 *  Powers the field app's "✨ Auto-fill from photo" button. Uses Google Drive's
 *  OWN native OCR (no paid API, no Gemini key): the image is converted to a
 *  Google Doc with ocr=true via the Drive REST API using the script's existing
 *  Drive scope (ScriptApp.getOAuthToken — no new authorization needed), the text
 *  is exported, the temp Doc is deleted, and we parse vendor/date/total/GST.
 *
 *  This is a best-effort DRAFT the rep reviews — the receipt photo remains the
 *  source of truth and the scheduled router re-verifies on its run.
 *
 *  apiOcrReceipt(token, photo{mimeType,data(base64)}) -> {ok, fields:{date,vendor,total,gst}, chars}
 *  EV_testOcrOnFile(fileId) — run from the editor on a real receipt to validate.
 * ============================================================================
 */
function apiOcrReceipt(token, photo) {
  var user = checkToken_(token);
  if (!user) return { ok: false, error: 'Session expired — please sign in again.' };
  try {
    var bytes = Utilities.base64Decode(stripDataUrl_(photo.data));
    var text = EV_driveOcr_(bytes, photo.mimeType || 'image/jpeg');
    if (!text) return { ok: false, error: 'Could not read that photo — type it in.' };
    return { ok: true, fields: EV_parseReceipt_(text), chars: text.length };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/** Convert an image to text via Drive's native OCR. Existing Drive scope; no re-auth.
 *  Builds a multipart/related body as RAW BYTES (metadata + raw image + boundary) —
 *  Drive's upload endpoint wants true binary, not base64 text. */
function EV_driveOcr_(bytes, mimeType) {
  var t = ScriptApp.getOAuthToken();
  var boundary = '-----evolveOcr' + bytes.length;
  var pre =
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify({ title: 'evolve-ocr-temp' }) + '\r\n' +
    '--' + boundary + '\r\nContent-Type: ' + (mimeType || 'image/jpeg') + '\r\n\r\n';
  var post = '\r\n--' + boundary + '--';
  var payload = Utilities.newBlob(pre).getBytes()
    .concat(bytes)
    .concat(Utilities.newBlob(post).getBytes());
  var res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v2/files?uploadType=multipart&convert=true&ocr=true&ocrLanguage=en',
    { method: 'post', contentType: 'multipart/related; boundary=' + boundary, payload: payload,
      headers: { Authorization: 'Bearer ' + t }, muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) {
    var msg = 'Drive insert HTTP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300);
    Logger.log('OCR ' + msg);
    try { appLog_('OCR', msg); } catch (e) {}
    return '';
  }
  var id = JSON.parse(res.getContentText()).id;
  var exp = UrlFetchApp.fetch('https://www.googleapis.com/drive/v2/files/' + id + '/export?mimeType=text/plain',
    { headers: { Authorization: 'Bearer ' + t }, muteHttpExceptions: true });
  var text = (exp.getResponseCode() === 200) ? exp.getContentText() : '';
  try { UrlFetchApp.fetch('https://www.googleapis.com/drive/v2/files/' + id, { method: 'delete', headers: { Authorization: 'Bearer ' + t }, muteHttpExceptions: true }); } catch (e) {}
  return text;
}

/** Heuristic parse of receipt OCR text into {date, vendor, total, gst}. Best-effort draft. */
function EV_parseReceipt_(text) {
  var lines = String(text).split(/\r?\n/).map(function (l) { return l.trim(); }).filter(String);
  var out = { date: '', vendor: '', total: '', gst: '' };

  for (var i = 0; i < lines.length && i < 8; i++) {
    if (/[A-Za-z]{3,}/.test(lines[i]) &&
        !/^(receipt|invoice|transaction|record|duplicate|reprint|merchant|customer|copy|tel|phone|fax|www|http|store|cashier|order|date|time|terminal|ref|auth)/i.test(lines[i])) {
      out.vendor = lines[i]; break;
    }
  }
  var dm = text.match(/\b(20\d{2}[-\/.](?:0?[1-9]|1[0-2])[-\/.](?:0?[1-9]|[12]\d|3[01]))\b/) ||
           text.match(/\b((?:0?[1-9]|[12]\d|3[01])[-\/.](?:0?[1-9]|1[0-2])[-\/.](?:20)?\d{2})\b/) ||
           text.match(/\b((?:0?[1-9]|1[0-2])[-\/.](?:0?[1-9]|[12]\d|3[01])[-\/.](?:20)?\d{2})\b/) ||
           text.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+20\d{2})\b/i);
  if (dm) out.date = dm[1];

  var amts = [], re = /(?:total|amount due|balance due|grand total)\b[^0-9$]{0,14}\$?\s*([0-9]{1,5}[.,][0-9]{2})/ig, m;
  while ((m = re.exec(text))) { amts.push(parseFloat(m[1].replace(',', '.'))); }
  if (amts.length) out.total = Math.max.apply(null, amts).toFixed(2);
  else {
    var all = [], re2 = /\$\s*([0-9]{1,5}[.,][0-9]{2})/g, mm;
    while ((mm = re2.exec(text))) all.push(parseFloat(mm[1].replace(',', '.')));
    if (all.length) out.total = Math.max.apply(null, all).toFixed(2);
  }
  var gm = text.match(/\b(?:g\.?s\.?t|h\.?s\.?t)\b\s*(?:\d{1,2}\s*%)?[^0-9$]{0,40}\$?\s*([0-9]{1,4}[.,][0-9]{2})/i) ||
           text.match(/\btax\b\s*(?:\d{1,2}\s*%)?[^0-9$]{0,14}\$?\s*([0-9]{1,4}[.,][0-9]{2})/i);
  if (gm) out.gst = parseFloat(gm[1].replace(',', '.')).toFixed(2);
  return out;
}

/** Validate live (zero-arg): OCRs the NEWEST receipt image in the receipts folder. Run from editor. */
function EV_testOcr() {
  var folder = DriveApp.getFolderById(CONFIG.DRIVE.RECEIPTS);
  var it = folder.getFiles(), newest = null, newestT = 0;
  while (it.hasNext()) {
    var f = it.next();
    if (String(f.getMimeType()).indexOf('image') === 0) {
      var ts = f.getDateCreated().getTime();
      if (ts > newestT) { newestT = ts; newest = f; }
    }
  }
  if (!newest) { Logger.log('No receipt images found.'); return 'none'; }
  Logger.log('Testing OCR on: ' + newest.getName());
  return EV_testOcrOnFile(newest.getId());
}

/** Validate live: Run on a real receipt Drive file id; logs OCR length + parsed fields. */
function EV_testOcrOnFile(fileId) {
  var blob = DriveApp.getFileById(fileId).getBlob();
  var text = EV_driveOcr_(blob.getBytes(), blob.getContentType());
  var parsed = EV_parseReceipt_(text);
  Logger.log('OCR chars: ' + text.length + '\nParsed: ' + JSON.stringify(parsed) + '\n--- first 400 chars ---\n' + text.slice(0, 400));
  return { chars: text.length, parsed: parsed, sample: text.slice(0, 400) };
}
