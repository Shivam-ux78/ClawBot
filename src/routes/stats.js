import { Router } from 'express';
import { get, all } from '../db.js';
import { config } from '../config.js';

const router = Router();

/**
 * GET /api/stats
 * Aggregated statistics and system status overview
 */
router.get('/', async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    // 1. Creator Counts by State
    const creatorStateRows = await all(
      'SELECT state, COUNT(*) as count FROM creators GROUP BY state'
    );
    const creatorStates = {
      pending: 0,
      approved: 0,
      outreach_sent: 0,
      replied: 0,
      negotiating: 0,
      deal_closed: 0,
      rejected: 0,
    };
    let totalCreators = 0;
    creatorStateRows.forEach((r) => {
      if (creatorStates[r.state] !== undefined) {
        creatorStates[r.state] = Number(r.count);
      }
      totalCreators += Number(r.count);
    });

    // 2. Today's DM Sent Count
    const dmLogResult = await get(
      'SELECT COUNT(*) as count FROM dm_log WHERE sent_at >= $1',
      [todayIso]
    );
    const dmsSentToday = Number(dmLogResult?.count || 0);

    // 3. Today's Email Sent Count
    const emailLogResult = await get(
      'SELECT COUNT(*) as count FROM email_send_log WHERE sent_at >= $1',
      [todayIso]
    );
    const emailsSentToday = Number(emailLogResult?.count || 0);

    // 4. Deals Stats
    const dealStatsResult = await get(`
      SELECT 
        COUNT(*) as total_deals,
        COUNT(*) FILTER (WHERE status = 'approved') as closed_deals,
        COALESCE(SUM(proposed_price) FILTER (WHERE status = 'approved'), 0) as total_deal_value
      FROM deals
    `);

    // 5. Email Leads Stats
    const emailLeadsResult = await get('SELECT COUNT(*) as total FROM email_leads');

    // 6. Redis IG Cookies Status
    const igCookiesPath = 'www.instagram.com.cookies.json';

    res.json({
      success: true,
      stats: {
        totalCreators,
        creatorStates,
        dmsSentToday,
        dmDailyLimit: config.dmDailyLimit,
        emailsSentToday,
        emailDailyLimit: config.emailDailyLimit,
        totalDeals: Number(dealStatsResult?.total_deals || 0),
        closedDeals: Number(dealStatsResult?.closed_deals || 0),
        totalDealValue: Number(dealStatsResult?.total_deal_value || 0),
        totalEmailLeads: Number(emailLeadsResult?.total || 0),
      },
      system: {
        port: config.port,
        instagramStubMode: config.instagramStubMode,
        telegramBotActive: true,
        followerRange: { min: config.minFollowers, max: config.maxFollowers },
        discoveryLocation: config.discoveryLocation,
        discoveryCategory: config.discoveryCategory,
        discoveryIntervalHours: config.discoveryIntervalHours,
        budgetRange: { min: config.minBudget, target: config.targetBudget, max: config.maxBudget },
      },
    });
  } catch (err) {
    console.error('[Stats API] Error fetching stats:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
