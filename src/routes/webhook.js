import express from 'express';
import { config } from '../config.js';

const router = express.Router();

/**
 * ============================================================================
 * 1. Meta Webhook Verification (GET)
 * ============================================================================
 * When you add this URL to the Meta Developer Dashboard, Meta will send a GET
 * request here with a challenge code. This responds with the code to prove
 * you own the server.
 */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === config.metaVerifyToken) {
      console.log('✅ [Meta Webhook] Successfully verified by Meta!');
      return res.status(200).send(challenge);
    } else {
      console.log('❌ [Meta Webhook] Verification failed. Tokens do not match.');
      return res.sendStatus(403);
    }
  }
  
  return res.sendStatus(400);
});

/**
 * ============================================================================
 * 2. Meta Message Receiver (POST)
 * ============================================================================
 * This receives real-time messages from Instagram.
 */
router.post('/', async (req, res) => {
  const body = req.body;

  // Verify this is an Instagram event
  if (body.object === 'instagram') {
    // 1. MUST return 200 OK immediately so Meta knows we received it
    res.status(200).send('EVENT_RECEIVED');

    // 2. Process the incoming messages in the background
    for (const entry of body.entry) {
      if (!entry.messaging) continue;

      for (const event of entry.messaging) {
        if (event.message && event.message.text) {
          const senderId = event.sender.id; // This is a Scoped IG ID, not a @username
          const messageText = event.message.text;

          console.log(`\n🔔 [Meta Webhook] New Message from IG_SID ${senderId}:`);
          console.log(`   "${messageText}"`);

          /**
           * IMPORTANT NEXT STEPS FOR FULL PRODUCTION:
           * 
           * To reply automatically, we need to convert the \`senderId\` into their \`@username\` 
           * so we can match it to our database.
           * 
           * You need to use your Page Access Token to call the Graph API:
           * GET https://graph.facebook.com/v19.0/${senderId}?fields=username&access_token=YOUR_PAGE_TOKEN
           * 
           * Once you have the username, you can feed it into the exact same AI Negotiation 
           * logic we built in the \`/simulate\` route!
           */
        }
      }
    }
  } else {
    // Return a '404 Not Found' if event is not from an Instagram subscription
    res.sendStatus(404);
  }
});

export default router;
