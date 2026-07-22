import cron from 'node-cron';
import { discoverLinkedInProfiles } from '../linkedin/discover.js';
import { findEmail } from '../services/emailFinderService.js';
import { addLead, approveLead } from '../services/emailOutreachService.js';
import { notify } from '../telegram/bot.js';
import { config } from '../config.js';

let activeCronTask = null;
let resumeTimer = null;
export let isEmailSyncActive = true;
export let isAutoSequenceActive = false;

export function setAutoSequenceActive(state) {
  isAutoSequenceActive = state;
}

/**
 * Full free pipeline: search LinkedIn for matching profiles, guess+verify an
 * email for each, add as an email_lead, and — in Auto mode — send the
 * outreach email immediately.
 */
export async function runLinkedInDiscovery() {
  if (!isEmailSyncActive) {
    console.log('[LinkedInDiscoveryJob] Skipping run because email discovery is paused.');
    return;
  }

  const mode = isAutoSequenceActive ? 'Auto' : 'Manual (approval required)';
  notify(`📇 *LinkedIn discovery started*... Searching for prospects.\nMode: *${mode}*`);

  let added = 0;
  let skipped = 0;

  try {
    const profiles = await discoverLinkedInProfiles({ onProgress: (msg) => notify(msg) });

    for (const profile of profiles) {
      try {
        const { email, verified, catchAll } = await findEmail({
          fullName: profile.fullName,
          companyName: profile.company,
        });

        if (!email) {
          skipped++;
          console.log(`[LinkedInDiscoveryJob] No email found for ${profile.fullName} @ ${profile.company}`);
          continue;
        }

        const lead = await addLead({
          fullName: profile.fullName,
          email,
          linkedinUrl: profile.linkedinUrl,
          company: profile.company,
          title: profile.title,
          skipApprovalCard: isAutoSequenceActive,
        });
        added++;

        const confidence = verified ? 'verified' : catchAll ? 'unverified (catch-all domain)' : 'best guess';
        console.log(`[LinkedInDiscoveryJob] Added lead ${lead.email} (${confidence})`);

        if (isAutoSequenceActive) {
          await approveLead(lead.id);
          notify(`🚀 *Auto-Sent:* ${lead.email} (${confidence})`);
        }
      } catch (err) {
        skipped++;
        console.log(`[LinkedInDiscoveryJob] Skipped ${profile.fullName}: ${err.message}`);
      }
    }

    notify(`✅ *LinkedIn discovery complete.* Added ${added}, skipped ${skipped} (no email found/duplicates).`);
  } catch (err) {
    console.error('[LinkedInDiscoveryJob] Run failed:', err.message);
    notify(`⚠️ LinkedIn discovery failed: ${err.message}`);
  }
}

export function startLinkedInDiscoveryCron() {
  const intervalHours = config.linkedinSyncIntervalHours ?? 6;
  const cronExpr = `0 */${intervalHours} * * *`;

  console.log(`[LinkedInDiscoveryJob] Cron scheduled: every ${intervalHours} hours`);

  activeCronTask = cron.schedule(cronExpr, () => {
    console.log('[LinkedInDiscoveryJob] Cron triggered — starting discovery run...');
    runLinkedInDiscovery().catch((err) => {
      console.error('[LinkedInDiscoveryJob] Unhandled error in cron run:', err.message);
    });
  });
}

export function stopLinkedInDiscoveryCron(hours = null) {
  isEmailSyncActive = false;
  if (activeCronTask) activeCronTask.stop();
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }

  if (hours) {
    const ms = hours * 60 * 60 * 1000;
    console.log(`[LinkedInDiscoveryJob] Discovery paused for ${hours} hours.`);
    resumeTimer = setTimeout(() => {
      resumeLinkedInDiscoveryCron();
      notify('▶️ *LinkedIn discovery automatically resumed* after scheduled pause.');
    }, ms);
  } else {
    console.log('[LinkedInDiscoveryJob] Discovery paused indefinitely.');
  }
}

export function resumeLinkedInDiscoveryCron() {
  isEmailSyncActive = true;
  if (activeCronTask) activeCronTask.start();
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
  console.log('[LinkedInDiscoveryJob] Discovery resumed.');
}
