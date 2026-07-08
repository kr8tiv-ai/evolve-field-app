/** ===== START HERE — central self-documenting hub for the Evolve Ops sheet =====
 *  EV_writeStartHere() (re)writes the "Start Here" tab so any new Claude session can be
 *  told "go to the Ops sheet" and learn the whole system. Reachable via maint fn 'writeStartHere'. */
function EV_writeStartHere(){
  var S = ss_();
  var sh = S.getSheetByName('Start Here') || S.insertSheet('Start Here', 0);
  var lines = EV_START_HERE_LINES_();
  lines.push('');
  lines.push('Last rebuilt by Claude: ' + EV_fmt_(EV_now_(), 'EEEE, MMMM d, yyyy HH:mm') + ' (America/Edmonton).');
  sh.clearContents();
  var rows = lines.map(function(l){ return [l]; });
  var rng = sh.getRange(1, 1, rows.length, 1);
  rng.setNumberFormat('@');   // force plain text so lines like "=====" are not parsed as formulas
  rng.setValues(rows);
  try {
    sh.setColumnWidth(1, 980);
    sh.getRange(1, 1).setFontSize(15).setFontWeight('bold');
    sh.setFrozenRows(1);
  } catch (e) {}
  try { appLog_('Autopilot', 'Start Here hub rebuilt (' + rows.length + ' lines).'); } catch (e) {}
  return 'Start Here written: ' + rows.length + ' lines';
}

function EV_START_HERE_LINES_(){
  var a = [];
  a.push("START HERE — EVOLVE OPS — READ THIS FIRST");
  a.push("");
  a.push(">> NEW CLAUDE SESSION? Read this whole page first. It is the map of the entire ops system. Every other tab assumes you have read this. Commit it to memory, then operate. <<");
  a.push("");
  a.push("WHAT THIS SHEET IS");
  a.push("This Google Sheet (\"Evolve Ops\", fileId YOUR_SPREADSHEET_ID) is the SINGLE SOURCE OF TRUTH for Evolve Eco Blasting. One file, the whole business. Every automation reads and writes HERE. If a record is missing, add it; if it changed, update the existing row in place — never duplicate, never fail silently.");
  a.push("");
  return a.concat(EV_SH_brands_(), EV_SH_assets_(), EV_SH_process_(), EV_SH_airules_());
}

function EV_SH_brands_(){
  return [
    "____________________________________________________________________",
    "TWO BRANDS — KEEP THEM SEPARATE (HARD RULE)",
    "____________________________________________________________________",
    "There are TWO different Evolve businesses. They share ONLY the word \"Evolve\" (linked for SEO). They are NOT the same brand. NEVER cross-label: never put one brand's name, voice, colours, logo, or domain on the other. If unsure which brand a task is for, ASK — do not guess.",
    "",
    "BRAND 1 — EVOLVE ECO BLASTING  (THIS sheet runs this business)",
    "- What: mobile abrasive / dustless blasting + concrete restoration and surface-prep SERVICE business (Alberta).",
    "- Audience: homeowners, contractors, property managers, fleet / industrial owners.",
    "- Domain: evolveecoblasting.com   (field app: app.evolveecoblasting.com)",
    "- Look: dark background #0a0a0a / #050505, aurora-green accent #4ade80 (neon green #39ff14), Alloy Silver muted text. Professional, clean, high-contrast.",
    "- Fonts: Neue Montreal (headings, uppercase, tight); system sans-serif for body.",
    "- Voice: straight, competent, dry blue-collar humour. ALWAYS \"abrasive blasting\" / \"dustless blasting\" — NEVER \"sandblasting\". \"substrate profiling\", not \"cleaning\". Oxford commas. No exclamation points.",
    "- Logos / assets: Drive > 06 Brand & Templates > Evolve Logos & Media Kit. Live site logos: evolveecoblasting.com/images/logos/.",
    "",
    "BRAND 2 — EVOLVE APPAREL  (DIFFERENT business — do NOT mix into blasting)",
    "- What: Western-Canadian OUTDOOR LIFESTYLE apparel brand.",
    "- Audience: outdoor lifestyle / Western Canada.",
    "- Domain: evolveapparel.shop",
    "- Look: cinematic outdoor, warm, scenic — its OWN logo, fonts, and colours (NOT the blasting kit).",
    "- Voice: warm, funny, \"Purely Canadian / Get Outside\".",
    "",
    "HARD RULE: never write \"Evolve Eco Blasting\" on apparel content, and never use apparel voice / branding on blasting content. Each brand keeps its own separate kit. Blasting work = Brand 1 only.",
    ""
  ];
}

function EV_SH_assets_(){
  return [
    "____________________________________________________________________",
    "WHERE EVERYTHING LIVES",
    "____________________________________________________________________",
    "GOOGLE DRIVE (root \"Evolve Eco Blasting\", folderId YOUR_DRIVE_ROOT_ID):",
    "- 01 Quotes (finished quote PDFs): YOUR_01_QUOTES_FOLDER_ID",
    "- 02 Receipts & Expenses (receipt photos): YOUR_02_RECEIPTS_FOLDER_ID",
    "- 03 Job Photos (before/after, one subfolder per job): YOUR_03_JOB_PHOTOS_FOLDER_ID",
    "- 04 Customers · 05 Dispatch & Schedules · 06 Brand & Templates (logos + quote/invoice kit) · 07 Manuals & Procedures",
    "QUOTE / INVOICE PDF TEMPLATE: C:\\Users\\lucid\\Documents\\Evolve Quote Template\\ (quote_template.py + assets).",
    "WEBSITE: evolveecoblasting.com (Hostinger). Blog at /blog/. Source repo: GitHub kr8tiv-io/Evolve-Rebrand. The live HTML/CSS is edited in the Hostinger hPanel File Manager (cache-bust with ?v=NN on style.min.css).",
    "FIELD APP: app.evolveecoblasting.com -> Apps Script web app. Project \"Evolve Field App\", scriptId YOUR_SCRIPT_ID. Local source: C:\\Users\\lucid\\Desktop\\Evolve Field App\\. Deploy with: clasp push (triggers run latest code immediately).",
    "ROUTER API (the ONLY safe way to write the sheet from outside, server-side, no browser): URL + secret in C:\\Users\\lucid\\Desktop\\evolve-router-url.txt. Actions: ping, getNew, readTab, tabList, writeRow, setCell, markInbox, log, sendEmail, maint.",
    "",
    "SHEET TABS (the database):",
    "- Funnel: Leads -> Quote Engine -> Quotes -> Dispatch -> Job Form -> Job P&L",
    "- Money: Expenses, Receipt Log, Price Log, Price Watch, Suppliers, Inventory, P&L",
    "- Safety nets: Action Items (the ball-drop catcher), To-Do, Customers, File Index",
    "- App: App Inbox (field-app capture queue), App Users (crew name + 4-digit PIN), App Log (router heartbeat + audit trail)",
    ""
  ];
}

function EV_SH_process_(){
  return [
    "____________________________________________________________________",
    "REPEATABLE PROCESSES (step by step)",
    "____________________________________________________________________",
    "LEAD -> QUOTE -> JOB FLOW:",
    "1. New inquiry -> a LEADS row the same day, with NEXT ACTION + date.",
    "2. Price with the QUOTE ENGINE. Capture sq ft + blast depth. Rates (CAD/sq ft): very light ~2.50, light ~3.75, medium ~6.90, heavy ~14.50; exposed-aggregate = medium; mobilization ~250. Subtotal = sqft x rate x access + mobilization; GST 5%; deposit 25%; valid 30 days. Never below break-even — Todd prices fair on purpose, FLAG do not raise.",
    "3. Build the PDF from the template -> save to Drive 01 Quotes -> add a QUOTES row -> follow-up in ACTION ITEMS. Quote no. ECO-Q-MMDDYY-NN. Always capture the customer's EMAIL.",
    "4. Accepted -> DISPATCH row + 25% deposit tracked (Dispatch col K deposit / L invoiced / M paid). Job done -> Job Form card + Job P&L actuals (hours, wages, media).",
    "5. Units + voice: square feet, CAD, abrasive blasting. Fresh concrete cures 28 days before blasting.",
    "",
    "INVOICE TEMPLATE: same kit as quotes (Drive 06 Brand & Templates). Email to the customer + cc Todd; record in Customers + P&L.",
    "",
    "RECEIPT TEMPLATE + INTAKE: crew snap a receipt in the field app (or back-office app) -> photo to Drive 02 -> a row in EXPENSES + the QuickBooks-ready RECEIPT LOG; OCR reads vendor / date / total. A RECEIPT is a purchase we PAID for. Do NOT file inventory items as receipts (see Inventory).",
    "",
    "INVENTORY SYSTEM: counts of blasting media (crushed glass, corn cob, soda, walnut), PPE, pipe, and equipment -> the INVENTORY tab. Field / back-office \"inventory\" captures go to Inventory, NOT Expenses. Low counts surface as reorder flags in the sweep.",
    "",
    "MORNING DIGEST (6 AM, server-side: EV_morningDigest -> EV_buildDigestV3_): reads the sheet LIVE. \"Today's focus\" = open ACTION ITEMS (data-driven — mark an item Done/Closed in the sheet and it drops off next morning). Jobs / to-dos filter resolved rows and dedupe by Quote/Job ID. Optional free-text override: Script Property EV_DIGEST_NOTES (focus) / EV_DIGEST_REMINDERS (reminders). Weather + a rotating joke included.",
    "",
    "DISPATCH ROUTER / SWEEP (7 AM / 1 PM / 7 PM): files NEW App Inbox captures into the right tab (writeRow, update-in-place, never duplicate), prepares + HOLDS quotes for review, saves all photos to Drive 03, audits the money loop, raises keyed/deduped Action Items, and emails Todd. If captures pile up NEW with no router run in 12h it emails \"ROUTER MAY BE DOWN\" — meaning the Claude filer needs to run, NOT that the web app is down.",
    ""
  ];
}

function EV_SH_airules_(){
  return [
    "____________________________________________________________________",
    "FOR ANY AI / CLAUDE SESSION — OPERATING RULES",
    "____________________________________________________________________",
    "- This sheet is the source of truth. READ before you WRITE. When a record is missing, pull as much info as possible and ADD or UPDATE it — do not fail, do not duplicate.",
    "- Key every record by ID (ECO-Q / Job ID / lead name) and UPDATE IN PLACE. Never re-raise an item already marked Done / Closed / Removed.",
    "- Append/update only; never delete a row. If unsure where something goes, set status NEEDS REVIEW with a note.",
    "- Pick the correct BRAND every time (see Two Brands above). Blasting = Evolve Eco Blasting; apparel = Evolve Apparel; never mix.",
    "- Write via the Router API (server-side). Do not hand-edit the money tabs.",
    "- Brand voice + facts are CANONICAL here — use them, do not re-derive them stale each day."
  ];
}
