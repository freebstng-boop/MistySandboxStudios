const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const { createOrUpdateUser } = require('../db/database');

const ROBLOX_AUTH_URL = 'https://apis.roblox.com/oauth/v1/authorize';
const ROBLOX_TOKEN_URL = 'https://apis.roblox.com/oauth/v1/token';
const ROBLOX_USERINFO_URL = 'https://apis.roblox.com/oauth/v1/userinfo';

// --- Initiate Roblox OAuth ---
router.get('/roblox', (req, res) => {
  if (!process.env.ROBLOX_CLIENT_ID) {
    return res.redirect('/login?error=not_configured');
  }

  // Generate cryptographically secure state for CSRF protection
  const state = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: process.env.ROBLOX_CLIENT_ID,
    redirect_uri: `${process.env.BASE_URL}/redirect`,
    response_type: 'code',
    scope: 'openid profile',
    state: state,
  });

  res.redirect(`${ROBLOX_AUTH_URL}?${params.toString()}`);
});

// --- Roblox OAuth Callback ---
router.get('/roblox/callback', async (req, res) => {
  const { code, state, error } = req.query;

  // Handle user denial
  if (error) {
    return res.redirect('/login?error=access_denied');
  }

  // Validate required params
  if (!code || !state) {
    return res.redirect('/login?error=invalid_request');
  }

  // Verify state to prevent CSRF
  if (!req.session.oauthState || state !== req.session.oauthState) {
    return res.redirect('/login?error=invalid_state');
  }

  // Consume the state immediately
  delete req.session.oauthState;

  try {
    // Exchange authorization code for access token
    const tokenResponse = await axios.post(
      ROBLOX_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: process.env.ROBLOX_CLIENT_ID,
        client_secret: process.env.ROBLOX_CLIENT_SECRET,
        redirect_uri: `${process.env.BASE_URL}/redirect`,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      }
    );

    const { access_token } = tokenResponse.data;

    if (!access_token) {
      throw new Error('No access token received');
    }

    // Fetch user profile from Roblox
    const userInfoResponse = await axios.get(ROBLOX_USERINFO_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
      timeout: 10000,
    });

    const robloxUser = userInfoResponse.data;

    // Persist user to database
    const user = await createOrUpdateUser({
      roblox_id: robloxUser.sub,
      username: robloxUser.preferred_username || robloxUser.nickname || 'RobloxUser',
      display_name: robloxUser.name || robloxUser.preferred_username,
      avatar_url: robloxUser.picture || null,
    });

    // Store minimal, safe user info in session
    req.session.user = {
      id: user.id,
      roblox_id: user.roblox_id,
      username: user.username,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      role: user.role,
    };

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Roblox OAuth error:', err.response?.data || err.message);
    res.redirect('/login?error=auth_failed');
  }
});

// --- Logout ---
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

module.exports = router;
