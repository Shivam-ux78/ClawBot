import { run, get, all } from '../db.js';
import { enqueueDM } from '../queues/dmQueue.js';
import { bot, sendApprovalCard } from '../telegram/bot.js';
import { sendApprovalCard as sendWhatsAppApprovalCard } from '../whatsapp/bot.js';
import { config } from '../config.js';
import { getProfileInfo } from '../instagram/client.js';

/* ─────────────────────────────────────────────────
   Creator CRUD (PostgreSQL - Async)
───────────────────────────────────────────────── */

/**
 * Add a new creator and trigger Stage 1 Telegram approval (if not skipped).
 */
export async function addCreator({ username, followers, niche, location, bio, category, confidence, skipApprovalCard = false }) {
  const existing = await get('SELECT * FROM creators WHERE username = $1', [username]);
  if (existing) {
    throw new Error(`Creator @${username} already exists (state: ${existing.state})`);
  }

  let realFollowers = followers ?? null;
  let realBio = bio ?? null;

  // Only fetch from Instagram if we don't already have the follower count
  if (!realFollowers) {
    console.log(`[CreatorService] Fetching real profile info for @${username}...`);
    const profileInfo = await getProfileInfo(username).catch(() => ({ followers: null }));
    realFollowers = profileInfo.followers ?? null;
    console.log(`[CreatorService] @${username} followers: ${realFollowers ?? 'unknown'}`);
  }

  const { lastInsertRowid: creatorId } = await run(
    'INSERT INTO creators (username, followers, niche, location, bio, category, confidence) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [username, realFollowers, niche ?? null, location ?? null, realBio, category ?? null, confidence ?? null]
  );

  const creator = await get('SELECT * FROM creators WHERE id = $1', [creatorId]);

  // Fire Telegram + WhatsApp approval cards (either can approve/reject)
  if (!skipApprovalCard) {
    try {
      sendApprovalCard(creator);
    } catch (err) {
      console.error('[CreatorService] Failed to send Telegram approval card:', err.message);
    }
    try {
      sendWhatsAppApprovalCard(creator);
    } catch (err) {
      console.error('[CreatorService] Failed to send WhatsApp approval card:', err.message);
    }
  }

  return creator;
}

/**
 * Approve a creator: update state and send enriched outreach DM.
 */
export async function approveCreator(creatorId, { websiteUrl, imageUrl, postLinks } = {}) {
  const creator = await get('SELECT * FROM creators WHERE id = $1', [creatorId]);
  if (!creator) throw new Error(`Creator #${creatorId} not found`);

  await run(`UPDATE creators SET state = 'approved', updated_at = NOW() WHERE id = $1`, [creatorId]);

  // Build enriched outreach message
  const message = buildOutreachMessage(creator, { websiteUrl, imageUrl, postLinks });

  // Enqueue with short delay after approval
  await enqueueDM('outreach', {
    creatorId,
    username: creator.username,
    message,
    extras: { imageUrl, postLinks },
  }, 5000);

  // Update state to outreach_sent
  await run(`UPDATE creators SET state = 'outreach_sent', updated_at = NOW() WHERE id = $1`, [creatorId]);

  return creator;
}

/**
 * Reject a creator and mark in DB.
 */
export async function rejectCreator(creatorId) {
  await run(`UPDATE creators SET state = 'rejected', updated_at = NOW() WHERE id = $1`, [creatorId]);
  console.log(`[CreatorService] Creator #${creatorId} rejected.`);
}

/**
 * Get a creator by username.
 */
export async function getCreatorByUsername(username) {
  return await get('SELECT * FROM creators WHERE LOWER(username) = LOWER($1)', [username]);
}

/**
 * Get a creator by ID.
 */
export async function getCreatorById(id) {
  return await get('SELECT * FROM creators WHERE id = $1', [id]);
}

/**
 * Set the bot control state for a creator.
 */
export async function setBotState(username, botState) {
  const result = await run(
    `UPDATE creators SET bot_state = $1, updated_at = NOW() WHERE LOWER(username) = LOWER($2)`,
    [botState, username]
  );
  if (result.changes === 0) throw new Error(`Creator @${username} not found`);
  return await getCreatorByUsername(username);
}

/**
 * Get conversation history for a creator (formatted for OpenAI).
 */
export async function getConversationHistory(creatorId) {
  const rows = await all(
    `SELECT direction, message FROM conversations WHERE creator_id = $1 ORDER BY created_at ASC`,
    [creatorId]
  );

  return rows.map((r) => ({
    role: r.direction === 'out' ? 'assistant' : 'user',
    content: r.message,
  }));
}

/**
 * Log an incoming message from a creator.
 */
export async function logIncomingMessage(creatorId, message) {
  await run(
    `INSERT INTO conversations (creator_id, direction, message, sent_by) VALUES ($1, 'in', $2, 'creator')`,
    [creatorId, message]
  );
}

/* ─────────────────────────────────────────────────
   Message Builder
───────────────────────────────────────────────── */
function buildOutreachMessage(creator, { websiteUrl, imageUrl, postLinks } = {}) {
  const name = creator.username.replace(/_/g, ' ');
  return `Hi ${name}! 👋

We are offering creators a free personalized MakeAble 3D couple gift, created from their photos, memories, or gift idea. The product is ideal for anniversaries, Valentine’s Day, birthdays, weddings, proposals, and relationship milestones. Creators can view the brand here: https://makeable.nyc/

Creators will receive the custom gift at no cost and can create content in their own style. We are especially interested in emotional gift reveals, couple reactions, unboxings, and short reviews showing why the gift feels meaningful and personal.

We can also offer creators a strong affiliate commission of 10–25% or more on sales they generate through their unique link or code, depending on the creator and performance. The goal is to create authentic couple/gifting content that feels thoughtful, romantic, and highly shareable.`;
}
