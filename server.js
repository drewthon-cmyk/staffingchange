require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { initializeDb } = require('./db/schema');
const config = require('./config/config');

const app = express();

// ─── Force HTTPS in production ────────────────────────────────────────────────
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
});

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ─── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/postings', require('./routes/postings'));
app.use('/api/applications', require('./routes/applications'));
app.use('/api/workflow', require('./routes/workflow'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/export', require('./routes/export'));

// ─── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found.' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Error Handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
  }
  if (err.message && err.message.includes('Only PDF')) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
initializeDb();
app.listen(config.port, () => {
  console.log(`\n🏫 Garden City Transfer Center running on port ${config.port}`);
  console.log(`   Local: http://localhost:${config.port}\n`);
});
