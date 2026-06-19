# GO-LIVE — one paste-and-authorize session

Takes the **already‑deployed** Evolve project from where it is now to fully live with the 2026‑06
hardening + intelligence + reply/permissions work. ~15 minutes, one sitting. Nothing here changes the
web‑app URL, the router secret, or any tab/column structure.

> Branch: `harden/data-integrity` (PR #1). All code is proven — `node tests/run-tests.js` (70) +
> `node tests/intelligence.test.js` (21) green; every `.gs` parses clean.

---

## A. Prep (on the computer, 1 min)

```
git pull           # get branch harden/data-integrity
node tests/make-deploy.js
```
This writes **`deploy-local/`** — the same files with your real Evolve IDs/emails filled in (and the
Drive intake pointed at "Evolve temp"). `deploy-local/` is git‑ignored; never commit it.

## B. Paste into the Apps Script editor (5 min)

Open the **Evolve Field App** script project. Paste from `deploy-local/`:

- **Add three NEW files** (＋ → Script): **`Hardening.gs`**, **`Intelligence.gs`**, **`DriveIntake.gs`**.
- **Replace the contents** of: `Code.gs`, `AutoServer.gs`, `Filing.gs`, `OcrFill.gs`, `ReceiptOps.gs`,
  `Backups.gs`, and the **`Index`** HTML file. (Paste `appsscript.json` too — it's unchanged but harmless.)
- Tip for reliable paste: click into the file's code area, **Ctrl+A → Ctrl+V**, then **Ctrl+End** to confirm it took.

## C. Authorize — the Gmail fix (1 min) ⚠️ this is what stops the "permissions" emails

In the editor, pick **`EV_installGmail`** in the function dropdown and **Run**. A consent dialog appears →
**Advanced → Go to project → Allow**. This grants the `gmail.modify` scope the live token was missing —
the reason `EV_personalDigest`/the reply monitor were failing. (One time; the manifest already declared it.)

## D. Deploy a new version (1 min)

**Deploy ▸ Manage deployments ▸ ✏️ edit ▸ Version: New version ▸ Deploy.** The `/exec` URL stays the same.
(Editing files alone does **not** ship the web‑app path — you must cut a new version.)

## E. Run the one‑shots, in this order (5 min)

Run each from the editor (the first run of a couple may show an Allow prompt — accept it):

1. **`EV_selfTestHardening`** — sanity check. Expect the log to say all checks PASS.
2. **`EV_installCore`** — re‑installs morning digest + 3× dispatch sweep (now also runs the intelligence
   pass). Refuses if any placeholder remains (it won't — real IDs are filled).
3. **`EV_setupBrain`**, **`EV_installReceiptOps`**, **`EV_installBackups`**, **`EV_installFiler`** — ensure
   the Insights/Receipt‑Log tabs + hourly filer + 3‑day backups + router‑watch triggers all exist (idempotent).
4. **`EV_backfillNow`** — re‑files any stuck inbox rows and rebuilds the Receipt Log / Vendors with the new logic.
5. **`EV_intelligenceBackfill`** — **separates GST on every existing receipt** (Alberta 5%), **seeds + computes
   Job P&L** from accepted quotes, refreshes Price Watch, and builds the cross‑tab BI insights. (Fill‑if‑blank —
   it never overwrites a number you typed.)
6. **`EV_installDriveIntake`** — starts the hourly loose‑receipt loop. It will begin clearing **"Evolve temp"**
   into the books; to do the first batch now, also run **`EV_driveIntakeNow`**.

## F. Verify (2 min)

- **Permissions:** no new *"Evolve Autopilot FAILED"* emails should arrive. (If `EV_personalDigest` still
  can't reach Gmail, re‑do step C.)
- **Digest + BI:** run **`EV_previewDigest`** — the log shows it built; the email now carries a
  **📊 BUSINESS INTELLIGENCE** card (win rate, AR, quote accuracy, top customers, price alerts).
- **Receipts/GST:** open the **📒 Receipt Log** — Subtotal + GST columns are now filled (estimated rows are
  flagged "GST estimated (5% incl.)"). Submit a >$1,000 receipt photo from the app and confirm the Expenses +
  Receipt Log totals are correct (a bad/unreadable total is **HELD** out of the books, not booked wrong).
- **Loose receipts:** within the hour, files in **"Evolve temp"** move to **"✅ Filed by app"** and appear as
  App Inbox rows → filed.
- **Reply loop:** reply to the morning digest with e.g. *"can you add an equipment‑maintenance tab"* — within
  the hour you (Matt) get a *"request from …"* email and it lands as a **Request** To‑Do; reply *"approved, send
  ECO‑Q‑…"* and that quote flips to **Approved**.

## Who gets what (after this)

- **Todd (owner):** the **morning digest** + **app‑requested items (quotes)** — nothing else.
- **Matt (operator):** everything operational — dispatch sweep, personal digest, receipt check, router/
  failure alerts, and every request/fix/correction picked up from a reply.

## If something looks off

- Re‑running any installer or backfill is **safe** (idempotent, fill‑if‑blank).
- `EV_intelligenceBackfill` again won't double‑count; `EV_driveIntakeNow` won't re‑process moved files.
- To pause the loose‑receipt loop: delete the `EV_driveIntake_` trigger (Triggers panel). To repoint it,
  change `EV_DRIVE_INTAKE.FOLDER_ID` and re‑run `EV_installDriveIntake`.
