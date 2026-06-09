# Evolve Field App â€” Deploy in ~10 minutes

A mobile capture app for the crew. Sign in with name + PIN, tap a category, snap a photo
or type a note â€” it lands in a **ðŸ“¥ App Inbox** tab and Drive, and Claude files it into the
right workbook tab on a schedule. Nothing is ever written straight into your live financial
tabs, so it canâ€™t corrupt them.

**Files in this folder**
- `Code.gs` â€” backend (capture, auth, Drive uploads, the Claude API)
- `Index.html` â€” the whole app (branded UI + logic). Open it in a browser to preview offline.
- `appsscript.json` â€” project manifest (scopes + web-app settings)
- `claude-router-task.md` â€” the playbook for the scheduled Claude job
- `DEPLOY.md` â€” this file

---

## 1 Â· Create the Apps Script project
1. Go to **https://script.google.com** (signed in as the account that owns the workbook â€”
   manager@yourcompany.com).
2. **New project**. Rename it (top-left) to **Evolve Field App**.

## 2 Â· Add the code
1. **Code.gs** â€” select all the default code, delete it, paste the contents of `Code.gs`.
2. **+ â–¸ HTML** â†’ name it exactly **Index** (no â€œ.htmlâ€). Delete the default, paste `Index.html`. Save.
3. Show the manifest: **âš™ Project Settings â–¸ â€œShow appsscript.jsonâ€**. Open `appsscript.json`
   in the editor and paste this folderâ€™s `appsscript.json` over it. Save (Ctrl+S).

## 3 Â· Run setup (creates tabs + your secret)
1. In the toolbar function dropdown pick **`setup`**, click **Run**.
2. Approve the permission prompt (it needs Sheets + Drive + Maps; choose your account â–¸
   Advanced â–¸ Allow). It runs as **you**, so it acts on your own workbook + Drive.
3. Open **View â–¸ Logs** (or the execution result). Copy the **ROUTER_SECRET** it prints â€”
   youâ€™ll need it for the Claude task. (You can reprint it any time: run **`showSecret`**.)
4. Your workbook now has **ðŸ“¥ App Inbox**, **ðŸ‘¥ App Users**, **ðŸ—’ App Log** tabs.
   Default logins: **Todd / 0000** and **Matt / 2222** â€” change these PINs in App Users.

## 4 Â· Deploy as a Web App
1. **Deploy â–¸ New deployment â–¸** gear icon â–¸ **Web app**.
2. **Execute as:** *Me*.  **Who has access:** *Anyone*.
3. **Deploy**, approve again if asked, and copy the **Web app URL** (ends in `/exec`).
   - That URL is the app. Open it on your phone â†’ **Share â–¸ Add to Home Screen**. It gets the
     Evolve icon and opens full-screen like a native app.

> Re-deploying after edits: **Deploy â–¸ Manage deployments â–¸** edit (pencil) â–¸ Version: *New
> version* â–¸ Deploy. The URL stays the same.

## 5 Â· Add your crew
Sign in as Todd or Matt â†’ tap your **green avatar** (top-right) â†’ **Add crew member**
(name + 4-digit PIN). Crew can sign in immediately. Non-admins donâ€™t see the admin panel.

## 6 Â· Turn on the Claude brain (router + auditor)
The app captures; Claude files + audits. Set up a scheduled Claude task (Cowork automation
or your CLI) that runs **3Ã— a day** and follows **`claude-router-task.md`**. Paste your
`/exec` URL and `ROUTER_SECRET` into the top of that file (or hand them to the task).

Each run: reads new App Inbox rows â†’ files them into the correct tabs â†’ audits the workbook
â†’ raises Action Items â†’ logs a summary. (I can wire this schedule up for you.)

## 7 Â· Lock it down
- Change the default PINs (App Users tab, column B).
- The web app is open-by-URL but every action requires a valid name+PIN, and the Claude API
  requires the secret. Keep the `/exec` URL and secret out of public places.

---

### Troubleshooting
- **â€œAuthorization requiredâ€ / blank page** â€” re-run step 3â€™s permission grant; make sure
  *Execute as: Me* in the deployment.
- **Photos not appearing** â€” confirm the Drive folder IDs at the top of `Code.gs` match your
  Drive (theyâ€™re pre-filled from your ops notes).
- **Wrong tab names** â€” `Code.gs` opens the workbook by ID (`SPREADSHEET_ID`); the tab names
  it creates are App Inbox / App Users / App Log. The router maps to your existing 18 tabs.
- **Preview the UI without deploying** â€” just open `Index.html` in any browser; it runs in a
  built-in demo mode (no writes) so you can click around.
