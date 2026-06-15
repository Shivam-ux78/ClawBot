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
export async function runDiscovery(isRescan = false) {
  const label = isRescan ? '🔄 *Re-scanning*' : '🔍 *Discovery scan started*';
  notify(`${label}... Looking for couple creators with 50k+ followers.`);

  try {
    const creators = await discoverCreators({
      minFollowers: config.minFollowers ?? 50000,
      maxPerRun: config.discoveryMaxPerRun ?? 15,
      onProgress: (msg) => notify(msg),
    });

    if (!creators.length) {
      notify('🔍 Scan complete. No qualifying creators found this run.\n\nTrying a fresh scan in 30 minutes...');
      // Auto-rescan once after 30 minutes if nothing found
      if (!isRescan) {
        setTimeout(() => runDiscovery(true).catch(console.error), 30 * 60 * 1000);
      }
      return;
    }

    let added = 0;
    let skipped = 0;

    for (const { username, followers, bio } of creators) {
      try {
        // Pass bio so it shows in the Telegram approval card
        await addCreator({ username, followers, niche: 'couple', bio });
        added++;
        console.log(`[DiscoveryJob] ✅ Added @${username} (${followers?.toLocaleString()} followers)`);
      } catch (err) {
        skipped++;
        console.log(`[DiscoveryJob] Skipped @${username}: ${err.message}`);
      }
    }

    if (added === 0) {
      notify(`⏭ All ${skipped} creators already in pipeline. Re-scanning in 30 minutes with fresh hashtags...`);
      if (!isRescan) {
        setTimeout(() => runDiscovery(true).catch(console.error), 30 * 60 * 1000);
      }
      return;
    }

    notify(
      `🔍 *Scan complete!*\n\n` +
      `✅ New approval cards sent: *${added}*\n` +
      `⏭ Already in pipeline: *${skipped}*\n\n` +
      `Approve or Reject each card above 👆`
    );

  } catch (err) {
    console.error('[DiscoveryJob] Error:', err.message);
    notify(`⚠️ *Discovery failed:* ${err.message}`);
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
