const express = require('express');
const { getDb } = require('../db/schema');
const { authenticate, requireRole } = require('../middleware/auth');
const email = require('../services/email');
const config = require('../config/config');

const router = express.Router();

function getFullApplication(db, appId) {
  return db.prepare(`
    SELECT a.*, jp.title as posting_title, jp.fte, jp.school_id,
           s.name as school_name, s.principal_email as receiving_principal_email, s.principal_name as receiving_principal_name,
           u.email as employee_email,
           i.interview_date,
           ws_send.action as sending_decision,
           ws_recv.action as receiving_decision
    FROM applications a
    JOIN job_postings jp ON a.posting_id = jp.id
    JOIN schools s ON jp.school_id = s.id
    LEFT JOIN users u ON a.employee_id = u.id
    LEFT JOIN interviews i ON a.id = i.application_id
    LEFT JOIN workflow_steps ws_send ON a.id = ws_send.application_id AND ws_send.step = 'sending_principal'
    LEFT JOIN workflow_steps ws_recv ON a.id = ws_recv.application_id AND ws_recv.step = 'receiving_principal'
    WHERE a.id = ?
  `).get(appId);
}

// ─── Sending Principal: Approve or Deny ────────────────────────────────────────
router.post('/:id/sending-decision', authenticate, requireRole('principal', 'hr_admin'), async (req, res) => {
  const { approved, notes } = req.body;
  const db = getDb();
  const app = getFullApplication(db, req.params.id);

  if (!app) return res.status(404).json({ error: 'Application not found.' });
  if (app.status !== 'pending_sending_principal') {
    return res.status(400).json({ error: 'This application is not awaiting sending principal approval.' });
  }

  // Verify this user is the sending principal for the applicant's school
  if (req.user.role === 'principal') {
    const sendingSchool = db.prepare('SELECT * FROM schools WHERE name = ?').get(app.current_school);
    if (!sendingSchool || sendingSchool.principal_email.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ error: 'You are not authorized to act on this application.' });
    }
  }

  const newStatus = approved ? 'pending_interview' : 'pending_hr';
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    UPDATE workflow_steps SET action = ?, actor_email = ?, actor_name = ?, notes = ?, action_date = ?
    WHERE application_id = ? AND step = 'sending_principal'
  `).run(approved ? 'approved' : 'denied', req.user.email, req.user.name, notes || null, now, app.id);

  db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(newStatus, app.id);

  if (approved) {
    db.prepare(`INSERT INTO workflow_steps (application_id, step, action) VALUES (?, 'receiving_principal', 'pending')`).run(app.id);
  } else {
    db.prepare(`INSERT OR IGNORE INTO workflow_steps (application_id, step, action) VALUES (?, 'hr', 'pending')`).run(app.id);
  }

  // Email notifications
  const hrEmails = config.hrAdminEmails;
  const posting = { title: app.posting_title, fte: app.fte };
  const school = { name: app.school_name };
  const appData = { ...app };

  try {
    await email.notifySendingPrincipalDecision(
      approved, appData, posting, school,
      app.employee_email,
      app.receiving_principal_email,
      app.receiving_principal_name,
      hrEmails, notes
    );
  } catch (err) {
    console.error('Email error:', err.message);
  }

  res.json({ message: `Transfer request ${approved ? 'approved' : 'denied'}.` });
});

// ─── Receiving Principal: Schedule Interview ───────────────────────────────────
router.post('/:id/schedule-interview', authenticate, requireRole('principal', 'hr_admin'), async (req, res) => {
  const { interview_date, interview_location } = req.body;
  const db = getDb();
  const app = getFullApplication(db, req.params.id);

  if (!app) return res.status(404).json({ error: 'Application not found.' });
  if (!['pending_interview', 'interview_scheduled'].includes(app.status)) {
    return res.status(400).json({ error: 'This application is not at the interview scheduling stage.' });
  }

  if (req.user.role === 'principal') {
    if (app.receiving_principal_email.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ error: 'You are not authorized to schedule this interview.' });
    }
  }

  if (!interview_date) return res.status(400).json({ error: 'Interview date is required.' });

  const interviewTs = Math.floor(new Date(interview_date).getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);

  // Upsert interview record
  db.prepare(`
    INSERT INTO interviews (application_id, interview_date, interview_location, scheduled_at, scheduled_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(application_id) DO UPDATE SET interview_date = excluded.interview_date,
    interview_location = excluded.interview_location, scheduled_at = excluded.scheduled_at,
    scheduled_by = excluded.scheduled_by
  `).run(app.id, interviewTs, interview_location || null, now, req.user.email);

  db.prepare("UPDATE applications SET status = 'interview_scheduled' WHERE id = ?").run(app.id);

  // Find sending school for notifications
  const sendingSchool = db.prepare('SELECT * FROM schools WHERE name = ?').get(app.current_school);

  try {
    await email.notifyInterviewScheduled(
      app, { title: app.posting_title }, { name: app.school_name },
      app.employee_email,
      sendingSchool ? sendingSchool.principal_email : null,
      app.receiving_principal_name,
      interviewTs
    );
  } catch (err) {
    console.error('Email error:', err.message);
  }

  res.json({ message: 'Interview scheduled successfully.' });
});

// ─── Receiving Principal: Approve or Deny ─────────────────────────────────────
router.post('/:id/receiving-decision', authenticate, requireRole('principal', 'hr_admin'), async (req, res) => {
  const { approved, notes } = req.body;
  const db = getDb();
  const app = getFullApplication(db, req.params.id);

  if (!app) return res.status(404).json({ error: 'Application not found.' });
  if (!['pending_interview', 'interview_scheduled'].includes(app.status)) {
    return res.status(400).json({ error: 'This application is not awaiting receiving principal decision.' });
  }

  if (req.user.role === 'principal') {
    if (app.receiving_principal_email.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ error: 'You are not authorized to act on this application.' });
    }
  }

  const newStatus = 'pending_hr';
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    UPDATE workflow_steps SET action = ?, actor_email = ?, actor_name = ?, notes = ?, action_date = ?
    WHERE application_id = ? AND step = 'receiving_principal'
  `).run(approved ? 'approved' : 'denied', req.user.email, req.user.name, notes || null, now, app.id);

  db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(newStatus, app.id);

  db.prepare(`INSERT OR IGNORE INTO workflow_steps (application_id, step, action) VALUES (?, 'hr', 'pending')`).run(app.id);

  const sendingSchool = db.prepare('SELECT * FROM schools WHERE name = ?').get(app.current_school);

  try {
    await email.notifyReceivingPrincipalDecision(
      approved, app, { title: app.posting_title }, { name: app.school_name },
      app.employee_email,
      sendingSchool ? sendingSchool.principal_email : null,
      config.hrAdminEmails,
      app.receiving_principal_name,
      notes,
      app.interview_date
    );
  } catch (err) {
    console.error('Email error:', err.message);
  }

  res.json({ message: `Transfer request ${approved ? 'approved and sent to HR' : 'denied'}.` });
});

// ─── HR: Final Decision ────────────────────────────────────────────────────────
router.post('/:id/hr-decision', authenticate, requireRole('hr_admin'), async (req, res) => {
  const { approved, notes } = req.body;
  const db = getDb();
  const app = getFullApplication(db, req.params.id);

  if (!app) return res.status(404).json({ error: 'Application not found.' });
  if (app.status !== 'pending_hr') {
    return res.status(400).json({ error: 'This application is not awaiting HR approval.' });
  }

  const newStatus = approved ? 'hr_approved' : 'hr_denied';
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    UPDATE workflow_steps SET action = ?, actor_email = ?, actor_name = ?, notes = ?, action_date = ?
    WHERE application_id = ? AND step = 'hr'
  `).run(approved ? 'approved' : 'denied', req.user.email, req.user.name, notes || null, now, app.id);

  db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(newStatus, app.id);

  // If approved, fill the position and notify other applicants
  if (approved) {
    db.prepare('UPDATE job_postings SET status = ?, filled_date = ? WHERE id = ?').run('filled', now, app.posting_id);

    // Get other open applicants for this position
    const otherApps = db.prepare(`
      SELECT a.*, u.email as employee_email
      FROM applications a
      LEFT JOIN users u ON a.employee_id = u.id
      WHERE a.posting_id = ? AND a.id != ? AND a.status NOT IN ('sending_denied','receiving_denied','hr_denied','hr_approved','position_filled')
    `).all(app.posting_id, app.id);

    // Mark them as position_filled
    if (otherApps.length > 0) {
      const placeholders = otherApps.map(() => '?').join(',');
      db.prepare(`UPDATE applications SET status = 'position_filled' WHERE id IN (${placeholders})`).run(...otherApps.map(a => a.id));

      try {
        await email.notifyPositionFilled(otherApps, { title: app.posting_title, fte: app.fte }, { name: app.school_name });
      } catch (err) {
        console.error('Email error:', err.message);
      }
    }
  }

  const sendingSchool = db.prepare('SELECT * FROM schools WHERE name = ?').get(app.current_school);

  try {
    await email.notifyHrDecision(
      approved, app, { title: app.posting_title }, { name: app.school_name },
      app.employee_email,
      sendingSchool ? sendingSchool.principal_email : null,
      app.receiving_principal_email,
      notes
    );
  } catch (err) {
    console.error('Email error:', err.message);
  }

  res.json({ message: `Transfer ${approved ? 'approved' : 'denied'} by HR.` });
});

module.exports = router;
