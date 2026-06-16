# Evolve Field App â€” Claude Router & Auditor (scheduled task playbook)

This is the brain. The Field App only *captures* â€” it drops every employee submission
into the **ðŸ“¥ App Inbox** tab and saves photos to Drive. **You** (Claude, running on a
schedule via Cowork automation or the CLI) read that inbox, file each entry into the
correct workbook tab, and audit the whole workbook for accuracy.

Run this **3Ã— a day** (suggested 7:00, 13:00, 19:00 America/Edmonton). Each run does
both jobs: **(A) file new inbox items**, then **(B) audit the workbook**.

---

## Connection

The Apps Script web app exposes a secured JSON API. Fill these in after deploying:

- `WEB_APP_URL` = `https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec`
- `ROUTER_SECRET` = `YOUR_ROUTER_SECRET`  (reprint any time: run `showSecret` in the editor)
- Deployed live 2026-06-08 (Version 4). Project: script.google.com â†’ "Evolve Field App".

Every call is `POST {WEB_APP_URL}` with a JSON body that includes `secret`.
From the Windows CLI use PowerShell:

```powershell
$body = @{ secret=$ROUTER_SECRET; action='getNew'; limit=50 } | ConvertTo-Json
Invoke-RestMethod -Uri $WEB_APP_URL -Method Post -Body $body -ContentType 'application/json'
```

(Or use the Bash tool with `curl -L -X POST "$WEB_APP_URL" -H "Content-Type: application/json" -d '{...}'`.
Use `-L` â€” the /exec URL 302-redirects.)

### Actions
| action | body | returns |
|---|---|---|
| `ping` | `{secret,action}` | `{ok,time}` â€” sanity check |
| `getNew` | `{secret,action,limit}` | `{ok,rows:[â€¦]}` â€” all Inbox rows with Status=NEW |
| `readTab` | `{secret,action,tab,maxRows}` | `{ok,values:[[â€¦]]}` â€” display values, for placement + auditing |
| `tabList` | `{secret,action}` | `{ok,tabs:[â€¦]}` |
| `writeRow` | `{secret,action,tab,row,startCol,values:[â€¦],insert,inboxId,notes}` | writes one row; if `inboxId` given, also marks that Inbox row FILED |
| `setCell` | `{secret,action,tab,a1,value}` | sets one cell (for matrix/inventory tabs) |
| `markInbox` | `{secret,action,id,status,filedTo,notes}` | update an Inbox rowâ€™s Status/Filed To/Notes |
| `log` | `{secret,action,message}` | appends to the ðŸ—’ App Log |

**Value coercion in `values[]`:** a string `"DATE:2026-06-08"` is written as a real Date;
`"NUM:1234.5"` as a Number; anything else is written verbatim (so currency-as-text tabs
get plain `"$3,000.00"` strings). Pad with `""` for columns youâ€™re leaving blank.

**Placement rule (important):** before writing to a tab, `readTab` it. Find the last
non-empty data row *inside that tabâ€™s data region* (regions below), then `writeRow` with
`insert:true` at `lastDataRow + 1`. Inserting (not overwriting) protects legends,
scorecards and formulas that live further down â€” they simply shift down a row.

---

## A) FILE NEW INBOX ITEMS

1. `getNew`. For each row, look at `category`, `fields` (JSON the employee filled),
   `summary`, `photoLinks`, `location`, `capturedBy`, `id`.
2. **Read photos when needed.** If itâ€™s a receipt/invoice/quote photo and key fields are
   missing, open the Drive image (download/fetch the photoLink) and OCR it â€” pull vendor,
   total, date, line items. Trust typed values over OCR when both exist; fill gaps from OCR.
3. **Dedupe.** `readTab` the destination; if this looks like an entry already there
   (same vendor+amount+date, same lead phone, etc.), update instead of duplicating, and
   note it.
4. Write it (mappings below), passing `inboxId` so the Inbox row is auto-marked **FILED**
   with `filedTo`. If you canâ€™t confidently place it, `markInbox` Status=`NEEDS REVIEW`
   with a clear note instead of guessing.

### Category â†’ tab column maps

Column letters are exact. `startCol` = the column letter of the first value you send.

**`receipt` â†’ `Expenses`** (header row 9, data 10+, **starts at column B**, `startCol=2`)
`[ B Date(DATE:), C Purchased by(=capturedBy), D What purchased, E Vendor/where,
   F Why/job ref, G Category(must be a Lists ExpCat value), H Qty(NUM:), I Unit cost(NUM:),
   J Total(NUM:), K "Yes"/"No" receipt sent, L Notes ]`
Also: if itâ€™s a *materials* purchase, additionally append to **Price Log** (below) and let
the audit refresh Price Watch.

**RECEIPT VERIFICATION & BOOKKEEPING - the receipt is the SOURCE OF TRUTH (2026-06-15).**
Every receipt photo is already stored in Drive and is NEVER deleted. For every `receipt` (and any
`quick`/`pricelog` capture that is really a receipt):

> **IMPORTANT — backfill already-filed receipts.** A server-side auto-filer (`EV_fileInbox_`) writes
> receipts to **Expenses** from the rep's *typed* fields and marks the Inbox row **FILED at submit**,
> BEFORE any OCR. So `getNew` will NOT show them. Each run you MUST also `readTab` the **📥 App Inbox**
> and, for every `receipt` row whose Filed To is `Expenses!...` that has **no matching 📒 Receipt Log
> entry** (match on Submission ID, col N of the Inbox), do the full OCR + Receipt Log + verification +
> jobs cross-reference below. The auto-file is just the fast financial stub; you add the real
> intelligence on top. Reconcile (don't duplicate) the existing Expenses row.
1. **OCR the photo and read it as the source of truth.** Extract: date, vendor, every line item
   (description, qty, unit price, line total), subtotal, GST/tax, total, and payment method.
2. **Verify the typed input against the receipt.** The rep types a date/total/category in the app.
   Compare them to what the receipt actually says. **The receipt always wins** - file the receipt's
   values. Where a typed value disagrees (or the app date != the receipt date), still file per the
   receipt and record the conflict in the Receipt Log "Issue / discrepancy" column, e.g.
   "app date 06/14 vs receipt 06/13 - filed per receipt" or "typed $48.20 vs receipt $42.80".
3. **Verify the math.** Sum of line items ~= subtotal; subtotal + GST ~= total. If they do not
   reconcile, note it in the Issue column ("items sum $40 != total $45 - check").
4. **File it three ways (append-only, never delete):**
   - **`Receipt Log`** (the QuickBooks-ready ledger of record; setCol=1): one row per receipt with EVERY
     field - `[ A Date(DATE:), B Vendor, C Category, D Subtotal, E GST/Tax, F Total, G Payment method,
     H Line items (one per line: "qty x desc @unit = total"), I Qty(total NUM:), J Unit price(NUM:),
     K Job/reason, L Source (Inbox ID), M Photo link, N Filed by(=capturedBy), O Issue/discrepancy,
     P Created(DATE: today) ]`.
   - **`Expenses`** (the financial ledger - mapping above).
   - **`Price Log`** - one row PER tracked material/media line item, so per-unit price history is queryable.
5. **Every item is data - do not summarize line items away.** Capture them in the Receipt Log "Line items"
   column AND as Price Log rows for materials. This is what lets the books export to QuickBooks.
6. The `Receipt Log` columns map directly to a QuickBooks expense/bill import (Date, Vendor/Payee,
   Category/Account, Amount, Tax, Memo). Keep them clean and consistent.
7. A server-side job (`EV_receiptReport`) emails Matt + Todd every 3 days listing any Receipt Log rows
   whose "Issue / discrepancy" column is non-blank - so do NOT email per receipt; just populate that
   column accurately and the 3-day digest handles the rest.
8. **Cross-reference receipts to JOBS (do this as Dispatch fills in).** For each receipt, look at the
   receipt's date and `readTab Dispatch`: if a job was running that day (or the rep typed a job in the
   `job` field, or the GPS/location matches a job address), tie the receipt to it - put the Job ID in
   the Receipt Log "Job / reason" column and roll the cost into that job's **Job P&L** material/fuel
   actuals. This is how each job's true cost (and real margin) gets built. If the link is ambiguous,
   note your best guess in the Issue column rather than forcing it.

**CROSS-REFERENCE EVERYTHING (standing principle).** Treat every input as data that compounds. On each
run, look for links across tabs even when a single datapoint seems trivial: receipts <-> Dispatch jobs
<-> Job P&L; vendors <-> Price Log price trends <-> Suppliers; leads <-> Source <-> conversion rate;
GPS/location <-> job addresses <-> travel/fuel; weather <-> scheduling. Surface what you find as
Insights (via the `insight` action). Small patterns become valuable over time - never discard a
datapoint as insignificant.

**`pricelog` â†’ `Price Log`** (header 5, data 6+, `startCol=1`)
`[ A Date(DATE:), B Supplier, C Product name, D Brand, E SKU, F Category, G Unit type,
   H Package size, I Qty(NUM:), J Unit price(NUM:), K Total paid(NUM:), L Invoice#, M Notes ]`
Product name (C) **must exactly match** the Price Watch product list when itâ€™s a tracked item.

**`lead` â†’ `Leads`** (header 6, data 7+, legend at row 11 â€” insert above it, `startCol=1`)
`[ A Date in(DATE:), B Lead/company, C Contact, D Phone/email, E Source, F Service wanted,
   G Address, H Status="New", I Quote no.(blank), J Next action="Contact within 24h",
   K Next action date(DATE: tomorrow), L Notes ]`

**`customer` â†’ `Customers`** (header 6, data 7+, `startCol=1`)
`[ A Customer, B Contact, C Phone, D Email, E Address, F Type, G First quote date(blank),
   H Quote no.(blank), I Quote total(blank), J Quote sheet(blank), K Status="New", L Notes ]`

**`dispatch` â†’ `Dispatch`** (header 6; **divider rows are 7 ("THIS WEEK") and 9 ("WHAT'S AHEAD")**,
job rows sit at 8 and 10, status-key legend at row 12; `startCol=1`) â€” `insert:true` directly
**below the correct divider** (e.g. a this-week job inserts at row 8, pushing existing rows down);
never overwrite a divider or the row-12 legend.
`[ A Week, B Date(DATE:), C Time, D Job ID, E Customer, F Address, G Crew, H Quote no.,
   I Status(use the workbookâ€™s status set), J Notes ]`

**`todo` â†’ `To-Do`** (header 6, data 7+; divider rows have only col B; `startCol=1`)
`[ A # (next integer), B Task, C Category, D Priority, E Status="To Do", F Date added(DATE:),
   G Due date(DATE: or blank), H Notes ]`

**`quote` â†’ `Quotes` + branded PDF + EMAIL (the Quote Builder â€” important):**
The rep submits photos, client, phone, address, sqft, scope, `pricing_method`
("Use our rates" or "I'll set the price"), `depth`, `custom_price`, location, notes.

1. **Price it.**
   - If `pricing_method` = "I'll set the price" AND `custom_price` is given â†’ that is the **Subtotal** (pre-GST); use as-is.
   - Otherwise (rates): `readTab "Quote Engine"` for the live Evolve rate table + mobilization. Evolve rates (CAD/sq ft): Very light â‰ˆ2.50, Light â‰ˆ3.75, Medium â‰ˆ6.90, Heavy â‰ˆ14.50; **Exposed-aggregate = Medium**. Subtotal = sqft Ã— rate Ã— access factor (1.0 default; 1.1â€“1.3 if scope/notes show difficult access) + mobilization (Quote Engine B19, â‰ˆ$250 default). If sqft is missing, estimate it from the photos and note the assumption.
   - Then GST = 5% Ã— Subtotal; Total = Subtotal + GST; Deposit = 25% Ã— Total; Balance = Total âˆ’ Deposit. Never price below the Quote Engine break-even â€” if a custom price is below it, honour it but flag in Notes (Todd prices fair on purpose; flag, don't raise).
2. **Write the Quotes row** (header 6, data 7+, startCol=1). Generate the next quote no. `ECO-Q-MMDDYY-NN` (count today's existing quotes). Money cols Hâ€“L are TEXT strings like `"$3,000.00"` (no NUM:).
   `[ A Quote no., B Date(DATE: today), C Client, D Contact, E Phone, F Job address, G Scope, H Subtotal "$x", I GST "$x", J Total "$x", K Deposit "$x", L Balance "$x", M Status="Draft", N Valid until(DATE: +30d), O Prepared by(=capturedBy), P Quote sheet(fill in step 4), Q Notes, R Sq ft(NUM:), S $/sqft(NUM:), T Blast depth ]`
   Mirror the client into **Customers** and **Leads** (status "Quoted") if new.
3. **Generate the branded PDF.** Use the existing template at `C:\Users\lucid\Documents\Evolve Quote Template\` â€” read its README.txt + the EDIT BLOCK at the top of quote_template.py, copy the script, fill the EDIT BLOCK (client, address, scope, date, quote no., subtotal/GST/total/deposit/balance, sqft, blast depth), and run it with Python â†’ `Evolve-Quote-<QUOTE_NO>.pdf`. If it can't run this round, skip the PDF (still email the details) and note it.
4. **Email + save** via the `sendEmail` action â€” POST:
   `{secret, action:"sendEmail", to:["todd@evolveecoblasting.com","manager@yourcompany.com"], subject:"New quote <QUOTE_NO> â€” <Client>", htmlBody:"<full branded details: client, address, sq ft, blast depth, scope, line items, Subtotal / GST / Total / Deposit / Balance, photo links, submitted by>", attachmentBase64:"<base64 of the PDF>", attachmentName:"Evolve-Quote-<QUOTE_NO>.pdf", saveToFolderId:"YOUR_01_QUOTES_FOLDER_ID"}`
   The script attaches the PDF, saves it to Drive **01 Quotes**, and returns `savedUrl` â€” put that into the Quotes row's **P** (Quote sheet) column. Then `markInbox` FILED, filedTo="Quotes + emailed".
   Standard terms in the quote/email: 25% deposit, balance on completion, 5% GST, valid 30 days. Brand voice: abrasive blasting (not sandblasting), substrate profiling (not cleaning), Oxford comma, no exclamation points.

**`jobpnl` â†’ `Job P&L`** (header 7, data rows 8â€“16, **scorecard at A17+** â€” insert above row 17,
`startCol=1`). Leave formula cols O,Q,R,S blank (Toddâ€™s formulas recompute).
`[ A Job ID, B Date(DATE:), C Customer, D Address, E Sq ft(NUM:), F Blast type,
   G Quoted subtotal(NUM:), H Quoted $/sqft(NUM:), I Actual hours(NUM:), J Crew,
   K Wages(NUM:), L Material(NUM:), M Fuel/equip(NUM:), N Other(NUM:), O "", P Revenue(NUM:),
   Q "", R "", S "", T Verdict, U Won?, V Notes ]`

**`supplier` â†’ `Suppliers`** (header 5, data 6+, `startCol=1`)
`[ A Supplier, B Location, C Local/Online, D Phone/contact, E Website, F Products supplied,
   G Last known pricing, H Last checked(DATE:), I Notes ]`

**`inventory` â†’ `Inventory`** (3 stacked sections â€” DO NOT append a row). Use `setCell`:
`readTab` Inventory, find the row whose Item matches in the right section
(Materials & Media: rows 11â€“20, On hand = col **E**; Consumables & PPE: rows 24â€“30, col **E**;
Equipment & General: rows 34â€“43, col **E**), then `setCell` that itemâ€™s **E** to the new count.
If the item isnâ€™t listed, add it on the first empty row of that section (cols Bâ€“H).

**`job_photo`** â†’ no tab write needed (photo already in Drive `03 Job Photos`). Match it to a
customer/job: append a note in that **Customers** rowâ€™s Notes or the relevant **Job P&L**/Dispatch
row (â€œbefore/after photos: <link>â€). Mark Inbox FILED, filedTo=`Job Photos (Drive)`.

**`before_after`** (MARKETING) â†’ the photo links in the Inbox row are prefixed `BEFORE:` and
`AFTER:`; theyâ€™re already in Drive `03 Job Photos`. Keep the pair together: append a note to the
matching **Customers** row (â€œBefore/After marketing shots â€” <surface/service>: <before link> â†’
<after link>; OK to post: <yes/ask>â€). Maintain a running marketing index in the **ðŸ—’ App Log**
as one line per pair (`MARKETING B/A | <customer> | <surface> | before:<link> after:<link> | post:<yes/ask>`)
so Matt can pull assets fast. Respect `marketing_ok` = â€œAsk customer firstâ€ â€” flag those, donâ€™t
treat as cleared for public use. Mark Inbox FILED, filedTo=`Marketing (Before/After)`.

**`jobreport` â†’ `Job P&L`** for the actuals (as above) + `log` the full narrative; if itâ€™s a
complete formal job sheet Todd wants on the **Job Form** card, flag NEEDS REVIEW noting the
Inbox id (Job Form is one-card-per-job and best duplicated by hand for now).

**`request` (Feature request / Fix report) â†’ To-Do + email Matt + track as OUTSTANDING:**
- Append to **To-Do** (header 6, data 7+, startCol=1): `[ A # (next integer), B "[App â€“ <New feature|Fix>] " + description, C Category="App / Field App", D Priority(from priority field; default Medium), E Status="To Do", F Date added(DATE: today), G Due(blank), H Notes(submitted by + photo links) ]`.
- Email Matt as a reminder via `sendEmail`: `{to:["manager@yourcompany.com"], subject:"App request: <New feature|Fix> â€” <short summary>", htmlBody:"<type, full description, submitted by, priority, photo links>"}`.
- In the AUDIT each run, treat every To-Do row with Category "App / Field App" and Status â‰  Done as an OUTSTANDING ITEM: list them in your run summary, and if one has been open 2+ days, raise/refresh an Action Item ("App request still open: <desc>", Owner Matt) so it keeps surfacing until marked Done.

**`quick`** (Quick Capture) â†’ read `fields.note` (+ photo) and the `fields.about` hint, decide
which category above it really is, then file it there. This is the catch-all â€” use judgment.

---

## B) AUDIT THE WORKBOOK (the â€œmake sure everythingâ€™s accurateâ€ pass)

After filing, `readTab` the relevant tabs and reconcile. Raise issues into **Action Items**
(header 6, data 7+, legends rows 11â€“12, `startCol=1`):
`[ A Date raised(DATE:), B Alert, C Type, D Relates to, E Due(DATE:), F Owner, G Status="Open", H Notes ]`

Auto-raise rules (from the ops manual â€” only raise if not already open for the same item):
- **Deposit received but job not on Dispatch** â†’ schedule it.
- **Invoice unpaid 7+ days.**
- **Quote unanswered 7 days** / **quote expiring within 7 days** (check Quotes `Valid until`).
- **Job marked Complete but not invoiced / no Job P&L row.**
- **Lead with no Next Action, or Next Action date past.**

Consistency checks (fix small stuff directly, flag the rest):
- Every **Quote** client exists in **Customers**; every **Won** lead has a **Dispatch** row.
- Cross-tab keys line up (`ECO-Q-â€¦` consistent across Leads â†” Quotes â†” Dispatch â†” Customers â†” Job P&L).
- **Quotes/Job P&L** rows have Sq ft + Blast depth filled (the standing rule); flag blanks.
- **Pricing sanity:** quote `$/sqft` â‰¥ the Quote Engine break-even / at least mid-range.
  Todd intentionally prices fair for relationships â€” **flag, never silently raise.**
- **Inventory:** where On hand < Par/target, ensure Reorder is flagged.
- **Price Watch:** for any new Price Log products, refresh â€œLast price paidâ€, â€œ% changeâ€,
  and surface savings opportunities.
- **Dedupe** customers/leads/expenses created twice.

Finish each run with a one-line `log` summary, e.g.
`"Run 13:00 â€” filed 6 inbox items (3 receipts, 2 leads, 1 job photo), raised 2 action items, 1 NEEDS REVIEW."`

### Brand/voice rules when you write text into the sheet
Uppercase tracked headings already exist â€” match cell style. Say **abrasive blasting** (not
sandblasting) and **substrate profiling** (not cleaning). Oxford comma. **No exclamation points.**
Quote numbers `ECO-Q-MMDDYY-NN`. Fresh concrete cures 28 days before blasting.

### Safety
- Only ever write via these endpoints; never delete rows. When unsure, `NEEDS REVIEW` + note.
- The Lists, Start Here, Quote Engine (calculator), and P&L formula cells are not free-append
  tables â€” touch them only as described (setCell into existing cells).
