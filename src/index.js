import express from 'express';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { validateConfig, config } from './config.js';
import { initDb, all, get } from './db.js';
import { initBot, notify, escapeMd } from './telegram/bot.js';
import creatorsRouter from './routes/creators.js';
import webhookRouter from './routes/webhook.js';
import whatsappWebhookRouter from './routes/whatsappWebhook.js';
import statsRouter from './routes/stats.js';
import dealsRouter from './routes/deals.js';
import emailLeadsRouter from './routes/emailLeads.js';
import settingsRouter from './routes/settings.js';
import authRouter from './routes/auth.js';
import { getCreatorByUsername, logIncomingMessage } from './services/creatorService.js';
import { notifyWhatsApp } from './services/whatsappCloudService.js';
import { startDiscoveryCron, runDiscovery } from './jobs/discoveryJob.js';
import { startLinkedInDiscoveryCron, runLinkedInDiscovery } from './jobs/linkedinDiscoveryJob.js';
import { connection } from './queues/dmQueue.js';

/* ─────────────────────────────────────────────────
   Boot Sequence
───────────────────────────────────────────────── */
validateConfig();

await initDb();

// Override chat IDs from database if present (persists across cloud restarts)
try {
  const dbChatIds = await get("SELECT value FROM settings WHERE key = 'TELEGRAM_CHAT_IDS'");
  if (dbChatIds && dbChatIds.value) {
    config.telegramChatIds = JSON.parse(dbChatIds.value);
    console.log(`[Config] Loaded TELEGRAM_CHAT_IDS from database:`, config.telegramChatIds);
  }

  const dbFollowerRange = await get("SELECT value FROM settings WHERE key = 'FOLLOWER_RANGE'");
  if (dbFollowerRange && dbFollowerRange.value) {
    const range = JSON.parse(dbFollowerRange.value);
    if (range.min) config.minFollowers = range.min;
    if (range.max) config.maxFollowers = range.max;
    console.log(`[Config] Loaded FOLLOWER_RANGE from database: ${config.minFollowers} - ${config.maxFollowers}`);
  }

  const dbLocation = await get("SELECT value FROM settings WHERE key = 'DISCOVERY_LOCATION'");
  if (dbLocation && dbLocation.value) {
    config.discoveryLocation = dbLocation.value;
    console.log(`[Config] Loaded DISCOVERY_LOCATION from database: ${config.discoveryLocation}`);
  }

  const dbCategory = await get("SELECT value FROM settings WHERE key = 'DISCOVERY_CATEGORY'");
  if (dbCategory && dbCategory.value) {
    config.discoveryCategory = dbCategory.value;
    console.log(`[Config] Loaded DISCOVERY_CATEGORY from database: ${config.discoveryCategory}`);
  }

  const dbWhatsappNumbers = await get("SELECT value FROM settings WHERE key = 'WHATSAPP_CONTROL_NUMBERS'");
  if (dbWhatsappNumbers && dbWhatsappNumbers.value) {
    config.whatsappControlNumbers = JSON.parse(dbWhatsappNumbers.value);
    console.log(`[Config] Loaded WHATSAPP_CONTROL_NUMBERS from database:`, config.whatsappControlNumbers);
  }
} catch (err) {
  console.error('[Config] Error loading settings from DB:', err.message);
}

initBot();

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
app.use(express.json());

// Serve Web Dashboard Static Files
app.use(express.static('public'));

/* ─────────────────────────────────────────────────
   API Routes
───────────────────────────────────────────────── */
app.use('/api/auth', authRouter);
app.use('/api/creators', creatorsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/deals', dealsRouter);
app.use('/api/email-leads', emailLeadsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/webhooks/instagram', webhookRouter);
app.use('/api/webhooks/whatsapp', whatsappWebhookRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/privacy', (req, res) => {
  res.send(`<html><body><h1>Privacy Policy</h1><p>ClawBot is an internal brand partnership tool. It does not collect, store, or share personal data from end users. All Instagram interactions are conducted on behalf of the app owner only.</p></body></html>`);
});

app.get('/terms', (req, res) => {
  res.send(`<html><body><h1>Terms of Service</h1><p>ClawBot is an internal automation tool used solely by its operator. Use is restricted to the account owner.</p></body></html>`);
});

/* ─────────────────────────────────────────────────
   Manual Job Triggers
───────────────────────────────────────────────── */
app.post('/api/jobs/trigger-discovery', async (req, res) => {
  try {
    runDiscovery(); // Runs in background
    res.json({ success: true, message: 'Instagram discovery job triggered in background' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/jobs/trigger-linkedin', async (req, res) => {
  try {
    runLinkedInDiscovery(); // Runs in background
    res.json({ success: true, message: 'LinkedIn discovery job triggered in background' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────
   Update Cookies from Chrome Extension
───────────────────────────────────────────────── */
app.post('/api/cookies/update', async (req, res) => {
  const { secretKey, cookies, platform } = req.body;

  if (secretKey !== config.extensionSecretKey) {
    console.warn('[API] Unauthorized cookie update attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!cookies || !Array.isArray(cookies)) {
    return res.status(400).json({ error: 'Invalid cookies payload' });
  }

  let redisKey = 'ig_cookies';
  let fileName = 'www.instagram.com.cookies.json';
  let label = 'Instagram Main Account';

  if (platform === 'linkedin') {
    redisKey = 'li_cookies';
    fileName = 'www.linkedin.com.cookies.json';
    label = 'LinkedIn Account';
  } else if (platform === 'instagram_discovery' || platform === 'discovery') {
    redisKey = 'ig_discovery_cookies';
    fileName = 'www.instagram.discovery.cookies.json';
    label = 'Instagram Discovery/Scraper Account';
  }

  try {
    let redisSaved = false;
    try {
      await connection.set(redisKey, JSON.stringify(cookies));
      redisSaved = true;
    } catch (redisErr) {
      console.warn(`[API] ⚠️ Could not save cookies to Redis (${redisErr.message}). Saving to local file storage.`);
    }

    // Save locally as a backup for local dev
    const cookiesPath = path.resolve(fileName);
    fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));

    console.log(`[API] ✅ ${label} cookies updated from extension! ${redisSaved ? '(Redis + File)' : '(File backup)'}`);
    res.json({ success: true, message: `${label} cookies updated successfully` });
  } catch (err) {
    console.error('[API] Error saving cookies:', err.message);
    res.status(500).json({ error: 'Failed to save cookies: ' + err.message });
  }
});

/* ─────────────────────────────────────────────────
   Simulate Incoming Creator Reply (Testing)
───────────────────────────────────────────────── */
app.post('/instagram/webhook/simulate', async (req, res) => {
  const { username, message } = req.body;

  if (!username || !message) {
    return res.status(400).json({ error: 'username and message are required' });
  }

  try {
    const creator = await getCreatorByUsername(username.replace('@', ''));
    if (!creator) {
      return res.status(404).json({ error: `Creator @${username} not found` });
    }

    console.log(`[Simulate] Incoming from @${creator.username}: "${message}"`);

    await logIncomingMessage(creator.id, message);

    notify(`📩 *@${escapeMd(creator.username)}* replied to your DM:\n\n"${message}"`);
    await notifyWhatsApp(`📩 Creator @${creator.username} replied to your DM:\n\n"${message}"\n\nCheck Telegram for details.`);

    res.json({ success: true, action: 'notified', note: 'Telegram + WhatsApp notified. No reply sent to creator.' });
  } catch (err) {
    console.error('[Simulate] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────
   Start Server
───────────────────────────────────────────────── */
app.listen(config.port, () => {
  console.log(`\n🚀 ClawBot running on http://localhost:${config.port}`);
  console.log(`   Telegram bot: polling ✓`);
  console.log(`   Instagram: ${config.instagramStubMode ? 'STUB mode 🧪' : 'REAL mode 📡'}`);
  console.log(`   Follower range: ${config.minFollowers.toLocaleString()} - ${config.maxFollowers.toLocaleString()}`);
  console.log(`   Daily DM limit: ${config.dmDailyLimit}`);
  console.log(`   Discovery: every ${config.discoveryIntervalHours}h`);
  console.log(`   LinkedIn email discovery: every ${config.linkedinSyncIntervalHours}h ${config.gmailUser ? '' : '(⚠️ GMAIL_USER not set — approvals will fail to send)'}\n`);

  startDiscoveryCron();
  startLinkedInDiscoveryCron();
});

export default app;
