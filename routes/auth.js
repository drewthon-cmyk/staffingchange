const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { authenticate } = require('../middleware/auth');
const { sendPasswordReset } = require('../services/email');
const config = require('../config/config');

const router = express.Router();

// Register (first-time password setup from pre-loaded email)
router.post('/register', async (req, res) => {
  const { email, password, name, current_school, current_position } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, name, and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

  if (!user) {
    return res.status(403).json({ error: 'Your email address has not been added to the system. Please contact HR.' });
  }
  if (user.password_hash) {
    return res.status(400).json({ error: 'An account already exists for this email. Please log in.' });
  }

  const hash = await bcrypt.hash(password, 12);
  db.prepare(`
    UPDATE users SET password_hash = ?, name = ?, current_school = ?, current_position = ?
    WHERE email = ?
  `).run(hash, name, current_school || null, current_position || null, email.toLowerCase());

  res.json({ message: 'Account created successfully. You can now log in.' });
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.toLowerCase());

  if (!user || !user.password_hash) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  db.prepare('UPDATE users SET last_login = unixepoch() WHERE id = ?').run(user.id);

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiry }
  );

  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, current_school: user.current_school },
  });
});

// Get current user profile
router.get('/me', authenticate, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, email, name, role, current_school, current_position, created_at, last_login FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json(user);
});

// Update profile
router.put('/me', authenticate, async (req, res) => {
  const { name, current_school, current_position } = req.body;
  const db = getDb();
  db.prepare('UPDATE users SET name = ?, current_school = ?, current_position = ? WHERE id = ?')
    .run(name, current_school, current_position, req.user.id);
  res.json({ message: 'Profile updated.' });
});

// Change password
router.put('/change-password', authenticate, async (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Both current and new password are required.' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const valid = await bcrypt.compare(current_password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

  const hash = await bcrypt.hash(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ message: 'Password updated successfully.' });
});

// Request password reset
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.toLowerCase());

  // Always return success to prevent email enumeration
  if (user && user.password_hash) {
    const token = uuidv4();
    const expires = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(token, expires, user.id);
    const resetUrl = `${config.baseUrl}/reset-password.html?token=${token}`;
    await sendPasswordReset(user.email, user.name, resetUrl);
  }

  res.json({ message: 'If your email is registered, you will receive a reset link shortly.' });
});

// Reset password with token
router.post('/reset-password', async (req, res) => {
  const { token, new_password } = req.body;

  if (!token || !new_password) {
    return res.status(400).json({ error: 'Token and new password are required.' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const user = db.prepare('SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > ?').get(token, now);

  if (!user) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  }

  const hash = await bcrypt.hash(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?').run(hash, user.id);

  res.json({ message: 'Password reset successfully. You can now log in.' });
});

module.exports = router;
