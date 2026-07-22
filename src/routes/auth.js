import { Router } from 'express';
import crypto from 'crypto';

const router = Router();

// Active auth tokens stored in memory
const activeTokens = new Set(['clawbot_master_token_2026']);

const DASHBOARD_USER = process.env.DASHBOARD_USER || 'admin';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'Admin123@';

/**
 * POST /api/auth/login
 */
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required' });
  }

  if (username.trim() === DASHBOARD_USER && password.trim() === DASHBOARD_PASSWORD) {
    const token = 'cb_token_' + crypto.randomBytes(16).toString('hex');
    activeTokens.add(token);

    return res.json({
      success: true,
      token,
      user: { username: DASHBOARD_USER },
      message: 'Login successful',
    });
  }

  return res.status(401).json({ success: false, error: 'Invalid username or password' });
});

/**
 * GET /api/auth/check
 */
router.get('/check', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader ? authHeader.replace('Bearer ', '').trim() : (req.query.token || '');

  if (activeTokens.has(token)) {
    return res.json({ success: true, authenticated: true });
  }

  return res.json({ success: true, authenticated: false });
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader ? authHeader.replace('Bearer ', '').trim() : '';

  if (token) {
    activeTokens.delete(token);
  }

  return res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
