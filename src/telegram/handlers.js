import { run, get, all } from '../db.js';
import { sendDealCard, notify } from './bot.js';
import { config } from '../config.js';
import { runDiscovery, stopDiscoveryCron, resumeDiscoveryCron } from '../jobs/discoveryJob.js';
import fs from 'fs';
import path from 'path';

const pendingChatIdChanges = new Map();

/**
 * Register all Telegram message + callback handlers on the bot instance.
 * @param {import('node-telegram-bot-api')} bot
 */
export function registerHandlers(bot) {
  // ── Inline keyboard button presses ──────────────────────────────
  bot.on('callback_query', async (query) => {
    const { data, message } = query;
    const chatId = message.chat.id;

    await bot.answerCallbackQuery(query.id);

    try {
      if (data.startsWith('approve:')) {
        const creatorId = parseInt(data.split(':')[1]);
        await handleApprove(bot, chatId, creatorId, message.message_id);
        return;
      }

      if (data.startsWith('reject:')) {
        const creatorId = parseInt(data.split(':')[1]);
        await handleReject(bot, chatId, creatorId, message.message_id);
        return;
      }

      if (data.startsWith('deal_accept:')) {
        const dealId = parseInt(data.split(':')[1]);
        await handleDealAccept(bot, chatId, dealId, message.message_id);
        return;
      }

      if (data.startsWith('deal_reject:')) {
        const dealId = parseInt(data.split(':')[1]);
        await handleDealReject(bot, chatId, dealId, message.message_id);
        return;
      }
    } catch (err) {
      console.error('[Handlers] callback_query error:', err.message);
      bot.sendMessage(chatId, `⚠️ Error: ${err.message}`);
    }
  });

  // ── Text commands ────────────────────────────────────────────────
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    if (!text) return;

    if (text.startsWith('/chatID ')) {
      const newChatId = text.split(' ')[1];
      if (newChatId) {
        pendingChatIdChanges.set(chatId, newChatId);
        return bot.sendMessage(chatId, 'Please enter the password to update the chat ID.');
      }
    }

    if (pendingChatIdChanges.has(chatId)) {
      if (text === 'Admin123@') {
        const newChatId = pendingChatIdChanges.get(chatId);
        pendingChatIdChanges.delete(chatId);
        
        try {
          const envPath = path.resolve(process.cwd(), '.env');
          
          if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf8');
            if (envContent.includes('TELEGRAM_CHAT_ID=')) {
              envContent = envContent.replace(/TELEGRAM_CHAT_ID=.*/g, `TELEGRAM_CHAT_ID=${newChatId}`);
            } else {
              envContent += `\nTELEGRAM_CHAT_ID=${newChatId}\n`;
            }
            fs.writeFileSync(envPath, envContent);
          }
          
          config.telegramChatId = newChatId;
          
          try {
            await run(`
              INSERT INTO settings (key, value) VALUES ('TELEGRAM_CHAT_ID', $1)
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            `, [newChatId]);
          } catch (dbErr) {
            console.error('Error saving Chat ID to DB:', dbErr);
          }
          
          return bot.sendMessage(chatId, `✅ Chat ID successfully updated to ${newChatId} (saved to database).`);
        } catch (err) {
          console.error('Error updating Chat ID:', err);
          return bot.sendMessage(chatId, `⚠️ Error updating Chat ID: ${err.message}`);
        }
      } else {
        pendingChatIdChanges.delete(chatId);
        return bot.sendMessage(chatId, '❌ Incorrect password. Chat ID update cancelled.');
      }
    }

    // Only respond to our control chat
    if (String(chatId) !== String(config.telegramChatId)) return;

    try {
      if (text.startsWith('/pause')) {
        const username = extractUsername(text);
        if (!username) return bot.sendMessage(chatId, '⚠️ Usage: `/pause @username`', { parse_mode: 'Markdown' });
        await handleBotStateChange(bot, chatId, username, 'paused');
        return;
      }

      if (text.startsWith('/resume')) {
        const username = extractUsername(text);
        if (!username) return bot.sendMessage(chatId, '⚠️ Usage: `/resume @username`', { parse_mode: 'Markdown' });
        await handleBotStateChange(bot, chatId, username, 'active');
        return;
      }

      if (text.startsWith('/manual')) {
        const username = extractUsername(text);
        if (!username) return bot.sendMessage(chatId, '⚠️ Usage: `/manual @username`', { parse_mode: 'Markdown' });
        await handleBotStateChange(bot, chatId, username, 'manual');
        return;
      }

      if (text.startsWith('/status')) {
        const username = extractUsername(text);
        if (!username) return bot.sendMessage(chatId, '⚠️ Usage: `/status @username`', { parse_mode: 'Markdown' });
        await handleStatus(bot, chatId, username);
        return;
      }

      if (text === '/list') {
        await handleList(bot, chatId);
        return;
      }

      if (text === '/deals') {
        await handleDeals(bot, chatId);
        return;
      }

      if (text.startsWith('/stop')) {
        const parts = text.split(' ');
        const hours = parts.length > 1 ? parseInt(parts[1], 10) : null;
        
        if (hours && !isNaN(hours)) {
          stopDiscoveryCron(hours);
          bot.sendMessage(chatId, `⏸ *Discovery scan paused for ${hours} hours.*\nIt will resume automatically.`);
        } else {
          stopDiscoveryCron();
          bot.sendMessage(chatId, '⏸ *Discovery scan paused indefinitely.*\nUse `/startscan` to resume.', { parse_mode: 'Markdown' });
        }
        return;
      }

      if (text === '/startscan') {
        resumeDiscoveryCron();
        bot.sendMessage(chatId, '▶️ *Discovery scan schedule resumed.*', { parse_mode: 'Markdown' });
        return;
      }

      if (text === '/discover') {
        bot.sendMessage(chatId, '🔍 Starting manual discovery scan... This may take a few minutes.');
        runDiscovery().catch((err) => {
          bot.sendMessage(chatId, `⚠️ Discovery failed: ${err.message}`);
        });
        return;
      }

      if (text.startsWith('/collab')) {
        const username = extractUsername(text);
        if (!username) return bot.sendMessage(chatId, '⚠️ Usage: `/collab @username`', { parse_mode: 'Markdown' });
        
        bot.sendMessage(chatId, `⏳ Fetching profile info for @${username}...`);
        try {
          const { addCreator } = await import('../services/creatorService.js');
          await addCreator({ username, followers: null, niche: 'manual' });
        } catch (err) {
          bot.sendMessage(chatId, `⚠️ Error: ${err.message}`);
        }
        return;
      }

      if (text === '/help' || text === '/start') {
        await handleHelp(bot, chatId);
        return;
      }
    } catch (err) {
      console.error('[Handlers] message error:', err.message);
      bot.sendMessage(chatId, `⚠️ Error: ${err.message}`);
    }
  });

  console.log('[Telegram] All handlers registered.');
}

/* ─────────────────────────────────────────────────
   Handler Functions
───────────────────────────────────────────────── */

function escapeMd(str) {
  return str ? str.toString().replace(/_/g, '\\_').replace(/\*/g, '\\*') : '';
}

async function handleApprove(bot, chatId, creatorId, messageId) {
  // Import here to avoid circular dep at startup
  const { approveCreator, getCreatorById } = await import('../services/creatorService.js');
  const creator = await getCreatorById(creatorId);
  if (!creator) throw new Error(`Creator #${creatorId} not found`);

  if (creator.state !== 'pending') {
    return bot.editMessageText(
      `ℹ️ @${escapeMd(creator.username)} is already in state: \`${creator.state}\``,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
    );
  }

  await approveCreator(creatorId, {
    websiteUrl: 'https://makeable.nyc/',
    postLinks: [
      'https://www.instagram.com/makeableofficial/'
    ]
  });

  await bot.editMessageText(
    `✅ *Approved!* @${escapeMd(creator.username)}\n\nOutreach DM queued 📤 (sends in ~5s)`,
    { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
  );
}

async function handleReject(bot, chatId, creatorId, messageId) {
  const { rejectCreator, getCreatorById } = await import('../services/creatorService.js');
  const creator = await getCreatorById(creatorId);
  if (!creator) throw new Error(`Creator #${creatorId} not found`);

  await rejectCreator(creatorId);

  await bot.editMessageText(
    `❌ *Rejected* @${escapeMd(creator.username)}`,
    { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
  );
}

async function handleDealAccept(bot, chatId, dealId, messageId) {
  const { acceptDeal } = await import('../services/dealService.js');
  const result = await acceptDeal(dealId);

  await bot.editMessageText(
    `🎉 *Deal Accepted!* @${escapeMd(result.creator.username)} @ $${result.deal.proposed_price}\n\nConfirmation DM queued ✅`,
    { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
  );
}

async function handleDealReject(bot, chatId, dealId, messageId) {
  const { rejectDeal } = await import('../services/dealService.js');
  const result = await rejectDeal(dealId);

  await bot.editMessageText(
    `❌ *Deal Rejected* for @${escapeMd(result.creator.username)}\n\nGraceful decline DM queued.`,
    { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
  );
}

async function handleBotStateChange(bot, chatId, username, newState) {
  const { setBotState } = await import('../services/creatorService.js');
  const clean = username.replace('@', '');
  const creator = await setBotState(clean, newState);

  const stateEmoji = { active: '🟢', paused: '🟡', manual: '🔴' }[newState] || '⚪';

  await bot.sendMessage(
    chatId,
    `${stateEmoji} Bot state for @${escapeMd(creator.username)} set to *${newState}*`,
    { parse_mode: 'Markdown' }
  );
}

async function handleStatus(bot, chatId, username) {
  const { getCreatorByUsername } = await import('../services/creatorService.js');
  const { getPendingDeal } = await import('../services/dealService.js');
  const clean = username.replace('@', '');
  const creator = await getCreatorByUsername(clean);

  if (!creator) {
    return bot.sendMessage(chatId, `⚠️ Creator @${clean} not found in database.`);
  }

  const rows = await all('SELECT COUNT(*) as count FROM conversations WHERE creator_id = $1', [creator.id]);
  const msgCount = rows[0]?.count ?? 0;
  const pendingDeal = await getPendingDeal(creator.id);

  const stateEmoji = { active: '🟢', paused: '🟡', manual: '🔴' }[creator.bot_state] || '⚪';

  const text = [
    `📊 *Status: @${escapeMd(creator.username)}*`,
    ``,
    `State: \`${creator.state}\``,
    `Bot: ${stateEmoji} \`${creator.bot_state}\``,
    `Followers: ${creator.followers ? Number(creator.followers).toLocaleString() : 'N/A'}`,
    creator.niche ? `Niche: ${creator.niche}` : null,
    creator.quoted_price ? `Quoted Price: $${creator.quoted_price}` : null,
    `Messages: ${msgCount}`,
    pendingDeal ? `⏳ Pending Deal: $${pendingDeal.proposed_price}` : null,
    ``,
    `_Added: ${creator.created_at}_`,
  ]
    .filter(Boolean)
    .join('\n');

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

async function handleList(bot, chatId) {
  const creators = await all(`
    SELECT * FROM creators WHERE state NOT IN ('rejected', 'deal_closed', 'deal_rejected')
    ORDER BY created_at DESC LIMIT 20
  `);

  if (!creators.length) {
    return bot.sendMessage(chatId, 'ℹ️ No active creators in the pipeline.');
  }

  const stateEmoji = { active: '🟢', paused: '🟡', manual: '🔴' };
  const lines = creators.map((c) => {
    const e = stateEmoji[c.bot_state] || '⚪';
    return `${e} @${escapeMd(c.username)} | ${c.state} | ${c.followers ? Number(c.followers).toLocaleString() : 'N/A'} followers`;
  });

  bot.sendMessage(chatId, `📋 *Active Creators (${creators.length}):*\n\n${lines.join('\n')}`, {
    parse_mode: 'Markdown',
  });
}

async function handleDeals(bot, chatId) {
  const deals = await all(`
    SELECT d.*, c.username FROM deals d 
    JOIN creators c ON d.creator_id = c.id
    ORDER BY d.created_at DESC LIMIT 20
  `);

  if (!deals.length) {
    return bot.sendMessage(chatId, 'ℹ️ No deals yet.');
  }

  const emoji = { accepted: '✅', rejected: '❌', pending: '⏳', superseded: '⏩' };
  const lines = deals.map((d) => `${emoji[d.status] || '❓'} @${escapeMd(d.username)} — $${d.proposed_price} (${d.status})`);

  bot.sendMessage(chatId, `🤝 *Deals (${deals.length}):*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
}

async function handleHelp(bot, chatId) {
  const text = [
    `🤖 *ClawBot — Command Reference*`,
    ``,
    `*Creator Approval (inline buttons):*`,
    `✅ Approve → Sends enriched outreach DM`,
    `❌ Reject → Discards creator`,
    ``,
    `*Discovery:*`,
    `/discover — Manually trigger an Instagram scan now`,
    `/stop <hours> — Pause auto-discovery (e.g. /stop 12)`,
    `/startscan — Resume auto-discovery`,
    `/collab @username — Manually add any creator for outreach`,
    ``,
    `*Bot Control:*`,
    `/pause @username — Stop AI replies`,
    `/resume @username — Resume AI replies`,
    `/manual @username — Hand off to you`,
    `/chatID <id> — Change control to a new chat`,
    ``,
    `*Info:*`,
    `/status @username — Creator status`,
    `/list — Active pipeline`,
    `/deals — Deal history`,
    `/help — This message`,
  ].join('\n');

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

/* ─────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────── */
function extractUsername(text) {
  const match = text.match(/[\s@]@?([a-zA-Z0-9._]{1,30})\s*$/);
  return match ? match[1] : null;
}
