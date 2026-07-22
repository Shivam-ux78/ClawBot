import { config } from '../config.js';

/**
 * Meta WhatsApp Cloud API client.
 *
 * Setup (one-time):
 * 1. In Meta for Developers, add the "WhatsApp" product to your app (the same
 *    app used for the Instagram Graph webhook works fine).
 * 2. Under WhatsApp > API Setup, grab a permanent System User access token and
 *    the Phone Number ID for the number you'll message from.
 * 3. Under WhatsApp > Configuration, set the webhook URL to
 *    https://<your-domain>/api/webhooks/whatsapp and the verify token to
 *    WHATSAPP_VERIFY_TOKEN. Subscribe to the "messages" field.
 * 4. Add to env:
 *      WHATSAPP_CLOUD_TOKEN          = permanent access token
 *      WHATSAPP_CLOUD_PHONE_NUMBER_ID = phone number ID (not the phone number itself)
 *      WHATSAPP_VERIFY_TOKEN         = any string you choose, must match webhook config
 *      WHATSAPP_CONTROL_NUMBERS      = 919905251524,91XXXXXXXXXX (who may control the bot)
 */

const GRAPH_VERSION = 'v19.0';

function apiUrl() {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${config.whatsappCloudPhoneNumberId}/messages`;
}

async function post(payload) {
  if (!config.whatsappCloudToken || !config.whatsappCloudPhoneNumberId) {
    console.log('[WhatsApp] Not configured (WHATSAPP_CLOUD_TOKEN / WHATSAPP_CLOUD_PHONE_NUMBER_ID missing), skipping.');
    return null;
  }

  try {
    const res = await fetch(apiUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.whatsappCloudToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[WhatsApp] Send failed:', JSON.stringify(data));
      return null;
    }
    return data;
  } catch (err) {
    console.error('[WhatsApp] Error:', err.message);
    return null;
  }
}

/** Send a plain text message to a single wa_id (E.164 without '+'). */
export async function sendWhatsAppText(to, body) {
  return post({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body, preview_url: false },
  });
}

/** Send an interactive message with up to 3 quick-reply buttons. */
export async function sendWhatsAppButtons(to, bodyText, buttons) {
  return post({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map(({ id, title }) => ({
          type: 'reply',
          reply: { id, title: title.slice(0, 20) },
        })),
      },
    },
  });
}

/** Broadcast a plain text message to every configured control number. */
export async function notifyWhatsApp(message) {
  for (const to of config.whatsappControlNumbers) {
    await sendWhatsAppText(to, message);
  }
}
