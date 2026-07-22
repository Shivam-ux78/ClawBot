import { run, all } from '../db.js';
import { sendWhatsAppText } from '../services/whatsappCloudService.js';
import { config } from '../config.js';
import { runDiscovery, stopDiscoveryCron, resumeDiscoveryCron } from '../jobs/discoveryJob.js';

const pendingRangeActions = new Map();

function isAuthorized(from) {
  return config.whatsappControlNumbers.includes(String(from));
}

function reply(from, text) {
  return sendWhatsAppText(from, text).catch((err) => console.error(`[WhatsApp] reply failed for ${from}:`, err.message));
}

/**
 * Handle a button click from an interactive message (approve/reject/deal_accept/deal_reject).
 * @param {string} from wa_id of the sender
 * @param {string} buttonId e.g. "approve:12"
 */
export async function handleButtonReply(from, buttonId) {
  if (!isAuthorized(from)) return;

  try {
    const [action, idStr] = buttonId.split(':');
    const id = parseInt(idStr, 10);

    if (action === 'approve') return handleApprove(from, id);
    if (action === 'reject') return handleReject(from, id);
    if (action === 'approvelead') return handleApproveLead(from, id);
    if (action === 'rejectlead') return handleRejectLead(from, id);
    if (action === 'deal_accept') return handleDealAccept(from, id);
    if (action === 'deal_reject') return handleDealReject(from, id);
  } catch (err) {
    console.error('[WhatsApp Handlers] button reply error:', err.message);
    reply(from, `⚠️ Error: ${err.message}`);
  }
}

/**
 * Handle an incoming text message (control command) from WhatsApp.
 * @param {string} from wa_id of the sender
 * @param {string} text
 */
export async function handleTextMessage(from, text) {
  if (!isAuthorized(from)) return;
  text = text?.trim();
  if (!text) return;

  // ── Interactive /range flow (min → max) ──────────────────────────
  if (pendingRangeActions.has(from)) {
    if (text.toLowerCase() === '/cancel') {
      pendingRangeActions.delete(from);
      return reply(from, '❌ Range setup cancelled.');
    }
    const state = pendingRangeActions.get(from);
    const num = parseInt(text.replace(/[^\d]/g, ''), 10);
    if (isNaN(num) || num <= 0) {
      return reply(from, '⚠️ Please send a valid positive number, or /cancel.');
    }

    if (state.step === 'min') {
      state.min = num;
      state.step = 'max';
      pendingRangeActions.set(from, state);
      return reply(from, `✅ Minimum followers: ${num.toLocaleString()}\n\nNow send the *maximum* follower count.`);
    }

    if (state.step === 'max') {
      if (num <= state.min) {
        return reply(from, `⚠️ Maximum must be greater than the minimum (${state.min.toLocaleString()}). Send a larger number, or /cancel.`);
      }
      const min = state.min;
      const max = num;
      pendingRangeActions.delete(from);
      config.minFollowers = min;
      config.maxFollowers = max;
      try {
        await run(`
          INSERT INTO settings (key, value) VALUES ('FOLLOWER_RANGE', $1)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `, [JSON.stringify({ min, max })]);
        return reply(from, `✅ Follower range updated!\nNew range: ${min.toLocaleString()} - ${max.toLocaleString()}`);
      } catch (dbErr) {
        console.error('Error saving FOLLOWER_RANGE to DB:', dbErr);
        return reply(from, `⚠️ Range updated in memory, but failed to save to DB: ${dbErr.message}`);
      }
    }
  }

  try {
    if (text.startsWith('/approve ')) {
      const id = parseInt(text.split(' ')[1], 10);
      if (!isNaN(id)) return handleApprove(from, id);
      return reply(from, '⚠️ Usage: /approve <creator id>');
    }

    if (text.startsWith('/reject ')) {
      const id = parseInt(text.split(' ')[1], 10);
      if (!isNaN(id)) return handleReject(from, id);
      return reply(from, '⚠️ Usage: /reject <creator id>');
    }

    if (text.startsWith('/approvelead ')) {
      const id = parseInt(text.split(' ')[1], 10);
      if (!isNaN(id)) return handleApproveLead(from, id);
      return reply(from, '⚠️ Usage: /approvelead <lead id>');
    }

    if (text.startsWith('/rejectlead ')) {
      const id = parseInt(text.split(' ')[1], 10);
      if (!isNaN(id)) return handleRejectLead(from, id);
      return reply(from, '⚠️ Usage: /rejectlead <lead id>');
    }

    if (text === '/EmailAuto') {
      const { setAutoSequenceActive } = await import('../jobs/linkedinDiscoveryJob.js');
      setAutoSequenceActive(true);
      return reply(from, '🚀 Email Auto Mode Enabled\nNew LinkedIn leads will have the outreach email sent automatically, without confirmation.');
    }

    if (text === '/EmailManual') {
      const { setAutoSequenceActive } = await import('../jobs/linkedinDiscoveryJob.js');
      setAutoSequenceActive(false);
      return reply(from, '🔴 Email Manual Mode Enabled\nNew LinkedIn leads require your approval before the outreach email is sent.');
    }

    if (text === '/syncleads') {
      reply(from, '📇 Searching LinkedIn for new prospects... This may take a few minutes.');
      const { runLinkedInDiscovery } = await import('../jobs/linkedinDiscoveryJob.js');
      runLinkedInDiscovery().catch((err) => reply(from, `⚠️ LinkedIn discovery failed: ${err.message}`));
      return;
    }

    if (text.startsWith('/leads')) {
      const filterStr = text.replace('/leads', '').trim();
      return handleLeadsList(from, filterStr);
    }

    if (text.startsWith('/pause')) {
      const username = extractUsername(text);
      if (!username) return reply(from, '⚠️ Usage: /pause @username');
      return handleBotStateChange(from, username, 'paused');
    }

    if (text.startsWith('/resume')) {
      const username = extractUsername(text);
      if (!username) return reply(from, '⚠️ Usage: /resume @username');
      return handleBotStateChange(from, username, 'active');
    }

    if (text.startsWith('/manual')) {
      const username = extractUsername(text);
      if (!username) return reply(from, '⚠️ Usage: /manual @username');
      return handleBotStateChange(from, username, 'manual');
    }

    if (text.startsWith('/status')) {
      const username = extractUsername(text);
      if (!username) return reply(from, '⚠️ Usage: /status @username');
      return handleStatus(from, username);
    }

    if (text.startsWith('/list')) {
      const filterStr = text.replace('/list', '').trim();
      return handleList(from, filterStr);
    }

    if (text === '/deals') {
      return handleDeals(from);
    }

    if (text.startsWith('/stop')) {
      const parts = text.split(' ');
      const hours = parts.length > 1 ? parseInt(parts[1], 10) : null;

      if (hours && !isNaN(hours)) {
        stopDiscoveryCron(hours);
        return reply(from, `⏸ Discovery scan paused for ${hours} hours.\nIt will resume automatically.`);
      }
      stopDiscoveryCron();
      return reply(from, '⏸ Discovery scan paused indefinitely.\nUse /startscan to resume.');
    }

    if (text === '/range') {
      pendingRangeActions.set(from, { step: 'min' });
      return reply(from, '📊 Set follower range\n\nSend the *minimum* follower count (numbers only).\nSend /cancel to abort.');
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
            return reply(from, `✅ Follower range updated!\nNew range: ${min.toLocaleString()} - ${max.toLocaleString()}`);
          } catch (dbErr) {
            console.error('Error saving FOLLOWER_RANGE to DB:', dbErr);
            return reply(from, `⚠️ Range updated in memory, but failed to save to DB: ${dbErr.message}`);
          }
        }
      }
      return reply(from, '⚠️ Usage: /range 3000 - 10000');
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
          return reply(from, `🎯 Discovery Target Updated!\nLocation: ${location}\nCategory: ${category}`);
        } catch (dbErr) {
          console.error('Error saving target to DB:', dbErr);
          return reply(from, `⚠️ Target updated in memory, but failed to save to DB: ${dbErr.message}`);
        }
      }
      return reply(from, '⚠️ Usage: /settarget <location> <category>\nExample: /settarget US couple');
    }

    if (text === '/startscan') {
      resumeDiscoveryCron();
      return reply(from, '▶️ Discovery scan schedule resumed.');
    }

    if (text === '/Auto') {
      const { setAutoDMActive } = await import('../jobs/discoveryJob.js');
      setAutoDMActive(true);
      return reply(from, "🚀 Auto Mode Enabled\nCreators passing the confidence filter will be automatically approved and cold-DM'd without confirmation.");
    }

    if (text === '/Manual' || text === '/AutoStop') {
      const { setAutoDMActive } = await import('../jobs/discoveryJob.js');
      setAutoDMActive(false);
      return reply(from, '🔴 Manual Mode Enabled\nCreators found will require your approval before any cold DM is sent.');
    }

    if (text === '/StopCategoryFilter') {
      const { setCategoryFilterActive } = await import('../jobs/discoveryJob.js');
      setCategoryFilterActive(false);
      return reply(from, '🟢 Category Filter OFF\nDiscovery will now surface any US creator in your follower range, regardless of niche.');
    }

    if (text === '/StartCategoryFilter') {
      const { setCategoryFilterActive } = await import('../jobs/discoveryJob.js');
      setCategoryFilterActive(true);
      return reply(from, '🎯 Category Filter ON\nDiscovery will only keep Love/Couple/Relationship/Marriage/Family creators (confidence ≥ threshold).');
    }

    if (text === '/discover') {
      reply(from, '🔍 Starting manual discovery scan... This may take a few minutes.');
      runDiscovery().catch((err) => reply(from, `⚠️ Discovery failed: ${err.message}`));
      return;
    }

    if (text.startsWith('/collab')) {
      const username = extractUsername(text);
      if (!username) return reply(from, '⚠️ Usage: /collab @username');

      reply(from, `⏳ Fetching profile info for @${username}...`);
      try {
        const { addCreator } = await import('../services/creatorService.js');
        await addCreator({ username, followers: null, niche: 'manual' });
      } catch (err) {
        reply(from, `⚠️ Error: ${err.message}`);
      }
      return;
    }

    if (text.startsWith('/AddNumber ')) {
      const target = text.split(' ')[1];
      if (!target) return reply(from, '⚠️ Usage: /AddNumber <wa_id>');
      return handleControlNumberChange(from, 'add', target);
    }

    if (text.startsWith('/RemoveNumber ')) {
      const target = text.split(' ')[1];
      if (!target) return reply(from, '⚠️ Usage: /RemoveNumber <wa_id>');
      return handleControlNumberChange(from, 'remove', target);
    }

    if (text === '/checkNumbers') {
      const list = config.whatsappControlNumbers.length > 0 ? config.whatsappControlNumbers.join('\n') : 'None';
      return reply(from, `📋 Registered control numbers:\n${list}`);
    }

    if (text === '/help' || text === '/start') {
      return handleHelp(from);
    }
  } catch (err) {
    console.error('[WhatsApp Handlers] message error:', err.message);
    reply(from, `⚠️ Error: ${err.message}`);
  }
}

/* ─────────────────────────────────────────────────
   Handler Functions
───────────────────────────────────────────────── */

async function handleApprove(from, creatorId) {
  const { approveCreator, getCreatorById } = await import('../services/creatorService.js');
  const creator = await getCreatorById(creatorId);
  if (!creator) throw new Error(`Creator #${creatorId} not found`);

  if (creator.state !== 'pending') {
    return reply(from, `ℹ️ @${creator.username} is already in state: ${creator.state}`);
  }

  await approveCreator(creatorId, {
    websiteUrl: 'https://makeable.nyc/',
    postLinks: ['https://www.instagram.com/makeableofficial/'],
  });

  return reply(from, `✅ Approved! @${creator.username}\n\nOutreach DM queued (sends in ~5s)`);
}

async function handleReject(from, creatorId) {
  const { rejectCreator, getCreatorById } = await import('../services/creatorService.js');
  const creator = await getCreatorById(creatorId);
  if (!creator) throw new Error(`Creator #${creatorId} not found`);

  await rejectCreator(creatorId);
  return reply(from, `❌ Rejected @${creator.username}`);
}

async function handleApproveLead(from, leadId) {
  const { approveLead, getLeadById } = await import('../services/emailOutreachService.js');
  const lead = await getLeadById(leadId);
  if (!lead) throw new Error(`Lead #${leadId} not found`);

  if (lead.state !== 'pending') {
    return reply(from, `ℹ️ ${lead.email} is already in state: ${lead.state}`);
  }

  await approveLead(leadId);
  return reply(from, `✅ Approved! ${lead.email}\n\nOutreach email sent.`);
}

async function handleRejectLead(from, leadId) {
  const { rejectLead, getLeadById } = await import('../services/emailOutreachService.js');
  const lead = await getLeadById(leadId);
  if (!lead) throw new Error(`Lead #${leadId} not found`);

  await rejectLead(leadId);
  return reply(from, `❌ Rejected ${lead.email}`);
}

async function handleLeadsList(from, filterStr) {
  let query = "SELECT * FROM email_leads WHERE state NOT IN ('rejected', 'deal_closed', 'deal_rejected')";
  const params = [];

  if (filterStr) {
    query += ' AND LOWER(location) = LOWER($' + (params.length + 1) + ')';
    params.push(filterStr);
  }

  query += ' ORDER BY created_at DESC LIMIT 20';

  const leads = await all(query, params);

  if (!leads.length) {
    return reply(from, 'ℹ️ No active LinkedIn leads matching your criteria.');
  }

  const stateEmoji = { active: '🟢', paused: '🟡', manual: '🔴' };
  const lines = leads.map((l) => {
    const e = stateEmoji[l.bot_state] || '⚪';
    const loc = l.location ? `[${l.location}] ` : '';
    const co = l.company ? `(${l.company})` : '';
    return `${e} ${l.email} | ${l.state} | ${loc}${co}`;
  });

  return reply(from, `📇 LinkedIn Leads (${leads.length}):\n\n${lines.join('\n')}`);
}

async function handleDealAccept(from, dealId) {
  const { acceptDeal } = await import('../services/dealService.js');
  const result = await acceptDeal(dealId);
  return reply(from, `🎉 Deal Accepted! @${result.creator.username} @ $${result.deal.proposed_price}\n\nConfirmation DM queued.`);
}

async function handleDealReject(from, dealId) {
  const { rejectDeal } = await import('../services/dealService.js');
  const result = await rejectDeal(dealId);
  return reply(from, `❌ Deal Rejected for @${result.creator.username}\n\nGraceful decline DM queued.`);
}

async function handleBotStateChange(from, username, newState) {
  const { setBotState } = await import('../services/creatorService.js');
  const clean = username.replace('@', '');
  const creator = await setBotState(clean, newState);

  const stateEmoji = { active: '🟢', paused: '🟡', manual: '🔴' }[newState] || '⚪';
  return reply(from, `${stateEmoji} Bot state for @${creator.username} set to ${newState}`);
}

async function handleStatus(from, username) {
  const { getCreatorByUsername } = await import('../services/creatorService.js');
  const { getPendingDeal } = await import('../services/dealService.js');
  const clean = username.replace('@', '');
  const creator = await getCreatorByUsername(clean);

  if (!creator) {
    return reply(from, `⚠️ Creator @${clean} not found in database.`);
  }

  const rows = await all('SELECT COUNT(*) as count FROM conversations WHERE creator_id = $1', [creator.id]);
  const msgCount = rows[0]?.count ?? 0;
  const pendingDeal = await getPendingDeal(creator.id);

  const stateEmoji = { active: '🟢', paused: '🟡', manual: '🔴' }[creator.bot_state] || '⚪';

  const text = [
    `📊 Status: @${creator.username}`,
    ``,
    `State: ${creator.state}`,
    `Bot: ${stateEmoji} ${creator.bot_state}`,
    `Followers: ${creator.followers ? Number(creator.followers).toLocaleString() : 'N/A'}`,
    creator.niche ? `Niche: ${creator.niche}` : null,
    creator.quoted_price ? `Quoted Price: $${creator.quoted_price}` : null,
    `Messages: ${msgCount}`,
    pendingDeal ? `⏳ Pending Deal: $${pendingDeal.proposed_price}` : null,
    ``,
    `Added: ${creator.created_at}`,
  ].filter(Boolean).join('\n');

  return reply(from, text);
}

async function handleList(from, filterStr) {
  let query = "SELECT * FROM creators WHERE state NOT IN ('rejected', 'deal_closed', 'deal_rejected')";
  let params = [];

  if (filterStr) {
    const parts = filterStr.split(' ');
    if (parts.length >= 1) {
      query += ' AND LOWER(location) = LOWER($' + (params.length + 1) + ')';
      params.push(parts[0]);
    }
    if (parts.length >= 2) {
      query += ' AND LOWER(niche) = LOWER($' + (params.length + 1) + ')';
      params.push(parts.slice(1).join(' '));
    }
  }

  query += ' ORDER BY created_at DESC LIMIT 20';

  const creators = await all(query, params);

  if (!creators.length) {
    return reply(from, 'ℹ️ No active creators in the pipeline matching your criteria.');
  }

  const stateEmoji = { active: '🟢', paused: '🟡', manual: '🔴' };
  const lines = creators.map((c) => {
    const e = stateEmoji[c.bot_state] || '⚪';
    const loc = c.location ? `[${c.location}] ` : '';
    const cat = c.niche ? `(${c.niche})` : '';
    return `${e} @${c.username} | ${c.state} | ${loc}${cat} ${c.followers ? Number(c.followers).toLocaleString() : 'N/A'} followers`;
  });

  return reply(from, `📋 Active Creators (${creators.length}):\n\n${lines.join('\n')}`);
}

async function handleDeals(from) {
  const deals = await all(`
    SELECT d.*, c.username FROM deals d
    JOIN creators c ON d.creator_id = c.id
    ORDER BY d.created_at DESC LIMIT 20
  `);

  if (!deals.length) {
    return reply(from, 'ℹ️ No deals yet.');
  }

  const emoji = { accepted: '✅', rejected: '❌', pending: '⏳', superseded: '⏩' };
  const lines = deals.map((d) => `${emoji[d.status] || '❓'} @${d.username} — $${d.proposed_price} (${d.status})`);

  return reply(from, `🤝 Deals (${deals.length}):\n\n${lines.join('\n')}`);
}

async function handleControlNumberChange(from, action, target) {
  let newNumbers = [...config.whatsappControlNumbers];
  if (action === 'add') {
    if (!newNumbers.includes(target)) newNumbers.push(target);
  } else {
    newNumbers = newNumbers.filter((n) => n !== target);
  }

  config.whatsappControlNumbers = newNumbers;

  try {
    await run(`
      INSERT INTO settings (key, value) VALUES ('WHATSAPP_CONTROL_NUMBERS', $1)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `, [JSON.stringify(newNumbers)]);
    return reply(from, `✅ Control number ${action === 'add' ? 'added' : 'removed'}: ${target} (saved to database).`);
  } catch (dbErr) {
    console.error('Error saving WHATSAPP_CONTROL_NUMBERS to DB:', dbErr);
    return reply(from, `⚠️ Updated in memory, but failed to save to DB: ${dbErr.message}`);
  }
}

async function handleHelp(from) {
  const text = [
    `🤖 ClawBot — WhatsApp Command Reference`,
    ``,
    `*Creator Approval:*`,
    `Tap ✅/❌ on the card, or:`,
    `/approve <id> — Approve & send outreach DM`,
    `/reject <id> — Discard creator`,
    ``,
    `*Discovery:*`,
    `/discover — Manually trigger an Instagram scan now`,
    `/stop <hours> — Pause auto-discovery (e.g. /stop 12)`,
    `/startscan — Resume auto-discovery`,
    `/range — Set follower range interactively (asks min, then max)`,
    `/range <min> - <max> — Set the follower range in one line`,
    `/Auto — Auto-approve & cold-DM creators passing the filter`,
    `/Manual — Require your approval before any cold DM (default)`,
    `/StopCategoryFilter — Find any US creator (ignore niche)`,
    `/StartCategoryFilter — Only keep Love/Couple/Relationship creators`,
    `/collab @username — Manually add any creator for outreach`,
    ``,
    `*LinkedIn → Email (free discovery):*`,
    `/approvelead <id> — Send the outreach email`,
    `/rejectlead <id> — Discard lead`,
    `/syncleads — Search LinkedIn for new prospects now`,
    `/EmailAuto — Auto-send outreach email to new leads`,
    `/EmailManual — Require approval before sending (default)`,
    `/leads [location] — Active LinkedIn lead pipeline`,
    ``,
    `*Bot Control:*`,
    `/pause @username — Stop AI replies`,
    `/resume @username — Resume AI replies`,
    `/manual @username — Hand off to you`,
    `/AddNumber <wa_id> — Add a control number`,
    `/RemoveNumber <wa_id> — Remove a control number`,
    `/checkNumbers — List all control numbers`,
    ``,
    `*Info:*`,
    `/status @username — Creator status`,
    `/list [location] [category] — Active pipeline (optionally filtered)`,
    `/settarget <location> <category> — Set discovery target location & category`,
    `/deals — Deal history`,
    `/help — This message`,
  ].join('\n');

  return reply(from, text);
}

/* ─────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────── */
function extractUsername(text) {
  const match = text.match(/[\s@]@?([a-zA-Z0-9._]{1,30})\s*$/);
  return match ? match[1] : null;
}
