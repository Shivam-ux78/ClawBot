import express from 'express';
import 'dotenv/config';
import { validateConfig, config } from './config.js';
import { initDb, all } from './db.js';
import { initBot, notify, escapeMd } from './telegram/bot.js';
import creatorsRouter from './routes/creators.js';
import webhookRouter from './routes/webhook.js';
import { getCreatorByUsername, logIncomingMessage } from './services/creatorService.js';
import { notifyWhatsApp } from './services/whatsappService.js';
import { startDiscoveryCron } from './jobs/discoveryJob.js';

/* ─────────────────────────────────────────────────
   Boot Sequence
───────────────────────────────────────────────── */
validateConfig();

await initDb();

initBot();

const app = express();
app.use(express.json());

/* ─────────────────────────────────────────────────
   API Routes
───────────────────────────────────────────────── */
app.use('/api/creators', creatorsRouter);
app.use('/api/webhooks/instagram', webhookRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/privacy', (req, res) => {
  res.send(`<html><body><h1>Privacy Policy</h1><p>ClawBot is an internal brand partnership tool. It does not collect, store, or share personal data from end users. All Instagram interactions are conducted on behalf of the app owner only.</p></body></html>`);
});

app.get('/terms', (req, res) => {
  res.send(`<html><body><h1>Terms of Service</h1><p>ClawBot is an internal automation tool used solely by its operator. Use is restricted to the account owner.</p></body></html>`);
});

app.get('/api/creators', async (req, res) => {
  try {
    const creators = await all('SELECT * FROM creators ORDER BY created_at DESC');
    res.json({ success: true, creators });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────
   Simulate Incoming Creator Reply (Testing)
   Notifies Telegram + WhatsApp only — no reply sent.
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
  console.log(`   Min followers: ${config.minFollowers.toLocaleString()}`);
  console.log(`   Daily DM limit: ${config.dmDailyLimit}`);
  console.log(`   Discovery: every ${config.discoveryIntervalHours}h\n`);

  startDiscoveryCron();
});

export default app;
