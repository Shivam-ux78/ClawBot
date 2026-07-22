import express from 'express';
import { config } from '../config.js';
import { handleTextMessage, handleButtonReply } from '../whatsapp/handlers.js';

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
    if (mode === 'subscribe' && token === config.whatsappVerifyToken) {
      console.log('✅ [WhatsApp Webhook] Successfully verified by Meta!');
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }
  return res.sendStatus(400);
});

/**
 * ============================================================================
 * 2. Meta Message Receiver (POST)
 * Receives control commands / button taps from WhatsApp control numbers.
 * ============================================================================
 */
router.post('/', async (req, res) => {
  const body = req.body;

  if (body.object !== 'whatsapp_business_account') return res.sendStatus(404);

  // MUST return 200 OK immediately
  res.status(200).send('EVENT_RECEIVED');

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const message of value.messages || []) {
        const from = message.from; // wa_id, e.g. "919905251524"

        try {
          if (message.type === 'text') {
            await handleTextMessage(from, message.text?.body);
          } else if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
            await handleButtonReply(from, message.interactive.button_reply.id);
          }
        } catch (err) {
          console.error('[WhatsApp Webhook] Error processing message:', err.message);
        }
      }
    }
  }
});

export default router;
