/**
 * Garden City Transfer Center — First-Time Setup Script
 * Run: node setup.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { initializeDb, getDb } = require('./db/schema');
const config = require('./config/config');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function setup() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Garden City Public Schools — Transfer Center Setup');
  console.log('═══════════════════════════════════════════════════════\n');

  // 1. Check for .env
  if (!fs.existsSync(path.join(__dirname, '.env'))) {
    console.log('⚠️  No .env file found. Copying from .env.example...');
    fs.copyFileSync(path.join(__dirname, '.env.example'), path.join(__dirname, '.env'));
    console.log('✅  .env created. Please edit it with your settings before going live.\n');
  }

  // 2. Initialize database
  console.log('📦  Initializing database...');
  initializeDb();
  console.log('✅  Database ready.\n');

  // 3. Seed schools if empty
  const db = getDb();
  const schoolCount = db.prepare('SELECT COUNT(*) as c FROM schools').get().c;
  if (schoolCount === 0) {
    console.log('🏫  Seeding school/department list...');
    config.schools.forEach(name => {
      db.prepare('INSERT OR IGNORE INTO schools (name) VALUES (?)').run(name);
    });
    console.log(`✅  ${config.schools.length} schools/departments added.\n`);
  } else {
    console.log(`ℹ️  Schools already seeded (${schoolCount} found). Skipping.\n`);
  }

  // 4. Create first HR admin account
  const existingAdmin = db.prepare("SELECT id FROM users WHERE role = 'hr_admin'").get();
  if (!existingAdmin) {
    console.log('👤  No HR admin account found. Let\'s create one.\n');

    let email = await ask('   HR Admin email (e.g. personnel@gckschools.com): ');
    email = email.trim().toLowerCase();

    let password = await ask('   Create a password (min 8 characters): ');
    while (password.length < 8) {
      console.log('   ⚠️  Password must be at least 8 characters.');
      password = await ask('   Try again: ');
    }

    let name = await ask('   Full name: ');
    name = name.trim();

    const hash = await bcrypt.hash(password, 12);
    db.prepare(`
      INSERT INTO users (email, password_hash, name, role, is_active)
      VALUES (?, ?, ?, 'hr_admin', 1)
      ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name, role = 'hr_admin'
    `).run(email, hash, name);

    console.log(`\n✅  HR admin account created for ${email}\n`);
  } else {
    console.log('ℹ️  HR admin account already exists. Skipping.\n');
  }

  // 5. Optionally pre-load employees from CSV
  const loadEmps = await ask('📋  Would you like to pre-load employee emails from a CSV now? (y/n): ');
  if (loadEmps.trim().toLowerCase() === 'y') {
    const csvPath = await ask('   Path to CSV file (column header must be "email"): ');
    const trimmed = csvPath.trim().replace(/^["']|["']$/g, '');
    if (fs.existsSync(trimmed)) {
      try {
        const { parse } = require('csv-parse/sync');
        const content = fs.readFileSync(trimmed, 'utf8');
        const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
        let added = 0, skipped = 0;
        for (const row of records) {
          const em = (row['email'] || row['Email'] || '').toLowerCase().trim();
          if (!em) continue;
          const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(em);
          if (exists) { skipped++; continue; }
          let role = 'employee';
          if (config.hrAdminEmails.includes(em)) role = 'hr_admin';
          db.prepare('INSERT INTO users (email, role) VALUES (?, ?)').run(em, role);
          added++;
        }
        console.log(`\n✅  ${added} employees added, ${skipped} already existed.\n`);
      } catch (err) {
        console.log(`\n⚠️  Could not read CSV: ${err.message}\n`);
      }
    } else {
      console.log('\n⚠️  File not found. Skipping employee import.\n');
    }
  }

  // 6. Optionally load principals CSV
  const loadPrins = await ask('🏫  Would you like to upload a principals CSV now? (y/n): ');
  if (loadPrins.trim().toLowerCase() === 'y') {
    const csvPath = await ask('   Path to CSV file (columns: name, principal_name, principal_email): ');
    const trimmed = csvPath.trim().replace(/^["']|["']$/g, '');
    if (fs.existsSync(trimmed)) {
      try {
        const { parse } = require('csv-parse/sync');
        const content = fs.readFileSync(trimmed, 'utf8');
        const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
        let updated = 0, created = 0;
        for (const row of records) {
          const name = row['name'] || row['Name'] || row['school_name'];
          const pName = row['principal_name'] || row['Principal Name'];
          const pEmail = (row['principal_email'] || row['Principal Email'] || '').toLowerCase();
          if (!name) continue;
          const existing = db.prepare('SELECT * FROM schools WHERE name = ?').get(name);
          if (existing) {
            db.prepare('UPDATE schools SET principal_name = ?, principal_email = ? WHERE id = ?').run(pName, pEmail, existing.id);
            updated++;
          } else {
            db.prepare('INSERT INTO schools (name, principal_name, principal_email) VALUES (?, ?, ?)').run(name, pName, pEmail);
            created++;
          }
          if (pEmail) {
            const u = db.prepare('SELECT id FROM users WHERE email = ?').get(pEmail);
            if (u) db.prepare("UPDATE users SET role = 'principal' WHERE email = ?").run(pEmail);
            else db.prepare("INSERT OR IGNORE INTO users (email, role) VALUES (?, 'principal')").run(pEmail);
          }
        }
        console.log(`\n✅  ${created} schools created, ${updated} updated.\n`);
      } catch (err) {
        console.log(`\n⚠️  Could not read CSV: ${err.message}\n`);
      }
    } else {
      console.log('\n⚠️  File not found. Skipping.\n');
    }
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Setup complete!');
  console.log('═══════════════════════════════════════════════════════');
  console.log('\n  Next steps:');
  console.log('  1. Edit your .env file with your email/Google Drive credentials');
  console.log('  2. Run:  npm install');
  console.log('  3. Run:  npm start');
  console.log(`  4. Open: http://localhost:${config.port}\n`);

  rl.close();
}

setup().catch(err => {
  console.error('\n❌  Setup failed:', err.message);
  rl.close();
  process.exit(1);
});
