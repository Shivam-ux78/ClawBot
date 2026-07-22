# LinkedIn → Email Outreach — Setup Guide

Free replacement for the old Apollo.io pipeline: a Puppeteer LinkedIn search
(using a **temporary account**) finds prospects, a free pattern-guess +
SMTP-verify step finds their email, and Google Workspace SMTP sends the
outreach email. Approval still flows through Telegram/WhatsApp exactly as
before (`/EmailAuto`, `/EmailManual`, `/syncleads`, approve/reject buttons).

---

## ⚠️ READ THIS FIRST — Use a temporary LinkedIn account

**Never log the extension into your real/main LinkedIn account.** Create a
brand-new, throwaway LinkedIn account and use *only that account* for the
search/discovery step.

**Why this matters:**
- LinkedIn detects and bans automated browsing far more aggressively than
  Instagram. There is no "stub mode" grace period — accounts get hard-banned,
  often permanently, with no appeal that works reliably.
- Automated scraping of LinkedIn search results is an explicit Terms of
  Service violation. If your main account gets flagged, you risk losing your
  real professional profile, connections, and history — not just a bot
  account.
- A temp account costs you nothing if it gets banned. Your main account does
  not have that luxury.

**Practical setup:**
1. Create a new LinkedIn account with a fresh email (not tied to your
   real identity or your main account's email/phone).
2. Build a minimal, believable profile (photo, headline, a few connections)
   — a completely empty/bare account is itself a ban signal.
3. Only ever log this account in on the browser profile where the ClawBot
   Sync extension is installed. Don't browse LinkedIn casually on it, don't
   log your main account into the same browser profile.
4. If it does get banned or rate-limited, you make a new one — that's the
   point of using a temp account in the first place.

This applies to the LinkedIn side only. Your Instagram account (used for
creator discovery/DMs) is a separate concern with its own risk profile —
see [SETUP.md](SETUP.md).

---

## 1. Configure `.env`

These are the new variables this pipeline needs (already scaffolded in
[.env.example](.env.example)):

```env
# ─── LinkedIn → Email Outreach (free pipeline) ───────────────────
# Comma-separated LinkedIn search keywords to discover prospects
LINKEDIN_SEARCH_KEYWORDS=founder,marketing manager,content creator
# Max profiles to discover per run
LINKEDIN_DISCOVERY_MAX_PER_RUN=15
# How often the discovery job runs, in hours
LINKEDIN_SYNC_INTERVAL_HOURS=6

# ─── Google Workspace SMTP (sends the outreach email) ────────────
# Mailbox on your custom domain, e.g. outreach@makeable.nyc
GMAIL_USER=
# App Password from that mailbox's Google Account — NOT your login password
GMAIL_APP_PASSWORD=
# Max outreach emails sent per rolling 24h
EMAIL_DAILY_LIMIT=30
```

### Getting `GMAIL_USER` / `GMAIL_APP_PASSWORD`

1. In Google Workspace Admin, make sure the sending mailbox exists (e.g.
   `outreach@makeable.nyc`).
2. Sign into that mailbox, go to **myaccount.google.com → Security**.
3. Enable **2-Step Verification** (required before app passwords are
   available).
4. Go to **App Passwords**, generate one (name it "ClawBot SMTP" or similar),
   and copy the 16-character password it gives you.
5. Set `GMAIL_USER=outreach@makeable.nyc` and
   `GMAIL_APP_PASSWORD=<the 16-char password>` in `.env`.

### DNS records (do this before sending anything for real)

On your domain's DNS (e.g. `makeable.nyc`), add:
- **SPF**: `v=spf1 include:_spf.google.com ~all`
- **DKIM**: generate in Workspace Admin → Apps → Google Workspace → Gmail →
  Authenticate email, then add the TXT record it gives you.
- **DMARC**: at minimum `v=DMARC1; p=none;` as a monitoring policy.

Without these, cold outreach emails land in spam regardless of volume.

### Removed variables

`APOLLO_API_KEY`, `APOLLO_LIST_ID`, `APOLLO_SEQUENCE_ID`,
`APOLLO_WEBHOOK_SECRET`, `APOLLO_SYNC_INTERVAL_HOURS` no longer do anything —
remove them from `.env` if present.

---

## 2. Install the Chrome Extension

The same extension used for Instagram cookie sync now also handles LinkedIn
(with the temp account, per the warning above).

1. Open `chrome://extensions`, enable **Developer mode** (top-right toggle).
2. Click **Load unpacked**, select the [extension/](extension/) folder.
3. Click the ClawBot Sync icon in the toolbar — Cloud API URL and Secret Key
   are pre-filled (Local by default; use the "Use Render" link once deployed).
4. Click **Save & Sync Instagram Now** — no account ID needed, whichever
   Instagram account is logged into this browser gets synced. Only relevant
   if you're also running the IG discovery pipeline.
5. **For LinkedIn**: in a browser profile logged into your **temp LinkedIn
   account**, open the same extension popup and click **Sync LinkedIn Now**.
   Same deal — no account matching, whichever LinkedIn account is logged
   into that browser gets synced, so make sure it's the temp one.
6. The extension re-syncs both automatically every 30 minutes in the
   background, as long as Chrome stays open with the extension loaded.

Cookies land in Redis (`li_cookies` for LinkedIn, `ig_cookies` for
Instagram), with a local JSON file backup for local dev
(`www.linkedin.com.cookies.json` / `www.instagram.com.cookies.json`).

---

## 3. Migrate / Deploy to Render

The app already deploys to Render via [render.yaml](render.yaml) (Blueprint)
+ [Dockerfile](Dockerfile) — this pipeline doesn't need new infrastructure,
just new env vars on the existing `clawbot-web` service.

### Steps

1. **Push your changes** to the branch/repo Render is watching.
2. In the Render dashboard, open your `clawbot-secrets` env var group (or
   the `clawbot-web` service's Environment tab if you're not using the
   Blueprint group) and add:
   - `GMAIL_USER`
   - `GMAIL_APP_PASSWORD`
   - `EMAIL_DAILY_LIMIT` (defaults to `30` if unset)
   - `LINKEDIN_SEARCH_KEYWORDS`
   - `LINKEDIN_DISCOVERY_MAX_PER_RUN` (defaults to `15`)
   - `LINKEDIN_SYNC_INTERVAL_HOURS` (defaults to `6`)

   These are already declared in `render.yaml`'s `clawbot-secrets` group —
   if you're using the Blueprint (`render.yaml` sync), Render will prompt you
   to fill in the `sync: false` ones on the next deploy.
3. Remove the old `APOLLO_*` env vars from Render if you had them set —
   they're unused now.
4. Redeploy (`render.yaml` changes trigger this automatically if Blueprint
   sync is on, otherwise trigger a manual deploy).
5. Push fresh cookies from the Chrome extension pointed at your **Render
   URL** (`https://<your-app>.onrender.com/api/cookies/update`) instead of
   localhost.

### Important caveat — outbound port 25

The free email-verification step (`emailFinderService.js`) connects directly
to mail servers on **port 25** to verify a guessed address. **Render (like
most cloud PaaS providers) blocks outbound port 25 by default** as an
anti-spam measure. This means on Render:
- Email *finding* (domain guess + pattern generation) still works fine.
- Email *verification* will fail to connect and silently fall back to the
  best-guess candidate, unverified — you'll see this logged as `MX lookup
  failed` or probe errors in the Render logs.
- Sending emails is unaffected — that goes through Gmail's SMTP on port
  587, which isn't blocked.

If you want verification working in production, you'd need a host that
allows outbound port 25 (some VPS providers do on request) — not something
to chase unless bounce rates from unverified guesses become a real problem.

---

## 4. Verify It's Working

1. On Render (or locally), check the boot log for:
   ```
   LinkedIn email discovery: every 6h
   ```
   with no `⚠️ GMAIL_USER not set` warning.
2. Trigger a manual run from Telegram: `/syncleads`
3. Watch for Telegram notifications: `📇 LinkedIn discovery started...` →
   profile results → `✅ LinkedIn discovery complete.`
4. New leads arrive as approval cards in Telegram/WhatsApp — approve one and
   confirm you receive the outreach email at a test address (or check
   `email_send_log` in Postgres for the send record).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `LinkedIn cookies not found!` error | Re-sync via the extension's "Sync LinkedIn Now" button, logged into the temp account |
| Discovery finds 0 profiles | LinkedIn may be showing a login wall or CAPTCHA to the temp account — check it hasn't been flagged; try logging in manually first |
| Email verification always "unverified" | Expected on Render/most cloud hosts — port 25 is blocked (see caveat above) |
| `Daily email limit reached` | Working as intended — raise `EMAIL_DAILY_LIMIT` if needed, but keep it low (20-50) to protect domain reputation |
| Outreach emails land in spam | Check SPF/DKIM/DMARC are set on your sending domain |
| Temp LinkedIn account gets banned | Expected risk of this approach — create a new temp account and re-sync |
