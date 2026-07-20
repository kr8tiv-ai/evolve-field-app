/**
 * ============================================================================
 *  EVOLVE INTAKE VALIDATION  (added 2026-07-19)
 * ----------------------------------------------------------------------------
 *  WHY THIS EXISTS
 *    The intake write path used to pass crew/OCR strings straight into typed
 *    columns. Two ways that bit us:
 *
 *      1. Spend CATEGORY. EV_fileExpense_ wrote
 *             details.category || details.about || 'Field App'
 *         but `about` is a ROUTING HINT, not a spend category. DriveIntake sets
 *         about = the classifier verdict ('receipt' | 'quick' | 'inventory' | …)
 *         and the Quick Capture form's `about` select emits labels like
 *         'Receipt / expense'. So the literal strings "receipt", "quick",
 *         "Receipt / expense" and the hardcoded "Field App" became the largest
 *         slices of the spend donut. (56 of 118 Receipt Log rows read "receipt".)
 *
 *      2. Anything unvalidated is invisible until it distorts a report. Nobody
 *         reads the Category column; they read the dashboard.
 *
 *  THE RULE HERE
 *    A value only reaches a typed column if it validates against the controlled
 *    list. If it cannot be validated we write an explicit 'Uncategorized' and a
 *    human-readable note in the Issue/discrepancy column. We never silently
 *    invent a plausible-looking value, and we never write a routing hint.
 *
 *  Canonical list source of truth: the Lists tab, column "ExpCat".
 *  EV_CAT_EXTRA_ carries categories the humans are actively using in the book
 *  that are not yet in Lists!ExpCat — see the note on that constant.
 * ============================================================================
 */

/** Categories from Lists!ExpCat as of 2026-07-19 — the fallback if the tab can't be read. */
var EV_CAT_BASE_ = [
  'Fuel / Diesel', 'Media / Materials', 'PPE', 'Equipment',
  'Repairs', 'Shop supplies', 'Travel / Lodging', 'Other'
];

/** In active use in Expenses / Receipt Log but NOT yet in Lists!ExpCat.
 *  These were chosen by a human (ops promote / manual receipt batches), so they are
 *  real categories, not junk — accepting them keeps us from "correcting" Todd's own
 *  vocabulary. TODO(ops): add these to the Lists!ExpCat column so the app's dropdown
 *  offers them too; this constant can shrink as they land there. */
var EV_CAT_EXTRA_ = [
  'Crew provisions', 'Maintenance', 'Marketing', 'Office / Shipping'
];

/** Written when nothing validates. Deliberately obvious in a pivot/donut. */
var EV_CAT_UNKNOWN_ = 'Uncategorized';

/** Tokens that are NEVER a spend category: capture-mode ids, DriveIntake classifier
 *  verdicts, Quick-Capture `about` labels, and the old hardcoded fallback. We refuse
 *  these outright and never try to infer from them. */
var EV_CAT_JUNK_ = [
  'receipt', 'quick', 'quote', 'inventory', 'label', 'blank', 'review',
  'job photo', 'job_photo', 'before_after', 'before / after', 'lead', 'customer',
  'field app', 'drive intake', 'capture', 'quick capture', 'reference photo',
  'receipt / expense', 'receipt/expense', 'lead / customer', 'task / reminder',
  'not sure - let claude decide', 'not sure — let claude decide', 'request / report',
  'build a quote', 'inventory / photo', 'new lead', 'uncategorized', 'n/a', 'na', 'none', 'null', 'undefined'
];

/** High-confidence vendor/keyword -> category. Ordered: first match wins, so the
 *  specific patterns sit above the generic ones. Only add a rule here when the match
 *  is unambiguous enough to book against a job without a human looking. */
var EV_CAT_RULES_ = [
  ['Fuel / Diesel',     /\b(petro[- ]?canada|esso|shell|husky|centex|chevron|mobil|fas ?gas|7-?eleven fuel|gas ?bar|cardlock|diesel|biodiesel|gasoline|propane|fuel)\b/i],
  ['Media / Materials', /\b(sil industrial|sil minerals|sil ?7|abrasive|blast media|garnet|corn ?cob|walnut shell|glass media|silica|20\/40|2040 grade|ds2000|black beauty)\b/i],
  ['PPE',               /\b(respirator|cartridge|tyvek|coverall|face ?shield|hearing protection|ear ?plug|safety glass|hard ?hat|work glove|steel toe)\b/i],
  ['Office / Shipping', /\b(canada post|purolator|fedex|ups store|staples|postage|shipping|courier|best copy|printing)\b/i],
  ['Travel / Lodging',  /\b(hotel|motel|\binn\b|lodging|campground|air ?canada|westjet|airbnb)\b/i],
  ['Repairs',           /\b(car ?wash|oil change|mechanic|autobody|tire|muffler|transmission|repair|servicing)\b/i],
  ['Crew provisions',   /\b(tim horton|mcdonald|a&w|subway|starbucks|dairy queen|coffee|donut|water|drinks|snack|groceries|co-?op food)\b/i],
  ['Equipment',         /\b(compressor|generator|nozzle|deadman|blast pot|pressure washer|air ?hose)\b/i],
  ['Shop supplies',     /\b(home depot|home hardware|rona|canadian tire|princess auto|lumber|hardware|tuck tape|duct tape|fastener|screws|zip ?tie)\b/i]
];

/** Normalize for comparison: lowercase, collapse punctuation/whitespace. */
function EV_normCatKey_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[\s\-_/&.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The allowed category list: Lists!ExpCat (live) UNION the in-use extras.
 *  Cached per execution — the Lists tab does not change mid-run. */
var EV_CAT_CACHE_ = null;
function EV_catAllowed_(book) {
  if (EV_CAT_CACHE_) return EV_CAT_CACHE_;
  var out = EV_CAT_BASE_.concat(EV_CAT_EXTRA_);
  try {
    book = book || SpreadsheetApp.openById(EV_FILER_SS_ID);
    var sh = EV_sheetEndingWith_(book, 'Lists');
    if (sh) {
      var v = sh.getDataRange().getValues();
      var ci = EV_colIndex_(v[0] || [], 'ExpCat');
      if (ci >= 0) {
        for (var r = 1; r < v.length; r++) {
          var val = String(v[r][ci] || '').trim();
          if (!val) continue;
          var dup = false;
          for (var i = 0; i < out.length; i++) { if (EV_normCatKey_(out[i]) === EV_normCatKey_(val)) { dup = true; break; } }
          if (!dup) out.push(val);
        }
      }
    }
  } catch (e) { /* fall back to the constants — never block a receipt on a list read */ }
  EV_CAT_CACHE_ = out;
  return out;
}

/** Is this string a known non-category (mode id / classifier verdict / placeholder)? */
function EV_isJunkCat_(raw) {
  var k = EV_normCatKey_(raw);
  if (!k) return true;
  for (var i = 0; i < EV_CAT_JUNK_.length; i++) {
    if (k === EV_normCatKey_(EV_CAT_JUNK_[i])) return true;
  }
  return false;
}

/** Exact (punctuation-insensitive) match against the allowed list.
 *  Returns the CANONICAL spelling, or '' if not allowed. */
function EV_matchCat_(raw, book) {
  var k = EV_normCatKey_(raw);
  if (!k) return '';
  var allowed = EV_catAllowed_(book);
  for (var i = 0; i < allowed.length; i++) {
    if (EV_normCatKey_(allowed[i]) === k) return allowed[i];
  }
  return '';
}

/** Infer a category from vendor + line-item text. Returns '' when nothing is
 *  confident enough — an honest blank beats a wrong number on a job P&L. */
function EV_inferCategory_(vendor, text, book) {
  var hay = (String(vendor || '') + ' ' + String(text || '')).slice(0, 500);
  if (!hay.trim()) return '';
  for (var i = 0; i < EV_CAT_RULES_.length; i++) {
    if (EV_CAT_RULES_[i][1].test(hay)) {
      // Only return it if it is actually an allowed category (list may be overridden).
      var m = EV_matchCat_(EV_CAT_RULES_[i][0], book);
      if (m) return m;
    }
  }
  return '';
}

/**
 * THE gate for the spend Category column.
 *   details  — the parsed Details(JSON) from the App Inbox row
 *   summary  — the inbox Summary (free text)
 *   vendor   — the resolved vendor string
 * Returns { value, note, source } where:
 *   value  = a canonical category, or EV_CAT_UNKNOWN_ — never a routing hint
 *   note   = '' or a human-readable string for the Issue/discrepancy column
 *   source = 'crew' | 'inferred' | 'unknown'  (for logging/debugging)
 *
 * NOTE: details.about is deliberately NOT consulted. It is a routing hint
 * (DriveIntake classifier verdict / Quick-Capture "what kind of thing?" select)
 * and reading it here is exactly what produced the "receipt"/"quick" junk.
 */
function EV_normalizeCategory_(details, summary, vendor, book) {
  details = details || {};
  var raw = details.category;
  if (raw == null || String(raw).trim() === '') raw = details.expenseCategory || details.expcat || '';

  // 1) The crew picked something. Accept it only if it validates.
  if (String(raw).trim() !== '' && !EV_isJunkCat_(raw)) {
    var hit = EV_matchCat_(raw, book);
    if (hit) return { value: hit, note: '', source: 'crew' };
  }

  // 2) Nothing usable was typed (or it was a junk token). Try to infer.
  var itemText = [details.item, details.what, details.purchased, details.notes, summary].join(' ');
  var inferred = EV_inferCategory_(vendor, itemText, book);
  if (inferred) {
    var why = (String(raw).trim() === '')
      ? 'category was blank'
      : ('app sent a non-category value "' + String(raw).trim() + '"');
    return {
      value: inferred,
      note: 'category inferred as "' + inferred + '" from vendor/items (' + why + ') — verify',
      source: 'inferred'
    };
  }

  // 3) Give up loudly rather than write something plausible-looking.
  var detail = (String(raw).trim() === '')
    ? 'no category supplied'
    : ('rejected non-category value "' + String(raw).trim() + '"');
  return {
    value: EV_CAT_UNKNOWN_,
    note: 'NEEDS CATEGORY — ' + detail + '; pick one of: ' + EV_catAllowed_(book).join(' / '),
    source: 'unknown'
  };
}

/**
 * For routines that COPY an existing category from one tab to another (the Receipt Log
 * backfill, the Vendors rebuild). Never invents and never infers — it only refuses to
 * propagate a value that is not a real category, so historical junk stops at the tab it
 * is already in instead of being laundered into a second one.
 * Does NOT modify the source row: existing data stays exactly as it is for Matt to rule on.
 */
function EV_cleanExistingCat_(raw, book) {
  return EV_matchCat_(raw, book) || EV_CAT_UNKNOWN_;
}

/**
 * Boundary-safe test for "does this Receipt Log Source cell refer to submission `sub`?"
 * The Source cell now carries a cross-reference suffix, e.g.
 *   "SUB-260718-084453-456 — MIRRORS Expenses row 63 (do NOT sum both tabs)"
 * so an exact === match no longer works. Boundary-safe so SUB-…-5 never matches SUB-…-57.
 */
function EV_srcHasSub_(cellValue, sub) {
  if (!sub) return false;
  var s = String(cellValue == null ? '' : cellValue);
  if (s === String(sub)) return true;
  try {
    var esc = String(sub).replace(/[.*+?^${}()|[\]\\\-]/g, '\\$&');
    return new RegExp('(^|[^0-9A-Za-z])' + esc + '(?![0-9A-Za-z])').test(s);
  } catch (e) { return s.indexOf(String(sub)) === 0; }
}

/**
 * RECONCILIATION SAFETY NET.
 * Every app-filed receipt must exist in BOTH Expenses and the Receipt Log. This
 * reports Expenses rows carrying a SubID with no matching Receipt Log Source, so a
 * silent mirror failure surfaces instead of quietly starving job costing.
 * Read-only: it reports, it does not write. Run from the editor or via maint.
 */
function EV_auditExpenseVsReceiptLog_(book) {
  var out = { ok: true, checked: 0, missing: [], note: '' };
  try {
    book = book || SpreadsheetApp.openById(EV_FILER_SS_ID);
    var exp = EV_sheetEndingWith_(book, 'Expenses');
    var rl = EV_sheetEndingWith_(book, 'Receipt Log');
    if (!exp || !rl) { out.ok = false; out.note = 'Expenses or Receipt Log tab not found'; return out; }

    var rlv = rl.getDataRange().getValues();
    var sources = [];
    for (var i = 1; i < rlv.length; i++) sources.push(String(rlv[i][11] || ''));

    var ev = exp.getDataRange().getValues();
    var hr = EV_headerIndex_(ev, ['date', 'vendor', 'total']);
    if (hr < 0) { out.ok = false; out.note = 'Expenses header row not found'; return out; }
    var H = ev[hr];
    var ciDesc = EV_colIndex_(H, 'Description'), ciVendor = EV_colIndex_(H, 'Vendor'),
        ciTotal = EV_colIndex_(H, 'Total'), ciDate = EV_colIndex_(H, 'Date');

    for (var r = hr + 1; r < ev.length; r++) {
      var desc = String((ciDesc >= 0 ? ev[r][ciDesc] : '') || '');
      var m = desc.match(/SubID:\s*(\S+)/);
      if (!m) continue;
      var sub = m[1];
      out.checked++;
      var found = false;
      for (var k = 0; k < sources.length; k++) { if (EV_srcHasSub_(sources[k], sub)) { found = true; break; } }
      if (!found) {
        out.missing.push({
          expensesRow: r + 1,
          sub: sub,
          date: String((ciDate >= 0 ? ev[r][ciDate] : '') || ''),
          vendor: String((ciVendor >= 0 ? ev[r][ciVendor] : '') || ''),
          total: String((ciTotal >= 0 ? ev[r][ciTotal] : '') || '')
        });
      }
    }
    out.note = out.checked + ' app-filed Expenses row(s) checked, ' + out.missing.length + ' missing from the Receipt Log.';
    if (out.missing.length) { try { appLog_('Receipt', 'RECONCILE: ' + out.note + ' ' + JSON.stringify(out.missing).slice(0, 400)); } catch (e) {} }
  } catch (err) {
    out.ok = false; out.note = String(err);
  }
  return out;
}

/** Router/editor entry point for the reconciliation report. */
function EV_reconcileReceipts() { return EV_auditExpenseVsReceiptLog_(); }
