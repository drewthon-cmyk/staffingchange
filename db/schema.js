const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'transfer-center.sqlite');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initializeDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT,
      name TEXT,
      role TEXT DEFAULT 'employee',
      current_school TEXT,
      current_position TEXT,
      is_active INTEGER DEFAULT 1,
      reset_token TEXT,
      reset_token_expires INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      last_login INTEGER
    );

    CREATE TABLE IF NOT EXISTS schools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      principal_name TEXT,
      principal_email TEXT COLLATE NOCASE,
      type TEXT DEFAULT 'school'
    );

    CREATE TABLE IF NOT EXISTS job_postings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      school_id INTEGER NOT NULL,
      fte TEXT NOT NULL,
      job_description_url TEXT,
      status TEXT DEFAULT 'open',
      posted_date INTEGER DEFAULT (unixepoch()),
      filled_date INTEGER,
      created_by INTEGER,
      FOREIGN KEY (school_id) REFERENCES schools(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      posting_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      employee_name TEXT NOT NULL,
      current_school TEXT NOT NULL,
      current_position TEXT NOT NULL,
      resume_drive_url TEXT,
      resume_drive_id TEXT,
      resume_filename TEXT,
      status TEXT DEFAULT 'pending_sending_principal',
      applied_date INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (posting_id) REFERENCES job_postings(id),
      FOREIGN KEY (employee_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS workflow_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL,
      step TEXT NOT NULL,
      action TEXT DEFAULT 'pending',
      actor_email TEXT,
      actor_name TEXT,
      notes TEXT,
      action_date INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (application_id) REFERENCES applications(id)
    );

    CREATE TABLE IF NOT EXISTS interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL UNIQUE,
      interview_date INTEGER,
      interview_location TEXT,
      scheduled_at INTEGER DEFAULT (unixepoch()),
      scheduled_by TEXT,
      FOREIGN KEY (application_id) REFERENCES applications(id)
    );
  `);

  console.log('Database initialized successfully.');
  return db;
}

module.exports = { getDb, initializeDb };
