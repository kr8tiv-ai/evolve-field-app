/**
 * ============================================================================
 *  EVOLVE OCR AUTO-FILL — read a receipt and pre-fill the form, for FREE
 * ----------------------------------------------------------------------------
 *  Powers the field app's "✨ Auto-fill from photo" button.
 *
 *  TWO free OCR engines, no paid API / no Gemini key:
 *    1. apiOcrReceipt() — Google Drive's OWN native OCR (fast, accurate). The
 *       client sends a downscaled JPEG; we convert it to a Google Doc with
 *       ocr=true via the Drive REST API using the script's existing Drive scope
 *       (ScriptApp.getOAuthToken — no new authorization), export the text, delete
 *       the temp Doc, and parse vendor/date/total/GST. Drive OCR has a LOW
 *       per-user rate limit, so failures return a CODE the client uses to fall back.
 *    2. apiParseReceiptText() — when Drive OCR is rate-limited/unavailable, the
 *       client runs on-device OCR (Tesseract.js, no quota, no key) and sends the
 *       raw text here to be parsed by the SAME heuristics, so both engines behave
 *       identically.
 *
 *  Best-effort DRAFT the rep reviews — the receipt photo stays the source of
 *  truth and the scheduled router re-verifies on its run.
 *
 *  apiOcrReceipt(token, photo{mimeType,data}) -> {ok, fields:{date,vendor,total,gst}, chars} | {ok:false, code, error}
 *  apiParseReceiptText(token, text)           -> {ok, fields, chars} | {ok:false, error}
 *  EV_testOcrOnFile(fileId) / EV_testOcr()    -> run from the editor to validate.
 * ============================================================================
 */
function apiOcrReceipt(token, photo) {
  var user = checkToken_(token);
  if (!user) return { ok: false, error: 'Session expired — please sign in again.' };
  try {
    var b64 = stripDataUrl_((photo && photo.data) || '');
    if (b64.length > 11000000) return { ok: false, code: 'TOO_BIG', error: 'Photo is too large to read — type it in.' };
    var bytes = Utilities.base64Decode(b64);
    var r = EV_driveOcr_(bytes, (photo && photo.mimeType) || 'image/jpeg');
    if (r.text) return { ok: true, fields: EV_parseReceipt_(r.text), chars: r.text.length };
    if (r.http === 403 || r.http === 429) return { ok: false, code: 'RATE_LIMIT', error: 'Free quick-read is busy right now.' };
    if (r.http === 400) return { ok: false, code: 'BAD_FORMAT', error: 'That image format could not be read.' };
    return { ok: false, code: 'EMPTY', error: 'Could not read the text on that photo.' };
  } catch (err) { return { ok: false, code: 'ERROR', error: String(err) }; }
}

/** Parse OCR text (from on-device Tesseract) with the same heuristics as Drive OCR. */
function apiParseReceiptText(token, text) {
  var user = checkToken_(token);
  if (!user) return { ok: false, error: 'Session expired — please sign in again.' };
  try {
    var t = String(text || '');
    if (!t.trim()) return { ok: false, error: 'No text to parse.' };
    return { ok: true, fields: EV_parseReceipt_(t), chars: t.length };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/** Convert an image to text via Drive's native OCR. Existing Drive scope; no re-auth.
 *  Builds a multipart/related body as RAW BYTES (metadata + raw image + boundary) —
 *  Drive's upload endpoint wants true binary, not base64 text. The metadata must NOT
 *  declare a Doc mimeType (that returns HTTP 400 "OCR is not supported"); convert=true
 *  + the media part's content-type drive the OCR. Retries once on 403/429 (rate limit).
 *  Returns {text, http}. */
function EV_driveOcr_(bytes, mimeType) {
  var t = ScriptApp.getOAuthToken();
  var boundary = '-----evolveOcr' + bytes.length;
  var pre =
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify({ title: 'evolve-ocr-temp' }) + '\r\n' +
    '--' + boundary + '\r\nContent-Type: ' + (mimeType || 'image/jpeg') + '\r\n\r\n';
  var post = '\r\n--' + boundary + '--';
  var payload = Utilities.newBlob(pre).getBytes().concat(bytes).concat(Utilities.newBlob(post).getBytes());
  var url = 'https://www.googleapis.com/upload/drive/v2/files?uploadType=multipart&convert=true&ocr=true&ocrLanguage=en';
  var opts = { method: 'post', contentType: 'multipart/related; boundary=' + boundary, payload: payload,
               headers: { Authorization: 'Bearer ' + t }, muteHttpExceptions: true };

  var res = UrlFetchApp.fetch(url, opts);
  var code = res.getResponseCode();
  if (code === 403 || code === 429) { Utilities.sleep(1600); res = UrlFetchApp.fetch(url, opts); code = res.getResponseCode(); }
  if (code >= 300) {
    var msg = 'Drive insert HTTP ' + code + ': ' + res.getContentText().slice(0, 300);
    Logger.log('OCR ' + msg);
    try { appLog_('OCR', msg); } catch (e) {}
    return { text: '', http: code };
  }
  var id = JSON.parse(res.getContentText()).id;
  var exp = UrlFetchApp.fetch('https://www.googleapis.com/drive/v2/files/' + id + '/export?mimeType=text/plain',
    { headers: { Authorization: 'Bearer ' + t }, muteHttpExceptions: true });
  var text = (exp.getResponseCode() === 200) ? exp.getContentText() : '';
  try { UrlFetchApp.fetch('https://www.googleapis.com/drive/v2/files/' + id, { method: 'delete', headers: { Authorization: 'Bearer ' + t }, muteHttpExceptions: true }); } catch (e) {}
  return { text: text, http: code };
}

/** Heuristic parse of receipt OCR text into {date(ISO), vendor, total, gst}. Best-effort draft. */
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
  if (dm) out.date = EV_isoDate_(dm[1]) || dm[1];

  // Total: prefer an amount near a total keyword (allow a small gap incl. a newline),
  // then the largest $-prefixed amount, then the largest bare decimal.
  var amts = [], re = /(?:grand total|amount due|balance due|total)\b[^0-9$]{0,25}\$?\s*([0-9]{1,5}[.,][0-9]{2})/ig, m;
  while ((m = re.exec(text))) { amts.push(parseFloat(m[1].replace(',', '.'))); }
  if (amts.length) out.total = Math.max.apply(null, amts).toFixed(2);
  else {
    var all = [], re2 = /\$\s*([0-9]{1,5}[.,][0-9]{2})/g, mm;
    while ((mm = re2.exec(text))) all.push(parseFloat(mm[1].replace(',', '.')));
    if (!all.length) { var re3 = /(?:^|\s)([0-9]{1,5}[.,][0-9]{2})(?:\s|$)/g, m3; while ((m3 = re3.exec(text))) all.push(parseFloat(m3[1].replace(',', '.'))); }
    if (all.length) out.total = Math.max.apply(null, all).toFixed(2);
  }

  var gm = text.match(/\b(?:g\.?s\.?t|h\.?s\.?t)\b\s*(?:\d{1,2}\s*%)?[^0-9$]{0,40}\$?\s*([0-9]{1,4}[.,][0-9]{2})/i) ||
           text.match(/\btax\b\s*(?:\d{1,2}\s*%)?[^0-9$]{0,14}\$?\s*([0-9]{1,4}[.,][0-9]{2})/i);
  if (gm) out.gst = parseFloat(gm[1].replace(',', '.')).toFixed(2);
  return out;
}

/** Normalize a matched date string to ISO YYYY-MM-DD, or '' if it can't be resolved. */
function EV_isoDate_(s) {
  if (!s) return '';
  s = String(s).trim();
  function p(n) { n = String(n); return n.length < 2 ? ('0' + n) : n; }
  var m = s.match(/^(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (m) return m[1] + '-' + p(m[2]) + '-' + p(m[3]);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.]((?:20)?\d{2})$/);
  if (m) {
    var a = +m[1], b = +m[2], y = m[3].length === 2 ? ('20' + m[3]) : m[3], mo, d;
    if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else { mo = a; d = b; } // NA month-first default
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return y + '-' + p(mo) + '-' + p(d);
    return '';
  }
  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(20\d{2})$/);
  if (m) {
    var mi = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return m[3] + '-' + p(mi + 1) + '-' + p(m[2]);
  }
  return '';
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
  var r = EV_driveOcr_(blob.getBytes(), blob.getContentType());
  var text = r.text || '';
  var parsed = EV_parseReceipt_(text);
  Logger.log('OCR http ' + r.http + ' chars: ' + text.length + '\nParsed: ' + JSON.stringify(parsed) + '\n--- first 400 chars ---\n' + text.slice(0, 400));
  return { http: r.http, chars: text.length, parsed: parsed, sample: text.slice(0, 400) };
}
