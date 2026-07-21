# 🤖 ClawBot — AI Influencer Outreach & Deal Automation System

An AI + Human hybrid system for finding, reaching out to, and negotiating deals with Instagram influencers — fully controlled via Telegram.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔍 Creator Discovery | Add creators via API or CSV → Telegram approval card |
| 🤖 Puppeteer Bypass | Uses headless Chrome & cookies to bypass Instagram login blocks |
| 💬 AI Conversation | GPT-4o handles replies naturally and negotiates prices |
| 💰 Budget Negotiation | Auto counter-offers, deal proposals within budget limits |
| 🎛️ Manual Override | Pause/resume/manual mode per creator via Telegram |
| 🔒 Rate Limiting | Max 30 DMs/day, 60–90s random delays via BullMQ |
| ✅ Deal Approval | Final deal confirmation via Telegram before closing |

---

## 🚀 Setup

### Prerequisites
- Node.js 18+
- Cloud PostgreSQL Database (e.g., Supabase)
- Cloud Redis Database (e.g., Upstash)
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- OpenAI API Key

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

Edit `.env`:
```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id          # Your personal Telegram user ID
OPENAI_API_KEY=sk-...

MIN_BUDGET=50
TARGET_BUDGET=100
MAX_BUDGET=150

REDIS_URL=rediss://default:...@...upstash.io:6379
DATABASE_URL=postgresql://postgres:...@...supabase.co:5432/postgres

INSTAGRAM_STUB_MODE=false
META_VERIFY_TOKEN=clawbot_secret_token_123
```

### 3. Add Instagram Cookies
To bypass Instagram's strict login security, export your browser cookies from Instagram.com and save them as `www.instagram.com.cookies.json` in the root folder. *(Note: If deploying to the cloud, use the `IG_COOKIES_JSON` environment variable instead).*

### 4. Start the System

**Terminal 1 — Main server + Telegram bot:**
```bash
npm run dev
```

**Terminal 2 — DM Queue Worker:**
```bash
npm run worker
```

---

## ☁️ Deploying on Render

The app ships with a `Dockerfile` and `render.yaml` blueprint — Puppeteer needs a real Chromium binary and its shared libraries, which a plain Node buildpack doesn't reliably provide, so the container installs `chromium` via `apt-get` and points Puppeteer at it.

### 1. Push the blueprint
In the Render dashboard: **New → Blueprint**, point it at this repo. Render reads `render.yaml` and creates two services from the same `Dockerfile`:

| Service | Runs | Notes |
|---|---|---|
| `clawbot-web` | `node src/index.js` | Express API + Telegram bot (polling) + discovery cron |
| `clawbot-worker` | `node src/queues/worker.js` (via `dockerCommand`) | BullMQ DM worker, Telegram bot in send-only mode |

### 2. Set the secrets
`render.yaml` declares an `clawbot-secrets` env var group with every variable the app reads (see [.env.example](.env.example)). Fill in the `sync: false` ones in the Render dashboard: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `OPENAI_API_KEY`, `DATABASE_URL`, `REDIS_URL`, `META_VERIFY_TOKEN`, `EXTENSION_SECRET_KEY`.

Keep using managed Supabase (Postgres) and Upstash (Redis) — just paste their connection strings in. Render's own Postgres/Key Value work too; only the connection string changes, no code does.

### 3. Push Instagram cookies
Cookies are never baked into the image or committed — the container's filesystem is wiped on every redeploy. Instead, the server reads them from Redis (`ig_cookies` key), written there by:
- the **ClawBot Chrome Extension** (`extension/`), which syncs your logged-in session every 30 minutes via `POST /api/cookies/update`, or
- manually, by calling that same endpoint with `secretKey` = your `EXTENSION_SECRET_KEY`.

### 4. Constraints specific to this app
- **Keep `clawbot-web` at exactly 1 instance.** `node-cron` (discovery scheduling) and the Telegram bot's long-polling both assume a single process — autoscaling this service causes duplicate discovery runs and Telegram `409 Conflict` errors from two pollers fighting over the same bot token.
- **The worker is a separate always-on service, not a cron job.** If `clawbot-worker` is stopped or crash-looping, creators still move through approval but no DM is ever actually sent — check its logs first when outreach appears stuck.
- **`/health` is wired as the health check path** for `clawbot-web`; Render restarts the service if it stops responding.

---

## 🎮 Usage

### Add a Creator (Stage 1)
```bash
curl.exe -X POST http://localhost:3000/api/creators/add \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"john_emily\", \"followers\": 82000}"
```
→ Telegram sends you an approval card immediately. When you tap "Approve", the background worker launches Puppeteer and sends the real DM.

### Telegram Commands

| Command | Effect |
|---|---|
| ✅ **1 — Approve** (inline button) | Sends enriched outreach DM |
| ❌ **2 — Reject** (inline button) | Discards creator |
| `/pause @username` | Bot stops replying to this creator |
| `/resume @username` | Bot resumes AI replies |
| `/manual @username` | Permanently hands off to you |
| `/status @username` | Shows creator state, deal info |
| `/list` | Shows active pipeline |
| `/deals` | Shows all deal history |

---

## 💸 Budget Logic

| Creator's Price | Action |
|---|---|
| `> MAX_BUDGET` | AI sends counter-offer targeting `TARGET_BUDGET` |
| `MIN_BUDGET` ≤ price ≤ `MAX_BUDGET` | Telegram deal card sent for approval |
| `< MIN_BUDGET` | Telegram deal card sent (great deal!) |

---

## 🏗️ Architecture

```text
ClawBot/
├── src/
│   ├── index.js              # Express server + App Init
│   ├── config.js             # Env vars + validation
│   ├── db.js                 # PostgreSQL (pg pool connection)
│   ├── telegram/
│   │   ├── bot.js            # Bot init + card builders
│   │   └── handlers.js       # All Telegram handlers
│   ├── instagram/
│   │   └── client.js         # Puppeteer hidden browser DM sender
│   ├── ai/
│   │   └── negotiate.js      # GPT-4o reply + negotiation logic
│   ├── queues/
│   │   ├── dmQueue.js        # BullMQ Redis queue
│   │   └── worker.js         # DM worker process
│   ├── routes/
│   │   ├── creators.js       # POST /api/creators/add
│   │   └── webhook.js        # Official Meta Webhook receiver
│   └── services/
│       ├── creatorService.js # Creator lifecycle
│       └── dealService.js    # Deal management
├── scripts/
│   └── import_creators.js    # Bulk CSV Importer
└── www.instagram.com.cookies.json # Hidden browser session
```

---

## 📋 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/creators/add` | Add creator to pipeline |
| `GET` | `/api/creators` | List all creators |
| `POST` | `/instagram/webhook/simulate` | Simulate an incoming creator reply |
| `GET` | `/api/webhooks/instagram` | Official Meta webhook verification |
| `POST` | `/api/webhooks/instagram` | Official Meta webhook message receiver |