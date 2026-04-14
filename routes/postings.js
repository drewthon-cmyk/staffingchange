const express = require('express');
const { getDb } = require('../db/schema');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get all open postings (all authenticated users)
router.get('/', authenticate, (req, res) => {
  const db = getDb();
  const { status, school_id } = req.query;

  let query = `
    SELECT jp.*, s.name as school_name, s.principal_name,
           COUNT(a.id) as applicant_count,
           u.name as created_by_name
    FROM job_postings jp
    JOIN schools s ON jp.school_id = s.id
    LEFT JOIN applications a ON jp.id = a.posting_id AND a.status NOT IN ('position_filled')
    LEFT JOIN users u ON jp.created_by = u.id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    query += ' AND jp.status = ?';
    params.push(status);
  } else if (req.user.role === 'employee') {
    // Employees only see open postings
    query += " AND jp.status = 'open'";
  }

  if (school_id) {
    query += ' AND jp.school_id = ?';
    params.push(school_id);
  }

  query += ' GROUP BY jp.id ORDER BY jp.posted_date DESC';

  const postings = db.prepare(query).all(...params);
  res.json(postings);
});

// Get single posting
router.get('/:id', authenticate, (req, res) => {
  const db = getDb();
  const posting = db.prepare(`
    SELECT jp.*, s.name as school_name, s.principal_name, s.principal_email,
           u.name as created_by_name
    FROM job_postings jp
    JOIN schools s ON jp.school_id = s.id
    LEFT JOIN users u ON jp.created_by = u.id
    WHERE jp.id = ?
  `).get(req.params.id);

  if (!posting) return res.status(404).json({ error: 'Posting not found.' });

  // Include applicants for principals and HR
  if (req.user.role === 'hr_admin' || req.user.role === 'principal') {
    const applicants = db.prepare(`
      SELECT a.*, ws_send.action as sending_decision, ws_recv.action as receiving_decision,
             i.interview_date
      FROM applications a
      LEFT JOIN workflow_steps ws_send ON a.id = ws_send.application_id AND ws_send.step = 'sending_principal'
      LEFT JOIN workflow_steps ws_recv ON a.id = ws_recv.application_id AND ws_recv.step = 'receiving_principal'
      LEFT JOIN interviews i ON a.id = i.application_id
      WHERE a.posting_id = ?
      ORDER BY a.applied_date ASC
    `).all(req.params.id);
    posting.applicants = applicants;
  }

  res.json(posting);
});

// Create posting (HR only)
router.post('/', authenticate, requireRole('hr_admin'), (req, res) => {
  const { title, school_id, fte, job_description_url, close_date, start_date, contact_name, contact_email } = req.body;

  if (!title || !school_id || !fte) {
    return res.status(400).json({ error: 'Title, school, and FTE are required.' });
  }

  const db = getDb();
  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(school_id);
  if (!school) return res.status(404).json({ error: 'School not found.' });

  const toTs = (d) => d ? Math.floor(new Date(d).getTime() / 1000) : null;

  const result = db.prepare(`
    INSERT INTO job_postings (title, school_id, fte, job_description_url, close_date, start_date, contact_name, contact_email, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, school_id, fte, job_description_url || null, toTs(close_date), toTs(start_date), contact_name || null, contact_email || null, req.user.id);

  const posting = db.prepare('SELECT jp.*, s.name as school_name FROM job_postings jp JOIN schools s ON jp.school_id = s.id WHERE jp.id = ?').get(result.lastInsertRowid);
  res.status(201).json(posting);
});

// Update posting (HR only)
router.put('/:id', authenticate, requireRole('hr_admin'), (req, res) => {
  const { title, school_id, fte, job_description_url, status } = req.body;
  const db = getDb();

  const posting = db.prepare('SELECT * FROM job_postings WHERE id = ?').get(req.params.id);
  if (!posting) return res.status(404).json({ error: 'Posting not found.' });

  const toTs = (d) => d ? Math.floor(new Date(d).getTime() / 1000) : null;

  db.prepare(`
    UPDATE job_postings SET title = ?, school_id = ?, fte = ?, job_description_url = ?, status = ?,
      close_date = ?, start_date = ?, contact_name = ?, contact_email = ?
    WHERE id = ?
  `).run(
    title || posting.title,
    school_id || posting.school_id,
    fte || posting.fte,
    job_description_url !== undefined ? job_description_url : posting.job_description_url,
    status || posting.status,
    close_date !== undefined ? toTs(close_date) : posting.close_date,
    start_date !== undefined ? toTs(start_date) : posting.start_date,
    contact_name !== undefined ? contact_name : posting.contact_name,
    contact_email !== undefined ? contact_email : posting.contact_email,
    req.params.id
  );

  const updated = db.prepare('SELECT jp.*, s.name as school_name FROM job_postings jp JOIN schools s ON jp.school_id = s.id WHERE jp.id = ?').get(req.params.id);
  res.json(updated);
});

// Close posting (HR only)
router.delete('/:id', authenticate, requireRole('hr_admin'), (req, res) => {
  const db = getDb();
  db.prepare("UPDATE job_postings SET status = 'closed' WHERE id = ?").run(req.params.id);
  res.json({ message: 'Posting closed.' });
});

module.exports = router;
