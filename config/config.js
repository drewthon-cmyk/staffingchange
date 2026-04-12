require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  jwtExpiry: '7d',

  email: {
    host: process.env.SMTP_HOST || 'mail.gckschools.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || 'personnel@gckschools.com',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'personnel@gckschools.com',
    fromName: process.env.EMAIL_FROM_NAME || 'Garden City Transfer Center',
  },

  google: {
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '',
  },

  hrAdminEmails: (process.env.HR_ADMIN_EMAILS || 'personnel@gckschools.com')
    .split(',')
    .map(e => e.trim().toLowerCase()),

  schools: [
    'Garden City High School',
    'Garden City Achieve Academy',
    'Horace Good Middle School',
    'Kenneth Henderson Middle School',
    'Bernadine Sitts Intermediate School',
    'Charles Stones Intermediate Center',
    'Abe Huber Elementary',
    'Alta Brown Elementary',
    'Buffalo Jones Elementary',
    'Edith Sheuerman Elementary',
    'Florence Wilson Elementary',
    'Georgia Matthews Elementary',
    'Gertrude Walker Elementary',
    'Jenny Berker Elementary',
    'Plymell Elementary',
    'Victor Ornelas Elementary',
    'Garfield Early Childhood Center',
    'Finance Department',
    'HR Department',
    'Curriculum and Instruction Department',
    'Nutrition Department',
    'Health Services Department',
    'Student Services Department',
    'Transportation Department',
    'Plant Facilities Department',
  ],
};
