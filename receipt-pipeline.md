# Receipt Ingestion Pipeline — Haiku → Sonnet (cheapest reliable path)

**Purpose:** Matt is loading a LOT of receipts. This pipeline files them into the ops workbook
— categorized, deduped, matched to the right job, feeding the P&Ls — at minimum model cost.

**Model policy (by design):**
- **Stage 1 — HAIKU** (`claude-haiku-4-5`): cheap extraction/normalization. No judgement calls.
- **Stage 2 — SONNET** (`claude-sonnet-5`): the reasoning layer — category, job match, dedupe
  edge cases, P&L feed.
- **Never Opus/Fable for per-receipt work.** The orchestrating agent may run on anything;
  per-receipt tokens go to Haiku/Sonnet only (spawn them as subagents with an explicit model).

**Zero new infrastructure:** photos OCR for free (Drive native OCR + on-device Tesseract at
capture; the free in-app "Auto-fill from photo" button). The server filer enforces dedupe +
the financial gate no matter what the models say — the AI can only make filing *smarter*,
never *wronger*.

## How receipts arrive (all funnel through 📥 App Inbox)
1. **Field app** — crew snaps a receipt (full-res kept), optional OCR auto-fill, → Inbox row.
2. **Drive intake** — loose images dropped in the intake folder are OCR'd hourly → Inbox row.
3. Server filer (`EV_fileInbox_`, hourly) auto-files clean rows immediately — the AI pass
   below handles what's left (NEEDS REVIEW) and audits what was auto-filed.

## The two-stage run (scheduled agent follows this)

### Stage 0 — one cheap fetch (no model)
```
POST {WEB_APP_URL} { secret, action:"ops", fn:"receiptContext" }
```
Returns in ONE call everything both stages need:
`pending[]` (unfiled receipt rows w/ fields+photos), `receiptLogTail[]` (dedupe context),
`openJobs[]` (Dispatch jobs for matching), `vendors[]` (canonical names).

### Stage 1 — HAIKU: extract & normalize (one small call per receipt, batch where possible)
Input: the pending row's `fields` + OCR text (photo link if OCR text missing).
Output JSON per receipt: `{vendor, date(ISO), total, gst, subtotal, what}` — normalized
vendor spelling against `vendors[]`, receipt-printed date wins, amounts as plain numbers.
No categorization, no job matching — extraction only.

### Stage 2 — SONNET: reason & file (one small call per receipt)
Input: Haiku's JSON + `openJobs[]` + `receiptLogTail[]`.
Decide: `category` (Expenses list), `job` (match to an open job's customer/quote no, or blank),
`isDuplicate` (against the log tail — if duplicate, mark the inbox row instead of filing).
Then ONE writeback per receipt:
```
POST { secret, action:"ops", fn:"fileReceipt",
       inboxId:"SUB-…", category:"Receipt / Expense",
       fields:{ vendor, date, total, gst, subtotal, category, job, what, notes } }
```
The server merges the fields and re-runs the **hardened filer** — dedupe, financial gate
(implausible totals HELD, never booked), Receipt Log mirror, vendor canon, job cost roll-up
to Job P&L all apply automatically. The response reports `status` + `filedTo`.
For a duplicate: `POST {action:"markInbox", id, status:"FILED", notes:"duplicate of <date vendor total>"}`.

### Cost shape
- 1 context fetch + N×(1 tiny Haiku + 1 small Sonnet + 1 writeback POST).
- No images through the models (OCR is free upstream); text-only prompts.
- Batch Haiku extraction (10–20 receipts per call) when volume is high.

## Guardrails (server-enforced, model-independent)
- `EV_receiptFinancialIssue_` holds no-total / mismatched / implausible receipts OUT of the books.
- `EV_subAlreadyFiled_` + `EV_isDupReceipt_` block double-filing (submission-ID + vendor/total/date).
- Every action needs the router secret; every write lands in the App Log.
