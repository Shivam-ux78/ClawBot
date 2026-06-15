import { run, get, all } from '../db.js';
import { enqueueDM } from '../queues/dmQueue.js';
import { generateDealConfirmation } from '../ai/negotiate.js';

/* ─────────────────────────────────────────────────
   Deal Management (PostgreSQL - Async)
───────────────────────────────────────────────── */

/**
 * Create a pending deal proposal for a creator.
 */
export async function createDeal(creatorId, proposedPrice) {
  // Supersede any existing pending deals
  await run(
    `UPDATE deals SET status = 'superseded', resolved_at = NOW() WHERE creator_id = $1 AND status = 'pending'`,
    [creatorId]
  );

  const { lastInsertRowid: dealId } = await run(
    `INSERT INTO deals (creator_id, proposed_price) VALUES ($1, $2) RETURNING id`,
    [creatorId, proposedPrice]
  );

  // Store quoted price on creator record
  await run(
    `UPDATE creators SET quoted_price = $1, updated_at = NOW() WHERE id = $2`,
    [proposedPrice, creatorId]
  );

  return await get('SELECT * FROM deals WHERE id = $1', [dealId]);
}

/**
 * Accept a deal: send confirmation DM and close the creator.
 */
export async function acceptDeal(dealId) {
  const deal = await get('SELECT * FROM deals WHERE id = $1', [dealId]);
  if (!deal) throw new Error(`Deal #${dealId} not found`);

  const creator = await get('SELECT * FROM creators WHERE id = $1', [deal.creator_id]);
  if (!creator) throw new Error(`Creator for deal #${dealId} not found`);

  // Mark deal accepted
  await run(`UPDATE deals SET status = 'accepted', resolved_at = NOW() WHERE id = $1`, [dealId]);

  // Mark creator as deal_closed
  await run(
    `UPDATE creators SET state = 'deal_closed', bot_state = 'manual', updated_at = NOW() WHERE id = $1`,
    [deal.creator_id]
  );

  // Generate and send confirmation DM
  const confirmationMsg = await generateDealConfirmation(creator.username);
  await enqueueDM('confirm', {
    creatorId: deal.creator_id,
    username: creator.username,
    message: confirmationMsg,
  }, 3000);

  console.log(`[DealService] Deal #${dealId} accepted with @${creator.username} at $${deal.proposed_price}`);
  return { deal, creator, confirmationMsg };
}

/**
 * Reject a deal — send a graceful decline DM.
 */
export async function rejectDeal(dealId) {
  const deal = await get('SELECT * FROM deals WHERE id = $1', [dealId]);
  if (!deal) throw new Error(`Deal #${dealId} not found`);

  const creator = await get('SELECT * FROM creators WHERE id = $1', [deal.creator_id]);

  await run(`UPDATE deals SET status = 'rejected', resolved_at = NOW() WHERE id = $1`, [dealId]);

  await run(
    `UPDATE creators SET state = 'deal_rejected', bot_state = 'manual', updated_at = NOW() WHERE id = $1`,
    [deal.creator_id]
  );

  const declineMsg = `Thanks so much for your interest, ${creator.username}! Unfortunately we can't make the numbers work right now, but we'd love to connect in the future. 🙏`;

  await enqueueDM('decline', {
    creatorId: deal.creator_id,
    username: creator.username,
    message: declineMsg,
  }, 5000);

  console.log(`[DealService] Deal #${dealId} rejected for @${creator.username}`);
  return { deal, creator };
}

/**
 * Get the latest pending deal for a creator.
 */
export async function getPendingDeal(creatorId) {
  return await get(
    `SELECT * FROM deals WHERE creator_id = $1 AND status = 'pending' ORDER BY id DESC LIMIT 1`,
    [creatorId]
  );
}

/**
 * Get all deals (for reporting).
 */
export async function getAllDeals() {
  return await all(`
    SELECT d.*, c.username FROM deals d JOIN creators c ON d.creator_id = c.id
    ORDER BY d.created_at DESC
  `);
}
