import { run, get, all } from '../db.js';
import { enqueueDM } from '../queues/dmQueue.js';
import { bot, sendApprovalCard } from '../telegram/bot.js';
import { config } from '../config.js';
import { getProfileInfo } from '../instagram/client.js';

/* ─────────────────────────────────────────────────
   Creator CRUD (PostgreSQL - Async)
───────────────────────────────────────────────── */

/**
 * Add a new creator and trigger Stage 1 Telegram approval.
 */
export async function addCreator({ username, followers, niche, bio }) {
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
    'INSERT INTO creators (username, followers, niche, bio) VALUES ($1, $2, $3, $4) RETURNING id',
    [username, realFollowers, niche ?? null, realBio]
  );

  const creator = await get('SELECT * FROM creators WHERE id = $1', [creatorId]);

  // Fire Telegram approval card
  sendApprovalCard(creator);

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
    `UPDATE creators SET bot_state = $1, updated_at = NOW() WHERE username = $2`,
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
  const lines = [
    `Hi ${name}! 👋`,
    '',
    `We've been following your content and absolutely love what you create.`,
    '',
  ];

  if (websiteUrl) {
    lines.push(`We run a platform you might enjoy: ${websiteUrl}`);
    lines.push('');
  }

  if (postLinks?.length) {
    lines.push('Here are some examples of our work:');
    postLinks.forEach((link, i) => lines.push(`  ${i + 1}. ${link}`));
    lines.push('');
  }

  if (imageUrl) {
    lines.push(`We also create custom couple products (see attached 📸)`);
    lines.push('');
  }

  lines.push(`Would you be open to a collaboration? We'd love to chat! 🎉`);

  return lines.join('\n');
}
