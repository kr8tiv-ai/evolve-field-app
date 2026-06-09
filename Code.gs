/**
 * ============================================================================
 *  EVOLVE FIELD APP  â€”  Google Apps Script backend
 *  Evolve Eco Surface Prep & Restoration / Evolve Eco Blasting
 * ----------------------------------------------------------------------------
 *  WHAT THIS IS
 *    A mobile-first capture app for the crew. Anyone signs in with a name + PIN
 *    and can drop ANY kind of field input (receipt photo, job photo, lead,
 *    expense, schedule update, task, inventory count, quick note, anything).
 *
 *  SAFETY-FIRST DESIGN
 *    The app NEVER writes directly into the live financial tabs (Quotes, P&L,
 *    Dispatch, etc.) â€” those have banners, legends, matrix layouts and
 *    scorecards that are easy to corrupt. Instead every submission lands as one
 *    clean row in a dedicated "ðŸ“¥ App Inbox" tab, and photos go to Drive.
 *
 *    Claude (running on a schedule via Cowork / your CLI) then reads the Inbox,
 *    files each entry into the correct tab, and audits the workbook. See
 *    DEPLOY.md + claude-router-task.md.
 *
 *  SETUP
 *    Run setup() once from the editor (Run â–¸ setup). It creates the
 *    App Inbox + App Users tabs and seeds an admin login. Then deploy as a
 *    Web App (Deploy â–¸ New deployment â–¸ Web app).
 * ============================================================================
 */

// ----------------------------------------------------------------------------
//  CONFIG  (all IDs are Evolve's, pulled from the ops notes)
// ----------------------------------------------------------------------------
const CONFIG = {
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID',

  INBOX_SHEET:  'ðŸ“¥ App Inbox',
  USERS_SHEET:  'ðŸ‘¥ App Users',
  LISTS_SHEET:  'Lists',

  // Google Drive folders (root: Evolve Eco Blasting)
  DRIVE: {
    ROOT:        'YOUR_DRIVE_ROOT_ID',
    QUOTES:      'YOUR_01_QUOTES_FOLDER_ID',  // 01 Quotes
    RECEIPTS:    'YOUR_02_RECEIPTS_FOLDER_ID',  // 02 Receipts & Expenses
    JOB_PHOTOS:  'YOUR_03_JOB_PHOTOS_FOLDER_ID',  // 03 Job Photos
    CUSTOMERS:   'YOUR_04_CUSTOMERS_FOLDER_ID',  // 04 Customers
    DISPATCH:    'YOUR_05_DISPATCH_FOLDER_ID',  // 05 Dispatch & Schedules
    TEMPLATES:   'YOUR_06_TEMPLATES_FOLDER_ID',  // 06 Brand & Templates
    MANUALS:     'YOUR_07_MANUALS_FOLDER_ID'   // 07 Manuals & Procedures
  },

  TIMEZONE: 'America/Edmonton',

  // Map each capture category to the Drive folder its photos belong in.
  PHOTO_ROUTING: {
    receipt:      'RECEIPTS',
    job_photo:    'JOB_PHOTOS',
    before_after: 'JOB_PHOTOS',
    quote:        'QUOTES'
    // anything else -> a "08 Field App Uploads" folder created on demand
  }
};

const INBOX_HEADERS = [
  'Timestamp', 'Captured By', 'Category', 'Summary', 'Details (JSON)',
  'Photo Links', 'GPS Lat', 'GPS Lng', 'Location', 'Device',
  'Status', 'Filed To', 'Claude Notes', 'Submission ID'
];

const USERS_HEADERS = ['Name', 'PIN', 'Role', 'Active', 'Added'];

// ----------------------------------------------------------------------------
//  WEB APP ENTRY POINT
// ----------------------------------------------------------------------------
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Evolve Field App')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1')
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ----------------------------------------------------------------------------
//  ONE-TIME SETUP
// ----------------------------------------------------------------------------
function setup() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  // --- App Inbox ---
  let inbox = ss.getSheetByName(CONFIG.INBOX_SHEET);
  if (!inbox) {
    inbox = ss.insertSheet(CONFIG.INBOX_SHEET);
    inbox.getRange(1, 1, 1, INBOX_HEADERS.length).setValues([INBOX_HEADERS]);
    styleHeaderRow_(inbox, INBOX_HEADERS.length);
    inbox.setFrozenRows(1);
    inbox.setColumnWidth(4, 320); // Summary
    inbox.setColumnWidth(5, 360); // JSON
    inbox.setColumnWidth(13, 320); // Claude Notes
  }

  // --- App Users ---
  let users = ss.getSheetByName(CONFIG.USERS_SHEET);
  if (!users) {
    users = ss.insertSheet(CONFIG.USERS_SHEET);
    users.getRange(1, 1, 1, USERS_HEADERS.length).setValues([USERS_HEADERS]);
    styleHeaderRow_(users, USERS_HEADERS.length);
    users.setFrozenRows(1);
    // Seed two admins â€” CHANGE THESE PINS after first login.
    users.getRange(2, 1, 2, USERS_HEADERS.length).setValues([
      ['Todd', '0000', 'admin', 'Yes', new Date()],
      ['Matt', '0000', 'admin', 'Yes', new Date()]
    ]);
  }

  // --- App Log (Claude's audit trail) ---
  let log = ss.getSheetByName('ðŸ—’ App Log');
  if (!log) {
    log = ss.insertSheet('ðŸ—’ App Log');
    log.getRange(1, 1, 1, 3).setValues([['Timestamp', 'Source', 'Message']]);
    styleHeaderRow_(log, 3);
    log.setFrozenRows(1);
    log.setColumnWidth(3, 520);
  }

  // --- Shared secret for the Claude router API (doPost) ---
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('ROUTER_SECRET');
  if (!secret) {
    secret = Utilities.getUuid();
    props.setProperty('ROUTER_SECRET', secret);
  }

  SpreadsheetApp.flush();
  return 'Setup complete. Tabs created: App Inbox, App Users, App Log.\n' +
         'Default logins: Todd/0000, Matt/0000 (change these in the App Users tab).\n' +
         'ROUTER_SECRET (give this to the Claude scheduled task): ' + secret;
}

/** Print the router secret again any time. Run â–¸ showSecret. */
function showSecret() {
  const s = PropertiesService.getScriptProperties().getProperty('ROUTER_SECRET') || 'Not set â€” run setup() first.';
  Logger.log('ROUTER_SECRET = ' + s);
  return s;
}

function ss_() { return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID); }

function styleHeaderRow_(sheet, numCols) {
  const r = sheet.getRange(1, 1, 1, numCols);
  r.setBackground('#4ade80').setFontColor('#050505').setFontWeight('bold')
   .setVerticalAlignment('middle').setWrap(true);
}

// ----------------------------------------------------------------------------
//  AUTH  (name + PIN â€” lightweight, internal tool)
// ----------------------------------------------------------------------------
function apiLogin(name, pin) {
  name = String(name || '').trim();
  pin  = String(pin  || '').trim();

  // Brute-force throttle: 6 wrong tries locks this name for 10 minutes.
  const cache = CacheService.getScriptCache();
  const key = 'fails_' + name.toLowerCase();
  const fails = Number(cache.get(key) || 0);
  if (fails >= 6) return { ok: false, error: 'Too many tries. Wait 10 minutes and try again.' };

  const user = findUser_(name);
  if (!user)              return { ok: false, error: 'Name not found. Ask Todd or Matt to add you.' };
  if (user.active !== 'Yes') return { ok: false, error: 'This login is disabled.' };
  if (String(user.pin) !== pin) {
    cache.put(key, String(fails + 1), 600);
    return { ok: false, error: 'Wrong PIN.' };
  }
  cache.remove(key);
  return {
    ok: true,
    token: makeToken_(user.name),
    user: { name: user.name, role: user.role }
  };
}

function findUser_(name) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.USERS_SHEET);
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  const want = String(name).toLowerCase();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === want) {
      return { row: i + 1, name: data[i][0], pin: data[i][1], role: data[i][2], active: data[i][3] };
    }
  }
  return null;
}

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days â€” crew stay signed in on their phone

function getAuthSecret_() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty('AUTH_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('AUTH_SECRET', s); }
  return s;
}
function sign_(payload) {
  const raw = Utilities.computeHmacSha256Signature(payload, getAuthSecret_());
  return Utilities.base64EncodeWebSafe(raw);
}
function makeToken_(name) {
  const ts = Date.now();
  const sig = sign_(name + '|' + ts);
  return Utilities.base64EncodeWebSafe(name + '|' + ts + '|' + sig);
}
function checkToken_(token) {
  try {
    const raw = Utilities.newBlob(Utilities.base64DecodeWebSafe(token)).getDataAsString();
    const parts = raw.split('|');
    if (parts.length < 3) return null;
    const sig = parts.pop();
    const ts  = parts.pop();
    const name = parts.join('|');                 // names may (rarely) contain '|'
    if (sign_(name + '|' + ts) !== sig) return null;          // forged / tampered
    if (Date.now() - Number(ts) > TOKEN_TTL_MS) return null;  // expired
    const u = findUser_(name);
    return (u && u.active === 'Yes') ? u : null;
  } catch (err) { return null; }
}

// ----------------------------------------------------------------------------
//  CONFIG FOR FRONT-END  (dropdown lists + user list)
// ----------------------------------------------------------------------------
function apiGetConfig() {
  return {
    lists:   readListsTab_(),
    users:   readUserNames_(),
    version: '1.0'
  };
}

function readListsTab_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.LISTS_SHEET);
  const out = {
    yesno: ['Yes', 'No'],
    yesnona: ['Yes', 'No', 'NA'],
    material: [], jobtype: [], access: [], weather: [],
    clientrate: [], quality: [], expcat: [], invcat: []
  };
  if (!sheet) return out;
  const data = sheet.getDataRange().getValues();
  // Lists tab: header row 1, columns A..J map to the keys below.
  const keys = ['yesno','yesnona','material','jobtype','access','weather','clientrate','quality','expcat','invcat'];
  for (let c = 0; c < keys.length; c++) {
    const col = [];
    for (let r = 1; r < data.length; r++) {
      const v = String(data[r][c] || '').trim();
      if (v) col.push(v);
    }
    if (col.length) out[keys[c]] = col;
  }
  return out;
}

function readUserNames_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.USERS_SHEET);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const names = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][3]).trim() === 'Yes' && data[i][0]) names.push(String(data[i][0]).trim());
  }
  return names;
}

// ----------------------------------------------------------------------------
//  THE CORE: SUBMIT A CAPTURE
//  payload = {
//    token, category, summary, fields:{...}, photos:[{name, mimeType, data(base64)}],
//    gps:{lat,lng}, device
//  }
// ----------------------------------------------------------------------------
function apiSubmit(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    const user = checkToken_(payload.token);
    if (!user) return { ok: false, error: 'Session expired â€” please sign in again.' };

    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const inbox = ss.getSheetByName(CONFIG.INBOX_SHEET);
    if (!inbox) return { ok: false, error: 'App Inbox tab missing â€” run setup() once.' };

    const subId = 'SUB-' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyMMdd-HHmmss') +
                  '-' + Math.floor(Math.random() * 1000);

    // 1) Photos. Preferred path: client already uploaded them one-by-one via
    //    apiUploadPhoto and passes back the links. Legacy/fallback: inline base64.
    let photoLinks = [];
    if (payload.photoLinks && payload.photoLinks.length) {
      photoLinks = payload.photoLinks.slice();
    } else if (payload.photos && payload.photos.length) {
      const folder = photoFolderFor_(payload.category);
      payload.photos.forEach(function (p, i) {
        try {
          const bytes = Utilities.base64Decode(stripDataUrl_(p.data));
          const blob = Utilities.newBlob(bytes, p.mimeType || 'image/jpeg',
            buildPhotoName_(payload, user, subId, i, p.name));
          const file = folder.createFile(blob);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          photoLinks.push(file.getUrl());
        } catch (err) {
          photoLinks.push('UPLOAD_FAILED: ' + err);
        }
      });
    }

    // 2) Reverse-geocode location (best effort; lat may legitimately be 0)
    let location = '';
    if (payload.gps && payload.gps.lat != null) {
      location = reverseGeocode_(payload.gps.lat, payload.gps.lng);
    }

    // 3) Write the Inbox row
    const row = [
      new Date(),                                   // Timestamp
      user.name,                                    // Captured By
      prettyCategory_(payload.category),            // Category
      payload.summary || autoSummary_(payload),     // Summary
      JSON.stringify(payload.fields || {}),         // Details (JSON)
      photoLinks.join('\n'),                        // Photo Links
      payload.gps ? payload.gps.lat : '',           // GPS Lat
      payload.gps ? payload.gps.lng : '',           // GPS Lng
      location,                                     // Location
      payload.device || '',                         // Device
      'NEW',                                        // Status
      '',                                           // Filed To (Claude fills)
      '',                                           // Claude Notes (Claude fills)
      subId                                         // Submission ID
    ];
    inbox.appendRow(row);

    return {
      ok: true,
      id: subId,
      photoCount: photoLinks.length,
      message: 'Captured. Claude will file this into the right place shortly.'
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Upload ONE photo and return its Drive link. The app calls this per photo so
 * large multi-photo submissions never blow the request size limit.
 * payload = { token, category, photo:{name, mimeType, data(base64)} }
 */
function apiUploadPhoto(payload) {
  const user = checkToken_(payload && payload.token);
  if (!user) return { ok: false, error: 'Session expired â€” please sign in again.' };
  try {
    const p = payload.photo || {};
    const bytes = Utilities.base64Decode(stripDataUrl_(p.data));
    const name = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd') + ' ' +
                 (payload.category || 'capture') + ' ' + user.name + ' ' +
                 Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'HHmmss') +
                 '-' + Math.floor(Math.random() * 1000) + '.jpg';
    const blob = Utilities.newBlob(bytes, p.mimeType || 'image/jpeg', name);
    const file = photoFolderFor_(payload.category).createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { ok: true, link: file.getUrl() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function stripDataUrl_(data) {
  if (typeof data !== 'string') return data;
  const i = data.indexOf(',');
  return (i > -1 && data.substring(0, i).indexOf('base64') > -1) ? data.substring(i + 1) : data;
}

function photoFolderFor_(category) {
  const key = CONFIG.PHOTO_ROUTING[category];
  if (key && CONFIG.DRIVE[key]) return DriveApp.getFolderById(CONFIG.DRIVE[key]);
  // default bucket: "08 Field App Uploads" under root, created on demand
  const root = DriveApp.getFolderById(CONFIG.DRIVE.ROOT);
  const it = root.getFoldersByName('08 Field App Uploads');
  return it.hasNext() ? it.next() : root.createFolder('08 Field App Uploads');
}

function buildPhotoName_(payload, user, subId, i, original) {
  const date = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const cat  = (payload.category || 'capture');
  const ext  = (original && original.indexOf('.') > -1) ? original.substring(original.lastIndexOf('.')) : '.jpg';
  const tag  = (payload.fields && (payload.fields.vendor || payload.fields.customer || payload.fields.lead)) || user.name;
  return [date, cat, String(tag).replace(/[^\w\- ]/g, ''), subId, (i + 1)].join(' ') + ext;
}

function reverseGeocode_(lat, lng) {
  try {
    const res = Maps.newGeocoder().reverseGeocode(lat, lng);
    if (res.results && res.results.length) return res.results[0].formatted_address;
  } catch (err) {}
  return lat + ', ' + lng;
}

function prettyCategory_(c) {
  const map = {
    quick: 'Quick Capture', receipt: 'Receipt / Expense', job_photo: 'Job Photo',
    lead: 'New Lead', customer: 'New Customer', dispatch: 'Dispatch / Schedule',
    todo: 'To-Do / Task', quote: 'Quote (field)', inventory: 'Inventory Count',
    pricelog: 'Price Log / Purchase', supplier: 'Supplier', jobpnl: 'Job P&L (actuals)',
    jobreport: 'Job Report'
  };
  return map[c] || (c || 'Capture');
}

function autoSummary_(payload) {
  const f = payload.fields || {};
  const parts = [];
  ['vendor', 'customer', 'lead', 'item', 'task', 'product', 'supplier', 'note', 'description']
    .forEach(function (k) { if (f[k]) parts.push(f[k]); });
  if (f.amount || f.total) parts.push('$' + (f.total || f.amount));
  return parts.slice(0, 3).join(' Â· ') || prettyCategory_(payload.category);
}

// ----------------------------------------------------------------------------
//  RECENT CAPTURES (feed shown in the app so it feels alive)
// ----------------------------------------------------------------------------
function apiRecent(token, limit) {
  const user = checkToken_(token);
  if (!user) return { ok: false, error: 'Session expired.' };
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const inbox = ss.getSheetByName(CONFIG.INBOX_SHEET);
  if (!inbox) return { ok: true, items: [] };
  const last = inbox.getLastRow();
  if (last < 2) return { ok: true, items: [] };
  const n = Math.min(limit || 12, last - 1);
  const data = inbox.getRange(last - n + 1, 1, n, INBOX_HEADERS.length).getValues();
  const items = data.map(function (r) {
    return {
      time: Utilities.formatDate(new Date(r[0]), CONFIG.TIMEZONE, 'MMM d, h:mm a'),
      by: r[1], category: r[2], summary: r[3],
      hasPhoto: !!r[5], status: r[10], filedTo: r[11]
    };
  }).reverse();
  return { ok: true, items: items };
}

// ----------------------------------------------------------------------------
//  ADMIN: manage crew logins
// ----------------------------------------------------------------------------
function apiAddUser(token, name, pin, role) {
  const admin = checkToken_(token);
  if (!admin || admin.role !== 'admin') return { ok: false, error: 'Admins only.' };
  name = String(name || '').trim();
  pin  = String(pin  || '').trim();
  if (!name || !/^\d{4}$/.test(pin)) return { ok: false, error: 'Need a name and a 4-digit PIN.' };
  if (findUser_(name)) return { ok: false, error: 'That name already exists.' };
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.USERS_SHEET);
  sheet.appendRow([name, pin, role === 'admin' ? 'admin' : 'crew', 'Yes', new Date()]);
  return { ok: true, message: name + ' can now sign in.' };
}

function apiListUsers(token) {
  const admin = checkToken_(token);
  if (!admin || admin.role !== 'admin') return { ok: false, error: 'Admins only.' };
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  const users = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) users.push({ name: data[i][0], role: data[i][2], active: data[i][3] });
  }
  return { ok: true, users: users };
}

// ============================================================================
//  CLAUDE ROUTER API  (doPost)
//  The scheduled Claude job is the BRAIN: it reads new Inbox rows, decides
//  which tab + columns each belongs in, and calls these endpoints to do the
//  actual (safe) writing. Apps Script never decides placement â€” it just
//  executes precise instructions. Every call must carry the shared secret.
//
//  POST body (JSON): { secret, action, ...args }
//  Value coercion in row arrays: a string "DATE:2026-06-08" becomes a real
//  Date; "NUM:1234.5" becomes a Number; everything else is written as-is
//  (so currency-as-text tabs like Quotes can receive "$3,000.00" strings).
// ============================================================================
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return jsonOut_({ ok: false, error: 'Bad JSON' }); }

  const secret = PropertiesService.getScriptProperties().getProperty('ROUTER_SECRET');
  if (!secret || body.secret !== secret) return jsonOut_({ ok: false, error: 'Unauthorized' });

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    switch (body.action) {
      case 'ping':       return jsonOut_({ ok: true, time: new Date().toISOString() });
      case 'getNew':     return jsonOut_(getNewInbox_(body.limit || 50));
      case 'readTab':    return jsonOut_(readTab_(body.tab, body.maxRows || 400));
      case 'tabList':    return jsonOut_({ ok: true, tabs: ss_().getSheets().map(function (s) { return s.getName(); }) });
      case 'writeRow':   return jsonOut_(writeRow_(body));   // {tab,row,startCol,values,insert}
      case 'setCell':    return jsonOut_(setCell_(body));    // {tab,a1,value}
      case 'markInbox':  return jsonOut_(markInbox_(body));  // {id,status,filedTo,notes}
      case 'sendEmail':  return jsonOut_(sendEmail_(body));  // {to,subject,htmlBody,attachmentBase64,attachmentName,saveToFolderId}
      case 'log':        return jsonOut_(appLog_('Claude', body.message));
      default:           return jsonOut_({ ok: false, error: 'Unknown action: ' + body.action });
    }
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getNewInbox_(limit) {
  const sh = ss_().getSheetByName(CONFIG.INBOX_SHEET);
  if (!sh) return { ok: false, error: 'No inbox' };
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, rows: [] };
  const data = sh.getRange(2, 1, last - 1, INBOX_HEADERS.length).getValues();
  const rows = [];
  for (let i = 0; i < data.length && rows.length < limit; i++) {
    if (String(data[i][10]).toUpperCase() === 'NEW') {
      let fields = {};
      try { fields = JSON.parse(data[i][4] || '{}'); } catch (e) {}
      rows.push({
        rowIndex: i + 2,
        timestamp: data[i][0] ? new Date(data[i][0]).toISOString() : '',
        capturedBy: data[i][1], category: data[i][2], summary: data[i][3],
        fields: fields, photoLinks: String(data[i][5] || '').split('\n').filter(String),
        lat: data[i][6], lng: data[i][7], location: data[i][8], device: data[i][9],
        id: data[i][13]
      });
    }
  }
  return { ok: true, rows: rows };
}

function readTab_(tab, maxRows) {
  const sh = ss_().getSheetByName(tab);
  if (!sh) return { ok: false, error: 'No tab: ' + tab };
  const lastRow = Math.min(sh.getLastRow(), maxRows);
  const lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { ok: true, values: [] };
  const values = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  return { ok: true, tab: tab, rows: lastRow, cols: lastCol, values: values };
}

function coerce_(v) {
  if (typeof v === 'string') {
    if (v.indexOf('DATE:') === 0) { const d = new Date(v.slice(5)); return isNaN(d.getTime()) ? v.slice(5) : d; }
    if (v.indexOf('NUM:') === 0)  { const n = Number(v.slice(4)); return isNaN(n) ? v.slice(4) : n; }
  }
  return v;
}

function writeRow_(b) {
  const sh = ss_().getSheetByName(b.tab);
  if (!sh) return { ok: false, error: 'No tab: ' + b.tab };
  const row = b.row, startCol = b.startCol || 1;
  const vals = (b.values || []).map(coerce_);
  if (b.insert) sh.insertRowBefore(row);
  sh.getRange(row, startCol, 1, vals.length).setValues([vals]);
  if (b.inboxId) markInbox_({ id: b.inboxId, status: 'FILED', filedTo: b.tab, notes: b.notes || '' });
  appLog_('Claude', 'Wrote row ' + row + ' to "' + b.tab + '"' + (b.inboxId ? ' (inbox ' + b.inboxId + ')' : ''));
  return { ok: true, tab: b.tab, row: row };
}

function setCell_(b) {
  const sh = ss_().getSheetByName(b.tab);
  if (!sh) return { ok: false, error: 'No tab: ' + b.tab };
  sh.getRange(b.a1).setValue(coerce_(b.value));
  appLog_('Claude', 'Set ' + b.tab + '!' + b.a1 + ' = ' + b.value);
  return { ok: true };
}

function markInbox_(b) {
  const sh = ss_().getSheetByName(CONFIG.INBOX_SHEET);
  if (!sh) return { ok: false, error: 'No inbox' };
  let rowIndex = b.rowIndex;
  if (!rowIndex && b.id) {
    const ids = sh.getRange(2, 14, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
    for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(b.id)) { rowIndex = i + 2; break; }
  }
  if (!rowIndex) return { ok: false, error: 'Inbox row not found for id ' + b.id };
  if (b.status)  sh.getRange(rowIndex, 11).setValue(b.status);
  if (b.filedTo) sh.getRange(rowIndex, 12).setValue(b.filedTo);
  if (b.notes)   sh.getRange(rowIndex, 13).setValue(b.notes);
  return { ok: true, rowIndex: rowIndex };
}

function appLog_(source, message) {
  const sh = ss_().getSheetByName('ðŸ—’ App Log');
  if (sh) sh.appendRow([new Date(), source, message]);
  return { ok: true };
}

/**
 * Send an email (used by the router to deliver finished quotes), runs as the
 * deploying account (manager@yourcompany.com). Can attach a base64 file (e.g. the
 * branded quote PDF) and optionally save that file to a Drive folder.
 * b = { to, subject, htmlBody, body, cc, attachmentBase64, attachmentMime,
 *       attachmentName, saveToFolderId }
 */
function sendEmail_(b) {
  const to = b.to ? (Array.isArray(b.to) ? b.to.join(',') : b.to)
                  : 'todd@evolveecoblasting.com,manager@yourcompany.com';
  const opts = { name: 'Evolve Eco Blasting' };
  if (b.htmlBody) opts.htmlBody = b.htmlBody;
  if (b.cc) opts.cc = Array.isArray(b.cc) ? b.cc.join(',') : b.cc;

  let savedUrl = '';
  if (b.attachmentBase64) {
    try {
      const bytes = Utilities.base64Decode(stripDataUrl_(b.attachmentBase64));
      const blob = Utilities.newBlob(bytes, b.attachmentMime || 'application/pdf',
        b.attachmentName || 'Evolve-Quote.pdf');
      opts.attachments = [blob];
      if (b.saveToFolderId) {
        const f = DriveApp.getFolderById(b.saveToFolderId).createFile(blob);
        f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        savedUrl = f.getUrl();
      }
    } catch (err) { /* attachment failed â€” still send the email body */ }
  } else if (b.attachmentFileId) {
    try { opts.attachments = [DriveApp.getFileById(b.attachmentFileId).getBlob()]; } catch (err) {}
  }

  MailApp.sendEmail(to, b.subject || 'Evolve Quote', b.body || '', opts);
  appLog_('Claude', 'Emailed "' + (b.subject || '') + '" to ' + to + (savedUrl ? ' (PDF: ' + savedUrl + ')' : ''));
  return { ok: true, to: to, savedUrl: savedUrl };
}
