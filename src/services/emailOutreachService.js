import { run, get, all } from '../db.js';
import { sendOutreachEmail } from './gmailSmtpService.js';
import { sendLeadApprovalCard } from '../telegram/bot.js';
import { sendLeadApprovalCard as sendWhatsAppLeadApprovalCard } from '../whatsapp/bot.js';

/* ─────────────────────────────────────────────────
   Email Lead CRUD (LinkedIn → Email, sourced free via
   the LinkedIn discovery job + pattern-guess email finder)
───────────────────────────────────────────────── */

/**
 * Add a new lead and trigger approval cards.
 */
export async function addLead({ fullName, email, linkedinUrl, company, title, location, niche, skipApprovalCard = false }) {
  if (!email) throw new Error('Lead requires an email address');

  const existing = await get('SELECT * FROM email_leads WHERE LOWER(email) = LOWER($1)', [email]);
  if (existing) {
    throw new Error(`Lead ${email} already exists (state: ${existing.state})`);
  }

  const { lastInsertRowid: leadId } = await run(
    `INSERT INTO email_leads (full_name, email, linkedin_url, company, title, location, niche)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [fullName ?? null, email, linkedinUrl ?? null, company ?? null, title ?? null, location ?? null, niche ?? null]
  );

  const lead = await get('SELECT * FROM email_leads WHERE id = $1', [leadId]);

  if (!skipApprovalCard) {
    try {
      sendLeadApprovalCard(lead);
    } catch (err) {
      console.error('[EmailOutreachService] Failed to send Telegram lead card:', err.message);
    }
    try {
      sendWhatsAppLeadApprovalCard(lead);
    } catch (err) {
      console.error('[EmailOutreachService] Failed to send WhatsApp lead card:', err.message);
    }
  }

  return lead;
}

/**
 * Approve a lead: send the outreach email directly via Gmail SMTP.
 */
export async function approveLead(leadId) {
  const lead = await get('SELECT * FROM email_leads WHERE id = $1', [leadId]);
  if (!lead) throw new Error(`Lead #${leadId} not found`);

  const { subject, text } = buildOutreachEmail(lead);
  await sendOutreachEmail({ to: lead.email, subject, text, leadId });

  await run(
    `INSERT INTO email_conversations (lead_id, direction, message, sent_by) VALUES ($1, 'out', $2, 'bot')`,
    [leadId, text]
  );
  await run(`UPDATE email_leads SET state = 'sent', updated_at = NOW() WHERE id = $1`, [leadId]);
  return await get('SELECT * FROM email_leads WHERE id = $1', [leadId]);
}

/**
 * Build the outreach email for a lead. Mirrors the Instagram DM pitch.
 */
function buildOutreachEmail(lead) {
  const name = (lead.full_name || '').split(' ')[0] || 'there';
  const subject = 'Quick collab idea for a personalized gift feature';
  const text = `Hi ${name},

We're MakeAble (https://makeable.nyc/) — we make personalized 3D couple gifts from photos and memories, ideal for anniversaries, weddings, and relationship milestones.

We'd love to send you a free custom gift, no strings attached, in case it's a fit for your audience or your own use. If you ever want to share it, we also offer a 10-25%+ affiliate commission on sales generated through your link.

Let me know if you'd like a sample sent over!

Best,
The MakeAble team`;
  return { subject, text };
}

/**
 * Reject a lead and mark in DB.
 */
export async function rejectLead(leadId) {
  await run(`UPDATE email_leads SET state = 'rejected', updated_at = NOW() WHERE id = $1`, [leadId]);
  console.log(`[EmailOutreachService] Lead #${leadId} rejected.`);
}

/**
 * Get a lead by email.
 */
export async function getLeadByEmail(email) {
  return await get('SELECT * FROM email_leads WHERE LOWER(email) = LOWER($1)', [email]);
}

/**
 * Get a lead by ID.
 */
export async function getLeadById(id) {
  return await get('SELECT * FROM email_leads WHERE id = $1', [id]);
}

/**
 * Set the bot control state for a lead.
 */
export async function setLeadBotState(leadId, botState) {
  const result = await run(
    `UPDATE email_leads SET bot_state = $1, updated_at = NOW() WHERE id = $2`,
    [botState, leadId]
  );
  if (result.changes === 0) throw new Error(`Lead #${leadId} not found`);
  return await getLeadById(leadId);
}

/**
 * Get conversation history for a lead.
 */
export async function getLeadConversationHistory(leadId) {
  return await all(
    `SELECT direction, message, created_at FROM email_conversations WHERE lead_id = $1 ORDER BY created_at ASC`,
    [leadId]
  );
}

/**
 * Log an incoming reply from a lead. No auto-reply is sent — this only
 * records the message and flips lead state, mirroring the IG DM pipeline.
 */
export async function logIncomingReply(leadId, message) {
  await run(
    `INSERT INTO email_conversations (lead_id, direction, message, sent_by) VALUES ($1, 'in', $2, 'lead')`,
    [leadId, message]
  );
  await run(`UPDATE email_leads SET state = 'replied', updated_at = NOW() WHERE id = $1`, [leadId]);
}
