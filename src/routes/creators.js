import { Router } from 'express';
import { addCreator } from '../services/creatorService.js';
import { all } from '../db.js';

const router = Router();

/**
 * POST /api/creators/add
 */
router.post('/add', async (req, res) => {
  const { username, followers, niche, location } = req.body;

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
    });

    res.json({ success: true, creator });
  } catch (err) {
    const status = err.message.includes('already exists') ? 409 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/creators
 * List all creators with their current state. Optionally filter by location and niche.
 */
router.get('/', async (req, res) => {
  try {
    const { location, niche } = req.query;
    let query = 'SELECT * FROM creators WHERE 1=1';
    const params = [];

    if (location) {
      params.push(location);
      query += ` AND LOWER(location) = LOWER($${params.length})`;
    }
    
    if (niche) {
      params.push(niche);
      query += ` AND LOWER(niche) = LOWER($${params.length})`;
    }

    query += ' ORDER BY created_at DESC';
    
    const creators = await all(query, params);
    res.json({ success: true, creators });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
