# Evolve Field App — Deploy in ~15 minutes

A mobile capture app for the crew. Sign in with name + PIN, tap a category, snap a photo
or type a note — it lands in a **📥 App Inbox** tab and Drive, clean expense rows are auto-filed
to Expenses server-side, and the scheduled brains do the heavier filing, price quotes, audit the
books, surface insights, and back everything up. The app only appends rows or sets cells — it never
edits or deletes the fragile legend/scorecard layouts, so it can't corrupt the books.

**Files in this repo**
- `Code.gs` — backend: capture, auth, Drive uploads, the secret-authed router API, email helpers
- `AutoServer.gs` — server-side autonomy: digests, sweeps, reply-monitor, the insights/spend brain, optional Gemini OCR
- `Backups.gs` — the 3-day, accident-proof workbook backup system
- `Index.html` — the whole app (branded UI + logic). Open it in a browser to preview offline (demo mode).
- `appsscript.json` — project manifest (scopes + web-app settings)
- `claude-router-task.md` — the playbook for the scheduled Claude agent
- `app-frame/` — custom-subdomain iframe wrapper + home-screen icon
- `DEPLOY.md` — this file

---

## 1 · Create the Apps Script project
1. Go to **https://script.google.com** (signed in as the account that owns the workbook).
2. **New project**. Rename it (top-left) to **Evolve Field App**.

## 2 · Add the code
1. **Code.gs** — select all the default code, delete it, paste the contents of `Code.gs`.
2. **+ ▸ Script** → name it **AutoServer**, paste `AutoServer.gs`. Repeat for **Backups** (`Backups.gs`).
3. **+ ▸ HTML** → name it exactly **Index** (no ".html"). Delete the default, paste `Index.html`. Save.
4. Show the manifest: **⚙ Project Settings ▸ "Show appsscript.json"**. Paste this repo's `appsscript.json` over it. Save (Ctrl+S).
5. **Fill in your IDs:** in `Code.gs` (and `Backups.gs`) replace `YOUR_SPREADSHEET_ID` and the `YOUR_*_FOLDER_ID` placeholders with your real Google Sheets + Drive folder IDs.

## 3 · Run setup (creates tabs + your secret)
1. In the toolbar function dropdown pick **`setup`**, click **Run**.
2. Approve the permission prompt (Sheets + Drive + Gmail; choose your account ▸ Advanced ▸ Allow). It runs as **you**.
3. Open **View ▸ Logs**. Copy the **ROUTER_SECRET** it prints — you'll need it for the Claude agent. (Reprint any time: run **`showSecret`**.)
4. Your workbook now has **📥 App Inbox**, **👥 App Users**, **🗒 App Log** tabs. Default logins: **Todd / 0000** and **Matt / 0000** — change these PINs in App Users.

## 4 · Deploy as a Web App
1. **Deploy ▸ New deployment ▸** gear icon ▸ **Web app**.
2. **Execute as:** *Me*.  **Who has access:** *Anyone*.
3. **Deploy**, approve again if asked, and copy the **Web app URL** (ends in `/exec`).
   - That URL is the app. Open it on your phone → **Share ▸ Add to Home Screen**.

> Re-deploying after edits: **Deploy ▸ Manage deployments ▸** edit (pencil) ▸ Version: *New version* ▸ Deploy. The URL stays the same.

## 5 · Turn on the always-on autonomy + brain (runs with the PC off)
Run each once from the editor (authorize when asked):
- **`EV_installCore`** — morning ops digest (7:45) + dispatch sweep with insight refresh (7/13/19). It also clears any older `evolve*` triggers so you don't double-send.
- **`EV_installGmail`** — hourly email-reply monitor + 6 AM personal digest (uses the Gmail scope already granted at `setup()`).
- **`EV_setupBrain`** — creates the **Insights / Feedback / Vendors** tabs for the spend-intelligence engine.
- **`EV_installBackups`** — creates the `00 SYSTEM BACKUPS — DO NOT DELETE` folder, installs the **every-3-days** backup trigger, and takes the first backup immediately.

> `AutoServer.gs` (the `EV_*` functions) is the current autonomy. An earlier `evolve*` generation in `Code.gs` is superseded — install the `EV_*` set above, not `evolveInstallTriggers`.

*(Optional)* paste a Gemini API key into `GEMINI_API_KEY` in `AutoServer.gs` to enable receipt OCR + AI narrative. It stays dormant and safe while the key is empty.

## 6 · Turn on the Claude router (filing + quoting + audit)
Set up a scheduled Claude task (Cowork automation or CLI) that runs **3× a day** and follows **`claude-router-task.md`**. Paste your `/exec` URL and `ROUTER_SECRET` into the top of that file (or hand them to the task). Each run: reads new App Inbox rows → files them into the correct tabs → builds/emails quotes → audits → logs a summary.

## 7 · Add your crew
Sign in as an admin → tap your **green avatar** (top-right) → **Add crew member** (name + 4-digit PIN).

## 8 · Lock it down
- Change the default PINs (App Users tab, column B).
- Keep the `/exec` URL and `ROUTER_SECRET` out of public places. Every action requires a valid name+PIN, and the router API requires the secret.

---

### Troubleshooting
- **"Authorization required" / blank page** — re-run the permission grant; ensure *Execute as: Me* in the deployment.
- **Photos not appearing** — confirm the Drive folder IDs at the top of `Code.gs` match your Drive.
- **Backups didn't run** — run `EV_listBackups` to see what's on file; `EV_runBackup` makes one on demand.
- **Preview the UI without deploying** — open `Index.html` in any browser; it runs in a built-in demo mode (no writes).
