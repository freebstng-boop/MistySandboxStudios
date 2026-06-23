require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const { initDatabase } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: [
          "'self'",
          'data:',
          'https://tr.rbxcdn.com',
          'https://thumbnails.roblox.com',
          'https://rbxcdn.com',
          'https://*.rbxcdn.com',
        ],
        connectSrc: ["'self'"],
      },
    },
  })
);

app.use(
  cors({
    origin: process.env.BASE_URL || 'http://localhost:3000',
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
const sessionOptions = {
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
};

if (process.env.MONGODB_URI) {
  const MongoStore = require('connect-mongo');
  sessionOptions.store = MongoStore.create({ mongoUrl: process.env.MONGODB_URI });
}

app.use(session(sessionOptions));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/cdn', express.static(path.join(__dirname, 'cdn')));

// Routes
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

// Roblox OAuth redirect endpoint (matches the URI registered in Roblox Creator Hub)
app.get('/redirect', (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  res.redirect(`/auth/roblox/callback?${qs}`);
});

// Serve specific HTML pages
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/tos', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tos.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start
async function start() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`\n  ╔══════════════════════════════════╗`);
    console.log(`  ║   Misty Sandbox Studios Server   ║`);
    console.log(`  ╚══════════════════════════════════╝`);
    console.log(`\n  Running at: http://localhost:${PORT}\n`);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
