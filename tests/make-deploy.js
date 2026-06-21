/**
 * Generate PASTE-READY deploy files for the live Evolve Apps Script project.
 * The repo keeps placeholders only (public/rebrandable). This fills the live
 * Evolve IDs/emails into a local, git-ignored ../deploy-local/ folder so the
 * files can be pasted straight into the Apps Script editor without losing config.
 *
 *   node tests/make-deploy.js
 *
 * The mapping below is the Evolve-specific config (spreadsheet + Drive folder IDs,
 * operator email) — NOT secret (the ROUTER_SECRET lives in Script Properties, never
 * in code). deploy-local/ is git-ignored so none of this is committed.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'deploy-local');

// placeholder -> live Evolve value (sourced from the live snapshot + CLAUDE.md)
const MAP = [
  ['YOUR_SPREADSHEET_ID', '1WbEC_mgmenCnqD3I1mehyCX7-mf8yYJHL1d08eJFCFA'],
  ['YOUR_DRIVE_ROOT_ID', '1WlEhX4FTOCStTpD9xh5Qu-qsa_3hlA31'],
  ['YOUR_01_QUOTES_FOLDER_ID', '1kI-h9vf1a8df5QNeDSRv8eHj_NOzOWsf'],
  ['YOUR_02_RECEIPTS_FOLDER_ID', '1boyYfLhBNq-JSR8VhEOc8WtAeOWP5g7i'],
  ['YOUR_03_JOB_PHOTOS_FOLDER_ID', '1GALPvRl_HT-hDwFIndLQsiFB_CG5Fmwn'],
  ['YOUR_04_CUSTOMERS_FOLDER_ID', '1iRLUB5tbt_zF0Oz1WVf9UWcSZnNrIA8Q'],
  ['YOUR_05_DISPATCH_FOLDER_ID', '108NgYuoh6vPl5CP0lLV0CXN7PBkjJ-Zo'],
  ['YOUR_06_TEMPLATES_FOLDER_ID', '13FpiUbt6YvFCa9JZL4fCmYBuy2E7k3UB'],
  ['YOUR_07_MANUALS_FOLDER_ID', '15OqnLEQywpszsGFiC_JxQ_4yeVLG7Ak5'],
  ['manager@yourcompany.com', 'lucidbloks@gmail.com'],
  // Drive intake drop folder -> Todd's "Evolve temp" pile (repoint anytime; this clears the backlog).
  ['YOUR_DROP_FOLDER_ID', '1reWd-k9dCERYWVI9vvw2qMUsOHTXu38_'],
];

const FILES = ['Code.gs', 'AutoServer.gs', 'Filing.gs', 'OcrFill.gs', 'Hardening.gs', 'Intelligence.gs',
  'DriveIntake.gs', 'ReceiptOps.gs', 'Backups.gs', 'FeedHistory.gs', 'Index.html', 'appsscript.json'];

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
let remaining = 0;
for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { console.log('skip (missing): ' + f); continue; }
  let txt = fs.readFileSync(src, 'utf8');
  for (const [ph, val] of MAP) txt = txt.split(ph).join(val);
  const left = (txt.match(/YOUR_[A-Z0-9_]+|yourcompany\.com/g) || []).length;
  remaining += left;
  fs.writeFileSync(path.join(OUT, f), txt);
  console.log('wrote deploy-local/' + f + (left ? ('  ⚠ ' + left + ' placeholder(s) still present') : '  ✓'));
}
console.log('\n' + (remaining ? ('⚠ ' + remaining + ' placeholder(s) remain — check the MAP') : 'All placeholders filled. Paste deploy-local/* into the Apps Script editor.'));
