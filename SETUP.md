# ClawBot — Setup Guide

Full setup process for the AI Influencer Outreach & Deal Automation System, from
a clean checkout to a running local instance with all optional integrations
(WhatsApp, LinkedIn email outreach, Chrome extension cookie sync).

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 18+ | `node -v` to check |
| PostgreSQL database | Cloud-hosted recommended (e.g. [Supabase](https://supabase.com)) |
| Redis instance | Cloud-hosted recommended (e.g. [Upstash](https://upstash.com)) — used by BullMQ for the DM queue |
| Telegram Bot Token | Create via [@BotFather](https://t.me/botfather) |
| Telegram Chat ID | Your personal Telegram user ID (message [@userinfobot](https://t.me/userinfobot) to get it) |
| OpenAI API Key | From [platform.openai.com](https://platform.openai.com) |
| Google Chrome | For running the cookie-sync extension (Instagram DM automation) |

Optional (only needed if you use those features):
- Meta Developer App with **WhatsApp** product — see [WHATSAPP_SETUP.md](WHATSAPP_SETUP.md)
- Meta Developer App with **Instagram Graph API** — for official webhook replies
- Google Workspace mailbox + temp LinkedIn account — for LinkedIn → email outreach, see [LINKEDIN_EMAIL_SETUP.md](LINKEDIN_EMAIL_SETUP.md)

---

## 2. Install Dependencies

```bash
npm install
```

---

## 3. Configure Environment Variables

```bash
cp .env.example .env
```

Then fill in `.env`. At minimum, these are **required** for the app to boot
(enforced by `validateConfig()` in [src/config.js](src/config.js)):

```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_telegram_user_id
OPENAI_API_KEY=sk-...
DATABASE_URL=postgresql://user:pass@host:5432/postgres
```

Everything else has a sensible default or is optional. Key groups:

### Core
```env
REDIS_URL=rediss://default:...@...upstash.io:6379
PORT=3000
INSTAGRAM_STUB_MODE=true        # true = simulate DMs, no real Instagram sends
```

### Budget & Rate Limiting
```env
MIN_BUDGET=50
TARGET_BUDGET=100
MAX_BUDGET=150
DM_DAILY_LIMIT=30
DM_DELAY_MIN_SEC=60
DM_DELAY_MAX_SEC=90
```

### Discovery Engine (finds creators via Instagram hashtags)
```env
MIN_FOLLOWERS=3000
MAX_FOLLOWERS=10000
DISCOVERY_LOCATION=US
DISCOVERY_CATEGORY=couple
DISCOVERY_MAX_PER_RUN=15
DISCOVERY_INTERVAL_HOURS=6
```
These can also be changed at runtime via Telegram/WhatsApp commands
(`/range`, `/Auto`, `/Manual`) — see the discovery operating model for details.

### Meta / Instagram Webhook
```env
META_VERIFY_TOKEN=clawbot_secret_token_123
```

### WhatsApp (optional — full walkthrough in [WHATSAPP_SETUP.md](WHATSAPP_SETUP.md))
```env
WHATSAPP_CLOUD_TOKEN=
WHATSAPP_CLOUD_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=clawbot_secret_token_123
WHATSAPP_CONTROL_NUMBERS=919905251524
```

### LinkedIn → Email Outreach (optional, free pipeline)
```env
LINKEDIN_SEARCH_KEYWORDS=founder,marketing manager,content creator
LINKEDIN_DISCOVERY_MAX_PER_RUN=15
LINKEDIN_SYNC_INTERVAL_HOURS=6
GMAIL_USER=
GMAIL_APP_PASSWORD=
EMAIL_DAILY_LIMIT=30
```
Full walkthrough (temp LinkedIn account setup, Gmail app password, Render
migration): see [LINKEDIN_EMAIL_SETUP.md](LINKEDIN_EMAIL_SETUP.md).

### Chrome Extension (cookie sync)
```env
EXTENSION_SECRET_KEY=default-secret-change-me
```
Set this to a random string and use the same value in the extension popup
(see step 6).

---

## 4. Database Setup

No manual migrations needed — `initDb()` in [src/db.js](src/db.js) creates
all required tables (`creators`, `conversations`, `deals`, `dm_log`,
`settings`, `email_leads`, `email_conversations`) automatically on first boot
via `CREATE TABLE IF NOT EXISTS`.

If you ever need to wipe and reinitialize the schema:
```bash
node scripts/reset_db.js
```

---

## 5. Instagram Session Cookies

ClawBot uses Puppeteer with real browser cookies to bypass Instagram's login
security, rather than the officially unsupported private API.

**Option A — Chrome Extension (recommended, keeps cookies fresh automatically)**
1. Open `chrome://extensions`, enable **Developer mode**, click
   **Load unpacked**, and select the [extension/](extension/) folder.
2. Log into instagram.com normally in that Chrome profile.
3. Click the ClawBot Sync extension icon, enter your server URL and the same
   `EXTENSION_SECRET_KEY` set in `.env`, and save.
4. The extension pushes fresh cookies to `POST /api/cookies/update`, which
   stores them in Redis (and as a local backup file) automatically.

**Option B — Manual export**
1. Export your Instagram session cookies (e.g. via a browser cookie-export
   extension) as JSON.
2. Save the file as `www.instagram.com.cookies.json` in the project root.
3. When deploying to the cloud instead of running locally, set the
   `IG_COOKIES_JSON` environment variable with the JSON contents instead of
   using a file.

---

## 6. Run the App

Two processes are required — the API/bot server and the DM queue worker.

**Terminal 1 — Server + Telegram bot:**
```bash
npm run dev
```

**Terminal 2 — DM Queue Worker:**
```bash
npm run worker
```

On boot you should see:
```
🚀 ClawBot running on http://localhost:3000
   Telegram bot: polling ✓
   Instagram: STUB mode 🧪   (or REAL mode 📡 once INSTAGRAM_STUB_MODE=false)
   Follower range: 3,000 - 10,000
   Daily DM limit: 30
   Discovery: every 6h
   LinkedIn email discovery: every 6h (or a warning if GMAIL_USER isn't set)
```

---

## 7. Verify the Setup

1. **Health check**: `curl http://localhost:3000/health` → `{"status":"ok"}`
2. **Telegram**: message your bot — it should respond. Try `/list`.
3. **Add a test creator**:
   ```bash
   curl.exe -X POST http://localhost:3000/api/creators/add \
     -H "Content-Type: application/json" \
     -d "{\"username\": \"john_emily\", \"followers\": 82000}"
   ```
   → a Telegram approval card should arrive immediately.
4. **Simulate a creator reply** (no real DM sent):
   ```bash
   curl.exe -X POST http://localhost:3000/instagram/webhook/simulate \
     -H "Content-Type: application/json" \
     -d "{\"username\": \"john_emily\", \"message\": \"How much for a post?\"}"
   ```

---

## 8. Going Live (moving off stub/test modes)

- Set `INSTAGRAM_STUB_MODE=false` once cookies are verified working.
- Follow [WHATSAPP_SETUP.md](WHATSAPP_SETUP.md) fully if you want WhatsApp
  control/notifications instead of (or alongside) Telegram — includes
  generating a **permanent** access token (the default token expires in 24h).
- Deploy (`Procfile` defines `web` and `worker` dynos — compatible with
  Railway/Heroku-style platforms). Make sure both processes run in
  production, and that all env vars from step 3 are set on the host.
- Set publicly reachable HTTPS webhook URLs in the Meta dashboard for
  Instagram (`/api/webhooks/instagram`) and WhatsApp
  (`/api/webhooks/whatsapp`) if using official Graph API messaging.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| App exits immediately with "Missing required environment variables" | Check `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `OPENAI_API_KEY`, `DATABASE_URL` are all set |
| Telegram bot doesn't respond | Confirm `TELEGRAM_CHAT_ID` matches your account and the bot token is correct |
| DMs never send | Confirm the worker process (`npm run worker`) is running — the server only enqueues jobs |
| Instagram login blocked / DMs fail in real mode | Cookies expired — re-sync via the Chrome extension or re-export manually |
| LinkedIn email discovery warning on boot | `GMAIL_USER` not set — expected if you're not using email outreach |
| WhatsApp webhook verification fails | See the Troubleshooting section in [WHATSAPP_SETUP.md](WHATSAPP_SETUP.md) |
