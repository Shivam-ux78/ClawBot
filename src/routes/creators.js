import { Router } from 'express';
import { addCreator } from '../services/creatorService.js';
import { all } from '../db.js';

const router = Router();

/**
 * POST /api/creators/add
 */
router.post('/add', async (req, res) => {
  const { username, followers, niche } = req.body;

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
    });

    res.json({ success: true, creator });
  } catch (err) {
    const status = err.message.includes('already exists') ? 409 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/creators
 * List all creators with their current state.
 */
router.get('/', async (req, res) => {
  try {
    const creators = await all('SELECT * FROM creators ORDER BY created_at DESC');
    res.json({ success: true, creators });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
