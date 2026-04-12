const nodemailer = require('nodemailer');
const config = require('../config/config');

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: {
        user: config.email.user,
        pass: config.email.pass,
      },
    });
  }
  return transporter;
}

async function sendEmail(to, subject, html) {
  const transport = getTransporter();
  const mailOptions = {
    from: `"${config.email.fromName}" <${config.email.from}>`,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    html,
  };
  try {
    await transport.sendMail(mailOptions);
    console.log(`Email sent to ${mailOptions.to}: ${subject}`);
  } catch (err) {
    console.error(`Failed to send email to ${mailOptions.to}:`, err.message);
  }
}

// ─── Email Templates ──────────────────────────────────────────────────────────

function baseTemplate(content) {
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; background: #D8D6CD; margin: 0; padding: 20px; }
  .container { max-width: 600px; margin: 0 auto; background: #FEFEFE; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
  .header { background: #2F2012; padding: 24px 32px; display: flex; align-items: center; }
  .header h1 { color: #F8B215; margin: 0; font-size: 20px; }
  .header p { color: #D8D6CD; margin: 4px 0 0; font-size: 13px; }
  .body { padding: 32px; }
  .body h2 { color: #2F2012; margin-top: 0; }
  .body p { color: #3a3a3a; line-height: 1.6; }
  .info-box { background: #D8D6CD; border-left: 4px solid #F8B215; border-radius: 4px; padding: 16px; margin: 20px 0; }
  .info-box p { margin: 4px 0; color: #2F2012; }
  .info-box strong { color: #2F2012; }
  .btn { display: inline-block; background: #F8B215; color: #2F2012; font-weight: bold; padding: 12px 28px; border-radius: 6px; text-decoration: none; margin: 20px 0; font-size: 15px; }
  .status-approved { color: #75C044; font-weight: bold; }
  .status-denied { color: #F26E22; font-weight: bold; }
  .footer { background: #6F655A; padding: 16px 32px; color: #D8D6CD; font-size: 12px; text-align: center; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div>
      <h1>Garden City Public Schools</h1>
      <p>In-District Transfer Center</p>
    </div>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    <p>Garden City Public Schools — USD 457 | This is an automated notification from the Transfer Center.</p>
    <p>Questions? Contact <a href="mailto:personnel@gckschools.com" style="color:#F8B215;">personnel@gckschools.com</a></p>
  </div>
</div>
</body>
</html>`;
}

function applicationInfo(app, posting, school) {
  return `
<div class="info-box">
  <p><strong>Position:</strong> ${posting.title}</p>
  <p><strong>School/Department:</strong> ${school.name}</p>
  <p><strong>FTE:</strong> ${posting.fte}</p>
  <p><strong>Applicant:</strong> ${app.employee_name}</p>
  <p><strong>Applicant's Current School:</strong> ${app.current_school}</p>
  <p><strong>Applicant's Current Position:</strong> ${app.current_position}</p>
  <p><strong>Date Applied:</strong> ${new Date(app.applied_date * 1000).toLocaleDateString()}</p>
</div>`;
}

// ─── Notification Functions ────────────────────────────────────────────────────

async function notifyApplicationSubmitted(app, posting, school, sendingPrincipalEmail, sendingPrincipalName) {
  const baseUrl = config.baseUrl;

  // To employee
  await sendEmail(app.employee_email, 'Transfer Application Received', baseTemplate(`
    <h2>Your Application Has Been Received</h2>
    <p>Hi ${app.employee_name},</p>
    <p>We have received your transfer application. It has been sent to your current administrator for review.</p>
    ${applicationInfo(app, posting, school)}
    <a href="${baseUrl}/my-applications.html" class="btn">View Application Status</a>
  `));

  // To sending principal
  await sendEmail(sendingPrincipalEmail, `Transfer Request — ${app.employee_name} Needs Your Approval`, baseTemplate(`
    <h2>Employee Transfer Request — Action Required</h2>
    <p>Hi ${sendingPrincipalName},</p>
    <p><strong>${app.employee_name}</strong> has requested a transfer from your building. Please log in to review and approve or deny this request.</p>
    ${applicationInfo(app, posting, school)}
    <a href="${baseUrl}" class="btn">Log In to Review</a>
  `));
}

async function notifySendingPrincipalDecision(approved, app, posting, school, employeeEmail, receivingPrincipalEmail, receivingPrincipalName, hrEmails, notes) {
  const baseUrl = config.baseUrl;
  const decision = approved ? '<span class="status-approved">APPROVED</span>' : '<span class="status-denied">DENIED</span>';
  const notesHtml = notes ? `<p><strong>Administrator Notes:</strong> ${notes}</p>` : '';

  if (approved) {
    // To employee
    await sendEmail(employeeEmail, `Transfer Update — Sending Principal Approved`, baseTemplate(`
      <h2>Your Transfer Request Has Been Approved by Your Current Administrator</h2>
      <p>Great news! Your current administrator has approved your transfer request. The receiving principal will now review your application and schedule an interview.</p>
      ${applicationInfo(app, posting, school)}
      ${notesHtml}
      <a href="${baseUrl}/my-applications.html" class="btn">View Application Status</a>
    `));

    // To receiving principal
    await sendEmail(receivingPrincipalEmail, `Transfer Applicant for Your Review — ${app.employee_name}`, baseTemplate(`
      <h2>Transfer Applicant Awaiting Your Review</h2>
      <p>Hi ${receivingPrincipalName},</p>
      <p><strong>${app.employee_name}</strong> has applied for a position at your building and has been approved by their current administrator. Please log in to review their application and schedule an interview.</p>
      ${applicationInfo(app, posting, school)}
      ${app.resume_drive_url ? `<p><a href="${app.resume_drive_url}">📄 View Resume</a></p>` : ''}
      <a href="${baseUrl}" class="btn">Log In to Review</a>
    `));
  } else {
    // To employee
    await sendEmail(employeeEmail, `Transfer Update — Request Denied by Current Administrator`, baseTemplate(`
      <h2>Your Transfer Request Has Been ${decision}</h2>
      <p>We're sorry to inform you that your current administrator has denied your transfer request for the position below.</p>
      ${applicationInfo(app, posting, school)}
      ${notesHtml}
      <a href="${baseUrl}/my-applications.html" class="btn">View Application Status</a>
    `));

    // To HR
    await sendEmail(hrEmails, `Transfer Denied by Sending Principal — ${app.employee_name}`, baseTemplate(`
      <h2>Transfer Request Denied by Sending Principal</h2>
      <p>A transfer request has been denied by the sending principal. No further action is required.</p>
      ${applicationInfo(app, posting, school)}
      ${notesHtml}
      <a href="${baseUrl}/hr" class="btn">View in HR Dashboard</a>
    `));
  }
}

async function notifyInterviewScheduled(app, posting, school, employeeEmail, sendingPrincipalEmail, receivingPrincipalName, interviewDate) {
  const baseUrl = config.baseUrl;
  const dateStr = new Date(interviewDate * 1000).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const interviewBox = `<div class="info-box"><p><strong>Interview Date:</strong> ${dateStr}</p></div>`;

  await sendEmail(employeeEmail, `Interview Scheduled — ${posting.title} at ${school.name}`, baseTemplate(`
    <h2>Your Interview Has Been Scheduled</h2>
    <p>An interview has been scheduled for your transfer application. Please plan accordingly.</p>
    ${applicationInfo(app, posting, school)}
    ${interviewBox}
    <a href="${baseUrl}/my-applications.html" class="btn">View Application Status</a>
  `));

  await sendEmail(sendingPrincipalEmail, `Interview Scheduled — ${app.employee_name}`, baseTemplate(`
    <h2>Interview Scheduled for Transfer Applicant</h2>
    <p>An interview has been scheduled for <strong>${app.employee_name}</strong>.</p>
    ${applicationInfo(app, posting, school)}
    ${interviewBox}
  `));
}

async function notifyReceivingPrincipalDecision(approved, app, posting, school, employeeEmail, sendingPrincipalEmail, hrEmails, receivingPrincipalName, notes, interviewDate) {
  const baseUrl = config.baseUrl;
  const decision = approved ? '<span class="status-approved">APPROVED</span>' : '<span class="status-denied">DENIED</span>';
  const notesHtml = notes ? `<p><strong>Principal Notes:</strong> ${notes}</p>` : '';
  const dateStr = interviewDate ? new Date(interviewDate * 1000).toLocaleDateString() : 'Not recorded';
  const interviewBox = `<div class="info-box"><p><strong>Interview Date:</strong> ${dateStr}</p></div>`;

  if (approved) {
    const recipients = [employeeEmail, sendingPrincipalEmail, ...hrEmails];
    await sendEmail(recipients, `Transfer ${approved ? 'Approved' : 'Denied'} by Receiving Principal — Pending HR Approval`, baseTemplate(`
      <h2>Transfer ${decision} by Receiving Principal — Awaiting HR Final Approval</h2>
      <p>The receiving principal (<strong>${receivingPrincipalName}</strong>) has ${approved ? 'approved' : 'denied'} the transfer request for <strong>${app.employee_name}</strong>. This transfer is now pending final approval from HR.</p>
      ${applicationInfo(app, posting, school)}
      ${interviewBox}
      ${notesHtml}
      <a href="${baseUrl}" class="btn">Log In to Review</a>
    `));
  } else {
    const recipients = [employeeEmail, ...hrEmails];
    await sendEmail(recipients, `Transfer Denied by Receiving Principal — ${app.employee_name}`, baseTemplate(`
      <h2>Transfer ${decision} by Receiving Principal</h2>
      <p>The receiving principal has denied the transfer request for <strong>${app.employee_name}</strong>. No further action is required.</p>
      ${applicationInfo(app, posting, school)}
      ${interviewBox}
      ${notesHtml}
      <a href="${baseUrl}" class="btn">View in Dashboard</a>
    `));
  }
}

async function notifyHrDecision(approved, app, posting, school, employeeEmail, sendingPrincipalEmail, receivingPrincipalEmail, notes) {
  const baseUrl = config.baseUrl;
  const decision = approved ? '<span class="status-approved">APPROVED</span>' : '<span class="status-denied">DENIED</span>';
  const notesHtml = notes ? `<p><strong>HR Notes:</strong> ${notes}</p>` : '';
  const recipients = [employeeEmail, sendingPrincipalEmail, receivingPrincipalEmail].filter(Boolean);

  await sendEmail(recipients, `Transfer ${approved ? 'APPROVED' : 'DENIED'} by HR — ${app.employee_name}`, baseTemplate(`
    <h2>Transfer ${decision} by HR Department</h2>
    <p>The HR Department has made a final decision on the transfer request for <strong>${app.employee_name}</strong>.</p>
    ${applicationInfo(app, posting, school)}
    ${notesHtml}
    <a href="${baseUrl}" class="btn">View in Dashboard</a>
  `));
}

async function notifyPositionFilled(apps, posting, school) {
  const baseUrl = config.baseUrl;
  for (const app of apps) {
    if (!app.employee_email) continue;
    await sendEmail(app.employee_email, `Position Filled — ${posting.title} at ${school.name}`, baseTemplate(`
      <h2>Position Has Been Filled</h2>
      <p>Hi ${app.employee_name},</p>
      <p>We appreciate your interest in the position below. Unfortunately, this position has been filled by another candidate. You are encouraged to apply for other available positions in the Transfer Center.</p>
      <div class="info-box">
        <p><strong>Position:</strong> ${posting.title}</p>
        <p><strong>School/Department:</strong> ${school.name}</p>
        <p><strong>FTE:</strong> ${posting.fte}</p>
      </div>
      <a href="${baseUrl}/postings.html" class="btn">View Open Positions</a>
    `));
  }
}

async function sendPasswordReset(email, name, resetUrl) {
  await sendEmail(email, 'Transfer Center — Password Reset Request', baseTemplate(`
    <h2>Password Reset Request</h2>
    <p>Hi ${name || 'there'},</p>
    <p>We received a request to reset your Transfer Center password. Click the button below to set a new password. This link expires in 1 hour.</p>
    <a href="${resetUrl}" class="btn">Reset My Password</a>
    <p style="color:#6F655A; font-size:13px;">If you did not request this, please ignore this email. Your password will not change.</p>
  `));
}

module.exports = {
  sendEmail,
  notifyApplicationSubmitted,
  notifySendingPrincipalDecision,
  notifyInterviewScheduled,
  notifyReceivingPrincipalDecision,
  notifyHrDecision,
  notifyPositionFilled,
  sendPasswordReset,
};
