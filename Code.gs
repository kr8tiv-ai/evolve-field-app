/**
 * ============================================================================
 *  EVOLVE FIELD APP  —  Google Apps Script backend
 *  Evolve Eco Surface Prep & Restoration / Evolve Eco Blasting
 * ----------------------------------------------------------------------------
 *  WHAT THIS IS
 *    A mobile-first capture app for the crew. Anyone signs in with a name + PIN
 *    and can drop ANY kind of field input (receipt photo, job photo, lead,
 *    expense, schedule update, task, inventory count, quick note, anything).
 *
 *  SAFETY-FIRST DESIGN
 *    The app NEVER writes directly into the live financial tabs (Quotes, P&L,
 *    Dispatch, etc.) — those have banners, legends, matrix layouts and
 *    scorecards that are easy to corrupt. Instead every submission lands as one
 *    clean row in a dedicated "📥 App Inbox" tab, and photos go to Drive.
 *
 *    Claude (running on a schedule via Cowork / your CLI) then reads the Inbox,
 *    files each entry into the correct tab, and audits the workbook. See
 *    DEPLOY.md + claude-router-task.md.
 *
 *  SETUP
 *    Run setup() once from the editor (Run ▸ setup). It creates the
 *    App Inbox + App Users tabs and seeds an admin login. Then deploy as a
 *    Web App (Deploy ▸ New deployment ▸ Web app).
 * ============================================================================
 */

// ----------------------------------------------------------------------------
//  CONFIG  (all IDs are Evolve's, pulled from the ops notes)
// ----------------------------------------------------------------------------
const CONFIG = {
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID',

  INBOX_SHEET:  '📥 App Inbox',
  USERS_SHEET:  '👥 App Users',
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
    // Seed two admins — CHANGE THESE PINS after first login.
    users.getRange(2, 1, 2, USERS_HEADERS.length).setValues([
      ['Todd', '0000', 'admin', 'Yes', new Date()],
      ['Matt', '0000', 'admin', 'Yes', new Date()]
    ]);
  }

  // --- App Log (Claude's audit trail) ---
  let log = ss.getSheetByName('🗒 App Log');
  if (!log) {
    log = ss.insertSheet('🗒 App Log');
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
  var _pf = (typeof EV_preflight_ === 'function') ? EV_preflight_() : [];
  var _warn = _pf.length ? ('\n\n⚠ CONFIG NOT COMPLETE — fill these before installing triggers (installers will refuse):\n - ' + _pf.join('\n - ')) : '';
  return 'Setup complete. Tabs created: App Inbox, App Users, App Log.\n' +
         'Default logins: Todd/0000, Matt/0000 (CHANGE these in the App Users tab now).\n' +
         'ROUTER_SECRET (give this to the Claude scheduled task): ' + secret + _warn;
}

/** Print the router secret again any time. Run ▸ showSecret. */
function showSecret() {
  const s = PropertiesService.getScriptProperties().getProperty('ROUTER_SECRET') || 'Not set — run setup() first.';
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
//  AUTH  (name + PIN — lightweight, internal tool)
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

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — crew stay signed in on their phone

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
function apiSubmit_core_(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    const user = checkToken_(payload.token);
    if (!user) return { ok: false, error: 'Session expired — please sign in again.' };

    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const inbox = ss.getSheetByName(CONFIG.INBOX_SHEET);
    if (!inbox) return { ok: false, error: 'App Inbox tab missing — run setup() once.' };

    const subId = 'SUB-' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyMMdd-HHmmss') +
                  '-' + ('00' + Math.floor(Math.random() * 1000)).slice(-3); // fixed-length: no id is a prefix of another

    // 1) Photos. Preferred path: client already uploaded them one-by-one via
    //    apiUploadPhoto and passes back the links. Legacy/fallback: inline base64.
    let photoLinks = [];
    let photoFailures = 0;
    if (payload.photoLinks && payload.photoLinks.length) {
      // C-2: keep only real links — never let an 'UPLOAD_FAILED' sentinel masquerade as a photo.
      payload.photoLinks.forEach(function (l) {
        if (/^https?:\/\//i.test(String(l).replace(/^[A-Za-z][A-Za-z ]*:\s+/, ''))) photoLinks.push(l);
        else photoFailures++;
      });
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
          photoFailures++;   // C-2: do NOT write a fake link; report it so the client can re-queue the photo
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
      photoFailures ? ('⚠ ' + photoFailures + ' photo upload(s) failed at capture — re-capture the photo') : '', // Claude Notes
      subId                                         // Submission ID
    ];
    inbox.appendRow(row);

    return {
      ok: true,
      id: subId,
      photoCount: photoLinks.length,
      photoFailures: photoFailures,
      message: 'Captured. Claude will file this into the right place shortly.' +
               (photoFailures ? (' (note: ' + photoFailures + ' photo did not upload)') : '')
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
  if (!user) return { ok: false, error: 'Session expired — please sign in again.' };
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
  return parts.slice(0, 3).join(' · ') || prettyCategory_(payload.category);
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
//  actual (safe) writing. Apps Script never decides placement — it just
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
      case 'insight':    return jsonOut_(upsertInsight_(body));  // F-3: {type,title,detail,score} upsert w/ fingerprint dedupe
      case 'log':        return jsonOut_(appLog_('Claude', body.message));
      case 'maint':      return jsonOut_(EV_maintAction_(body));   // {fn} whitelisted maintenance: setDigest6am | testDigestMatt | listTriggers | runDigest
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
    const st = String(data[i][10]).toUpperCase();
    if (st === 'NEW' || st === 'NEEDS REVIEW') {   // C-5: coordinator sees stuck rows, not just NEW
      let fields = {};
      try { fields = JSON.parse(data[i][4] || '{}'); } catch (e) {}
      rows.push({
        rowIndex: i + 2,
        timestamp: data[i][0] ? new Date(data[i][0]).toISOString() : '',
        capturedBy: data[i][1], category: data[i][2], summary: data[i][3],
        fields: fields, photoLinks: String(data[i][5] || '').split('\n').filter(String),
        lat: data[i][6], lng: data[i][7], location: data[i][8], device: data[i][9],
        status: data[i][10], id: data[i][13]
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
    if (v.indexOf('DATE:') === 0) {
      var _ds = v.slice(5).trim();
      // FIX (2026-06-23): a date-only string ("2026-06-08") parses as UTC midnight, which renders a
      // day early in America/Edmonton. Pin date-only values to LOCAL midnight so the calendar day is exact.
      var _dd = /^\d{4}-\d{2}-\d{2}$/.test(_ds) ? new Date(_ds + 'T00:00:00') : new Date(_ds);
      return isNaN(_dd.getTime()) ? _ds : _dd;
    }
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
  const sh = ss_().getSheetByName('🗒 App Log');
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
    } catch (err) { /* attachment failed — still send the email body */ }
  } else if (b.attachmentFileId) {
    try { opts.attachments = [DriveApp.getFileById(b.attachmentFileId).getBlob()]; } catch (err) {}
  }

  MailApp.sendEmail(to, b.subject || 'Evolve Quote', b.body || '', opts);
  appLog_('Claude', 'Emailed "' + (b.subject || '') + '" to ' + to + (savedUrl ? ' (PDF: ' + savedUrl + ')' : ''));
  return { ok: true, to: to, savedUrl: savedUrl };
}


/**
 * ============================================================================
 *  EVOLVE AUTONOMY LAYER  (server-side, time-driven — runs on Google servers
 *  24/7, with NO dependency on the Claude desktop app or Todd's PC)
 * ----------------------------------------------------------------------------
 *  Root cause this fixes: the four Claude "Scheduled" tasks were LOCAL desktop
 *  agent jobs. They only POST to this router when the desktop app happens to be
 *  open at fire time, so on a normal morning the scheduler updates lastRunAt but
 *  nothing actually runs. This file moves the schedule itself INTO Apps Script
 *  via time-driven triggers (ScriptApp.newTrigger), so the digests, sweep,
 *  reply-monitoring and heartbeat fire server-side regardless of any PC.
 *
 *  Reuses existing router helpers in Code.gs: CONFIG, ss_(), sendEmail_(b),
 *  appLog_(source,message), setCell_(b), writeRow_(b).
 *
 *  One-time setup: Run -> evolveInstallTriggers  (authorize once).
 * ============================================================================
 */

var EVOLVE = {
  OWNER_EMAIL: 'todd@evolveecoblasting.com',
  OWNER_NAME: 'Todd',
  BRAND: 'Evolve Eco Blasting',
  PROCESSED_LABEL: 'Evolve/Processed',
  TZ: (typeof CONFIG !== 'undefined' && CONFIG.TIMEZONE) ? CONFIG.TIMEZONE : 'America/Edmonton'
};

/* ----------------------------------------------------------------------------
 *  TRIGGER INSTALLER  (idempotent — safe to re-run)
 * --------------------------------------------------------------------------*/
function evolveInstallTriggers() {
  // F-2: the legacy evolve* generation is SUPERSEDED by the EV_* generation (AutoServer.gs). Installing
  // both double-sends every digest/sweep, so this installer no longer schedules the old handlers — it
  // removes any that exist and delegates to the current installers. Kept as a named entry point so old
  // runbooks keep working.
  var legacy = ['evolveDailyPersonalDigest6am','evolveMorningDigest','evolveDispatchSweep','evolveScanReplies','evolveSupplierPriceScan'];
  ScriptApp.getProjectTriggers().forEach(function(t){ if (legacy.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  var out = [];
  try { out.push(EV_installCore()); } catch(e){ try{ appLog_('Trigger','EV_installCore failed: '+e); }catch(_){} }
  try { out.push(EV_installGmail()); } catch(e){ /* Gmail scope may not be authorized yet — run EV_installGmail after granting it */ }
  try { appLog_('Trigger','evolveInstallTriggers delegated to the EV_* generation; legacy evolve* triggers removed to prevent double-send.'); } catch(e){}
  return evolveListTriggers();
}

function evolveListTriggers() {
  return ScriptApp.getProjectTriggers().map(function(t){
    var when = '';
    try { when = t.getEventType(); } catch(e){}
    return t.getHandlerFunction() + '  [' + when + ']';
  });
}

/* ----------------------------------------------------------------------------
 *  SHARED — sheet readers (defensive, header-aware)
 * --------------------------------------------------------------------------*/
function evolveSS_() { return (typeof ss_ === 'function') ? ss_() : SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID); }

function evolveSheet_(needle) {
  var want = String(needle).toLowerCase().replace(/[^a-z0-9]/g,'');
  var sheets = evolveSS_().getSheets();
  for (var i=0;i<sheets.length;i++){
    var n = sheets[i].getName().toLowerCase().replace(/[^a-z0-9]/g,'');
    if (n.indexOf(want) >= 0) return sheets[i];
  }
  return null;
}

function evolveTable_(needle, hints) {
  var s = evolveSheet_(needle);
  if (!s) return { ok:false, rows:[], headers:[], name:needle };
  var vals = s.getDataRange().getValues();
  var hdr = 0, best = -1;
  for (var r=0; r<Math.min(vals.length,30); r++){
    var low = vals[r].map(function(c){ return String(c).toLowerCase(); });
    var hits = 0;
    hints.forEach(function(h){ if (low.some(function(c){ return c.indexOf(h) >= 0; })) hits++; });
    if (hits > best){ best = hits; hdr = r; }
  }
  var headers = vals[hdr].map(function(c){ return String(c).trim(); });
  var rows = [];
  for (var r2=hdr+1; r2<vals.length; r2++){
    var obj = { _row: r2+1 }, any = false;
    for (var c=0;c<headers.length;c++){
      if (headers[c]) { obj[headers[c]] = vals[r2][c]; if (String(vals[r2][c]).trim() !== '') any = true; }
    }
    if (any) rows.push(obj);
  }
  return { ok:true, rows:rows, headers:headers, name:s.getName(), headerRow:hdr+1 };
}

function evolveField_(obj, re) {
  for (var k in obj){ if (k !== '_row' && re.test(k)) { var v = obj[k]; if (String(v).trim() !== '') return v; } }
  return '';
}

function evolveToday_() { return Utilities.formatDate(new Date(), EVOLVE.TZ, 'EEEE, MMMM d, yyyy'); }
function evolveNowStamp_() { return Utilities.formatDate(new Date(), EVOLVE.TZ, 'yyyy-MM-dd HH:mm') + ' MT'; }
function evolveEsc_(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function evolveIsOpen_(status){
  var s = String(status).toLowerCase();
  if (s === '') return true;
  return !/(done|closed|paid|complete|sent|won|lost|cancel|filed|archive)/.test(s);
}
function evolveAsDate_(v){
  if (v instanceof Date) return v;
  var d = new Date(v); return isNaN(d.getTime()) ? null : d;
}

/* ----------------------------------------------------------------------------
 *  OPS MORNING DIGEST  (was: evolve-morning-digest, 7:45am)
 * --------------------------------------------------------------------------*/
function evolveMorningDigest() {
  if (typeof EV_morningDigest === 'function') return; // F-2: superseded by EV_morningDigest (no double-send)
  try {
    var html = evolveBuildOpsDigest_();
    sendEmail_({ to: EVOLVE.OWNER_EMAIL,
                 subject: 'Evolve Morning Digest — ' + evolveToday_(),
                 htmlBody: html,
                 body: 'Open in an HTML-capable client to view the Evolve morning digest.' });
    appLog_('Trigger','Morning ops digest emailed to ' + EVOLVE.OWNER_EMAIL + ' server-side at ' + evolveNowStamp_() + ' (time trigger, no PC).');
    return 'sent';
  } catch (e) {
    try { appLog_('Trigger','Morning digest ERROR: ' + e.message); } catch(_){}
    throw e;
  }
}

function evolveBuildOpsDigest_() {
  var P = [];
  P.push(evolveHeader_('Evolve Morning Digest', evolveToday_()));

  // Money loop / Dispatch
  try {
    var disp = evolveTable_('dispatch', ['deposit','invoic','paid','status','job','customer','date']);
    var pend = [];
    disp.rows.forEach(function(r){
      var dep = evolveField_(r,/deposit/i), inv = evolveField_(r,/invoic/i), paid = evolveField_(r,/paid/i);
      var job = evolveField_(r,/(job|customer|client|name|site)/i) || ('Row '+r._row);
      var missing = [];
      if (!String(dep).trim()) missing.push('deposit');
      if (!String(inv).trim()) missing.push('invoice');
      if (!String(paid).trim()) missing.push('paid');
      if (missing.length) pend.push('<b>'+evolveEsc_(job)+'</b> — awaiting: ' + missing.join(', '));
    });
    P.push(evolveSection_('💵 Money loop (deposit → invoice → paid)',
      pend.length ? '<ul><li>'+pend.join('</li><li>')+'</li></ul>'
                  : '<i>All tracked jobs clear, or no booked jobs yet.</i>'));
  } catch(e){ P.push(evolveSection_('💵 Money loop','<i>Section unavailable: '+evolveEsc_(e.message)+'</i>')); }

  // Overdue / open Action Items
  try {
    var ai = evolveTable_('action', ['action','item','due','status','owner','follow','next']);
    var today = new Date(); today.setHours(0,0,0,0);
    var over = [], open = [];
    ai.rows.forEach(function(r){
      var st = evolveField_(r,/status/i);
      if (!evolveIsOpen_(st)) return;
      var item = evolveField_(r,/(action|item|task|follow|next|detail|note)/i) || ('Row '+r._row);
      var dueRaw = evolveField_(r,/(due|date)/i);
      var due = evolveAsDate_(dueRaw);
      if (due && due < today) over.push('<b>'+evolveEsc_(item)+'</b> — due '+Utilities.formatDate(due,EVOLVE.TZ,'MMM d'));
      else open.push(evolveEsc_(item) + (due ? ' — due '+Utilities.formatDate(due,EVOLVE.TZ,'MMM d') : ''));
    });
    var body = '';
    if (over.length) body += '<div style="color:#b00020"><b>OVERDUE</b><ul><li>'+over.join('</li><li>')+'</li></ul></div>';
    if (open.length) body += '<b>Open</b><ul><li>'+open.join('</li><li>')+'</li></ul>';
    if (!body) body = '<i>No open follow-ups. Clean slate.</i>';
    P.push(evolveSection_('✅ Follow-ups', body));
  } catch(e){ P.push(evolveSection_('✅ Follow-ups','<i>Section unavailable: '+evolveEsc_(e.message)+'</i>')); }

  // Outstanding quotes
  try {
    var q = evolveTable_('quote', ['quote','status','customer','amount','total','sq','price']);
    var out = [];
    q.rows.forEach(function(r){
      var st = evolveField_(r,/status/i);
      if (!evolveIsOpen_(st)) return;
      var id = evolveField_(r,/(quote|id|#|ref)/i);
      var cust = evolveField_(r,/(customer|client|name|company)/i);
      var amt = evolveField_(r,/(amount|total|price|value|\$)/i);
      var line = [id,cust,amt].filter(function(x){return String(x).trim();}).map(evolveEsc_).join(' — ');
      if (line) out.push(line + (st?(' <i>('+evolveEsc_(st)+')</i>'):''));
    });
    P.push(evolveSection_('📄 Quotes in play',
      out.length ? '<ul><li>'+out.join('</li><li>')+'</li></ul>' : '<i>No open quotes.</i>'));
  } catch(e){ P.push(evolveSection_('📄 Quotes in play','<i>Section unavailable: '+evolveEsc_(e.message)+'</i>')); }

  // App Inbox backlog
  try {
    var inbox = evolveTable_('inbox', ['status','id','category','submit','summary','user']);
    var nu = inbox.rows.filter(function(r){
      var st = String(evolveField_(r,/status/i)).toLowerCase();
      return st.indexOf('filed') < 0;
    });
    P.push(evolveSection_('🔥 Field App inbox',
      nu.length ? ('<b>'+nu.length+'</b> submission(s) awaiting filing. The dispatch sweep will process them; see App Inbox.')
                : '<i>Inbox clear — every submission filed.</i>'));
  } catch(e){ P.push(evolveSection_('🔥 Field App inbox','<i>Section unavailable: '+evolveEsc_(e.message)+'</i>')); }

  P.push(evolveFooter_());
  return P.join('');
}

/* ----------------------------------------------------------------------------
 *  PERSONAL 6 AM DIGEST  (was: daily-digest-6am)
 * --------------------------------------------------------------------------*/
function evolveDailyPersonalDigest6am() {
  if (typeof EV_personalDigest === 'function') return; // F-2: superseded by EV_personalDigest
  try {
    var html = evolveBuildPersonalDigest_();
    sendEmail_({ to: EVOLVE.OWNER_EMAIL,
                 subject: 'The Daily Digest — ' + evolveToday_(),
                 htmlBody: html,
                 body: 'Open in an HTML-capable client to view your daily to-do digest.' });
    appLog_('Trigger','Personal 6am digest emailed to ' + EVOLVE.OWNER_EMAIL + ' server-side at ' + evolveNowStamp_() + ' (time trigger, no PC).');
    return 'sent';
  } catch (e) {
    try { appLog_('Trigger','Personal 6am digest ERROR: ' + e.message); } catch(_){}
    throw e;
  }
}

function evolveBuildPersonalDigest_() {
  var P = [];
  P.push(evolveHeader_('The Daily Digest', evolveToday_()));
  try {
    var td = evolveTable_('to-do', ['task','to-do','todo','status','due','priority','item','done']);
    if (!td.ok) td = evolveTable_('todo', ['task','status','due','priority','item','done']);
    var open = [], done = 0;
    td.rows.forEach(function(r){
      var st = evolveField_(r,/(status|done|complete)/i);
      var item = evolveField_(r,/(task|to-?do|item|detail|note|action)/i) || ('Row '+r._row);
      if (evolveIsOpen_(st)) {
        var due = evolveField_(r,/(due|date)/i);
        open.push(evolveEsc_(item) + (String(due).trim()? ' <i>('+evolveEsc_(due)+')</i>' : ''));
      } else done++;
    });
    var body = '';
    body += '<p>You have <b>'+open.length+'</b> open item(s)'+(done?(' · '+done+' already done — nice'):'')+'.</p>';
    if (open.length) body += '<ul><li>'+open.slice(0,40).join('</li><li>')+'</li></ul>';
    else body += '<p>Inbox-zero on tasks. Go blast something. 🚀</p>';
    P.push(evolveSection_('📋 Today\'s list', body));
  } catch(e){ P.push(evolveSection_('📋 Today\'s list','<i>To-Do tab unavailable: '+evolveEsc_(e.message)+'</i>')); }
  P.push('<p style="font-size:13px;color:#555">Reply to this email to add items — I read replies every 15 minutes and confirm what I captured.</p>');
  P.push(evolveFooter_());
  return P.join('');
}

/* ----------------------------------------------------------------------------
 *  DISPATCH SWEEP  (was: evolve-dispatch-sweep, 7am/1pm/7pm)
 *  Writes the App Log heartbeat, audits the money loop + overdue items, counts
 *  unfiled inbox rows, and emails Todd an escalation summary only if something
 *  needs attention.
 * --------------------------------------------------------------------------*/
function evolveDispatchSweep() {
  if (typeof EV_dispatchSweep === 'function') return; // F-2: superseded by EV_dispatchSweep
  var alerts = [];
  // unfiled inbox
  var unfiled = 0;
  try {
    var inbox = evolveTable_('inbox', ['status','id','category','submit','summary','user']);
    inbox.rows.forEach(function(r){
      if (String(evolveField_(r,/status/i)).toLowerCase().indexOf('filed') < 0) unfiled++;
    });
    if (unfiled) alerts.push(unfiled + ' Field App submission(s) awaiting filing');
  } catch(e){}
  // overdue follow-ups
  var overdue = 0;
  try {
    var ai = evolveTable_('action', ['action','item','due','status','owner','follow']);
    var today = new Date(); today.setHours(0,0,0,0);
    ai.rows.forEach(function(r){
      var st = evolveField_(r,/status/i); if (!evolveIsOpen_(st)) return;
      var due = evolveAsDate_(evolveField_(r,/(due|date)/i));
      if (due && due < today) overdue++;
    });
    if (overdue) alerts.push(overdue + ' overdue follow-up(s)');
  } catch(e){}
  // money loop gaps
  var moneyGaps = 0;
  try {
    var disp = evolveTable_('dispatch', ['deposit','invoic','paid','status','job','date']);
    disp.rows.forEach(function(r){
      var dep = evolveField_(r,/deposit/i), inv = evolveField_(r,/invoic/i), paid = evolveField_(r,/paid/i);
      if (String(dep).trim() && !String(paid).trim()) moneyGaps++;
    });
    if (moneyGaps) alerts.push(moneyGaps + ' job(s) mid money-loop (deposit in, not yet paid)');
  } catch(e){}

  // ALWAYS write a heartbeat so absence of a server run is detectable
  try {
    appLog_('Trigger','Dispatch sweep ran server-side at ' + evolveNowStamp_() +
      ' — unfiled inbox: ' + unfiled + ', overdue: ' + overdue + ', money-loop gaps: ' + moneyGaps + '.');
  } catch(e){}

  // Email Todd only when there is something to act on
  if (alerts.length) {
    try {
      var html = evolveHeader_('Dispatch Sweep — action needed', evolveNowStamp_()) +
        evolveSection_('Needs your attention', '<ul><li>'+alerts.map(evolveEsc_).join('</li><li>')+'</li></ul>') +
        evolveFooter_();
      sendEmail_({ to: EVOLVE.OWNER_EMAIL, subject: 'Evolve dispatch — ' + alerts.length + ' item(s) need you', htmlBody: html, body: alerts.join('; ') });
    } catch(e){ try{ appLog_('Trigger','Dispatch sweep email ERROR: '+e.message);}catch(_){} }
  }
  return 'sweep ok (' + alerts.length + ' alerts)';
}

/* ----------------------------------------------------------------------------
 *  EMAIL REPLY MONITOR  (NEW — did not exist)
 *  Scans Gmail for replies from Todd, captures action items into the workbook,
 *  applies light actions, marks the thread Processed, and confirms by reply.
 * --------------------------------------------------------------------------*/
function evolveScanReplies() {
  if (typeof EV_replyMonitor === 'function') return; // F-2: superseded by EV_replyMonitor
  var label = evolveGetLabel_(EVOLVE.PROCESSED_LABEL);
  var query = 'from:(' + EVOLVE.OWNER_EMAIL + ') newer_than:3d -label:"' + EVOLVE.PROCESSED_LABEL + '"';
  var threads = GmailApp.search(query, 0, 25);
  var processed = 0;
  for (var i=0;i<threads.length;i++){
    var th = threads[i];
    var items = [];
    var msgs = th.getMessages();
    for (var m=0;m<msgs.length;m++){
      var msg = msgs[m];
      if (String(msg.getFrom()).toLowerCase().indexOf(EVOLVE.OWNER_EMAIL.toLowerCase()) < 0) continue;
      evolveExtractItems_(msg.getPlainBody()).forEach(function(it){ items.push(it); });
    }
    if (items.length) {
      var filed = 0;
      try { filed = evolveFileReplyItems_(th, items); } catch(e){}
      var acted = [];
      try { acted = evolveActOnItems_(items); } catch(e){}
      try {
        var conf = evolveHeader_('Got it — captured from your reply', evolveNowStamp_()) +
          evolveSection_('Logged to your workbook (' + filed + ' item(s))',
            '<ul><li>'+items.slice(0,25).map(evolveEsc_).join('</li><li>')+'</li></ul>') +
          (acted.length ? evolveSection_('Actioned automatically','<ul><li>'+acted.map(evolveEsc_).join('</li><li>')+'</li></ul>') : '') +
          evolveFooter_();
        msgs[msgs.length-1].reply('Captured ' + items.length + ' item(s) from your reply.', { htmlBody: conf, name: EVOLVE.BRAND });
      } catch(e){}
      try { appLog_('Trigger','Reply monitor captured ' + items.length + ' item(s) from "' + th.getFirstMessageSubject() + '" and sent confirmation (server-side ' + evolveNowStamp_() + ').'); } catch(e){}
      processed++;
    }
    try { th.addLabel(label); } catch(e){}
  }
  return 'reply scan ok (' + processed + ' thread(s) with items)';
}

function evolveGetLabel_(name){
  var l = GmailApp.getUserLabelByName(name);
  return l ? l : GmailApp.createLabel(name);
}

function evolveExtractItems_(body){
  if (!body) return [];
  var out = [];
  var lines = String(body).split(/\r?\n/);
  for (var i=0;i<lines.length;i++){
    var ln = lines[i].trim();
    if (!ln) continue;
    if (/^>/.test(ln)) continue;
    if (/^On .+ wrote:$/.test(ln)) break;
    if (/^-{2,}/.test(ln)) break;
    if (/^(sent from|get outlook|thanks|cheers|todd)\b/i.test(ln)) continue;
    ln = ln.replace(/^[-*•\d.\)\s]+/, '').trim();
    if (ln.length >= 2) out.push(ln);
  }
  var seen = {}, res = [];
  out.forEach(function(x){ var k=x.toLowerCase(); if(!seen[k]){seen[k]=1;res.push(x);} });
  return res.slice(0,25);
}

function evolveFileReplyItems_(thread, items){
  var subj = thread.getFirstMessageSubject();
  var stamp = evolveNowStamp_();
  var n = 0;
  var target = evolveSheet_('to-do') || evolveSheet_('todo') || evolveSheet_('action');
  if (!target) return 0;
  for (var i=0;i<items.length;i++){
    try {
      target.appendRow([stamp, items[i], 'Open', 'from email reply: ' + subj]);
      n++;
    } catch(e){}
  }
  return n;
}

function evolveActOnItems_(items){
  var acted = [];
  items.forEach(function(it){
    var mq = it.match(/approve\b.*?(ECO-?Q-?[\w-]+)/i);
    if (mq){
      try {
        var q = evolveTable_('quote', ['quote','status','customer','amount']);
        for (var i=0;i<q.rows.length;i++){
          var idVal = String(evolveField_(q.rows[i],/(quote|id|#|ref)/i));
          if (idVal && it.toUpperCase().indexOf(idVal.toUpperCase()) >= 0){
            var col = q.headers.findIndex(function(h){ return /status/i.test(h); });
            if (col >= 0){
              var a1 = String.fromCharCode(65+col) + q.rows[i]._row;
              setCell_({ tab: evolveSheet_('quote').getName(), a1: a1, value: 'Approved (email ' + Utilities.formatDate(new Date(),EVOLVE.TZ,'MMM d') + ')' });
              acted.push('Marked quote ' + idVal + ' approved');
            }
            break;
          }
        }
      } catch(e){}
    }
  });
  return acted;
}

/* ----------------------------------------------------------------------------
 *  BIWEEKLY SUPPLIER PRICE SCAN  (was: evolve-supplier-price-scan, 1st & 15th)
 *  Server-side reminder + current Price Watch snapshot. (Live internet price
 *  scraping with judgement stays better suited to the desktop agent; this keeps
 *  the cadence alive server-side and nudges Todd so it never silently lapses.)
 * --------------------------------------------------------------------------*/
function evolveSupplierPriceScan() {
  if (typeof EV_dispatchSweep === 'function') return; // F-2: superseded by the EV_* generation
  try {
    var html = evolveHeader_('Supplier price scan — biweekly', evolveToday_());
    var snap = '';
    try {
      var pw = evolveTable_('price', ['item','supplier','price','paid','watch','sku','product']);
      if (pw.ok && pw.rows.length){
        var rows = pw.rows.slice(0,30).map(function(r){
          var item = evolveField_(r,/(item|product|sku|name)/i);
          var price = evolveField_(r,/(price|paid|cost|\$)/i);
          var sup = evolveField_(r,/(supplier|vendor|source)/i);
          return '<li>'+[item,sup,price].filter(function(x){return String(x).trim();}).map(evolveEsc_).join(' — ')+'</li>';
        }).join('');
        snap = '<ul>'+rows+'</ul>';
      }
    } catch(e){}
    html += evolveSection_('Current Price Watch', snap || '<i>No Price Watch rows found.</i>');
    html += evolveSection_('Action', 'Run a fresh internet price comparison on these supplies and update Price Watch. (Open Cowork and say "run the supplier price scan" — the desktop agent does the web comparison; this reminder fires server-side so the cadence never lapses.)');
    html += evolveFooter_();
    sendEmail_({ to: EVOLVE.OWNER_EMAIL, subject: 'Evolve supplier price scan — ' + evolveToday_(), htmlBody: html, body: 'Biweekly price scan reminder.' });
    appLog_('Trigger','Supplier price scan reminder emailed server-side at ' + evolveNowStamp_() + '.');
  } catch(e){ try{ appLog_('Trigger','Price scan ERROR: '+e.message);}catch(_){} }
  return 'price scan ok';
}

/* ----------------------------------------------------------------------------
 *  EMAIL CHROME — small, branded, inline-styled
 * --------------------------------------------------------------------------*/
function evolveHeader_(title, sub){
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;border:1px solid #e3e6e8;border-radius:10px;overflow:hidden">'
    + '<div style="background:#0b0f0c;padding:18px 22px">'
    + '<div style="color:#8ef04a;font-size:13px;letter-spacing:2px;font-weight:bold">EVOLVE ECO BLASTING</div>'
    + '<div style="color:#ffffff;font-size:22px;font-weight:bold;margin-top:2px">'+evolveEsc_(title)+'</div>'
    + '<div style="color:#9fb3a5;font-size:13px;margin-top:2px">'+evolveEsc_(sub)+'</div>'
    + '</div><div style="padding:6px 22px 4px">';
}
function evolveSection_(h, bodyHtml){
  return '<div style="margin:16px 0 4px;font-size:15px;font-weight:bold;color:#0b0f0c;border-bottom:2px solid #8ef04a;padding-bottom:4px">'+evolveEsc_(h)+'</div>'
    + '<div style="font-size:14px;color:#222;line-height:1.5">'+bodyHtml+'</div>';
}
function evolveFooter_(){
  return '<div style="margin-top:18px;padding-top:10px;border-top:1px solid #e3e6e8;color:#7a8a80;font-size:12px">'
    + 'Sent automatically by the Evolve router on Google servers at '+evolveNowStamp_()+' — no PC or desktop app required. '
    + 'Reply to this email to add items; I scan replies every 15 minutes.'
    + '</div></div></div>';
}

/* ----------------------------------------------------------------------------
 *  SELF-TEST  (proves autonomy; safe to run/trigger anytime)
 *  Sends a clearly-labelled test to the automation account itself and writes an
 *  App Log heartbeat. Deletes its own one-off trigger if present.
 * --------------------------------------------------------------------------*/
function evolveSelfTest() {
  var who = Session.getEffectiveUser().getEmail();
  var html = evolveHeader_('Autonomy self-test ✅', evolveNowStamp_())
    + evolveSection_('Proof', 'This email was composed and sent by a Google Apps Script <b>time-driven trigger</b> running on Google servers — the Claude desktop app was not involved. If you are reading this in the Sent folder, server-side autonomy is working.')
    + evolveFooter_();
  sendEmail_({ to: who, subject: 'Evolve Autonomy Self-Test ✅ (server-side, safe to ignore)', htmlBody: html, body: 'Server-side self-test.' });
  appLog_('Trigger','SELF-TEST: server-side email sent to ' + who + ' at ' + evolveNowStamp_() + ' with NO desktop app. Autonomy confirmed.');
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === 'evolveSelfTest') {
      try { ScriptApp.deleteTrigger(t); } catch(e){}
    }
  });
  return 'self-test sent to ' + who;
}

function evolveScheduleSelfTest() {
  ScriptApp.newTrigger('evolveSelfTest').timeBased().after(3 * 60 * 1000).create();
  try { appLog_('Trigger','Scheduled one-off self-test ~3 min out at ' + evolveNowStamp_() + '.'); } catch(e){}
  return 'self-test scheduled ~3 min out';
}
