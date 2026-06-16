# Ops Workbook — blank schema

The whole system reads and writes one Google Sheets "Ops Workbook." This file documents its
**structure only** — every tab and its column headers — with **no business data** in it. It is
the blank template: copy these tabs/headers into a new Google Sheet to stand the system up, and
keep this file updated as the schema evolves. (Real customer/financial data never goes in this
repo — only the empty structure.)

Tabs are grouped by who owns them. App-owned tabs are created automatically by `setup()` /
`EV_setupBrain()` / `EV_installReceiptOps()`; the business tabs are the live books the router
files into.

---

## App-owned tabs (auto-created)

### 📥 App Inbox — every field capture lands here first (append-only staging)
`Timestamp | Captured By | Category | Summary | Details (JSON) | Photo Links | GPS Lat | GPS Lng | Location | Device | Status | Filed To | Claude Notes | Submission ID | Raw Category`

### 👥 App Users — crew logins (PINs are placeholders here)
`Name | PIN | Role | Active | Added`

### 🗒 App Log — heartbeat + audit trail of every automated action
`Timestamp | Source | Message`

### 💡 Insights — the brain's ranked daily observations
`ID | Date | Type | Title | Detail | Score | Importance | AI / notes`
*Importance is a dropdown: New / Important / Not important / Done — the engine learns from it.*

### Feedback — importance ratings that train the insights engine
`When | Insight ID | Type | Rating | Title`

### Vendors — canonical vendor list + rolling spend
`Vendor (raw) | Canonical | Category | First seen | Total spend`

### 📒 Receipt Log — QuickBooks-ready receipt ledger (one row per receipt; never deleted)
`Date | Vendor | Category | Subtotal | GST / Tax | Total | Payment method | Line items | Qty | Unit price | Job / reason | Source (Inbox ID) | Photo link | Filed by | Issue / discrepancy | Created`

### 00 SYSTEM BACKUPS — DO NOT DELETE *(Drive folder, not a tab)*
Holds an automatic full copy of this workbook every 3 days. Never pruned.

---

## Business tabs (the live books)

### Expenses — financial ledger (data starts row 10; receipt mapping starts at column B)
`Date | Purchased by | What purchased | Vendor / where | Why / job ref | Category | Qty | Unit cost | Total | Receipt sent? | Notes`

### Price Log — per-purchase price history (feeds Price Watch)
`Date | Supplier | Product name | Brand | SKU | Category | Unit type | Package size | Qty | Unit price | Total paid | Invoice # | Notes`

### Price Watch — tracked-product price tracking + sourcing
`Product | Last price paid | Last supplier | Best price found online | % change | Source | Last checked | Notes`

### Suppliers — vendor directory
`Supplier | Location | Local / Online | Phone / contact | Website | Products supplied | Last known pricing | Last checked | Notes`

### Leads — sales pipeline
`Date in | Lead / company | Contact | Phone / email | Source | Service wanted | Address | Status | Quote no. | Next action | Next action date | Notes`

### Customers — customer book
`Customer | Contact | Phone | Email | Address | Type | First quote date | Quote no. | Quote total | Quote sheet | Status | Notes`

### Dispatch — the schedule + money loop (deposit → invoice → paid)
`Week | Date | Time | Job ID | Customer | Address | Crew | Quote no. | Status | Notes | Deposit | Invoiced | Paid`

### Quotes — every quote issued
`Quote no. | Date | Client | Contact | Phone | Job address | Scope | Subtotal | GST | Total | Deposit | Balance | Status | Valid until | Prepared by | Quote sheet | Notes | Sq ft | $/sq ft | Blast depth`

### To-Do — task list
`# | Task | Category | Priority | Status | Date added | Due date | Notes`

### Action Items — auto-raised "don't drop this" alerts
`Date raised | Alert | Type | Relates to | Due | Owner | Status | Notes`

### Job P&L — quoted vs actual per job (O/Q/R/S are formula columns)
`Job ID | Date | Customer | Address | Sq ft | Blast type | Quoted subtotal | Quoted $/sqft | Actual hours | Crew | Wages | Material | Fuel / equip | Other | — | Revenue | — | — | — | Verdict | Won? | Notes`

### Quote Engine — rate table + live calculator + profitability (formula tab; touch only via setCell)
Rate table (CAD/sq ft by blast depth), access factor, mobilization, GST/deposit math, break-even check.

### Inventory — stock counts (3 stacked sections: Materials & Media / Consumables & PPE / Equipment)
`Item | Unit | On hand | Par / target | Reorder? | Location | Notes`

### Job Form — one card per job (formal job sheet)
Single-card layout (job id, customer, address, material, hours, weather, crew, quality, photos, notes).

### File Index — searchable record log of every file received + Drive link
`Date | Type | Description | Drive link | Related to | Notes`

### P&L — monthly money in/out
`Month | Jobs invoiced | Other income | Fixed expenses | Variable expenses | Net | Notes`

### Start Here — navigation map + the AI operating rules (human-readable home tab)

---

*Keep this in sync with `Code.gs` (INBOX_HEADERS, setup), `AutoServer.gs` (EV_setupBrain), and
`ReceiptOps.gs` (RCPT_LOG_HEADERS) whenever a tab or column changes.*
