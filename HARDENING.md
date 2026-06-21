# Hardening patch — data integrity & fail-safe (2026-06-18)

This branch (`harden/data-integrity`) fixes every finding from the Evolve Ops System data audit and
makes the books fail-safe. It is **pure logic** — it does not touch any credential/ID line, so it
applies cleanly to the live deployment. All new shared logic lives in **`Hardening.gs`**; the existing
files received small surgical hooks that call into it.

> Proven before shipping: `node tests/run-tests.js` → **63/63 assertions green**, including the headline
> regression (a `$1,250.00` receipt that the old parser turned into `1.25` now reads `1250.00`). All
> `.gs` files and the field-app JS parse clean (`tests/syntax-check.js`, `tests/html-check.js`).
>
> **Adversarially reviewed in three passes (20 further defects found and fixed).** Two multi-agent review
> rounds + a final gate hardened the money parser and receipt-ledger logic against cases the first tests
> missed: a `TOTAL 1250` whole-dollar total (was undercounting to the subtotal), a held-then-corrected
> receipt that left a stale wrong row in the QuickBooks Receipt Log, a `Subtotal`/`Total` column
> substring collision in the job roll-up, French/space-grouped and comma-decimal totals, refunds read as
> positive, item-count / invoice# / year lines masquerading as the total, and a Submission-ID prefix
> collision. The parser now **fails safe** — anything ambiguous is HELD out of the books, never booked wrong.

## What changed, by audit ID

| ID | Fix | Where |
|----|-----|-------|
| **A-1** | Robust money parser — thousands separators handled, grand total beats line items, subtotal/tax/change lines are never mistaken for the total. | `Hardening.gs` (`EV_amount_`, `EV_amounts_`, `EV_pickTotal_`, `EV_pickGst_`); `OcrFill.gs` (`EV_parseReceipt_`) |
| **A-2** | **Financial gate** — a receipt with no usable / inconsistent total is **HELD out of Expenses & P&L** (recorded once in the Receipt Log with the reason, inbox left NEEDS REVIEW). A wrong number never books. | `Hardening.gs` (`EV_receiptFinancialIssue_`); `AutoServer.gs` (`EV_fileExpense_`) |
| **A-3** | Backfilled Receipt Log rows are flagged "GST/subtotal unverified". | `Filing.gs` (`EV_backfillReceiptLog_`) |
| **A-4** | Receipt date that's missing/future falls back to capture date **with an inline flag** (never a silent wrong-month spend). | `AutoServer.gs` (`EV_fileExpense_`) |
| **B-1** | Quote No. propagated forward as a key onto the mirrored Customer (and Dispatch carries it). | `Filing.gs` (`EV_fileQuote_`, `EV_fileCustomer_`, `EV_fileDispatch_`) |
| **B-2** | Receipts linked to jobs (Job ID stamped) + idempotent per-job cost roll-up to Job P&L from the Receipt Log. | `Hardening.gs` (`EV_matchJobId_`, `EV_rollupJobCosts_`); wired into `EV_dispatchSweep` |
| **B-3 / D-1** | Every filed business row carries its Submission ID; every filer is idempotent (a re-run never duplicates). | `Hardening.gs` (`EV_withSub_`, `EV_subAlreadyFiled_`); `EV_fileInbox_` + all `Filing.gs` filers |
| **B-4** | Money-loop Action Items raised server-side, deduped by a stable key. | `Hardening.gs` (`EV_raiseActionItem_`, `EV_raiseSweepActionItems_`); wired into `EV_dispatchSweep` |
| **B-6** | File Index keeps **all** job-photo links (and a bare `https:` URL is never corrupted by de-tagging). | `Hardening.gs` (`EV_cleanLink_`); `Filing.gs` (`EV_fileJobIndex_`) |
| **C-1** | Nothing dead-ends: an unclassifiable capture also becomes a one-time "review & file" To-Do. | `AutoServer.gs` (`EV_fileInbox_`) |
| **C-2** | Photo-upload failures are atomic: the client never files a receipt/job **without** its photo — it queues the whole capture for retry; the server never writes a fake `UPLOAD_FAILED` link. | `Code.gs` (`apiSubmit_core_`); `Index.html` (`submitForm`, `evFlushOutbox`) |
| **C-3** | An offline save that fails (private mode / full storage) no longer shows a false "saved" — the user is warned and kept on the form. | `Index.html` (`submitForm`) |
| **C-4** | Outbox flush skips-and-continues past one bad entry, and a periodic timer flushes even if the `online` event never fires. | `Index.html` (`evFlushOutbox`) |
| **C-5** | `getNew` returns NEEDS REVIEW rows too (with `status`), so the AI coordinator sees the stuck queue. | `Code.gs` (`getNewInbox_`) |
| **D-2** | Lead dedup falls back to name when no phone is present. | `Filing.gs` (`EV_fileLead_`) |
| **E-1** | Digest extractors find their data row by **header signature**, surviving banner/layout changes. | `Hardening.gs` (`EV_headerIndex_`, `EV_dataStart_`); `AutoServer.gs` extractors + `EV_fileExpense_` |
| **E-4** | `setup()` reports unfilled placeholders; `EV_installCore`/`EV_installBackups` **refuse to run** while any remain. | `Hardening.gs` (`EV_preflight_`, `EV_requireConfigured_`); `Code.gs`, `AutoServer.gs`, `Backups.gs` |
| **F-2** | The legacy `evolve*` trigger generation can no longer double-send — its installer delegates to the `EV_*` generation and each legacy handler no-ops while `EV_*` is present. | `Code.gs` |
| **F-3** | `insight` router action (upsert with fingerprint dedupe), matching the playbook. | `Code.gs` (`doPost`); `Hardening.gs` (`upsertInsight_`) |
| **F-5** | `rotateRouterSecret()` helper. | `Hardening.gs` |

## Behavior changes to know (for Todd/Matt)

- **Receipts can now be HELD.** If a receipt's total can't be read or doesn't reconcile (subtotal+GST≠total),
  it stays out of Expenses/P&L and sits as NEEDS REVIEW + a flagged Receipt Log row, surfaced in the
  3-day receipt check and morning digest. This is intentional — better an empty cell than a wrong number.
  Fill the total (or fix the receipt) and it files on the next run.
- **Job P&L actual Material/Fuel may auto-fill** from receipts tagged to that Job ID (idempotent — it
  recomputes from the Receipt Log each sweep). It only writes when receipts are tagged to a job; jobs with
  no tagged receipts keep whatever is there. If you'd rather enter these by hand, say so and we'll disable
  `EV_rollupJobCosts_`.
- **Action Items now get raised automatically** by the sweep (deposit-unscheduled, complete-not-invoiced,
  invoice-unpaid, quote unanswered/expiring, lead past-due), deduped so they don't pile up.

## Deploy (no clasp — manual paste, URL stays the same)

1. `node tests/make-deploy.js` → writes paste-ready files with the live IDs into `deploy-local/` (git-ignored).
2. In the Apps Script project, add a new file **`Hardening.gs`** and paste `deploy-local/Hardening.gs`.
3. Replace the contents of `Code.gs`, `AutoServer.gs`, `Filing.gs`, `OcrFill.gs`, `ReceiptOps.gs`,
   `Backups.gs`, and the `Index` HTML with their `deploy-local/` versions.
4. **Deploy ▸ Manage deployments ▸ edit ▸ Version: New version.** (Editing files alone does not ship.)
5. Run **`EV_selfTestHardening`** from the editor — expect all checks PASS in the log.
6. Re-run **`EV_installCore`** once (it now refuses if any placeholder remains — a feature). Backups:
   re-run `EV_installBackups` (it will tell you if `Backups.gs` IDs are unfilled).
7. Live receipt test: submit a receipt photo from the field app (a >$1,000 one), then confirm the
   Expenses + Receipt Log rows show the correct total.

Nothing here changes the router contract, the secret, or any tab/column structure.

## Known limitations (documented, low-risk)

- **Single-space "qty price" merge.** OCR text like `2 250.00` (one space) can be read as `2250.00`. Real
  receipts column-align qty and price with multiple spaces/tabs (not merged), single-space is the
  thousands separator, and the free-OCR-to-total path only books when the gate passes — so impact is
  narrow. Multi-space layouts are unaffected.
- **Subtotal×GST cross-check is dormant on the free-OCR path.** The free OCR returns only total + GST (no
  subtotal), so the gate's subtotal+GST=total reconciliation only fires when a subtotal is typed by the
  rep or supplied by the (optional, dormant) Gemini OCR. Parser correctness + the HOLD-on-ambiguity gate
  are the primary protection; enabling `GEMINI_API_KEY` adds the cross-check.
- **Idempotency scans read a tab's used range.** Bounded and fine at this business's scale; if a tab ever
  grows into many thousands of rows, narrow the scan to the provenance column.
