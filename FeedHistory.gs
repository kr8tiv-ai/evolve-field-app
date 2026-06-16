/**
 * ============================================================================
 *  EVOLVE FEED HISTORY — total recall of every field capture
 * ----------------------------------------------------------------------------
 *  Powers the app's "Just Captured" feed: tap any entry to see EXACTLY what was
 *  inputted (every field, the photos, the location, where it was filed), and
 *  scroll back through the ENTIRE capture history (paginated, newest-first) — as
 *  far back as the inputs run on the phone. Nothing captured is ever out of reach.
 *
 *  Read-only. Reuses ss_(), CONFIG, checkToken_, INBOX_HEADERS from Code.gs.
 *  apiCaptureHistory(token, limit, offset)  — offset = how many newest rows to skip.
 * ============================================================================
 */
function apiCaptureHistory(token, limit, offset) {
  var user = checkToken_(token);
  if (!user) return { ok: false, error: 'Session expired — please sign in again.' };
  var sh = ss_().getSheetByName(CONFIG.INBOX_SHEET);
  if (!sh) return { ok: true, items: [], more: false, total: 0 };
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, items: [], more: false, total: 0 };

  limit = Math.min(Math.max(limit || 20, 1), 100);
  offset = Math.max(offset || 0, 0);
  var total = last - 1;                              // data rows (2..last)
  var width = Math.max(sh.getLastColumn(), INBOX_HEADERS.length);

  var endRow = last - offset;                        // newest row not yet shown
  if (endRow < 2) return { ok: true, items: [], more: false, total: total };
  var startRow = Math.max(2, endRow - limit + 1);
  var n = endRow - startRow + 1;
  var data = sh.getRange(startRow, 1, n, width).getValues();

  var items = [];
  for (var i = data.length - 1; i >= 0; i--) {       // newest-first within the block
    var r = data[i];
    var fields = {};
    try { fields = JSON.parse(r[4] || '{}'); } catch (e) {}
    items.push({
      id: r[13],
      rowIndex: startRow + i,
      time: r[0] ? Utilities.formatDate(new Date(r[0]), CONFIG.TIMEZONE, 'MMM d, yyyy · h:mm a') : '',
      by: r[1],
      category: r[2],
      rawCategory: r[14] || '',
      summary: r[3],
      fields: fields,
      photoLinks: String(r[5] || '').split('\n').filter(String),
      location: r[8],
      status: r[10],
      filedTo: r[11],
      claudeNotes: r[12]
    });
  }
  return { ok: true, items: items, more: (startRow > 2), total: total };
}
