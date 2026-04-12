const express = require('express');
const { getDb } = require('../db/schema');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

function toCSV(rows, fields) {
  if (!rows.length) return fields.join(',') + '\n';
  const escape = v => {
    if (v === null || v === undefined) return '';
    const str = String(v);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };
  const header = fields.join(',');
  const csvRows = rows.map(row => fields.map(f => escape(row[f])).join(','));
  return [header, ...csvRows].join('\n');
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleDateString('en-US');
}

// Export all applications as CSV
router.get('/applications', authenticate, requireRole('hr_admin'), (req, res) => {
  const db = getDb();
  const { status, school_id, from_date, to_date } = req.query;

  let query = `
    SELECT a.id, a.employee_name, a.current_school, a.current_position, a.status,
           a.applied_date, a.resume_drive_url,
           jp.title as position_title, jp.fte,
           s.name as school_name,
           ws_send.action as sending_decision, ws_send.action_date as sending_date, ws_send.actor_name as sending_principal, ws_send.notes as sending_notes,
           ws_recv.action as receiving_decision, ws_recv.action_date as receiving_date, ws_recv.actor_name as receiving_principal, ws_recv.notes as receiving_notes,
           ws_hr.action as hr_decision, ws_hr.action_date as hr_date, ws_hr.actor_name as hr_approver, ws_hr.notes as hr_notes,
           i.interview_date
    FROM applications a
    JOIN job_postings jp ON a.posting_id = jp.id
    JOIN schools s ON jp.school_id = s.id
    LEFT JOIN workflow_steps ws_send ON a.id = ws_send.application_id AND ws_send.step = 'sending_principal'
    LEFT JOIN workflow_steps ws_recv ON a.id = ws_recv.application_id AND ws_recv.step = 'receiving_principal'
    LEFT JOIN workflow_steps ws_hr ON a.id = ws_hr.application_id AND ws_hr.step = 'hr'
    LEFT JOIN interviews i ON a.id = i.application_id
    WHERE 1=1
  `;
  const params = [];

  if (status) { query += ' AND a.status = ?'; params.push(status); }
  if (school_id) { query += ' AND s.id = ?'; params.push(school_id); }
  if (from_date) { query += ' AND a.applied_date >= ?'; params.push(Math.floor(new Date(from_date).getTime() / 1000)); }
  if (to_date) { query += ' AND a.applied_date <= ?'; params.push(Math.floor(new Date(to_date).getTime() / 1000)); }

  query += ' ORDER BY a.applied_date DESC';

  const rows = db.prepare(query).all(...params).map(row => ({
    ...row,
    applied_date: formatDate(row.applied_date),
    sending_date: formatDate(row.sending_date),
    receiving_date: formatDate(row.receiving_date),
    hr_date: formatDate(row.hr_date),
    interview_date: formatDate(row.interview_date),
  }));

  const fields = [
    'id', 'employee_name', 'current_school', 'current_position',
    'position_title', 'school_name', 'fte', 'status',
    'applied_date',
    'sending_principal', 'sending_decision', 'sending_date', 'sending_notes',
    'interview_date',
    'receiving_principal', 'receiving_decision', 'receiving_date', 'receiving_notes',
    'hr_approver', 'hr_decision', 'hr_date', 'hr_notes',
    'resume_drive_url',
  ];

  const csv = toCSV(rows, fields);
  const filename = `transfer-applications-${new Date().toISOString().split('T')[0]}.csv`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// Export job postings
router.get('/postings', authenticate, requireRole('hr_admin'), (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT jp.id, jp.title, s.name as school_name, jp.fte, jp.status,
           jp.posted_date, jp.filled_date, jp.job_description_url,
           u.name as created_by,
           COUNT(a.id) as total_applicants
    FROM job_postings jp
    JOIN schools s ON jp.school_id = s.id
    LEFT JOIN users u ON jp.created_by = u.id
    LEFT JOIN applications a ON jp.id = a.posting_id
    GROUP BY jp.id
    ORDER BY jp.posted_date DESC
  `).all().map(row => ({
    ...row,
    posted_date: formatDate(row.posted_date),
    filled_date: formatDate(row.filled_date),
  }));

  const fields = ['id', 'title', 'school_name', 'fte', 'status', 'posted_date', 'filled_date', 'total_applicants', 'created_by', 'job_description_url'];
  const csv = toCSV(rows, fields);
  const filename = `job-postings-${new Date().toISOString().split('T')[0]}.csv`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

module.exports = router;
