import { Router } from 'express';
import { 
  addCreator, 
  approveCreator, 
  rejectCreator, 
  setBotState, 
  getCreatorById,
  getConversationHistory 
} from '../services/creatorService.js';
import { all, run } from '../db.js';
import { enqueueDM } from '../queues/dmQueue.js';

const router = Router();

/**
 * POST /api/creators/add
 */
router.post('/add', async (req, res) => {
  const { username, followers, niche, location, bio } = req.body;

  if (!username) {
    return res.status(400).json({ success: false, error: 'username is required' });
  }

  const cleanUsername = username.replace(/^@/, '').trim();

  if (!cleanUsername.match(/^[a-zA-Z0-9._]{1,30}$/)) {
    return res.status(400).json({ success: false, error: 'Invalid Instagram username format' });
  }

  try {
    const creator = await addCreator({
      username: cleanUsername,
      followers: followers ? Number(followers) : null,
      niche: niche?.trim() || null,
      location: location?.trim() || null,
      bio: bio?.trim() || null,
    });

    res.json({ success: true, creator });
  } catch (err) {
    const status = err.message.includes('already exists') ? 409 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/creators
 * List creators with optional state, location, and niche filtering.
 */
router.get('/', async (req, res) => {
  try {
    const { state, location, niche, search } = req.query;
    let query = 'SELECT * FROM creators WHERE 1=1';
    const params = [];

    if (state && state !== 'all') {
      params.push(state);
      query += ` AND state = $${params.length}`;
    }

    if (location) {
      params.push(location);
      query += ` AND LOWER(location) = LOWER($${params.length})`;
    }
    
    if (niche) {
      params.push(niche);
      query += ` AND LOWER(niche) = LOWER($${params.length})`;
    }

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      query += ` AND (LOWER(username) LIKE $${params.length} OR LOWER(niche) LIKE $${params.length} OR LOWER(location) LIKE $${params.length})`;
    }

    query += ' ORDER BY created_at DESC';
    
    const creators = await all(query, params);
    res.json({ success: true, creators });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/creators/:id/approve
 */
router.post('/:id/approve', async (req, res) => {
  const creatorId = Number(req.params.id);
  const { websiteUrl, imageUrl, postLinks } = req.body || {};

  try {
    const creator = await approveCreator(creatorId, { websiteUrl, imageUrl, postLinks });
    res.json({ success: true, creator, message: 'Creator approved and outreach queued!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/creators/:id/reject
 */
router.post('/:id/reject', async (req, res) => {
  const creatorId = Number(req.params.id);

  try {
    await rejectCreator(creatorId);
    res.json({ success: true, message: 'Creator rejected' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/creators/:id/bot-state
 * Update bot_state: 'active' (AI on), 'paused' (AI off), 'manual' (handed off)
 */
router.post('/:id/bot-state', async (req, res) => {
  const creatorId = Number(req.params.id);
  const { botState } = req.body;

  if (!['active', 'paused', 'manual'].includes(botState)) {
    return res.status(400).json({ success: false, error: "botState must be 'active', 'paused', or 'manual'" });
  }

  try {
    const creator = await getCreatorById(creatorId);
    if (!creator) return res.status(404).json({ success: false, error: 'Creator not found' });

    const updated = await setBotState(creator.username, botState);
    res.json({ success: true, creator: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/creators/:id/conversations
 * Get conversation history for a creator
 */
router.get('/:id/conversations', async (req, res) => {
  const creatorId = Number(req.params.id);

  try {
    const rows = await all(
      'SELECT id, creator_id, direction, message, sent_by, created_at FROM conversations WHERE creator_id = $1 ORDER BY created_at ASC',
      [creatorId]
    );

    res.json({ success: true, conversations: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/creators/:id/message
 * Send a manual outgoing DM to a creator via BullMQ queue
 */
router.post('/:id/message', async (req, res) => {
  const creatorId = Number(req.params.id);
  const { message } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, error: 'message content is required' });
  }

  try {
    const creator = await getCreatorById(creatorId);
    if (!creator) return res.status(404).json({ success: false, error: 'Creator not found' });

    // Enqueue manual message
    await enqueueDM('manual_message', {
      creatorId,
      username: creator.username,
      message: message.trim(),
    });

    res.json({ success: true, message: 'Message queued for delivery' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
