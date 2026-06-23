/**
 * Database layer — dual mode:
 *   MONGODB_URI set  →  MongoDB Atlas (production)
 *   MONGODB_URI unset →  JSON file store (local development)
 */
const crypto = require('crypto');
const fs   = require('fs');
const path = require('path');

// ── JSON File Store ───────────────────────────────────────

const DB_DIR  = path.join(__dirname);
const DB_PATH = path.join(DB_DIR, 'users.json');
const ADMIN_USERNAMES = new Set(['buckoalpine']);

function defaultStore() {
  return {
    users: [],
    posts: [],
    nextId: 1,
    nextPostId: 1,
    nextCommentId: 1,
  };
}

function normalizeStore(store) {
  const safe = store && typeof store === 'object' ? store : {};
  return {
    users: Array.isArray(safe.users) ? safe.users : [],
    posts: Array.isArray(safe.posts) ? safe.posts : [],
    nextId: Number.isInteger(safe.nextId) ? safe.nextId : 1,
    nextPostId: Number.isInteger(safe.nextPostId) ? safe.nextPostId : 1,
    nextCommentId: Number.isInteger(safe.nextCommentId) ? safe.nextCommentId : 1,
  };
}

function isAdminUsername(username) {
  return ADMIN_USERNAMES.has(String(username || '').toLowerCase());
}

function readStore() {
  try {
    if (!fs.existsSync(DB_PATH)) return defaultStore();
    return normalizeStore(JSON.parse(fs.readFileSync(DB_PATH, 'utf8')));
  } catch {
    return defaultStore();
  }
}
function writeStore(store) {
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2), 'utf8');
}

// ── MongoDB Store ─────────────────────────────────────────

let User = null;
let Post = null;

function buildMongoModel() {
  const mongoose = require('mongoose');
  const userSchema = new mongoose.Schema(
    {
      roblox_id:    { type: String, unique: true, required: true },
      username:     { type: String, required: true },
      display_name: String,
      avatar_url:   String,
      role:         { type: String, default: 'member' },
      last_login:   { type: Date,   default: Date.now },
    },
    { timestamps: { createdAt: 'created_at', updatedAt: false } }
  );
  const commentSchema = new mongoose.Schema(
    {
      comment_id:    { type: String, required: true },
      user_id:       { type: String, required: true },
      username:      { type: String, required: true },
      display_name:  { type: String },
      text:          { type: String, required: true },
      created_at:    { type: Date, default: Date.now },
    },
    { _id: false }
  );
  const postSchema = new mongoose.Schema(
    {
      author_id:           { type: String, required: true },
      author_username:     { type: String, required: true },
      author_display_name: { type: String },
      content:             { type: String, required: true },
      likes:               { type: [String], default: [] },
      comments:            { type: [commentSchema], default: [] },
      created_at:          { type: Date, default: Date.now },
    },
    { versionKey: false }
  );

  User = mongoose.models.User || mongoose.model('User', userSchema);
  Post = mongoose.models.Post || mongoose.model('Post', postSchema);
}

function mapMongoUser(doc) {
  if (!doc) return null;
  return {
    ...doc,
    id: String(doc._id),
  };
}

function mapMongoPost(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    author_id: doc.author_id,
    author_username: doc.author_username,
    author_display_name: doc.author_display_name,
    content: doc.content,
    likes: Array.isArray(doc.likes) ? doc.likes : [],
    comments: Array.isArray(doc.comments)
      ? doc.comments.map((c) => ({
          id: c.comment_id,
          user_id: c.user_id,
          username: c.username,
          display_name: c.display_name,
          text: c.text,
          created_at: c.created_at,
        }))
      : [],
    created_at: doc.created_at,
  };
}

// ── Public API ────────────────────────────────────────────

async function initDatabase() {
  if (process.env.MONGODB_URI) {
    const mongoose = require('mongoose');
    buildMongoModel();
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('  MongoDB connected:', mongoose.connection.host);
  } else {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    if (!fs.existsSync(DB_PATH)) writeStore(defaultStore());
    else writeStore(readStore());
    console.log('  JSON file store ready:', DB_PATH);
  }
}

async function createOrUpdateUser({ roblox_id, username, display_name, avatar_url }) {
  if (User) {
    const existing = await User.findOne({ roblox_id }).lean();
    const role = isAdminUsername(username)
      ? 'admin'
      : existing?.role || 'member';

    const doc = await User.findOneAndUpdate(
      { roblox_id },
      { username, display_name, avatar_url, role, last_login: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return mapMongoUser(doc);
  }

  // JSON fallback
  const store = readStore();
  const now   = new Date().toISOString();
  const idx   = store.users.findIndex((u) => u.roblox_id === roblox_id);
  if (idx !== -1) {
    const existingRole = store.users[idx].role || 'member';
    store.users[idx] = {
      ...store.users[idx],
      username,
      display_name,
      avatar_url,
      role: isAdminUsername(username) ? 'admin' : existingRole,
      last_login: now,
    };
    writeStore(store);
    return store.users[idx];
  }
  const user = {
    id: store.nextId++,
    roblox_id,
    username,
    display_name,
    avatar_url,
    role: isAdminUsername(username) ? 'admin' : 'member',
    created_at: now,
    last_login: now,
  };
  store.users.push(user);
  writeStore(store);
  return user;
}

async function getUserById(id) {
  if (User) {
    const doc = await User.findById(id).lean();
    return mapMongoUser(doc);
  }

  // JSON fallback
  const { users } = readStore();
  return users.find((u) => String(u.id) === String(id)) || null;
}

async function getFeedPosts() {
  if (Post) {
    const posts = await Post.find({}).sort({ created_at: -1 }).limit(100).lean();
    return posts.map(mapMongoPost);
  }

  const { posts } = readStore();
  return [...posts].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function createFeedPost({ author_id, author_username, author_display_name, content }) {
  const trimmed = String(content || '').trim();
  if (!trimmed) return null;

  if (Post) {
    const doc = await Post.create({
      author_id: String(author_id),
      author_username,
      author_display_name,
      content: trimmed,
      likes: [],
      comments: [],
      created_at: new Date(),
    });
    return mapMongoPost(doc.toObject());
  }

  const store = readStore();
  const post = {
    id: String(store.nextPostId++),
    author_id: String(author_id),
    author_username,
    author_display_name,
    content: trimmed,
    likes: [],
    comments: [],
    created_at: new Date().toISOString(),
  };
  store.posts.push(post);
  writeStore(store);
  return post;
}

async function togglePostLike({ post_id, user_id }) {
  const uid = String(user_id);

  if (Post) {
    const doc = await Post.findById(post_id);
    if (!doc) return null;
    const likes = Array.isArray(doc.likes) ? doc.likes : [];
    const hasLiked = likes.includes(uid);
    doc.likes = hasLiked ? likes.filter((x) => x !== uid) : [...likes, uid];
    await doc.save();
    return { post: mapMongoPost(doc.toObject()), liked: !hasLiked };
  }

  const store = readStore();
  const idx = store.posts.findIndex((p) => String(p.id) === String(post_id));
  if (idx === -1) return null;
  const likes = Array.isArray(store.posts[idx].likes) ? store.posts[idx].likes : [];
  const hasLiked = likes.includes(uid);
  store.posts[idx].likes = hasLiked ? likes.filter((x) => x !== uid) : [...likes, uid];
  writeStore(store);
  return { post: store.posts[idx], liked: !hasLiked };
}

async function addPostComment({ post_id, user_id, username, display_name, text }) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  if (Post) {
    const doc = await Post.findById(post_id);
    if (!doc) return null;
    const comment = {
      comment_id: crypto.randomUUID(),
      user_id: String(user_id),
      username,
      display_name,
      text: trimmed,
      created_at: new Date(),
    };
    doc.comments = Array.isArray(doc.comments) ? [...doc.comments, comment] : [comment];
    await doc.save();
    return mapMongoPost(doc.toObject());
  }

  const store = readStore();
  const idx = store.posts.findIndex((p) => String(p.id) === String(post_id));
  if (idx === -1) return null;
  const comment = {
    id: String(store.nextCommentId++),
    user_id: String(user_id),
    username,
    display_name,
    text: trimmed,
    created_at: new Date().toISOString(),
  };
  if (!Array.isArray(store.posts[idx].comments)) store.posts[idx].comments = [];
  store.posts[idx].comments.push(comment);
  writeStore(store);
  return store.posts[idx];
}

module.exports = {
  initDatabase,
  createOrUpdateUser,
  getUserById,
  getFeedPosts,
  createFeedPost,
  togglePostLike,
  addPostComment,
};

