import { run, get, all } from '../db.js';
import { sendDealCard, notify } from './bot.js';
import { config } from '../config.js';
import { runDiscovery, stopDiscoveryCron, resumeDiscoveryCron } from '../jobs/discoveryJob.js';
import fs from 'fs';
import path from 'path';

const pendingIdActions = new Map();
const pendingRangeActions = new Map();

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

      if (data.startsWith('approvelead:')) {
        const leadId = parseInt(data.split(':')[1]);
        await handleApproveLead(bot, chatId, leadId, message.message_id);
        return;
      }

      if (data.startsWith('rejectlead:')) {
        const leadId = parseInt(data.split(':')[1]);
        await handleRejectLead(bot, chatId, leadId, message.message_id);
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

    if (text.startsWith('/AddID ')) {
      const newChatId = text.split(' ')[1];
      if (newChatId) {
        pendingIdActions.set(chatId, { action: 'add', target: newChatId });
        return bot.sendMessage(chatId, 'Please enter the password to add the Chat ID.');
      }
    }

    if (text.startsWith('/RemoveID ')) {
      const targetId = text.split(' ')[1];
      if (targetId) {
        pendingIdActions.set(chatId, { action: 'remove', target: targetId });
        return bot.sendMessage(chatId, 'Please enter the password to remove the Chat ID.');
      }
    }

    if (text === '/checkTotalID') {
      if (!config.telegramChatIds.includes(String(chatId))) return; // only admins can check
      const list = config.telegramChatIds.length > 0 ? config.telegramChatIds.join('\n') : 'None';
      return bot.sendMessage(chatId, `📋 *Registered Admin Chat IDs:*\n${list}`, { parse_mode: 'Markdown' });
    }

    if (pendingIdActions.has(chatId)) {
      if (text === 'Admin123@') {
        const { action, target } = pendingIdActions.get(chatId);
        pendingIdActions.delete(chatId);
        
        let newIds = [...config.telegramChatIds];
        if (action === 'add') {
          if (!newIds.includes(target)) newIds.push(target);
        } else if (action === 'remove') {
          newIds = newIds.filter(id => id !== target);
        }
        
        try {
          const envPath = path.resolve(process.cwd(), '.env');
          if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf8');
            const idsString = newIds.join(',');
            if (envContent.includes('TELEGRAM_CHAT_ID=')) {
              envContent = envContent.replace(/TELEGRAM_CHAT_ID=.*/g, `TELEGRAM_CHAT_ID=${idsString}`);
            } else {
              envContent += `\nTELEGRAM_CHAT_ID=${idsString}\n`;
            }
            fs.writeFileSync(envPath, envContent);
          }
          
          config.telegramChatIds = newIds;
          
          try {
            await run(`
              INSERT INTO settings (key, value) VALUES ('TELEGRAM_CHAT_IDS', $1)
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            `, [JSON.stringify(newIds)]);
          } catch (dbErr) {
            console.error('Error saving Chat IDs to DB:', dbErr);
          }
          
          return bot.sendMessage(chatId, `✅ Chat ID successfully ${action === 'add' ? 'added' : 'removed'}: ${target} (saved to database).`);
        } catch (err) {
          console.error('Error updating Chat IDs:', err);
          return bot.sendMessage(chatId, `⚠️ Error updating Chat IDs: ${err.message}`);
        }
      } else {
        pendingIdActions.delete(chatId);
        return bot.sendMessage(chatId, '❌ Incorrect password. Action cancelled.');
      }
    }

    // Only respond to our control chat
    if (!config.telegramChatIds.includes(String(chatId))) return;

    // ── Interactive /range flow (min → max) ──────────────────────────
    if (pendingRangeActions.has(chatId)) {
      if (text.toLowerCase() === '/cancel') {
        pendingRangeActions.delete(chatId);
        return bot.sendMessage(chatId, '❌ Range setup cancelled.');
      }
      const state = pendingRangeActions.get(chatId);
      const num = parseInt(text.replace(/[^\d]/g, ''), 10);
      if (isNaN(num) || num <= 0) {
        return bot.sendMessage(chatId, '⚠️ Please send a valid positive number, or /cancel.');
      }

      if (state.step === 'min') {
        state.min = num;
        state.step = 'max';
        pendingRangeActions.set(chatId, state);
        return bot.sendMessage(
          chatId,
          `✅ Minimum followers: *${num.toLocaleString()}*\n\nNow send the *maximum* follower count.`,
          { parse_mode: 'Markdown' }
        );
      }

      if (state.step === 'max') {
        if (num <= state.min) {
          return bot.sendMessage(chatId, `⚠️ Maximum must be greater than the minimum (${state.min.toLocaleString()}). Send a larger number, or /cancel.`);
        }
        const min = state.min;
        const max = num;
        pendingRangeActions.delete(chatId);
        config.minFollowers = min;
        config.maxFollowers = max;
        try {
          await run(`
            INSERT INTO settings (key, value) VALUES ('FOLLOWER_RANGE', $1)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
          `, [JSON.stringify({ min, max })]);
          return bot.sendMessage(chatId, `✅ *Follower range updated!*\nNew range: ${min.toLocaleString()} - ${max.toLocaleString()}`, { parse_mode: 'Markdown' });
        } catch (dbErr) {
          console.error('Error saving FOLLOWER_RANGE to DB:', dbErr);
          return bot.sendMessage(chatId, `⚠️ Range updated in memory, but failed to save to DB: ${dbErr.message}`);
        }
      }
    }

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

      if (text.startsWith('/list')) {
        const filterStr = text.replace('/list', '').trim();
        await handleList(bot, chatId, filterStr);
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

      if (text === '/range') {
        pendingRangeActions.set(chatId, { step: 'min' });
        return bot.sendMessage(
          chatId,
          '📊 *Set follower range*\n\nSend the *minimum* follower count (numbers only).\nSend /cancel to abort.',
          { parse_mode: 'Markdown' }
        );
      }

      if (text.startsWith('/range ')) {
        const parts = text.replace('/range', '').trim().split('-');
        if (parts.length === 2) {
          const min = parseInt(parts[0].trim(), 10);
          const max = parseInt(parts[1].trim(), 10);
          
          if (!isNaN(min) && !isNaN(max) && min < max) {
            config.minFollowers = min;
            config.maxFollowers = max;
            
            try {
              await run(`
                INSERT INTO settings (key, value) VALUES ('FOLLOWER_RANGE', $1)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
              `, [JSON.stringify({ min, max })]);
              return bot.sendMessage(chatId, `✅ *Follower range updated!*\nNew range: ${min.toLocaleString()} - ${max.toLocaleString()}`, { parse_mode: 'Markdown' });
            } catch (dbErr) {
              console.error('Error saving FOLLOWER_RANGE to DB:', dbErr);
              return bot.sendMessage(chatId, `⚠️ Range updated in memory, but failed to save to DB: ${dbErr.message}`);
            }
          }
        }
        return bot.sendMessage(chatId, '⚠️ Usage: `/range 3000 - 10000`', { parse_mode: 'Markdown' });
      }

      if (text.startsWith('/settarget')) {
        const parts = text.replace('/settarget', '').trim().split(' ');
        if (parts.length >= 2) {
          const location = parts[0].trim();
          const category = parts.slice(1).join(' ').trim();
          
          config.discoveryLocation = location;
          config.discoveryCategory = category;
          
          try {
            await run(`
              INSERT INTO settings (key, value) VALUES ('DISCOVERY_LOCATION', $1)
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            `, [location]);
            await run(`
              INSERT INTO settings (key, value) VALUES ('DISCOVERY_CATEGORY', $1)
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            `, [category]);
            return bot.sendMessage(chatId, `🎯 *Discovery Target Updated!*\nLocation: \`${location}\`\nCategory: \`${category}\``, { parse_mode: 'Markdown' });
          } catch (dbErr) {
            console.error('Error saving target to DB:', dbErr);
            return bot.sendMessage(chatId, `⚠️ Target updated in memory, but failed to save to DB: ${dbErr.message}`);
          }
        }
        return bot.sendMessage(chatId, '⚠️ Usage: `/settarget <location> <category>`\nExample: `/settarget US couple`', { parse_mode: 'Markdown' });
      }

      if (text === '/startscan') {
        resumeDiscoveryCron();
        bot.sendMessage(chatId, '▶️ *Discovery scan schedule resumed.*', { parse_mode: 'Markdown' });
        return;
      }

      if (text === '/Auto') {
        const { setAutoDMActive } = await import('../jobs/discoveryJob.js');
        setAutoDMActive(true);
        const threshold = config.autoDmMinConfidence ?? 50;
        return bot.sendMessage(chatId, `🚀 *Auto Mode Enabled*\nCreators scoring *≥${threshold}% match* will be automatically approved and cold-DM'd without confirmation.`, { parse_mode: 'Markdown' });
      }

      if (text === '/Manual' || text === '/AutoStop') {
        const { setAutoDMActive } = await import('../jobs/discoveryJob.js');
        setAutoDMActive(false);
        return bot.sendMessage(chatId, '🔴 *Manual Mode Enabled (Scrape Only)*\nCreators found will require your approval in Telegram/Dashboard before any cold DM is sent.', { parse_mode: 'Markdown' });
      }

      if (text.startsWith('/threshold')) {
        const arg = text.replace('/threshold', '').trim();
        if (arg) {
          const val = parseInt(arg, 10);
          if (isNaN(val) || val < 0 || val > 100) {
            return bot.sendMessage(chatId, '⚠️ Please specify a threshold between 0 and 100.\nExample: `/threshold 50`', { parse_mode: 'Markdown' });
          }
          config.autoDmMinConfidence = val;
          try {
            await run(`
              INSERT INTO settings (key, value) VALUES ('AUTO_DM_MIN_CONFIDENCE', $1)
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            `, [String(val)]);
            return bot.sendMessage(chatId, `🎯 *Auto DM Threshold Updated!*\nCreators scoring *≥${val}% match* will automatically receive DMs in Auto mode.`, { parse_mode: 'Markdown' });
          } catch (dbErr) {
            return bot.sendMessage(chatId, `⚠️ Updated in memory, but failed to save to DB: ${dbErr.message}`);
          }
        } else {
          const { isAutoDMActive } = await import('../jobs/discoveryJob.js');
          const current = config.autoDmMinConfidence ?? 50;
          return bot.sendMessage(chatId, `📊 *Current Auto DM Threshold:* *${current}%*\nMode: *${isAutoDMActive ? 'Auto DM Mode 🟢' : 'Scrape Only Mode (Manual Review) 🔴'}*\n\nTo change: \`/threshold <0-100>\` (e.g. \`/threshold 50\`)`, { parse_mode: 'Markdown' });
        }
      }

      if (text === '/StopCategoryFilter') {
        const { setCategoryFilterActive } = await import('../jobs/discoveryJob.js');
        setCategoryFilterActive(false);
        return bot.sendMessage(chatId, '🟢 *Category Filter OFF*\nDiscovery will now surface *any US creator* in your follower range, regardless of niche (couple/love no longer required).', { parse_mode: 'Markdown' });
      }

      if (text === '/StartCategoryFilter') {
        const { setCategoryFilterActive } = await import('../jobs/discoveryJob.js');
        setCategoryFilterActive(true);
        return bot.sendMessage(chatId, '🎯 *Category Filter ON*\nDiscovery will only keep Love/Couple/Relationship/Marriage/Family creators (confidence ≥ threshold).', { parse_mode: 'Markdown' });
      }

      if (text === '/discover') {
        bot.sendMessage(chatId, '🔍 Starting manual discovery scan... This may take a few minutes.');
        runDiscovery().catch((err) => {
          bot.sendMessage(chatId, `⚠️ Discovery failed: ${err.message}`);
        });
        return;
      }

      if (text === '/EmailAuto') {
        const { setAutoSequenceActive } = await import('../jobs/linkedinDiscoveryJob.js');
        setAutoSequenceActive(true);
        return bot.sendMessage(chatId, '🚀 *Email Auto Mode Enabled*\nNew LinkedIn leads will have the outreach email sent automatically, without confirmation.', { parse_mode: 'Markdown' });
      }

      if (text === '/EmailManual') {
        const { setAutoSequenceActive } = await import('../jobs/linkedinDiscoveryJob.js');
        setAutoSequenceActive(false);
        return bot.sendMessage(chatId, '🔴 *Email Manual Mode Enabled*\nNew LinkedIn leads require your approval before the outreach email is sent.', { parse_mode: 'Markdown' });
      }

      if (text === '/syncleads') {
        bot.sendMessage(chatId, '📇 Searching LinkedIn for new prospects... This may take a few minutes.');
        const { runLinkedInDiscovery } = await import('../jobs/linkedinDiscoveryJob.js');
        runLinkedInDiscovery().catch((err) => {
          bot.sendMessage(chatId, `⚠️ LinkedIn discovery failed: ${err.message}`);
        });
        return;
      }

      if (text.startsWith('/leads')) {
        const filterStr = text.replace('/leads', '').trim();
        await handleLeadsList(bot, chatId, filterStr);
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

async function handleApproveLead(bot, chatId, leadId, messageId) {
  const { approveLead, getLeadById } = await import('../services/emailOutreachService.js');
  const lead = await getLeadById(leadId);
  if (!lead) throw new Error(`Lead #${leadId} not found`);

  if (lead.state !== 'pending') {
    return bot.editMessageText(
      `ℹ️ ${escapeMd(lead.email)} is already in state: \`${lead.state}\``,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
    );
  }

  await approveLead(leadId);

  await bot.editMessageText(
    `✅ *Approved!* ${escapeMd(lead.email)}\n\nOutreach email sent 📤`,
    { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
  );
}

async function handleRejectLead(bot, chatId, leadId, messageId) {
  const { rejectLead, getLeadById } = await import('../services/emailOutreachService.js');
  const lead = await getLeadById(leadId);
  if (!lead) throw new Error(`Lead #${leadId} not found`);

  await rejectLead(leadId);

  await bot.editMessageText(
    `❌ *Rejected* ${escapeMd(lead.email)}`,
    { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
  );
}

async function handleLeadsList(bot, chatId, filterStr) {
  let query = "SELECT * FROM email_leads WHERE state NOT IN ('rejected', 'deal_closed', 'deal_rejected')";
  const params = [];

  if (filterStr) {
    query += ' AND LOWER(location) = LOWER($' + (params.length + 1) + ')';
    params.push(filterStr);
  }

  query += ' ORDER BY created_at DESC LIMIT 20';

  const leads = await all(query, params);

  if (!leads.length) {
    return bot.sendMessage(chatId, 'ℹ️ No active LinkedIn leads matching your criteria.');
  }

  const stateEmoji = { active: '🟢', paused: '🟡', manual: '🔴' };
  const lines = leads.map((l) => {
    const e = stateEmoji[l.bot_state] || '⚪';
    const loc = l.location ? `[${l.location}] ` : '';
    const co = l.company ? `(${l.company})` : '';
    return `${e} ${escapeMd(l.email)} | ${l.state} | ${loc}${co}`;
  });

  bot.sendMessage(chatId, `📇 *LinkedIn Leads (${leads.length}):*\n\n${lines.join('\n')}`, {
    parse_mode: 'Markdown',
  });
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

async function handleList(bot, chatId, filterStr) {
  let query = "SELECT * FROM creators WHERE state NOT IN ('rejected', 'deal_closed', 'deal_rejected')";
  let params = [];

  if (filterStr) {
    const parts = filterStr.split(' ');
    if (parts.length >= 1) {
      query += " AND LOWER(location) = LOWER($" + (params.length + 1) + ")";
      params.push(parts[0]);
    }
    if (parts.length >= 2) {
      query += " AND LOWER(niche) = LOWER($" + (params.length + 1) + ")";
      params.push(parts.slice(1).join(' '));
    }
  }

  query += " ORDER BY created_at DESC LIMIT 20";

  const creators = await all(query, params);

  if (!creators.length) {
    return bot.sendMessage(chatId, 'ℹ️ No active creators in the pipeline matching your criteria.');
  }

  const stateEmoji = { active: '🟢', paused: '🟡', manual: '🔴' };
  const lines = creators.map((c) => {
    const e = stateEmoji[c.bot_state] || '⚪';
    const loc = c.location ? `[${c.location}] ` : '';
    const cat = c.niche ? `(${c.niche})` : '';
    return `${e} @${escapeMd(c.username)} | ${c.state} | ${loc}${cat} ${c.followers ? Number(c.followers).toLocaleString() : 'N/A'} followers`;
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
    `/range — Set follower range interactively (asks min, then max)`,
    `/range <min> - <max> — Set the follower range in one line`,
    `/Auto — Auto-approve & cold-DM creators passing the filter`,
    `/Manual — Require your approval before any cold DM (default)`,
    `/threshold <0-100> — Set or check Auto DM match threshold (e.g. /threshold 50)`,
    `/StopCategoryFilter — Find any US creator (ignore niche)`,
    `/StartCategoryFilter — Only keep Love/Couple/Relationship creators`,
    `/collab @username — Manually add any creator for outreach`,
    ``,
    `*LinkedIn → Email (free discovery):*`,
    `📇 Approve/Reject → Send the outreach email, or discard`,
    `/syncleads — Search LinkedIn for new prospects now`,
    `/EmailAuto — Auto-send outreach email to new leads`,
    `/EmailManual — Require approval before sending (default)`,
    `/leads [location] — Active LinkedIn lead pipeline`,
    ``,
    `*Bot Control:*`,
    `/pause @username — Stop AI replies`,
    `/resume @username — Resume AI replies`,
    `/manual @username — Hand off to you`,
    `/AddID <id> — Add a new Admin Chat ID`,
    `/RemoveID <id> — Remove an Admin Chat ID`,
    `/checkTotalID — List all Admin Chat IDs`,
    ``,
    `*Info:*`,
    `/status @username — Creator status`,
    `/list [location] [category] — Active pipeline (optionally filtered)`,
    `/settarget <location> <category> — Set discovery target location & category`,
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
