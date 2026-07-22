import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { run, get } from '../db.js';

/**
 * Sends outreach email via Google Workspace SMTP (smtp.gmail.com), using an
 * app password on your custom-domain mailbox (e.g. outreach@makeable.nyc).
 * Free — no paid email API involved.
 *
 * Setup:
 *   1. Enable 2-Step Verification on the sending mailbox.
 *   2. Generate an App Password (myaccount.google.com > Security > App Passwords).
 *   3. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env.
 *   4. Add SPF/DKIM/DMARC records for your domain in Workspace Admin, or
 *      cold email will land in spam regardless of volume.
 */

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  if (!config.gmailUser || !config.gmailAppPassword) {
    throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD not configured');
  }
  _transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: config.gmailUser, pass: config.gmailAppPassword },
  });
  return _transporter;
}

/**
 * How many outreach emails have gone out in the last 24h.
 */
async function getSentCountLast24h() {
  const row = await get(
    `SELECT COUNT(*)::int AS count FROM email_send_log WHERE sent_at > NOW() - INTERVAL '24 hours'`
  );
  return row?.count ?? 0;
}

/**
 * Send a single outreach email, enforcing the daily send cap.
 * @param {{ to: string, subject: string, text: string, leadId?: number }} opts
 */
export async function sendOutreachEmail({ to, subject, text, leadId }) {
  const sentToday = await getSentCountLast24h();
  if (sentToday >= config.emailDailyLimit) {
    throw new Error(`Daily email limit (${config.emailDailyLimit}) reached. Skipping send to ${to}.`);
  }

  const transporter = getTransporter();
  await transporter.sendMail({
    from: config.gmailUser,
    to,
    subject,
    text,
  });

  await run(
    `INSERT INTO email_send_log (lead_id, recipient, sent_at) VALUES ($1, $2, NOW())`,
    [leadId ?? null, to]
  );

  console.log(`[GmailSMTP] Sent outreach email to ${to} (${sentToday + 1}/${config.emailDailyLimit} today).`);
}
