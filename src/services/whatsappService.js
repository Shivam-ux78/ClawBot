import { config } from '../config.js';

/**
 * Send a WhatsApp notification via CallMeBot API.
 * Setup: https://www.callmebot.com/blog/free-api-whatsapp-messages/
 * 1. Add +34 644 63 63 33 to your WhatsApp contacts as "CallMeBot"
 * 2. Send "I allow callmebot to send me messages" to that number
 * 3. You'll receive an API key — set it as WHATSAPP_API_KEY in Railway env
 */
export async function notifyWhatsApp(message) {
  if (!config.whatsappApiKey) {
    console.log('[WhatsApp] WHATSAPP_API_KEY not set, skipping notification.');
    return;
  }

  const url = `https://api.callmebot.com/whatsapp.php?phone=${config.whatsappPhone}&text=${encodeURIComponent(message)}&apikey=${config.whatsappApiKey}`;

  try {
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) {
      console.error('[WhatsApp] Failed to send:', res.status, text);
    } else {
      console.log('[WhatsApp] Notification sent.');
    }
  } catch (err) {
    console.error('[WhatsApp] Error:', err.message);
  }
}
