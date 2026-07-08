/**
 * ============================================================================
 *  EVOLVE SYSTEM BACKUPS  —  every 3 days, accident-proof copies of the whole
 *  Ops Workbook into a dedicated, clearly-marked Drive folder.
 * ----------------------------------------------------------------------------
 *  WHY: the Ops Workbook is the irreplaceable structured database for the whole
 *  business. This takes a FULL, independent copy of it every 3 days so that if
 *  the live file is ever damaged, mis-edited, or deleted, you can open the most
 *  recent snapshot and you have lost at most 3 days.
 *
 *  ACCIDENT-PROOF DESIGN (best possible on a standard Google account):
 *    - Each backup is a separate, full copy — independent of the live file.
 *    - Copies live in their own folder "00 SYSTEM BACKUPS — DO NOT DELETE"
 *      (separate from the working folders, with a README inside).
 *    - The job NEVER deletes anything — every snapshot is kept forever, so even
 *      if one copy is removed by hand, all the others remain.
 *    - Copies are set private/view-only to discourage stray edits.
 *    (True immutability/retention-lock needs Google Workspace + Vault; this is
 *     the strongest protection available without that, and it is a real safety
 *     net because the snapshots are independent of the live file.)
 *
 *  ONE-TIME SETUP:  Run ▸ EV_installBackups
 *    Creates the folder, installs the 3-day trigger, and takes the first backup
 *    immediately so you can confirm it works. Uses only existing scopes (Drive +
 *    ScriptApp + MailApp) — no new authorization needed.
 *
 *  Reuses appLog_() from Code.gs (same project).
 * ============================================================================
 */
var EV_BACKUP = {
  SS_ID:          'YOUR_SPREADSHEET_ID',   // Evolve_Ops_Workbook_final
  ROOT_FOLDER_ID: 'YOUR_DRIVE_ROOT_ID',              // Drive root: Evolve Eco Blasting
  FOLDER_NAME:    '00 SYSTEM BACKUPS — DO NOT DELETE',
  ALERT_EMAIL:    'manager@yourcompany.com',
  TZ:             'America/Edmonton',
  EVERY_DAYS:     3
};

/** Find (or create) the dedicated, clearly-marked backup folder. */
function EV_backupFolder_() {
  var root = DriveApp.getFolderById(EV_BACKUP.ROOT_FOLDER_ID);
  var it = root.getFoldersByName(EV_BACKUP.FOLDER_NAME);
  var f = it.hasNext() ? it.next() : root.createFolder(EV_BACKUP.FOLDER_NAME);
  try {
    if (!f.getFilesByName('READ ME — automated backups.txt').hasNext()) {
      f.createFile('READ ME — automated backups.txt',
        'This folder holds automatic full copies of the Evolve Ops Workbook, taken every ' +
        EV_BACKUP.EVERY_DAYS + ' days by the Field App script.\n\n' +
        'DO NOT DELETE these files. Each one is a complete, independent snapshot of the whole ' +
        'database. If the live workbook is ever damaged or lost, open the most recent backup ' +
        '(File > Make a copy) and you are back in business.\n\n' +
        'The job never deletes old backups, so you always have history to fall back on.');
    }
  } catch (e) {}
  return f;
}

/** Take one full backup of the workbook now. Returns a status string. */
function EV_runBackup() {
  try {
    var folder = EV_backupFolder_();
    var stamp = Utilities.formatDate(new Date(), EV_BACKUP.TZ, 'yyyy-MM-dd HHmm');
    var name = 'Evolve Ops Workbook — BACKUP ' + stamp;
    var copy = DriveApp.getFileById(EV_BACKUP.SS_ID).makeCopy(name, folder);
    try { copy.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW); } catch (e) {}
    try { copy.setDescription('Automated Evolve system backup — ' + stamp + ' MT. Independent full copy. Do not delete.'); } catch (e) {}

    var total = 0; var fi = folder.getFiles();
    while (fi.hasNext()) { fi.next(); total++; }
    try { appLog_('Backup', 'System backup created: "' + name + '" — ' + total + ' snapshot(s) now on file in "' + EV_BACKUP.FOLDER_NAME + '".'); } catch (e) {}
    return 'backup ok: ' + name + ' (' + total + ' on file)';
  } catch (err) {
    try { appLog_('Backup', 'BACKUP FAILED: ' + err); } catch (e) {}
    try { MailApp.sendEmail(EV_BACKUP.ALERT_EMAIL, 'Evolve BACKUP FAILED', 'The automated workbook backup did not run:\n\n' + String(err && err.stack ? err.stack : err)); } catch (e) {}
    throw err;
  }
}

/** One-time installer: idempotent. Creates the 3-day trigger + first backup. */
function EV_installBackups() {
  if (typeof EV_requireConfigured_ === 'function') EV_requireConfigured_();   // E-4: refuse while placeholders remain
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'EV_runBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('EV_runBackup').timeBased().everyDays(EV_BACKUP.EVERY_DAYS).atHour(3).create();
  var first = EV_runBackup();   // prove it works right now
  try { appLog_('Backup', 'Backups installed: every ' + EV_BACKUP.EVERY_DAYS + ' days at ~3 AM (server-side, no PC needed). ' + first); } catch (e) {}
  return 'Backups installed — every ' + EV_BACKUP.EVERY_DAYS + ' days at ~3 AM. ' + first;
}

/** Convenience: list the backups on file (Run ▸ EV_listBackups, see the log). */
function EV_listBackups() {
  var folder = EV_backupFolder_();
  var fi = folder.getFiles(), out = [];
  while (fi.hasNext()) { var f = fi.next(); if (f.getName().indexOf('BACKUP') >= 0) out.push(f.getName()); }
  out.sort();
  Logger.log(out.length + ' backups:\n' + out.join('\n'));
  return out;
}
