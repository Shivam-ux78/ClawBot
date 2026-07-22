import { Router } from 'express';
import { all, run, get } from '../db.js';

const router = Router();

/**
 * GET /api/email-leads
 */
router.get('/', async (req, res) => {
  try {
    const leads = await all('SELECT * FROM email_leads ORDER BY created_at DESC');
    res.json({ success: true, leads });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/email-leads/add
 */
router.post('/add', async (req, res) => {
  const { full_name, email, linkedin_url, company, title, location, niche } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'Valid email is required' });
  }

  try {
    const existing = await get('SELECT * FROM email_leads WHERE email = $1', [email.trim()]);
    if (existing) {
      return res.status(409).json({ success: false, error: 'Lead with this email already exists' });
    }

    const { lastInsertRowid: id } = await run(
      `INSERT INTO email_leads (full_name, email, linkedin_url, company, title, location, niche) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        full_name?.trim() || null,
        email.trim(),
        linkedin_url?.trim() || null,
        company?.trim() || null,
        title?.trim() || null,
        location?.trim() || null,
        niche?.trim() || null,
      ]
    );

    const lead = await get('SELECT * FROM email_leads WHERE id = $1', [id]);
    res.json({ success: true, lead });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
