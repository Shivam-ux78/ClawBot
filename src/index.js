import express from 'express';
import 'dotenv/config';
import { validateConfig, config } from './config.js';
import { initDb, all } from './db.js';
import { initBot, sendDealCard, notify } from './telegram/bot.js';
import creatorsRouter from './routes/creators.js';
import webhookRouter from './routes/webhook.js';
import {
  getCreatorByUsername,
  getConversationHistory,
  logIncomingMessage,
} from './services/creatorService.js';
import { createDeal } from './services/dealService.js';
import {
  generateReply,
  extractPrice,
  negotiationDecision,
  generateCounterOffer,
} from './ai/negotiate.js';
import { enqueueDM } from './queues/dmQueue.js';

/* ─────────────────────────────────────────────────
   Boot Sequence
───────────────────────────────────────────────── */
validateConfig();

// Init DB (async Postgres pool)
await initDb();

// Init Telegram bot (polling)
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

app.get('/api/creators', async (req, res) => {
  try {
    const creators = await all('SELECT * FROM creators ORDER BY created_at DESC');
    res.json({ success: true, creators });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────
   Instagram Webhook (Simulated Testing)
───────────────────────────────────────────────── */


/**
 * POST /instagram/webhook/simulate
 * Simulate a creator reply — use for full end-to-end testing without real Instagram.
 */
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

    // 1. Log incoming message
    await logIncomingMessage(creator.id, message);

    // 2. Notify Telegram
    notify(`📩 *@${creator.username}* replied:\n\n_"${message}"_`);

    // 3. Check bot state
    if (creator.bot_state === 'paused') {
      return res.json({ success: true, action: 'skipped_paused' });
    }
    if (creator.bot_state === 'manual') {
      return res.json({ success: true, action: 'skipped_manual' });
    }

    // 4. Price detection → negotiation
    const quotedPrice = extractPrice(message);

    if (quotedPrice) {
      console.log(`[Simulate] Price detected: $${quotedPrice}`);

      const decision = negotiationDecision(quotedPrice, {
        minBudget: config.minBudget,
        targetBudget: config.targetBudget,
        maxBudget: config.maxBudget,
      });

      console.log(`[Simulate] Decision: ${decision}`);

      if (decision === 'counter') {
        const counterMsg = await generateCounterOffer(creator.username, quotedPrice, config.targetBudget);
        notify(`💬 *Counter offer* → @${creator.username}:\n_"${counterMsg}"_`);
        await enqueueDM('counter', { creatorId: creator.id, username: creator.username, message: counterMsg });
        return res.json({ success: true, action: 'counter_offer', counterMsg });
      }

      // propose_deal or accept
      const deal = await createDeal(creator.id, quotedPrice);
      sendDealCard(creator, deal);
      return res.json({ success: true, action: 'deal_proposed', deal });
    }

    // 5. No price — AI conversation reply
    const history = await getConversationHistory(creator.id);
    const aiReply = await generateReply(history, creator.username);

    await enqueueDM('reply', { creatorId: creator.id, username: creator.username, message: aiReply });

    res.json({ success: true, action: 'ai_reply', aiReply });
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
  console.log(`   Budget: $${config.minBudget} – $${config.targetBudget} – $${config.maxBudget}\n`);
});

export default app;
