<p align="center">
  <img src="app-frame/evolve-icon.png" width="116" alt="Evolve Field App">
</p>

<h1 align="center">Evolve Field App</h1>

<p align="center">
  <em>The back office of a blasting company, run on autopilot.</em><br>
  Crew tap a button in the truck. The system files the books, prices the quotes, audits itself, and backs itself up — while they drive to the next job.
</p>

<p align="center">
  <strong>$0/month · Google Apps Script + a spreadsheet + a scheduled AI · no servers, no SaaS</strong>
</p>

---

## TL;DR

A mobile-first capture app for an abrasive-blasting crew who aren't technical and shouldn't have to be. They sign in with a name and a 4-digit PIN, tap one big button — **Receipt, Job Photo, Before/After, Lead, Customer, Quote, Inventory, Price, Job Actuals, "just say what it is"** — snap a photo, and hit save. That's the whole job.

Everything they capture lands in one safe **Inbox** tab of the company's Google Sheets "Ops Workbook." Then **two brains take over**:

1. A **scheduled Claude agent** reads the inbox a few times a day and does the part nobody wants to do — reads the receipt, files it under Expenses; turns a field note into a Lead with a follow-up; prices a quote, generates the branded PDF, and emails it; and audits the whole workbook for things that slipped.
2. A **server-side automation layer** running on Google's own triggers (no PC required) sends the morning digest, sweeps the money loop three times a day, turns email replies into to-dos, **mines spend for daily insights**, and **backs up the entire workbook every three days into a copy that can't be deleted by accident.**

It is the difference between *"we have a spreadsheet"* and *"the spreadsheet runs the business."*

---

## What this actually is

Most small trades businesses die by a thousand un-logged receipts. The owner is on a ladder, not at a desk. Data entry is the tax you pay for knowing whether you made money, and nobody pays it on time.

This kills the tax.

- **Capture is one tap and a photo.** No training. No "fields." If they're not sure where something goes, they hit **Quick Capture**, say it in plain words, and the AI figures it out.
- **The crew can't break the books.** Every capture lands in a safe staging **Inbox**, and clean expense rows are auto-filed to Expenses server-side — but the app only ever *appends rows or sets cells*. It never edits or deletes the fragile matrix, legend, and scorecard layouts that are easy to corrupt. The heavy structured filing — quotes, dispatch, P&L — runs through the scheduled brains, not the crew's phone.
- **The intelligence is the back-office clerk.** It routes every inbox item into the correct tab with the correct columns, builds and emails quotes, raises "you forgot to invoice this" alerts, reconciles the books, surfaces money-saving insights — then logs exactly what it did.
- **It keeps running with the PC off.** The digests, sweeps, insight generation, and backups live on Google's time-driven triggers, so the back office runs whether or not anyone's computer is on.
- **It runs on what the business already pays for.** Google Workspace + a domain. No new subscriptions, no server, no per-seat SaaS.

> The design goal was never "an app." It was: *the owner should be able to ignore the back office for a week and come back to a clean, current, correctly-categorized set of books — and never lose a thing.*

---

## How it runs the business on autopilot

```
  FIELD CREW (phone)            SAFE STAGING            THE TWO BRAINS                    THE BOOKS
 ┌────────────────────┐      ┌──────────────┐    ┌──────────────────────────┐     ┌──────────────────┐
 │  Evolve Field App   │      │  📥 App Inbox │    │ ① Scheduled Claude agent │     │  Quotes           │
 │  name + 4-digit PIN  │ tap  │  (append-only │    │    7am · 1pm · 7pm        │ files│  Customers · Leads │
 │                      │ ───▶ │   staging)    │──▶ │    files · quotes · audit │ ───▶ │  Dispatch          │
 │  • Receipt / Expense │ photo│              │    │                          │     │  Expenses          │
 │  • Job / Before·After│      │  👥 App Users │    │ ② Apps Script autonomy   │     │  Inventory         │
 │  • Lead / Customer   │      │  🗒 App Log   │    │    (Google triggers,     │     │  Job P&L           │
 │  • Build a Quote     │      └──────┬───────┘    │     PC-off):              │     │  Action Items      │
 │  • Inventory / Price │             │            │    • morning digest      │     │  Price Watch …     │
 │  • Job Actuals       │   photos    ▼            │    • money-loop sweep ×3  │     └─────────┬────────┘
 │  • Request a feature │      ┌──────────────┐    │    • email-reply → to-do │               │
 │  • Quick Capture 🎙  │ ───▶ │ Google Drive  │    │    • 💡 insights engine  │  emails the   │
 └─────────┬───────────┘      │ receipts/photos│   │    • 🛟 3-day backups     │  branded quote │
           │                  └──────────────┘    └───────────┬──────────────┘  + alerts ◀─────┘
           │                                                   │
           └───────────────── insights + digests + quotes + "you forgot to invoice X" ──────▶ OWNER'S INBOX
```

The crew side is dumb on purpose. The intelligence lives in the scheduled layers, where it's cheap, auditable, and can be improved without ever touching the thing in the crew's hands.

---

## The capture app

A single-screen, PWA-style web app (`Index.html`), branded to match the company site (dark "Boreal Void," Cyber-Lime accents, Neue Montreal). Built for one-handed use in a truck.

| Button | What a tap does |
|---|---|
| 🎙 **Quick Capture** | Snap + say it in plain words. The AI decides where it belongs. |
| 🧾 **Receipt / Expense** | Photo → vendor, total, date auto-read → Expenses + Drive |
| 📸 **Job Photo** | On-site shots with GPS, tagged to the job |
| 🪄 **Before & After** | Paired marketing shots, kept together for socials |
| 🎯 **New Lead** | Snap a business card or the job → pipeline with a follow-up |
| 🤝 **New Customer** | Add to the book — card photo or typed |
| 💲 **Build a Quote** | Sq ft + scope + "use our rates" *or* "set my own price" |
| 🗓️ **Schedule / Dispatch** | Move a job, change its status |
| ✅ **To-Do / Task** | Drop a task with priority + due date |
| 📦 **Inventory Count** | Stock counts by section |
| 🛒 **Price / Purchase** | What we paid, for price-watching |
| 🏪 **Supplier** | Add a vendor — local/online, products, pricing |
| 📊 **Job Actuals** | Real hours and costs after a job, for true margin |
| 📋 **Job Report** | Full end-of-job wrap-up for the Job Form |
| 🛠 **Request / Report** | Crew ask for features or report bugs → straight to the to-do list |

Niceties: a 4-digit PIN keypad, persistent login (HMAC-signed 30-day tokens), auto-downscaled photos uploaded one at a time for weak cellular, tap-to-attach GPS, an "add to home screen" coach, and a green-glow UI that doesn't look like a spreadsheet.

---

## Brain ① — the scheduled Claude router

A scheduled agent that follows a playbook ([`claude-router-task.md`](claude-router-task.md)) on every run:

- **Files everything** — exact column maps for all the workbook tabs, currency-as-text vs numbers, legends/scorecards left untouched, cross-tab keys kept consistent.
- **Builds quotes** — prices from the rate table (sq ft × rate × access + mobilization, +GST, deposit) *or* a custom number, generates the branded PDF from the company template, emails it to the owners, and files it across Quotes + Customers + Leads.
- **Audits the books** — raises Action Items for unpaid invoices, stale/expiring quotes, deposits-in-but-unscheduled, jobs done-but-not-invoiced, and leads with no next action.
- **Never deletes. When unsure, it flags "NEEDS REVIEW" instead of guessing.**

It writes back only through a **narrow, secret-authenticated API** (`doPost`) that can append rows, set single cells, mark inbox items, send mail, and post insights — never wipe or delete.

---

## Brain ② — the server-side autonomy layer (`AutoServer.gs`)

Everything that *must* be reliable lives on Google's time-driven triggers, so it fires whether or not any computer is on. Install it with **`EV_installCore()`** + **`EV_installGmail()`** (and `EV_setupBrain()` + `EV_installBackups()`, below):

| Job | Cadence | What it does |
|---|---|---|
| **Morning ops digest** | daily ~7:45 AM | Weather, money loop, open follow-ups, quotes in play, inbox health → emailed to the owner |
| **Personal daily digest** | daily ~6:00 AM | Today's to-do list, reply-to-add |
| **Dispatch sweep + insight refresh** | 7 AM · 1 PM · 7 PM | Audits deposit→invoice→paid, overdue items, unfiled inbox; refreshes the 💡 insights; writes a heartbeat; emails only when something needs a human |
| **Email-reply monitor** | hourly | Reads replies to the digests, turns each line into a logged to-do, and confirms by reply |
| **🛟 System backups** | every 3 days | A full, accident-proof copy of the entire workbook |

> **Note on generations:** `AutoServer.gs` (the `EV_*` functions) is the current autonomy + brain. An earlier generation (`evolve*` functions in `Code.gs`, installed by `evolveInstallTriggers`) is superseded — `EV_installCore()` clears it out. Install the `EV_*` set; don't run both, or digests double-send.

---

## The Business Brain — insights that get smarter

`EV_generateInsights()` turns raw data into a ranked, plain-English feed in an auto-created **Insights** tab. It refreshes on every dispatch sweep (7 AM · 1 PM · 7 PM) and on each field submission, and is also exposed as an app-callable endpoint (`apiInsights(token)`) for a future in-app feed:

- **Spend intelligence** — this month vs last month, biggest vendor, biggest category and its share, the single largest expense, and **new-vendor detection** ("first purchase from X — check pricing vs Price Log").
- **Operational signals** — inbox backlog, money-loop gaps, anything that needs a human.
- **It learns what you care about.** Each insight carries an *Importance* dropdown (New / Important / Not important / Done) right in the Insights tab. Ratings flow into a **Feedback** tab (also writable via the `apiInsightFeedback` endpoint), and the engine weights future insights by what you've marked important — so the feed sharpens to *this* business over time.
- **Seed/estimate rows are excluded** from spend math, so baseline placeholders never pollute the numbers.

### Optional AI layer (receipt OCR + narrative)

Gemini-powered **receipt OCR** (`EV_ocrReceipt_`) and a short **"what to watch" narrative** (`EV_geminiNarrative_`) are built in but **gated behind an empty `GEMINI_API_KEY`** — dormant and safe until you paste a key from aistudio.google.com. With a key, a photographed receipt is parsed straight to `{vendor, total, gst, date, category}`.

---

## Every input is data — how captures become optimization

Nothing captured is "just a photo" or "just a note." Each input is geotagged, timestamped, and
cross-referenced against the rest, so small, individually-insignificant data points compound into
patterns the brain can act on.

**What gets gathered**
- **Location** — GPS is attached to job photos, before/after shots, leads, quotes, *and receipts*. Every capture knows *where* it happened.
- **Travel** — capture locations + job addresses (Dispatch) let the brain reason about distance, drive time, and fuel against the value of each job ("you drove 45 min for a $180 job").
- **Quotes** — sq ft, blast depth, rate, access factor, win/loss, and realized $/sq ft feed pricing optimization and the break-even check.
- **Receipts** — vendor, every line item, unit price, GST, payment method, and date — **full resolution, never downscaled** — tied to the job(s) running that day via Dispatch, so each job's true material + fuel cost is known.
- **Everything else** — supplier prices over time, lead source → conversion, inventory burn, weather vs scheduling, client ratings. All of it.

**How it becomes optimization.** The Business Brain (`EV_generateInsights`) plus the router's research pass cross-reference these inputs and surface ranked, plain-English suggestions daily — cheaper sourcing, pricing that's slipping, jobs whose travel eats the margin, vendors creeping up, the best day to schedule. They ride along in the morning email and the 💡 Insights feed, and the engine learns which ones matter from your Importance ratings. **The compounding is the point: the more you capture, the sharper the suggestions get over time.**

**Image integrity is non-negotiable.** Receipt, invoice, and paperwork photos upload at full original resolution — never downscaled or re-encoded — because they are financial and tax records and OCR can't read a degraded image. Nothing captured is ever deleted.

## 🛟 Data safety — backups that can't be deleted by accident

The Ops Workbook is the irreplaceable structured database for the whole business. [`Backups.gs`](Backups.gs) protects it:

- **Every 3 days** (server-side, ~3 AM, PC-off) it takes a **full, independent copy** of the entire workbook into a dedicated folder, `00 SYSTEM BACKUPS — DO NOT DELETE`, with a README inside.
- **It never deletes.** Every snapshot is kept forever, so a stray deletion can't wipe your history — there are always older copies to restore from.
- Copies are set private/view-only to discourage stray edits, and each is a standalone Google Sheet you can open and restore in one click.
- Uses only the permissions the app already has (Drive + triggers + mail), so **no new authorization is needed.** One-time setup: `Run ▸ EV_installBackups` (creates the folder, installs the trigger, and takes the first backup immediately). `EV_listBackups` shows what's on file; `EV_runBackup` makes one on demand.

> True retention-locking (immutability) requires Google Workspace + Vault. On a standard account this is the strongest protection available — independent full copies, never pruned, clearly marked — and it's a real safety net because every copy is independent of the live file.

---

## Safety-first, by construction

- The crew app (name + PIN) **appends to a staging Inbox and auto-files clean expense rows** — it only appends rows or sets cells, never deletes, and never rewrites the fragile legend/scorecard layouts.
- The scheduled Claude router writes back through a **narrow, shared-secret API** (`doPost`) for the heavier structured filing, quoting, and audit — append/set only, never wipe.
- Auth is **HMAC-signed, expiring tokens** with brute-force lockout. Photos are size-capped and uploaded one at a time so a weak signal in the field still succeeds.
- Heartbeats are written on every scheduled run, so the absence of a run is detectable rather than silent.

---

## Repo layout

| File | What it is |
|---|---|
| [`Code.gs`](Code.gs) | Backend: web-app entry, name+PIN auth, capture → Inbox, one-photo-per-call Drive uploads, the secret-authed router `doPost` API, and the email/digest helpers |
| [`AutoServer.gs`](AutoServer.gs) | The server-side autonomy layer: time-driven digests, sweeps, reply-monitor, the **Business Brain** (insights + spend + feedback learning), and the optional Gemini OCR/narrative |
| [`Backups.gs`](Backups.gs) | The 3-day, accident-proof workbook backup system |
| [`ReceiptOps.gs`](ReceiptOps.gs) | Router-health alerting + the QuickBooks-ready 📒 Receipt Log and a 3-day receipt-discrepancy report |
| [`FeedHistory.gs`](FeedHistory.gs) | Total-recall capture feed — `apiCaptureHistory` (paginated, full per-capture detail) for the tappable "Just Captured" view |
| [`OcrFill.gs`](OcrFill.gs) | Free receipt OCR auto-fill — `apiOcrReceipt` reads a receipt with Google Drive's **own** native OCR (no paid API/key, uses the existing Drive scope); when Drive OCR is rate-limited the app falls back to **on-device Tesseract.js** (`apiParseReceiptText` parses that text), so the button works either way. Pre-fills date/vendor/total for the rep to confirm |
| [`Index.html`](Index.html) | The entire branded capture app (UI + logic, runs in a built-in demo mode if opened directly) |
| [`appsscript.json`](appsscript.json) | Project manifest (OAuth scopes + web-app settings) |
| [`claude-router-task.md`](claude-router-task.md) | The scheduled Claude agent's playbook — column maps, quoting steps, audit rules |
| [`DEPLOY.md`](DEPLOY.md) | ~15-minute deployment guide |
| [`WORKBOOK-SCHEMA.md`](WORKBOOK-SCHEMA.md) | The blank Ops Workbook structure — every tab + columns, no business data |
| `app-frame/` | The custom-subdomain iframe wrapper + home-screen icon |

> **All IDs, the deployment URL, the router secret, the owner email, and the seed PINs in this repo are placeholders** (`YOUR_SPREADSHEET_ID`, `YOUR_ROUTER_SECRET`, `manager@yourcompany.com`, `'0000'`, …). Drop in your own. No live credentials are committed.

---

## The workbook

The app and brains read/write a single Google Sheets "Ops Workbook." Crew capture lands in app-owned tabs (**📥 App Inbox**, **👥 App Users**, **🗒 App Log**) and brain output in auto-created tabs (**Insights**, **Feedback**, **Vendors**). Filing happens into the live business tabs: **Quotes, Customers, Leads, Dispatch, Expenses, Inventory, Price Log, Price Watch, Suppliers, To-Do, Action Items, P&L, Job P&L, Quote Engine, Job Form, File Index, Start Here.** The crew app only auto-files clean expense rows (append/set, never delete); the structured filing, quoting, and audit run through the secret-authed router.

---

## Setup

Full guide in [`DEPLOY.md`](DEPLOY.md). In short:

1. **Create an Apps Script project** on the account that owns the workbook; paste in `Code.gs`, `AutoServer.gs`, `Backups.gs`, `ReceiptOps.gs`, `FeedHistory.gs`, `OcrFill.gs`, the `Index` HTML file, and `appsscript.json`.
2. **Fill in your IDs** (spreadsheet + Drive folders) and run **`setup()`** — it creates the app tabs and prints your `ROUTER_SECRET`.
3. **Deploy as a Web App** (execute as you, access "Anyone"). Open the `/exec` URL on a phone → *Add to Home Screen.*
4. **Turn on the autonomy + brain:** run **`EV_installCore()`** (morning digest + 3× dispatch sweep with insight refresh — it also clears any older triggers), **`EV_installGmail()`** (hourly reply-monitor + personal digest), **`EV_setupBrain()`** (Insights/Feedback/Vendors tabs), and **`EV_installBackups()`** (3-day backups). The `setup()` authorization already grants every scope (incl. `gmail.modify`), so no extra re-auth is needed.
5. **Point the scheduled Claude agent** at the `/exec` URL + secret, following [`claude-router-task.md`](claude-router-task.md).
6. **Change the seed PINs** in the App Users tab.

---

## Stack

- **Google Apps Script** — web app + time-driven triggers — the whole backend, free.
- **Google Sheets** as the database, **Google Drive** for photos and backups.
- **A scheduled Claude agent** as the routing/quoting/audit brain.
- **Deterministic Apps Script** as the always-on autonomy + insights + backup brain.
- **Optional Gemini** for receipt OCR + narrative (dormant until a key is added).
- **Plain HTML/CSS/JS** front end (no build step), wrapped on a custom subdomain.
- **Cost to run: $0/month** beyond the Google Workspace + domain the business already has.

---

<p align="center"><sub>Built for Evolve Eco Surface Prep &amp; Restoration. Crafted by Matt-Aurora-Ventures, with Claude.</sub></p>
