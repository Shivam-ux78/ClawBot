import cron from 'node-cron';
import { discoverCreators } from '../instagram/discover.js';
import { addCreator } from '../services/creatorService.js';
import { notify } from '../telegram/bot.js';
import { config } from '../config.js';

/**
 * Runs the full discovery pipeline:
 * 1. Scrapes Instagram hashtags for couple creators
 * 2. Filters by follower count & bio keywords
 * 3. Adds new creators to DB (skips duplicates)
 * 4. Sends Telegram approval cards for each new creator
 */
export async function runDiscovery() {
  notify('🔍 *Discovery scan started...* Looking for couple creators with 50k+ followers.');

  try {
    const creators = await discoverCreators({
      minFollowers: config.minFollowers ?? 50000,
      maxPerRun: config.discoveryMaxPerRun ?? 15,
      onProgress: (msg) => {
        notify(msg);
      },
    });

    if (!creators.length) {
      notify('🔍 Discovery scan complete. No new qualifying creators found this run.');
      return;
    }

    let added = 0;
    let skipped = 0;

    for (const { username, followers, bio } of creators) {
      try {
        // addCreator already sends the Telegram approval card
        await addCreator({ username, followers, niche: 'couple' });
        added++;
        console.log(`[DiscoveryJob] ✅ Added @${username} (${followers.toLocaleString()} followers)`);
      } catch (err) {
        // Creator already exists or some other error
        skipped++;
        console.log(`[DiscoveryJob] Skipped @${username}: ${err.message}`);
      }
    }

    notify(
      `🔍 *Discovery scan complete!*\n\n` +
      `✅ New creators found: *${added}*\n` +
      `⏭ Already in pipeline: *${skipped}*\n\n` +
      `Check the approval cards above to approve or reject each one.`
    );

  } catch (err) {
    console.error('[DiscoveryJob] Error during scan:', err.message);
    notify(`⚠️ *Discovery scan failed:* ${err.message}`);
  }
}

/**
 * Starts the discovery cron job.
 * Default: runs every 6 hours.
 */
export function startDiscoveryCron() {
  const intervalHours = config.discoveryIntervalHours ?? 6;
  const cronExpr = `0 */${intervalHours} * * *`; // Every N hours

  console.log(`[DiscoveryJob] Cron scheduled: every ${intervalHours} hours`);

  cron.schedule(cronExpr, () => {
    console.log('[DiscoveryJob] Cron triggered — starting discovery run...');
    runDiscovery().catch((err) => {
      console.error('[DiscoveryJob] Unhandled error in cron run:', err.message);
    });
  });
}
