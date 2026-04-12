const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { getDb } = require('../db/schema');
const { authenticate, requireRole } = require('../middleware/auth');
const config = require('../config/config');

const router = express.Router();

const csvUpload = multer({ dest: path.join(__dirname, '..', 'uploads') });

// ─── Dashboard Stats ───────────────────────────────────────────────────────────
router.get('/stats', authenticate, requireRole('hr_admin'), (req, res) => {
  const db = getDb();

  const stats = {
    open_postings: db.prepare("SELECT COUNT(*) as c FROM job_postings WHERE status = 'open'").get().c,
    filled_postings: db.prepare("SELECT COUNT(*) as c FROM job_postings WHERE status = 'filled'").get().c,
    total_applications: db.prepare("SELECT COUNT(*) as c FROM applications").get().c,
    pending_sending: db.prepare("SELECT COUNT(*) as c FROM applications WHERE status = 'pending_sending_principal'").get().c,
    pending_interview: db.prepare("SELECT COUNT(*) as c FROM applications WHERE status IN ('pending_interview','interview_scheduled')").get().c,
    pending_receiving: db.prepare("SELECT COUNT(*) as c FROM applications WHERE status = 'pending_receiving_principal'").get().c,
    pending_hr: db.prepare("SELECT COUNT(*) as c FROM applications WHERE status = 'pending_hr'").get().c,
    approved: db.prepare("SELECT COUNT(*) as c FROM applications WHERE status = 'hr_approved'").get().c,
    denied: db.prepare("SELECT COUNT(*) as c FROM applications WHERE status IN ('sending_denied','receiving_denied','hr_denied')").get().c,
    total_users: db.prepare("SELECT COUNT(*) as c FROM users WHERE is_active = 1").get().c,
    total_schools: db.prepare("SELECT COUNT(*) as c FROM schools").get().c,
  };

  res.json(stats);
});

// ─── Principal Stats (for principal dashboard) ─────────────────────────────────
router.get('/principal-stats', authenticate, requireRole('principal'), (req, res) => {
  const db = getDb();
  const school = db.prepare('SELECT * FROM schools WHERE principal_email = ?').get(req.user.email);
  if (!school) return res.json({ pending_sending: 0, pending_receiving: 0 });

  const stats = {
    pending_sending: db.prepare(`
      SELECT COUNT(*) as c FROM applications a
      JOIN schools s ON s.name = a.current_school
      WHERE s.principal_email = ? AND a.status = 'pending_sending_principal'
    `).get(req.user.email).c,
    pending_receiving: db.prepare(`
      SELECT COUNT(*) as c FROM applications a
      JOIN job_postings jp ON a.posting_id = jp.id
      JOIN schools s ON jp.school_id = s.id
      WHERE s.principal_email = ? AND a.status IN ('pending_interview', 'interview_scheduled')
    `).get(req.user.email).c,
    school_name: school.name,
  };

  res.json(stats);
});

// ─── Schools Management ────────────────────────────────────────────────────────
router.get('/schools', authenticate, (req, res) => {
  const db = getDb();
  const schools = db.prepare('SELECT * FROM schools ORDER BY name').all();
  res.json(schools);
});

// Upload principals CSV
// Expected format: name,principal_name,principal_email
router.post('/schools/upload-csv', authenticate, requireRole('hr_admin'), csvUpload.single('csv'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file is required.' });

  let records;
  try {
    const content = fs.readFileSync(req.file.path, 'utf8');
    records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    return res.status(400).json({ error: 'Failed to parse CSV: ' + err.message });
  } finally {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }

  const db = getDb();
  let updated = 0;
  let created = 0;

  for (const row of records) {
    const name = row['name'] || row['Name'] || row['school_name'] || row['School Name'];
    const principalName = row['principal_name'] || row['Principal Name'] || row['principal'];
    const principalEmail = row['principal_email'] || row['Principal Email'] || row['email'];

    if (!name) continue;

    const existing = db.prepare('SELECT * FROM schools WHERE name = ?').get(name);
    if (existing) {
      db.prepare('UPDATE schools SET principal_name = ?, principal_email = ? WHERE id = ?')
        .run(principalName || existing.principal_name, principalEmail || existing.principal_email, existing.id);
      updated++;
    } else {
      db.prepare('INSERT INTO schools (name, principal_name, principal_email) VALUES (?, ?, ?)').run(name, principalName, principalEmail);
      created++;
    }

    // Update user role if email matches
    if (principalEmail) {
      const userExists = db.prepare('SELECT id FROM users WHERE email = ?').get(principalEmail.toLowerCase());
      if (userExists) {
        db.prepare("UPDATE users SET role = 'principal' WHERE email = ?").run(principalEmail.toLowerCase());
      }
    }
  }

  res.json({ message: `CSV processed. ${created} schools created, ${updated} updated.` });
});

// ─── Employee Management ───────────────────────────────────────────────────────
router.get('/employees', authenticate, requireRole('hr_admin'), (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT id, email, name, role, current_school, current_position, is_active, created_at, last_login
    FROM users ORDER BY name ASC
  `).all();
  res.json(users);
});

// Pre-load employee emails
router.post('/employees/bulk-add', authenticate, requireRole('hr_admin'), csvUpload.single('csv'), (req, res) => {
  if (!req.file && !req.body.emails) {
    return res.status(400).json({ error: 'CSV file or email list required.' });
  }

  const db = getDb();
  let emails = [];

  if (req.file) {
    try {
      const content = fs.readFileSync(req.file.path, 'utf8');
      const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
      emails = records.map(r => r['email'] || r['Email'] || r['employee_email']).filter(Boolean);
    } catch (err) {
      return res.status(400).json({ error: 'Failed to parse CSV.' });
    } finally {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
  } else if (req.body.emails) {
    emails = req.body.emails.split(/[\n,]/).map(e => e.trim()).filter(Boolean);
  }

  let added = 0;
  let skipped = 0;

  for (const em of emails) {
    const lower = em.toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(lower);
    if (existing) { skipped++; continue; }

    // Determine role
    let role = 'employee';
    if (config.hrAdminEmails.includes(lower)) role = 'hr_admin';
    else {
      const principal = db.prepare('SELECT id FROM schools WHERE principal_email = ?').get(lower);
      if (principal) role = 'principal';
    }

    db.prepare('INSERT INTO users (email, role) VALUES (?, ?)').run(lower, role);
    added++;
  }

  res.json({ message: `${added} employees added, ${skipped} already exist.` });
});

// Add single employee
router.post('/employees', authenticate, requireRole('hr_admin'), (req, res) => {
  const { email: em, role } = req.body;
  if (!em) return res.status(400).json({ error: 'Email is required.' });

  const db = getDb();
  const lower = em.toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(lower);
  if (existing) return res.status(400).json({ error: 'This email is already in the system.' });

  let assignedRole = role || 'employee';
  if (config.hrAdminEmails.includes(lower)) assignedRole = 'hr_admin';

  db.prepare('INSERT INTO users (email, role) VALUES (?, ?)').run(lower, assignedRole);
  res.status(201).json({ message: 'Employee added. They can now register on the site.' });
});

// Update employee role or status
router.put('/employees/:id', authenticate, requireRole('hr_admin'), (req, res) => {
  const { role, is_active } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  db.prepare('UPDATE users SET role = ?, is_active = ? WHERE id = ?').run(
    role || user.role,
    is_active !== undefined ? (is_active ? 1 : 0) : user.is_active,
    req.params.id
  );
  res.json({ message: 'User updated.' });
});

// ─── Archive / Search ──────────────────────────────────────────────────────────
router.get('/archive', authenticate, requireRole('hr_admin'), (req, res) => {
  const db = getDb();
  const { search, status, school_id, from_date, to_date } = req.query;

  let query = `
    SELECT a.*, jp.title as posting_title, jp.fte, s.name as school_name,
           ws_hr.action as hr_decision, ws_hr.action_date as hr_date,
           i.interview_date
    FROM applications a
    JOIN job_postings jp ON a.posting_id = jp.id
    JOIN schools s ON jp.school_id = s.id
    LEFT JOIN workflow_steps ws_hr ON a.id = ws_hr.application_id AND ws_hr.step = 'hr'
    LEFT JOIN interviews i ON a.id = i.application_id
    WHERE a.status IN ('hr_approved','hr_denied','sending_denied','receiving_denied','position_filled')
  `;
  const params = [];

  if (search) {
    query += ' AND (a.employee_name LIKE ? OR jp.title LIKE ? OR s.name LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (status) { query += ' AND a.status = ?'; params.push(status); }
  if (school_id) { query += ' AND s.id = ?'; params.push(school_id); }
  if (from_date) { query += ' AND a.applied_date >= ?'; params.push(Math.floor(new Date(from_date).getTime() / 1000)); }
  if (to_date) { query += ' AND a.applied_date <= ?'; params.push(Math.floor(new Date(to_date).getTime() / 1000)); }

  query += ' ORDER BY a.applied_date DESC LIMIT 500';

  const results = db.prepare(query).all(...params);
  res.json(results);
});

module.exports = router;
