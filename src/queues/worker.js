import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config.js';
import { initDb, run, get } from '../db.js';
import { sendDM } from '../instagram/client.js';
import { initBot } from '../telegram/bot.js';

// Initialize the Telegram bot in "Send Only" mode (no polling) 
// so the worker can send notifications without causing 409 Conflicts.
initBot({ polling: false });


const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

// Ensure DB is ready before processing jobs
await initDb();

const worker = new Worker(
  'dm-queue',
  async (job) => {
    const { creatorId, username, message, extras = {} } = job.data;

    console.log(`[Worker] Processing job #${job.id} (${job.name}) → @${username}`);

    // ── Rate limit guard ─────────────────────────────────────────
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const rows = await get(
      `SELECT COUNT(*) as count FROM dm_log WHERE sent_at >= $1`,
      [todayStart.toISOString()]
    );
    const count = rows?.count ?? 0;

    if (count >= config.dmDailyLimit) {
      console.warn(`[Worker] Daily DM limit (${config.dmDailyLimit}) reached. Skipping job #${job.id}.`);
      return { skipped: true, reason: 'daily_limit' };
    }

    // ── Send the DM ──────────────────────────────────────────────
    const result = await sendDM(username, message, extras);

    if (!result.success) {
      throw new Error(`DM send failed for @${username}`);
    }

    // ── Log to DB ────────────────────────────────────────────────
    await run(`INSERT INTO dm_log (creator_id) VALUES ($1)`, [creatorId]);
    await run(
      `INSERT INTO conversations (creator_id, direction, message, sent_by) VALUES ($1, 'out', $2, $3)`,
      [creatorId, message, job.name === 'outreach' ? 'bot' : 'ai']
    );

    console.log(`[Worker] ✓ DM sent to @${username} (job #${job.id}) | messageId: ${result.messageId}`);
    return { success: true, messageId: result.messageId };
  },
  {
    connection,
    concurrency: 1,
  }
);

worker.on('completed', (job, result) => {
  if (result?.skipped) {
    console.log(`[Worker] Job #${job.id} skipped: ${result.reason}`);
  } else {
    console.log(`[Worker] Job #${job.id} completed ✓`);
  }
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job #${job?.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('[Worker] Worker error:', err);
});

console.log('[Worker] DM worker started and listening...');

export default worker;
