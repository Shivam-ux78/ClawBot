import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config.js';
import { registerHandlers } from './handlers.js';

let _bot = null;

export function initBot(options = { polling: true }) {
  if (_bot) return _bot;

  _bot = new TelegramBot(config.telegramBotToken, { polling: options.polling });

  _bot.on('polling_error', (err) => {
    // Only log if we are actually polling
    if (options.polling) {
      console.error('[Telegram] Polling error:', err.message);
    }
  });

  if (options.polling) {
    registerHandlers(_bot);
    console.log('[Telegram] Bot started (polling mode: ON)');
  } else {
    console.log('[Telegram] Bot started (polling mode: OFF - Send Only)');
  }
  
  return _bot;
}

export function getBot() {
  if (!_bot) throw new Error('Telegram bot not initialised. Call initBot() first.');
  return _bot;
}

// Convenience alias used by other modules
export { getBot as bot };

/* ─────────────────────────────────────────────────
   Message Builders — Telegram Cards
───────────────────────────────────────────────── */

function escapeMd(str) {
  return str ? str.toString().replace(/_/g, '\\_').replace(/\*/g, '\\*') : '';
}

/**
 * Send Stage 1 creator approval card.
 * @param {object} creator
 */
export function sendApprovalCard(creator) {
  const bot = getBot();
  const text = [
    `🔍 *NEW CREATOR FOUND*`,
    ``,
    `👤 Username: @${escapeMd(creator.username)}`,
    `👥 Followers: ${creator.followers ? creator.followers.toLocaleString() : 'N/A'}`,
    creator.niche ? `🏷 Niche: ${escapeMd(creator.niche)}` : null,
    ``,
    `*What would you like to do?*`,
    `1️⃣ Approve — Send outreach DM`,
    `2️⃣ Reject — Skip to next`,
  ]
    .filter(Boolean)
    .join('\n');

  bot.sendMessage(config.telegramChatId, text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ 1 — Approve', callback_data: `approve:${creator.id}` },
          { text: '❌ 2 — Reject', callback_data: `reject:${creator.id}` },
        ],
      ],
    },
  });
}

/**
 * Send Stage 5 deal proposal card.
 * @param {object} creator
 * @param {object} deal
 */
export function sendDealCard(creator, deal) {
  const bot = getBot();
  const text = [
    `🤝 *DEAL PROPOSAL*`,
    ``,
    `Creator: @${escapeMd(creator.username)}`,
    `💰 Proposed Price: *$${deal.proposed_price}*`,
    ``,
    `*Accept this deal?*`,
    `1️⃣ Accept — Send confirmation DM`,
    `2️⃣ Reject — Decline gracefully`,
  ].join('\n');

  bot.sendMessage(config.telegramChatId, text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ 1 — Accept Deal', callback_data: `deal_accept:${deal.id}` },
          { text: '❌ 2 — Reject Deal', callback_data: `deal_reject:${deal.id}` },
        ],
      ],
    },
  });
}

/**
 * Send an informational message to the control chat.
 * @param {string} text
 */
export function notify(text) {
  getBot().sendMessage(config.telegramChatId, text, { parse_mode: 'Markdown' });
}
