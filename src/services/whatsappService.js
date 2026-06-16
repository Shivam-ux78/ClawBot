import { config } from '../config.js';

/**
 * Send a WhatsApp notification via Green API (free tier).
 *
 * Setup (one-time):
 * 1. Go to https://green-api.com and sign up (free)
 * 2. Create a new instance → scan the QR code with your WhatsApp app
 * 3. Copy your idInstance and apiTokenInstance
 * 4. Add to Railway env vars:
 *      WHATSAPP_ID_INSTANCE   = your instance ID  (e.g. 1101234567)
 *      WHATSAPP_API_TOKEN     = your api token
 *      WHATSAPP_PHONE         = 919905251524  (country code + number, no +)
 */
export async function notifyWhatsApp(message) {
  if (!config.whatsappIdInstance || !config.whatsappApiToken) {
    console.log('[WhatsApp] Not configured (WHATSAPP_ID_INSTANCE / WHATSAPP_API_TOKEN missing), skipping.');
    return;
  }

  const url = `https://api.green-api.com/waInstance${config.whatsappIdInstance}/sendMessage/${config.whatsappApiToken}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: `${config.whatsappPhone}@c.us`,
        message,
      }),
    });

    const data = await res.json();
    if (data.idMessage) {
      console.log('[WhatsApp] Notification sent ✓');
    } else {
      console.error('[WhatsApp] Send failed:', JSON.stringify(data));
    }
  } catch (err) {
    console.error('[WhatsApp] Error:', err.message);
  }
}
