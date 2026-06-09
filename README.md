<p align="center">
  <img src="app-frame/evolve-icon.png" width="116" alt="Evolve Field App">
</p>

<h1 align="center">Evolve Field App</h1>

<p align="center">
  <em>The back office of a blasting company, run on autopilot.</em><br>
  Crew tap a button in the truck. Claude files the books while they drive to the next job.
</p>

<p align="center">
  <strong>$0/month · Google Apps Script + a spreadsheet + a scheduled AI · no servers, no SaaS</strong>
</p>

---

## TL;DR

A mobile-first capture app for a mobile abrasive-blasting crew that aren't technical and shouldn't have to be. They sign in with a name and a 4-digit PIN, tap one big button — **Receipt, Job Photo, Before/After, Lead, Quote, Inventory, "just say what it is"** — snap a photo, and hit save. That's the whole job.

Everything they capture lands in one safe **Inbox** tab of the company's Google Sheets "Ops Workbook." Then a **scheduled Claude agent** reads that inbox a few times a day and does the part nobody wants to do: it reads the receipt, extracts the vendor and total, files it under Expenses; turns a field note into a Lead with a follow-up date; prices a quote from the rate table, generates the branded PDF, and emails it; and audits the whole workbook for things that fell through the cracks.

It is the difference between *"we have a spreadsheet"* and *"the spreadsheet runs itself."*

---

## What this actually is

Most small trades businesses die by a thousand un-logged receipts. The owner is on a ladder, not at a desk. Data entry is the tax you pay for knowing whether you made money, and nobody pays it on time.

This kills the tax.

- **Capture is one tap and a photo.** No training. No "fields." If they're not sure where something goes, they hit **Quick Capture**, say it in plain words, and the AI figures it out.
- **The crew never touch the real books.** The app *physically cannot* write into the live financial tabs — quotes, P&L, dispatch, scorecards. It only ever appends to a staging **Inbox**. Nothing the crew does can corrupt the workbook.
- **Claude is the back-office clerk.** On a schedule (3×/day), it routes every inbox item into the correct tab with the correct columns, builds and emails quotes, raises "you forgot to invoice this" alerts, and reconciles the books — then logs exactly what it did.
- **It runs on what the business already pays for.** Google Workspace + a domain. No new subscriptions, no server, no per-seat SaaS.

> The design goal was never "an app." It was: *the owner should be able to ignore the back office for a week and come back to a clean, current, correctly-categorized set of books.*

---

## How it runs the business on automation mode

```
  FIELD CREW (phone)                      THE BRAIN (scheduled)                 THE BOOKS
 ┌────────────────────┐                 ┌────────────────────────┐          ┌──────────────────┐
 │  Evolve Field App   │   one tap +     │   Claude router agent   │  files   │  Ops Workbook     │
 │  name + PIN          │── photo/note ─▶│   runs 7am · 1pm · 7pm  │─────────▶│  Quotes           │
 │                      │                │                         │          │  Customers        │
 │  • Receipt/Expense   │                │  1. read new inbox rows │          │  Leads            │
 │  • Job / Before·After│                │  2. OCR receipts, parse │          │  Dispatch         │
 │  • Lead / Customer   │                │  3. file to right tab   │          │  Expenses         │
 │  • Build a Quote     │                │  4. price + PDF + email │          │  Inventory        │
 │  • Inventory / Price │                │     quotes              │          │  Job P&L          │
 │  • Request a feature │                │  5. AUDIT: unpaid       │          │  Action Items     │
 │  • Quick Capture 🎙  │                │     invoices, stale     │          │  Price Watch …    │
 └─────────┬──────────┘                 │     quotes, missing     │          └──────────────────┘
           │ writes to                   │     follow-ups          │                  ▲
           ▼                             └───────────┬────────────┘                  │
   ┌──────────────────┐                              │   emails the finished          │
   │  📥 App Inbox      │◀─────────────────────────────  quote (branded PDF) ──────────┘
   │  (safe staging)    │   reads + marks FILED         to the owners
   └──────────────────┘
```

The crew side is dumb on purpose. The intelligence lives in the scheduled agent, where it's cheap, auditable, and can be improved without ever touching the thing in the crew's hands.

---

## The capture app

A single-screen PWA-style web app, branded to match the company site (dark "Boreal Void", Cyber-Lime accents, Neue Montreal). Built for one-handed use in a truck.

| Button | What a tap does |
|---|---|
| 🎙 **Quick Capture** | Snap + say it in plain words. The AI decides where it belongs. |
| 🧾 **Receipt / Expense** | Photo → vendor, total, date auto-read → Expenses + Drive |
| 📸 **Job Photo** | On-site shots with GPS, tagged to the job |
| 🪄 **Before & After** | Paired marketing shots, kept together for socials |
| 🎯 **Lead / Customer** | Caught a job in the field → pipeline with a follow-up |
| 💲 **Build a Quote** | Sq ft + scope + "use our rates" *or* "set my own price" |
| 📦 **Inventory / Price** | Stock counts and what we paid, for price-watching |
| 🛠 **Request / Report** | Crew ask for features or report bugs → straight to the to-do list |

Niceties: 4-digit PIN keypad, persistent login, auto-downscaled photos for cellular, tap-to-attach GPS, an "add to home screen" coach, and a green-glow UI that doesn't look like a spreadsheet.

---

## The Claude router (the brain)

A scheduled agent that follows a playbook ([`claude-router-task.md`](claude-router-task.md)) on every run:

- **Files everything** — exact column maps for all 18 workbook tabs, currency-as-text vs numbers, legends/scorecards left untouched, cross-tab keys kept consistent.
- **Builds quotes** — prices from the rate table (sq ft × rate × access + mobilization, +GST, deposit) *or* a custom number, generates the branded PDF from the company template, emails it to the owners, and files it across Quotes + Customers + Leads.
- **Audits the books** — raises Action Items for unpaid invoices, stale/expiring quotes, deposits-in-but-unscheduled, jobs done-but-not-invoiced, and leads with no next action.
- **Never deletes. When unsure, it flags "NEEDS REVIEW" instead of guessing.**

---

## Safety-first, by construction

- The crew app talks to a **secured staging Inbox only** — it has no path to mutate the live financial tabs.
- The AI writes back through a **narrow, authenticated API** (signed requests) that can append rows and set cells — never wipe them.
- Auth is **HMAC-signed, expiring tokens** with brute-force lockout. Photos are size-capped and uploaded one at a time so a weak signal in the field still succeeds.

---

## Stack

- **Google Apps Script** (web app + time-driven trigger) — the whole backend, free.
- **Google Sheets** as the database, **Google Drive** for photos.
- **A scheduled Claude agent** as the routing/quoting/audit brain.
- **Plain HTML/CSS/JS** front end (no build step), wrapped on a custom subdomain.
- **Cost to run: $0/month** beyond the Google Workspace + domain the business already has.

---

## Setup

See [`DEPLOY.md`](DEPLOY.md) — paste three files into a new Apps Script project, run `setup()`, deploy as a web app, and point the scheduled agent at it. ~10 minutes. All the IDs, the deployment URL, and the router secret in this repo are placeholders — drop in your own.

---

<p align="center"><sub>Built for Evolve Eco Surface Prep &amp; Restoration. Crafted by Matt-Aurora-Ventures, with Claude.</sub></p>
