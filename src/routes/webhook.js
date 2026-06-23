import express from 'express';
import { config } from '../config.js';
import { getCreatorByUsername, logIncomingMessage } from '../services/creatorService.js';
import { notify, escapeMd } from '../telegram/bot.js';
import { notifyWhatsApp } from '../services/whatsappService.js';

const router = express.Router();

/**
 * ============================================================================
 * 1. Meta Webhook Verification (GET)
 * ============================================================================
 */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === config.metaVerifyToken) {
      console.log('✅ [Meta Webhook] Successfully verified by Meta!');
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }
  return res.sendStatus(400);
});

/**
 * ============================================================================
 * 2. Meta Message Receiver (POST)
 * Receives creator replies — notifies Telegram + WhatsApp only, no bot reply.
 * ============================================================================
 */
router.post('/', async (req, res) => {
  const body = req.body;

  if (body.object !== 'instagram') return res.sendStatus(404);

  // MUST return 200 OK immediately
  res.status(200).send('EVENT_RECEIVED');

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      if (event.message && event.message.text) {
        const senderId = event.sender.id;
        const messageText = event.message.text;

        try {
          // 1. Resolve IG sender ID to username via Graph API
          const graphRes = await fetch(`https://graph.facebook.com/v19.0/${senderId}?fields=username&access_token=${config.instagramAccessToken}`);
          const graphData = await graphRes.json();

          if (!graphData.username) {
            console.error(`[Webhook] Could not resolve username for IG_SID: ${senderId}. Response:`, graphData);
            continue;
          }

          const username = graphData.username;
          console.log(`\n🔔 [Webhook] Reply from @${username}: "${messageText}"`);

          // 2. Find creator in DB
          const creator = await getCreatorByUsername(username);
          if (!creator) {
            console.log(`[Webhook] Ignoring message from @${username} (Not in pipeline)`);
            continue;
          }

          // 3. Log incoming message
          await logIncomingMessage(creator.id, messageText);

          // 4. Notify Telegram + WhatsApp — no reply sent back to creator
          const telegramMsg = `👤 @${escapeMd(creator.username)} user response please handle it`;
          const whatsappMsg = `👤 @${creator.username} user response please handle it`;

          notify(telegramMsg);
          await notifyWhatsApp(whatsappMsg);

          console.log(`[Webhook] Notified Telegram + WhatsApp. No reply sent to @${username}.`);

        } catch (err) {
          console.error(`[Webhook] Error processing message:`, err.message);
        }
      }
    }
  }
});

export default router;
