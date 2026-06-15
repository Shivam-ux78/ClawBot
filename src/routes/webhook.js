import express from 'express';
import { config } from '../config.js';
import { getCreatorByUsername, logIncomingMessage, getConversationHistory } from '../services/creatorService.js';
import { createDeal } from '../services/dealService.js';
import { notify, sendDealCard, escapeMd } from '../telegram/bot.js';
import { extractPrice, negotiationDecision, generateCounterOffer, generateReply } from '../ai/negotiate.js';
import { enqueueDM } from '../queues/dmQueue.js';

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
          // 1. Convert IG_SID to @username via Graph API
          const graphRes = await fetch(`https://graph.facebook.com/v19.0/${senderId}?fields=username&access_token=${config.instagramAccessToken}`);
          const graphData = await graphRes.json();
          
          if (!graphData.username) {
            console.error(`[Webhook] Could not resolve username for IG_SID: ${senderId}. Response:`, graphData);
            continue;
          }

          const username = graphData.username;
          console.log(`\n🔔 [Webhook] Message from @${username}: "${messageText}"`);

          // 2. Fetch creator from our database
          const creator = await getCreatorByUsername(username);
          if (!creator) {
            console.log(`[Webhook] Ignoring message from @${username} (Not in pipeline)`);
            continue;
          }

          // 3. Log incoming message
          await logIncomingMessage(creator.id, messageText);
          notify(`📩 *@${escapeMd(creator.username)}* replied:\n\n"${messageText}"`);

          // 4. Check Bot State
          if (creator.bot_state === 'paused' || creator.bot_state === 'manual') {
            console.log(`[Webhook] Bot is ${creator.bot_state} for @${username}. Skipping AI reply.`);
            continue;
          }

          // 5. Price Detection & Negotiation
          const quotedPrice = extractPrice(messageText);

          if (quotedPrice) {
            console.log(`[Webhook] Price detected: $${quotedPrice}`);
            const decision = negotiationDecision(quotedPrice, {
              minBudget: config.minBudget,
              targetBudget: config.targetBudget,
              maxBudget: config.maxBudget,
            });

            if (decision === 'counter') {
              const counterMsg = await generateCounterOffer(creator.username, quotedPrice, config.targetBudget);
              notify(`💬 *Counter offer* → @${escapeMd(creator.username)}:\n"${counterMsg}"`);
              await enqueueDM('counter', { creatorId: creator.id, username: creator.username, message: counterMsg });
              continue;
            }

            // Propose deal or accept
            const deal = await createDeal(creator.id, quotedPrice);
            sendDealCard(creator, deal);
            continue;
          }

          // 6. Normal AI Conversation
          const history = await getConversationHistory(creator.id);
          const aiReply = await generateReply(history, creator.username);
          
          console.log(`[Webhook] AI generated reply: "${aiReply}"`);
          await enqueueDM('reply', { creatorId: creator.id, username: creator.username, message: aiReply });

        } catch (err) {
          console.error(`[Webhook] Error processing message:`, err.message);
        }
      }
    }
  }
});

export default router;
