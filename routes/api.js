const express = require('express');
const router = express.Router();
const { getUserById } = require('../db/database');

// Middleware: require authenticated session
function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// GET /api/auth/status — check whether the current visitor is logged in
router.get('/auth/status', (req, res) => {
  res.json({
    authenticated: !!req.session.user,
    user: req.session.user || null,
  });
});

// GET /api/user — return full profile of the logged-in user
router.get('/user', requireAuth, async (req, res, next) => {
  try {
    const user = await getUserById(req.session.user.id);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'User no longer exists' });
    }
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
