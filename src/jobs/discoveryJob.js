import cron from 'node-cron';
import { discoverCreators } from '../instagram/discover.js';
import { addCreator } from '../services/creatorService.js';
import { notify } from '../telegram/bot.js';
import { config } from '../config.js';

/**
 * Runs the full discovery pipeline:
 * 1. Scrapes Instagram hashtags for couple creators
 * 2. Filters by follower count
 * 3. Adds new creators to DB (skips duplicates)
 * 4. Sends Telegram approval cards for each new creator
 */
export async function runDiscovery(isRescan = false) {
  const label = isRescan ? '🔄 *Re-scanning*' : '🔍 *Discovery scan started*';
  notify(`${label}... Looking for couple creators with 50k+ followers.`);

  let added = 0;
  let skipped = 0;

  try {
    const creators = await discoverCreators({
      minFollowers: config.minFollowers ?? 50000,
      maxPerRun: 5, // Limit to 5 per scan as requested
      onProgress: (msg) => notify(msg),
      onCreatorFound: async (creator) => {
        try {
          // Process and send the approval card IMMEDIATELY
          await addCreator({ 
            username: creator.username, 
            followers: creator.followers, 
            niche: 'couple', 
            bio: creator.bio 
          });
          added++;
          console.log(`[DiscoveryJob] ✅ Added @${creator.username}`);
        } catch (err) {
          skipped++;
          console.log(`[DiscoveryJob] Skipped @${creator.username}: ${err.message}`);
        }
      }
    });

    if (added === 0 && skipped === 0) {
      notify('🔍 Scan complete. No qualifying creators found.\n\nAuto re-scanning in 30 minutes...');
      if (!isRescan) {
        setTimeout(() => runDiscovery(true).catch(console.error), 30 * 60 * 1000);
      }
      return;
    }

    if (added === 0 && skipped > 0) {
      notify(`⏭ All ${skipped} creators already in pipeline. Auto re-scanning in 30 minutes...`);
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
}

/**
 * Starts the discovery cron job.
 * Default: runs every 6 hours.
 */
export function startDiscoveryCron() {
  const intervalHours = config.discoveryIntervalHours ?? 6;
  const cronExpr = `0 */${intervalHours} * * *`;

  console.log(`[DiscoveryJob] Cron scheduled: every ${intervalHours} hours`);

  cron.schedule(cronExpr, () => {
    console.log('[DiscoveryJob] Cron triggered — starting discovery run...');
    runDiscovery().catch((err) => {
      console.error('[DiscoveryJob] Unhandled error in cron run:', err.message);
    });
  });
}
