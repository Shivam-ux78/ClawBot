import { Router } from 'express';
import { all, get, run } from '../db.js';
import { acceptDeal, rejectDeal } from '../services/dealService.js';

const router = Router();

/**
 * GET /api/deals
 * List all deals with creator info
 */
router.get('/', async (req, res) => {
  try {
    const deals = await all(`
      SELECT 
        d.id,
        d.creator_id,
        d.proposed_price,
        d.status,
        d.created_at,
        d.resolved_at,
        c.username,
        c.followers,
        c.niche,
        c.location
      FROM deals d
      JOIN creators c ON d.creator_id = c.id
      ORDER BY d.created_at DESC
    `);

    res.json({ success: true, deals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/deals/:id/resolve
 * Resolve a deal (approved or rejected)
 */
router.post('/:id/resolve', async (req, res) => {
  const dealId = Number(req.params.id);
  const { action } = req.body; // 'approve' or 'reject'

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, error: "Action must be 'approve' or 'reject'" });
  }

  try {
    let result;
    if (action === 'approve') {
      result = await acceptDeal(dealId);
    } else {
      result = await rejectDeal(dealId);
    }
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
