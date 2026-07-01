import cron from 'node-cron';
import { discoverCreators } from '../instagram/discover.js';
import { addCreator } from '../services/creatorService.js';
import { notify } from '../telegram/bot.js';
import { config } from '../config.js';

let activeCronTask = null;
let resumeTimer = null;
export let isDiscoveryActive = true;
export let isAutoDMActive = false;
export let isCategoryFilterActive = true;

export function setAutoDMActive(state) {
  isAutoDMActive = state;
}

export function setCategoryFilterActive(state) {
  isCategoryFilterActive = state;
}

/**
 * Runs the full discovery pipeline:
 * 1. Scrapes Instagram hashtags for couple creators
 * 2. Filters by follower count
 * 3. Adds new creators to DB (skips duplicates)
 * 4. Sends Telegram notifications for each new creator
 */
export async function runDiscovery(isRescan = false) {
  if (!isDiscoveryActive) {
    console.log('[DiscoveryJob] Skipping run because discovery is paused.');
    return;
  }
  const label = isRescan ? '🔄 *Re-scanning*' : '🔍 *Discovery scan started*';
  const minF = (config.minFollowers ?? 3000).toLocaleString();
  const maxF = (config.maxFollowers ?? 10000).toLocaleString();
  const mode = isAutoDMActive ? 'Auto' : 'Manual (approval required)';
  const catFilter = isCategoryFilterActive ? 'ON' : 'OFF (any US creator)';
  notify(`${label}... Looking for *${config.discoveryCategory || 'couple'}* creators in *${config.discoveryLocation || 'US'}* with ${minF}-${maxF} followers.\nMode: *${mode}* | Category filter: *${catFilter}* | Min confidence: *${config.discoveryMinConfidence ?? 80}%*`);

  let added = 0;
  let skipped = 0;

  try {
    const creators = await discoverCreators({
      minFollowers: config.minFollowers ?? 3000,
      maxFollowers: config.maxFollowers ?? 10000,
      minConfidence: config.discoveryMinConfidence ?? 80,
      categoryFilterEnabled: isCategoryFilterActive,
      maxPerRun: 5, // Limit to 5 per scan as requested
      onProgress: (msg) => notify(msg),
      onCreatorFound: async (creator) => {
        try {
          // Process and send the notification IMMEDIATELY
          const addedCreator = await addCreator({
            username: creator.username,
            followers: creator.followers,
            niche: creator.category || config.discoveryCategory || 'couple',
            location: creator.country || config.discoveryLocation || 'US',
            bio: creator.bio,
            category: creator.category,
            confidence: creator.confidence,
            skipApprovalCard: isAutoDMActive
          });
          added++;
          console.log(`[DiscoveryJob] ✅ Added @${creator.username}`);

          if (isAutoDMActive) {
            console.log(`[DiscoveryJob] Auto DM mode active, auto-approving @${creator.username}`);
            const { approveCreator } = await import('../services/creatorService.js');
            await approveCreator(addedCreator.id, {
              websiteUrl: 'https://makeable.nyc/',
              postLinks: [
                'https://www.instagram.com/makeableofficial/'
              ]
            });
            notify(`🚀 *Auto-Approved & DM Queued:* @${addedCreator.username}`);
          }
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
      `✅ New notifications sent: *${added}*\n` +
      `⏭ Already in pipeline: *${skipped}*`
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

  activeCronTask = cron.schedule(cronExpr, () => {
    console.log('[DiscoveryJob] Cron triggered — starting discovery run...');
    runDiscovery().catch((err) => {
      console.error('[DiscoveryJob] Unhandled error in cron run:', err.message);
    });
  });
}

/**
 * Pauses the discovery cron job.
 * @param {number|null} hours Optional hours to pause for.
 */
export function stopDiscoveryCron(hours = null) {
  isDiscoveryActive = false;
  if (activeCronTask) {
    activeCronTask.stop();
  }
  
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }

  if (hours) {
    const ms = hours * 60 * 60 * 1000;
    console.log(`[DiscoveryJob] Discovery paused for ${hours} hours.`);
    resumeTimer = setTimeout(() => {
      resumeDiscoveryCron();
      notify('▶️ *Discovery scan automatically resumed* after scheduled pause.');
    }, ms);
  } else {
    console.log(`[DiscoveryJob] Discovery paused indefinitely.`);
  }
}

/**
 * Resumes the discovery cron job.
 */
export function resumeDiscoveryCron() {
  isDiscoveryActive = true;
  if (activeCronTask) {
    activeCronTask.start();
  }
  
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
  console.log(`[DiscoveryJob] Discovery resumed.`);
}
