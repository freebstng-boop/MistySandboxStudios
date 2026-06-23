/**
 * Database layer — dual mode:
 *   MONGODB_URI set  →  MongoDB Atlas (production)
 *   MONGODB_URI unset →  JSON file store (local development)
 */
const fs   = require('fs');
const path = require('path');

// ── JSON File Store ───────────────────────────────────────

const DB_DIR  = path.join(__dirname);
const DB_PATH = path.join(DB_DIR, 'users.json');

function readStore() {
  try {
    if (!fs.existsSync(DB_PATH)) return { users: [], nextId: 1 };
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { users: [], nextId: 1 };
  }
}
function writeStore(store) {
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2), 'utf8');
}

// ── MongoDB Store ─────────────────────────────────────────

let User = null;

function buildMongoModel() {
  const mongoose = require('mongoose');
  const schema = new mongoose.Schema(
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
  User = mongoose.model('User', schema);
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
    if (!fs.existsSync(DB_PATH)) writeStore({ users: [], nextId: 1 });
    console.log('  JSON file store ready:', DB_PATH);
  }
}

async function createOrUpdateUser({ roblox_id, username, display_name, avatar_url }) {
  if (User) {
    const doc = await User.findOneAndUpdate(
      { roblox_id },
      { username, display_name, avatar_url, last_login: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return { ...doc, id: doc._id.toString() };
  }

  // JSON fallback
  const store = readStore();
  const now   = new Date().toISOString();
  const idx   = store.users.findIndex((u) => u.roblox_id === roblox_id);
  if (idx !== -1) {
    store.users[idx] = { ...store.users[idx], username, display_name, avatar_url, last_login: now };
    writeStore(store);
    return store.users[idx];
  }
  const user = { id: store.nextId++, roblox_id, username, display_name, avatar_url, role: 'member', created_at: now, last_login: now };
  store.users.push(user);
  writeStore(store);
  return user;
}

async function getUserById(id) {
  if (User) {
    const doc = await User.findById(id).lean();
    if (!doc) return null;
    return { ...doc, id: doc._id.toString() };
  }

  // JSON fallback
  const { users } = readStore();
  return users.find((u) => String(u.id) === String(id)) || null;
}

module.exports = { initDatabase, createOrUpdateUser, getUserById };

