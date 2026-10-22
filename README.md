# Khybrio CRM

The Khybrio sales dashboard: pipeline, leads, follow-ups, deals won, quotes and billing.
Every change saves straight into the **Khybrio Records** Airtable base, and the page refreshes from Airtable every 30 seconds.

- `public/index.html` is the dashboard.
- `api/` is the small server part that runs on Vercel. It holds the Airtable key so it never reaches the browser.
- One shared team password protects the whole site.

## Deploy on Vercel (one time)

### 1. Make an Airtable access token
1. Go to <https://airtable.com/create/tokens> and click **Create new token**.
2. Name it `Khybrio CRM website`.
3. Scopes: `data.records:read` and `data.records:write`.
4. Access: add the **Khybrio Records** base only.
5. Create it and copy the token (starts with `pat…`). You only see it once.

### 2. Import the repo into Vercel
1. In Vercel, click **Add New → Project** and import this GitHub repo.
2. Framework preset: **Other**. Leave build settings empty.
3. Before clicking Deploy, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `AIRTABLE_TOKEN` | the `pat…` token from step 1 |
| `CRM_PASSWORD` | the password you and your co-worker will type to log in |
| `SESSION_SECRET` | any long random text, e.g. 40+ random letters and numbers |

4. Click **Deploy**. Open the `.vercel.app` link and log in with `CRM_PASSWORD`.

Optional: `AIRTABLE_BASE_ID` if you ever move to a different base (defaults to `app6fRankhuL6LyjF`).

### After that
- Every push to `main` redeploys automatically.
- **Change the password:** edit `CRM_PASSWORD` in Vercel → Settings → Environment Variables, then redeploy. Everyone is logged out.
- **Custom domain** (e.g. `crm.khybrio.com`): Vercel → Settings → Domains.

## Good to know
- PDFs for quotes, contracts and invoices are attached in Airtable (each record has an "attach in Airtable" link). They then show on the dashboard.
- The daily 8 AM follow-up email is an Airtable automation, so it keeps working no matter how the dashboard is hosted.
- "Owner" and "Done by" are Airtable collaborators. Each person types their Airtable email once on the dashboard; the browser remembers it.
