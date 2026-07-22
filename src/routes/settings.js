import { Router } from 'express';
import { all, run, get } from '../db.js';
import { config } from '../config.js';

const router = Router();

/**
 * GET /api/settings
 */
router.get('/', async (req, res) => {
  try {
    const rows = await all('SELECT key, value, updated_at FROM settings');
    const dbSettings = {};
    rows.forEach((r) => {
      try {
        dbSettings[r.key] = JSON.parse(r.value);
      } catch {
        dbSettings[r.key] = r.value;
      }
    });

    const autoDmVal = dbSettings.AUTO_DM_MODE;
    const isAutoDM = autoDmVal !== undefined ? (autoDmVal === true || autoDmVal === 'true') : false;
    if (dbSettings.AUTO_DM_MIN_CONFIDENCE !== undefined) {
      config.autoDmMinConfidence = Number(dbSettings.AUTO_DM_MIN_CONFIDENCE) || 50;
    }

    res.json({
      success: true,
      config: {
        minFollowers: config.minFollowers,
        maxFollowers: config.maxFollowers,
        discoveryLocation: config.discoveryLocation,
        discoveryCategory: config.discoveryCategory,
        dmDailyLimit: config.dmDailyLimit,
        emailDailyLimit: config.emailDailyLimit,
        telegramChatIds: config.telegramChatIds,
        whatsappControlNumbers: config.whatsappControlNumbers,
        minBudget: config.minBudget,
        targetBudget: config.targetBudget,
        maxBudget: config.maxBudget,
        instagramStubMode: config.instagramStubMode,
        autoDmMode: isAutoDM,
        autoDmMinConfidence: config.autoDmMinConfidence ?? 50,
      },
      dbSettings,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/settings
 * Save dynamic settings to database & update runtime config
 */
router.post('/', async (req, res) => {
  const { minFollowers, maxFollowers, discoveryLocation, discoveryCategory, dmDailyLimit, emailDailyLimit, telegramChatIds, autoDmMode, autoDmMinConfidence } = req.body;

  try {
    if (minFollowers !== undefined || maxFollowers !== undefined) {
      const min = Number(minFollowers) || config.minFollowers;
      const max = Number(maxFollowers) || config.maxFollowers;
      config.minFollowers = min;
      config.maxFollowers = max;
      await run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('FOLLOWER_RANGE', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify({ min, max })]
      );
    }

    if (discoveryLocation !== undefined) {
      config.discoveryLocation = discoveryLocation.trim();
      await run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('DISCOVERY_LOCATION', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [config.discoveryLocation]
      );
    }

    if (discoveryCategory !== undefined) {
      config.discoveryCategory = discoveryCategory.trim();
      await run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('DISCOVERY_CATEGORY', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [config.discoveryCategory]
      );
    }

    if (dmDailyLimit !== undefined) {
      config.dmDailyLimit = Number(dmDailyLimit) || config.dmDailyLimit;
      await run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('DM_DAILY_LIMIT', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [String(config.dmDailyLimit)]
      );
    }

    if (emailDailyLimit !== undefined) {
      config.emailDailyLimit = Number(emailDailyLimit) || config.emailDailyLimit;
      await run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('EMAIL_DAILY_LIMIT', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [String(config.emailDailyLimit)]
      );
    }

    if (autoDmMode !== undefined) {
      const isAuto = Boolean(autoDmMode);
      try {
        const { setAutoDMActive } = await import('../jobs/discoveryJob.js');
        setAutoDMActive(isAuto);
      } catch (e) {
        console.warn('Could not update discoveryJob isAutoDMActive:', e.message);
      }
      await run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('AUTO_DM_MODE', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(isAuto)]
      );
    }

    if (autoDmMinConfidence !== undefined) {
      const val = Math.max(0, Math.min(100, Number(autoDmMinConfidence) || 0));
      config.autoDmMinConfidence = val;
      await run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('AUTO_DM_MIN_CONFIDENCE', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [String(val)]
      );
    }

    if (telegramChatIds !== undefined) {
      const chatIdsArr = Array.isArray(telegramChatIds) 
        ? telegramChatIds 
        : String(telegramChatIds).split(',').map((s) => s.trim()).filter(Boolean);
      config.telegramChatIds = chatIdsArr;
      await run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('TELEGRAM_CHAT_IDS', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(chatIdsArr)]
      );
    }

    res.json({ success: true, message: 'Settings updated successfully', config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
