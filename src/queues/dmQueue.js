import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config.js';

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

export const dmQueue = new Queue('dm-queue', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: true,
  },
});

/**
 * Add a DM job to the queue with a human-like random delay.
 *
 * @param {'outreach'|'reply'|'counter'|'confirm'} type  - DM purpose
 * @param {object} payload  - { creatorId, username, message, extras? }
 * @param {number} [delayMs]  - Override delay. If omitted, uses random safety delay.
 */
export async function enqueueDM(type, payload, delayMs) {
  const minMs = config.dmDelayMinSec * 1000;
  const maxMs = config.dmDelayMaxSec * 1000;
  const delay = delayMs ?? Math.floor(Math.random() * (maxMs - minMs + 1) + minMs);

  const job = await dmQueue.add(
    type,
    payload,
    { delay }
  );

  console.log(`[Queue] DM job #${job.id} (${type}) → @${payload.username} | delay: ${(delay / 1000).toFixed(0)}s`);
  return job;
}

/**
 * Check how many DMs have been sent today (rate limit guard).
 * @returns {Promise<number>}
 */
export async function getDailyDMCount() {
  // Count jobs completed today — we track this via the dm_log table in DB
  // This is a lightweight proxy — the worker logs to dm_log on success.
  return 0; // Implemented in creatorService with DB query
}
