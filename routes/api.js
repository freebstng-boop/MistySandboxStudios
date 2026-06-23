const express = require('express');
const router = express.Router();
const axios = require('axios');
const {
  getUserById,
  getFeedPosts,
  createFeedPost,
  togglePostLike,
  addPostComment,
} = require('../db/database');

const ROBLOX_GROUP_ID = '7824212';
const ROBLOX_GROUP_URL = `https://www.roblox.com/communities/${ROBLOX_GROUP_ID}`;

async function checkRobloxGroupMembership(robloxUserId) {
  if (!robloxUserId) return false;
  try {
    const response = await axios.get(
      `https://groups.roblox.com/v2/users/${robloxUserId}/groups/roles`,
      { timeout: 10000 }
    );
    const groups = Array.isArray(response.data?.data) ? response.data.data : [];
    return groups.some((entry) => String(entry.group?.id) === ROBLOX_GROUP_ID);
  } catch (err) {
    console.error('Group membership check failed:', err.response?.status || err.message);
    return false;
  }
}

// Middleware: require authenticated session
function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session?.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
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

// GET /api/dashboard-data — user profile + group status + social feed
router.get('/dashboard-data', requireAuth, async (req, res, next) => {
  try {
    const user = await getUserById(req.session.user.id);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'User no longer exists' });
    }

    // Keep session role synchronized with DB role.
    if (req.session.user.role !== user.role) {
      req.session.user.role = user.role;
    }

    const isGroupMember = await checkRobloxGroupMembership(user.roblox_id);
    const posts = await getFeedPosts();

    res.json({
      user,
      isGroupMember,
      groupId: ROBLOX_GROUP_ID,
      groupUrl: ROBLOX_GROUP_URL,
      canPost: user.role === 'admin',
      posts,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/posts — admin-only create post
router.post('/posts', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Post content is required' });
    if (content.length > 1200) return res.status(400).json({ error: 'Post is too long' });

    const user = await getUserById(req.session.user.id);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const post = await createFeedPost({
      author_id: user.id,
      author_username: user.username,
      author_display_name: user.display_name,
      content,
    });

    res.status(201).json({ post });
  } catch (err) {
    next(err);
  }
});

// POST /api/posts/:postId/like — toggle like
router.post('/posts/:postId/like', requireAuth, async (req, res, next) => {
  try {
    const result = await togglePostLike({
      post_id: req.params.postId,
      user_id: req.session.user.id,
    });
    if (!result) return res.status(404).json({ error: 'Post not found' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/posts/:postId/comments — add comment
router.post('/posts/:postId/comments', requireAuth, async (req, res, next) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Comment text is required' });
    if (text.length > 500) return res.status(400).json({ error: 'Comment is too long' });

    const user = await getUserById(req.session.user.id);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const post = await addPostComment({
      post_id: req.params.postId,
      user_id: user.id,
      username: user.username,
      display_name: user.display_name,
      text,
    });

    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.status(201).json({ post });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
