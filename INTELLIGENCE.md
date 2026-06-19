# Intelligence & automation patch (2026-06-19)

Built after examining the **live** Ops Workbook + the loose receipts in Drive ("Evolve temp").
Two new modules (`Intelligence.gs`, `DriveIntake.gs`) + small hooks. Everything is **free,
deterministic, fail-safe (fill-IF-BLANK, idempotent, try/caught so it can never break the sweep)**.
Proven: `node tests/intelligence.test.js` → 21 assertions green; the 63-assertion receipt harness
still passes; all `.gs` parse clean.

## What the live sheet told us (fill-state recon)

The capture→file pipeline **works** (29/29 inbox rows FILED, vendors canonicalized, audit raising
Action Items, Quotes 100% filled). The gaps were all **downstream**:

| Symptom (live) | Fix |
|---|---|
| Receipt Log **GST/Subtotal 0%** — not tax-reclaimable | (1) auto-separate GST on every receipt + backfill |
| Dispatch **deposit/invoiced/paid 0%** — cash-flow blind | (5) money-loop snapshot + AR insight/card |
| Job P&L **~empty** — no per-job margin | (3) seed from accepted quotes, (4) compute profit/margin/$sqft/verdict |
| **~55 loose receipts + a $17,742 quote** rotting in "Evolve temp" | (2) Drive intake OCRs them into the books |
| Insights were spend-only | (6) cross-tab BI; (8) vendor price moves; (9) digest dashboard |
| Price Watch trend 0% | (8) compute %change/trend from Price Log |

## The 10 builds

1. **GST auto-separation** — `EV_ensureGst_`/`EV_gstSplit_` (Alberta 5% incl.): every receipt gets
   Subtotal+GST, even when OCR only read a total (flagged "GST estimated"). Wired into `EV_fileExpense_`
   + one-shot `EV_backfillReceiptGst_` for existing rows. Makes the ledger QuickBooks/tax-ready.
2. **Drive intake** (`DriveIntake.gs`) — hourly sweep of a drop folder: OCRs each image (JPEG/PNG/PDF
   native; HEIC via thumbnail), classifies (receipt/quote/other), creates a normal App Inbox row → the
   existing gated filer routes it, then moves the file to "✅ Filed". A file that can't be OCR'd is still
   captured + photo-linked (never lost). `EV_installDriveIntake` / `EV_driveIntakeNow`.
3. **Seed Job P&L from accepted quotes** — `EV_seedJobPnL_` (idempotent by quote no): carries customer/
   address/sqft/blast/quoted subtotal+$sqft so the row exists and costs roll in.
4. **Compute Job P&L** — `EV_computeJobPnL_` fills Total cost / Profit / Margin% / Actual $sqft / Verdict
   (fill-if-blank, never overwrites a human number).
5. **Money loop** — `EV_cashFlow_` reads Dispatch deposit/invoiced/paid → AR insight + digest card;
   the sweep already raises the deposit/invoice/paid Action Items (deduped).
6. **Cross-tab insights** — `EV_buildBiInsights_`: win rate, outstanding AR, quote accuracy (quoted vs
   actual $/sqft), top customers, vendor price moves. Upserted (deduped) into Insights, surfaced in the digest.
7. **Receipt→job cost attribution** — `EV_rollupJobCosts_` (from the hardening patch) feeds (4); the
   intake/filer tag Job IDs onto receipts.
8. **Vendor price intelligence** — `EV_priceMoves_` (from Price Log history) + `EV_priceWatchRefresh_`
   fills Price Watch %change/trend.
9. **Digest BI dashboard** — `EV_biDashboardCard_` puts win rate / AR / quote accuracy / top customers /
   price alerts in Todd's one morning email. Complexity hidden, answers shown.
10. **Data-quality sweep** — `EV_dataQualitySweep_`: auto-fills GST + Price Watch, counts the gaps a human
    must close (leads without a next action, accepted quotes without a Job P&L row) and logs them.

Orchestrated by `EV_intelligenceSweep_()` (called from `EV_dispatchSweep`, **after** `EV_generateInsights`
so its insights aren't pruned). One-shot: `EV_intelligenceBackfill()`.

## Deploy (adds to the hardening patch)

1. `node tests/make-deploy.js` → `deploy-local/*` now includes `Intelligence.gs` + `DriveIntake.gs`, with
   the drop folder pre-pointed at "Evolve temp".
2. Add both new files in the Apps Script editor, paste the updated `AutoServer.gs`, redeploy a New version.
3. Run once: `EV_intelligenceBackfill` (separates GST on existing receipts, seeds/computes Job P&L),
   then `EV_installDriveIntake` (starts the hourly loose-receipt loop — clears the "Evolve temp" backlog).

All deterministic and free. No paid API. Nothing overwrites a human-entered value.

---

# Notifications, permissions & the email reply loop (2026-06-19)

## The "broken permissions" emails — fixed
Cause: `EV_personalDigest` (and the reply monitor) call `GmailApp`, but the **live project's granted
token predates the `gmail.modify` scope**, so they threw *"Specified permissions are not sufficient"* —
and `EV_failNotify_` only suppressed errors containing "authoriz", so every failure emailed Matt.

- `EV_failNotify_` now suppresses **permission/scope** errors too (no more email storm).
- `EV_personalDigest` got the same **Gmail‑auth guard** the reply monitor has — it no‑ops cleanly (one
  App Log line) instead of throwing when Gmail isn't authorized.
- **One‑time human fix to make Gmail actually work:** in the Apps Script editor, run **`EV_installGmail`**
  (or any Gmail function) → *Advanced → Allow* to grant `gmail.modify`. That clears the errors for good.
  The manifest is already correct; only the consent is stale.

## Todd only gets the morning email
Notification model is now explicit (see the `EV` object comment): the **owner (Todd)** receives **only
the morning digest + app‑requested items (quotes)**. Everything operational — **dispatch sweep, personal
digest, receipt check, router‑down alert, failure alerts, proof runs** — goes to the **operator (Matt)
only**. (Todd still sees what matters because the sweep findings are summarized in his morning digest.)

## Replies flow back into the system
`EV_replyMonitor` now **classifies every reply line** (`EV_classifyReply_`) and **routes it** (`EV_routeReplyItem_`)
instead of dumping everything into To‑Do:

| Reply looks like | Action |
|---|---|
| **Approval** ("approved, send ECO‑Q‑…") | quote status → Approved + a scheduling To‑Do |
| **Fix / bug** ("the scanner is broken") | To‑Do (High) + Action Item + email Matt |
| **Correction** ("actually that total is $48.20") | flagged as a Correction Action Item + email Matt |
| **Request** ("can you add an equipment tab") | To‑Do (Request) + email Matt |
| **Done** ("done follow up with Al") | noted/retired |
| **Anything else** | logged as feedback |

It replies with exactly what it did, and now also picks up **Matt's own replies** (a human "Re:" from the
operator is processed; the script's automated originals are skipped). Needs the same Gmail consent above.
