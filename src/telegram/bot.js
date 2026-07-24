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

export function escapeMd(str) {
  return str ? str.toString().replace(/_/g, '\\_').replace(/\*/g, '\\*') : '';
}

/**
 * Send interactive card for Stage 1 approval.
 * @param {object} creator 
 */
export function sendApprovalCard(creator) {
  const bot = getBot();
  const followersStr = creator.followers ? Number(creator.followers).toLocaleString() : 'Unknown';
  
  const text = [
    `🎉 *New Creator Found*`,
    ``,
    `👤 @${escapeMd(creator.username)}`,
    `👥 Followers: ${followersStr}`,
    creator.category ? `🏷 Category: ${escapeMd(creator.category)}` : (creator.niche ? `🏷 Niche: ${escapeMd(creator.niche)}` : ''),
    creator.confidence != null ? `📊 Confidence: ${creator.confidence}%` : '',
    creator.location ? `📍 ${escapeMd(creator.location)}` : '',
    ``,
    `*Action Required:*`,
  ].filter(Boolean).join('\n');

  config.telegramChatIds.forEach(chatId => {
    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve', callback_data: `approve:${creator.id}` },
            { text: '❌ Reject', callback_data: `reject:${creator.id}` },
          ],
          [
            { text: '🔍 View Profile', url: `https://instagram.com/${creator.username}` }
          ]
        ],
      },
    };
    bot.sendMessage(chatId, text, options).catch(err => {
      console.warn(`[Telegram] sendApprovalCard failed with Markdown for ${chatId} (${err.message}), retrying plain text...`);
      delete options.parse_mode;
      bot.sendMessage(chatId, text.replace(/[*_`]/g, ''), options).catch(e => {
        console.error(`[Telegram] sendApprovalCard failed for ${chatId}:`, e.message);
      });
    });
  });
}

/**
 * Send interactive card for a new LinkedIn → Email lead.
 * @param {object} lead
 */
export function sendLeadApprovalCard(lead) {
  const bot = getBot();

  const text = [
    `📇 *New LinkedIn Lead*`,
    ``,
    `👤 ${escapeMd(lead.full_name || lead.email)}`,
    `✉️ ${escapeMd(lead.email)}`,
    lead.title ? `💼 ${escapeMd(lead.title)}` : '',
    lead.company ? `🏢 ${escapeMd(lead.company)}` : '',
    lead.location ? `📍 ${escapeMd(lead.location)}` : '',
    ``,
    `*Action Required:*`,
  ].filter(Boolean).join('\n');

  config.telegramChatIds.forEach(chatId => {
    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve', callback_data: `approvelead:${lead.id}` },
            { text: '❌ Reject', callback_data: `rejectlead:${lead.id}` },
          ],
          lead.linkedin_url ? [{ text: '🔍 View LinkedIn', url: lead.linkedin_url }] : [],
        ].filter(row => row.length),
      },
    };
    bot.sendMessage(chatId, text, options).catch(err => {
      console.warn(`[Telegram] sendLeadApprovalCard failed with Markdown for ${chatId} (${err.message}), retrying plain text...`);
      delete options.parse_mode;
      bot.sendMessage(chatId, text.replace(/[*_`]/g, ''), options).catch(e => {
        console.error(`[Telegram] sendLeadApprovalCard failed for ${chatId}:`, e.message);
      });
    });
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

  config.telegramChatIds.forEach(chatId => {
    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ 1 — Accept Deal', callback_data: `deal_accept:${deal.id}` },
            { text: '❌ 2 — Reject Deal', callback_data: `deal_reject:${deal.id}` },
          ],
        ],
      },
    };
    bot.sendMessage(chatId, text, options).catch(err => {
      console.warn(`[Telegram] sendDealCard failed with Markdown for ${chatId} (${err.message}), retrying plain text...`);
      delete options.parse_mode;
      bot.sendMessage(chatId, text.replace(/[*_`]/g, ''), options).catch(e => {
        console.error(`[Telegram] sendDealCard failed for ${chatId}:`, e.message);
      });
    });
  });
}

/**
 * Send an informational message to the control chat.
 * @param {string} text
 */
export function notify(text) {
  const botInstance = getBot();
  config.telegramChatIds.forEach(chatId => {
    botInstance
      .sendMessage(chatId, text, { parse_mode: 'Markdown' })
      .catch((err) => {
        console.warn(`[Telegram] notify failed with Markdown for ${chatId} (${err.message}), retrying plain text...`);
        botInstance.sendMessage(chatId, text.replace(/[*_`]/g, '')).catch((e) => {
          console.error(`[Telegram] notify failed for ${chatId}:`, e.message);
        });
      });
  });
}
