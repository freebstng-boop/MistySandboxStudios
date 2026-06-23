const express = require('express');
const router = express.Router();
const axios = require('axios');
const {
  getUserById,
  getUserByUsername,
  getAllUsers,
  setUserRole,
  getFeedPosts,
  createFeedPost,
  deletePost,
  deleteComment,
  togglePostLike,
  addPostComment,
} = require('../db/database');

const ROBLOX_GROUP_ID = '7824212';
const ROBLOX_GROUP_URL = `https://www.roblox.com/communities/${ROBLOX_GROUP_ID}`;
const DISCORD_WEBHOOK_URL =
  'https://discordapp.com/api/webhooks/1519078577939681511/voW5mHxwYMuohNl21_XvZnVDT77vDOxpCo2tdWHdpbazq1tiK_y5zJnyctH5UK0r_FS0';

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

// Send a post to the Discord webhook
async function sendDiscordWebhook({ content, username, displayName, avatarUrl }) {
  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      content: content,
      username: `Announcement from ${displayName} (@${username})`,
      avatar_url: avatarUrl || undefined,
    }, { timeout: 10000 });
  } catch (err) {
    console.error('Discord webhook failed:', err.response?.data || err.message);
  }
}

// Middleware: require authenticated session
function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Require admin OR owner
function requireAdmin(req, res, next) {
  const role = req.session?.user?.role;
  if (!role || (role !== 'admin' && role !== 'owner')) {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

// Require owner only
function requireOwner(req, res, next) {
  if (!req.session?.user || req.session.user.role !== 'owner') {
    return res.status(403).json({ error: 'Owner only' });
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

// GET /api/profile/:username — public profile data
router.get('/profile/:username', async (req, res, next) => {
  try {
    const user = await getUserByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Return only public-safe fields
    res.json({
      user: {
        username: user.username,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        role: user.role,
        created_at: user.created_at,
        roblox_id: user.roblox_id,
      },
    });
  } catch (err) {
    next(err);
  }
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
      canPost: user.role === 'admin' || user.role === 'owner',
      canManageUsers: user.role === 'admin' || user.role === 'owner',
      posts,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/posts — admin/owner create post + Discord webhook
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

    // Fire-and-forget Discord webhook
    sendDiscordWebhook({
      content,
      username: user.username,
      displayName: user.display_name || user.username,
      avatarUrl: user.avatar_url,
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

// DELETE /api/posts/:postId — admin/owner delete a post
router.delete('/posts/:postId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const deleted = await deletePost(req.params.postId);
    if (!deleted) return res.status(404).json({ error: 'Post not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/posts/:postId/comments/:commentId — admin/owner delete a comment
router.delete('/posts/:postId/comments/:commentId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const post = await deleteComment(req.params.postId, req.params.commentId);
    if (!post) return res.status(404).json({ error: 'Post or comment not found' });
    res.json({ post });
  } catch (err) {
    next(err);
  }
});

// --- User Management (admin/owner only) ---

// GET /api/users — list all registered users
router.get('/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const users = await getAllUsers();
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// POST /api/users/:userId/role — change a user's role
router.post('/users/:userId/role', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const newRole = String(req.body?.role || '').trim();
    if (!['member', 'admin'].includes(newRole)) {
      return res.status(400).json({ error: 'Role must be "member" or "admin"' });
    }

    const target = await getUserById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'User not found' });

    // Owners cannot be demoted by anyone
    if (target.role === 'owner') {
      return res.status(403).json({ error: 'Cannot change the owner\'s role' });
    }

    // Only the owner can promote/demote other admins
    const actor = req.session.user;
    if (target.role === 'admin' && actor.role !== 'owner') {
      return res.status(403).json({ error: 'Only the owner can demote other admins' });
    }

    const updated = await setUserRole(req.params.userId, newRole);
    if (!updated) return res.status(404).json({ error: 'User not found' });

    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
