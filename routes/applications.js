const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/schema');
const { authenticate, requireRole } = require('../middleware/auth');
const { uploadResume } = require('../services/drive');
const { notifyApplicationSubmitted } = require('../services/email');
const config = require('../config/config');

const router = express.Router();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted for resumes.'));
    }
  },
});

// Get my applications (employee)
router.get('/my', authenticate, (req, res) => {
  const db = getDb();
  const apps = db.prepare(`
    SELECT a.*, jp.title as posting_title, jp.fte, jp.status as posting_status,
           s.name as school_name,
           ws_send.action as sending_decision, ws_send.notes as sending_notes, ws_send.action_date as sending_date,
           ws_recv.action as receiving_decision, ws_recv.notes as receiving_notes, ws_recv.action_date as receiving_date,
           ws_hr.action as hr_decision, ws_hr.notes as hr_notes, ws_hr.action_date as hr_date,
           i.interview_date
    FROM applications a
    JOIN job_postings jp ON a.posting_id = jp.id
    JOIN schools s ON jp.school_id = s.id
    LEFT JOIN workflow_steps ws_send ON a.id = ws_send.application_id AND ws_send.step = 'sending_principal'
    LEFT JOIN workflow_steps ws_recv ON a.id = ws_recv.application_id AND ws_recv.step = 'receiving_principal'
    LEFT JOIN workflow_steps ws_hr ON a.id = ws_hr.application_id AND ws_hr.step = 'hr'
    LEFT JOIN interviews i ON a.id = i.application_id
    WHERE a.employee_id = ?
    ORDER BY a.applied_date DESC
  `).all(req.user.id);
  res.json(apps);
});

// Get all applications (HR/admin)
router.get('/', authenticate, requireRole('hr_admin', 'principal'), (req, res) => {
  const db = getDb();
  const { status, posting_id, school_id } = req.query;

  let query = `
    SELECT a.*, jp.title as posting_title, jp.fte, s.name as school_name, s.id as school_id,
           s.principal_email as receiving_principal_email,
           ws_send.action as sending_decision, ws_send.notes as sending_notes, ws_send.action_date as sending_date,
           ws_recv.action as receiving_decision, ws_recv.notes as receiving_notes, ws_recv.action_date as receiving_date,
           ws_hr.action as hr_decision, ws_hr.notes as hr_notes, ws_hr.action_date as hr_date,
           i.interview_date,
           u.email as employee_email
    FROM applications a
    JOIN job_postings jp ON a.posting_id = jp.id
    JOIN schools s ON jp.school_id = s.id
    LEFT JOIN workflow_steps ws_send ON a.id = ws_send.application_id AND ws_send.step = 'sending_principal'
    LEFT JOIN workflow_steps ws_recv ON a.id = ws_recv.application_id AND ws_recv.step = 'receiving_principal'
    LEFT JOIN workflow_steps ws_hr ON a.id = ws_hr.application_id AND ws_hr.step = 'hr'
    LEFT JOIN interviews i ON a.id = i.application_id
    LEFT JOIN users u ON a.employee_id = u.id
    WHERE 1=1
  `;
  const params = [];

  // Principals only see applications relevant to their school
  if (req.user.role === 'principal') {
    const db2 = getDb();
    const school = db2.prepare('SELECT * FROM schools WHERE principal_email = ?').get(req.user.email);
    if (school) {
      query += ' AND (s.id = ? OR EXISTS (SELECT 1 FROM schools sc2 WHERE sc2.principal_email = ? AND a.current_school = sc2.name))';
      params.push(school.id, req.user.email);
    }
  }

  if (status) { query += ' AND a.status = ?'; params.push(status); }
  if (posting_id) { query += ' AND a.posting_id = ?'; params.push(posting_id); }
  if (school_id) { query += ' AND s.id = ?'; params.push(school_id); }

  query += ' ORDER BY a.applied_date DESC';
  const apps = db.prepare(query).all(...params);
  res.json(apps);
});

// Get single application
router.get('/:id', authenticate, (req, res) => {
  const db = getDb();
  const app = db.prepare(`
    SELECT a.*, jp.title as posting_title, jp.fte, jp.job_description_url,
           s.name as school_name, s.id as school_id,
           s.principal_name as receiving_principal_name, s.principal_email as receiving_principal_email,
           ws_send.action as sending_decision, ws_send.notes as sending_notes,
           ws_send.action_date as sending_date, ws_send.actor_name as sending_actor,
           ws_recv.action as receiving_decision, ws_recv.notes as receiving_notes,
           ws_recv.action_date as receiving_date, ws_recv.actor_name as receiving_actor,
           ws_hr.action as hr_decision, ws_hr.notes as hr_notes,
           ws_hr.action_date as hr_date, ws_hr.actor_name as hr_actor,
           i.interview_date,
           u.email as employee_email
    FROM applications a
    JOIN job_postings jp ON a.posting_id = jp.id
    JOIN schools s ON jp.school_id = s.id
    LEFT JOIN workflow_steps ws_send ON a.id = ws_send.application_id AND ws_send.step = 'sending_principal'
    LEFT JOIN workflow_steps ws_recv ON a.id = ws_recv.application_id AND ws_recv.step = 'receiving_principal'
    LEFT JOIN workflow_steps ws_hr ON a.id = ws_hr.application_id AND ws_hr.step = 'hr'
    LEFT JOIN interviews i ON a.id = i.application_id
    LEFT JOIN users u ON a.employee_id = u.id
    WHERE a.id = ?
  `).get(req.params.id);

  if (!app) return res.status(404).json({ error: 'Application not found.' });

  // Access control
  if (req.user.role === 'employee' && app.employee_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  res.json(app);
});

// Submit application (employee)
router.post('/', authenticate, requireRole('employee', 'principal'), upload.single('resume'), async (req, res) => {
  const { posting_id, employee_name, current_school, current_position } = req.body;

  if (!posting_id || !employee_name || !current_school || !current_position) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'A PDF resume is required.' });
  }

  const db = getDb();

  // Check posting is open
  const posting = db.prepare('SELECT jp.*, s.name as school_name, s.principal_email, s.principal_name FROM job_postings jp JOIN schools s ON jp.school_id = s.id WHERE jp.id = ?').get(posting_id);
  if (!posting || posting.status !== 'open') {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'This position is no longer accepting applications.' });
  }

  // Check for duplicate application
  const existing = db.prepare('SELECT id FROM applications WHERE posting_id = ? AND employee_id = ? AND status NOT IN (?, ?)').get(posting_id, req.user.id, 'sending_denied', 'receiving_denied');
  if (existing) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'You have already applied for this position.' });
  }

  // Find sending principal
  const sendingSchool = db.prepare('SELECT * FROM schools WHERE name = ?').get(current_school);

  // Upload resume to Drive
  let resumeUrl = null;
  let resumeId = null;
  try {
    const driveResult = await uploadResume(req.file.path, `${employee_name}_Resume.pdf`, employee_name);
    resumeUrl = driveResult.url;
    resumeId = driveResult.id;
  } catch (err) {
    console.error('Drive upload failed:', err.message);
  } finally {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }

  // Insert application
  const result = db.prepare(`
    INSERT INTO applications (posting_id, employee_id, employee_name, current_school, current_position, resume_drive_url, resume_drive_id, resume_filename)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(posting_id, req.user.id, employee_name, current_school, current_position, resumeUrl, resumeId, `${employee_name}_Resume.pdf`);

  const appId = result.lastInsertRowid;

  // Create pending workflow step
  db.prepare(`INSERT INTO workflow_steps (application_id, step, action) VALUES (?, 'sending_principal', 'pending')`).run(appId);

  // Send notifications
  const app = { id: appId, employee_name, current_school, current_position, applied_date: Math.floor(Date.now() / 1000), resume_drive_url: resumeUrl };
  try {
    if (sendingSchool && sendingSchool.principal_email) {
      await notifyApplicationSubmitted(
        { ...app, employee_email: req.user.email },
        posting,
        { name: posting.school_name },
        sendingSchool.principal_email,
        sendingSchool.principal_name || 'Administrator'
      );
    }
  } catch (err) {
    console.error('Email notification failed:', err.message);
  }

  res.status(201).json({ id: appId, message: 'Application submitted successfully.' });
});

module.exports = router;
