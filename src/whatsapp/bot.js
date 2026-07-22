import { config } from '../config.js';
import { sendWhatsAppText, sendWhatsAppButtons } from '../services/whatsappCloudService.js';

/**
 * Send interactive approval card (Stage 1) to every control number.
 * @param {object} creator
 */
export function sendApprovalCard(creator) {
  const followersStr = creator.followers ? Number(creator.followers).toLocaleString() : 'Unknown';

  const text = [
    `🎉 New Creator Found`,
    ``,
    `👤 @${creator.username}`,
    `👥 Followers: ${followersStr}`,
    creator.category ? `🏷 Category: ${creator.category}` : (creator.niche ? `🏷 Niche: ${creator.niche}` : ''),
    creator.confidence != null ? `📊 Confidence: ${creator.confidence}%` : '',
    creator.location ? `📍 ${creator.location}` : '',
    ``,
    `instagram.com/${creator.username}`,
  ].filter(Boolean).join('\n');

  config.whatsappControlNumbers.forEach((to) => {
    sendWhatsAppButtons(to, text, [
      { id: `approve:${creator.id}`, title: '✅ Approve' },
      { id: `reject:${creator.id}`, title: '❌ Reject' },
    ]).catch((err) => console.error(`[WhatsApp] sendApprovalCard failed for ${to}:`, err.message));
  });
}

/**
 * Send interactive card for a new LinkedIn → Email lead.
 * @param {object} lead
 */
export function sendLeadApprovalCard(lead) {
  const text = [
    `📇 New LinkedIn Lead`,
    ``,
    `👤 ${lead.full_name || lead.email}`,
    `✉️ ${lead.email}`,
    lead.title ? `💼 ${lead.title}` : '',
    lead.company ? `🏢 ${lead.company}` : '',
    lead.location ? `📍 ${lead.location}` : '',
  ].filter(Boolean).join('\n');

  config.whatsappControlNumbers.forEach((to) => {
    sendWhatsAppButtons(to, text, [
      { id: `approvelead:${lead.id}`, title: '✅ Approve' },
      { id: `rejectlead:${lead.id}`, title: '❌ Reject' },
    ]).catch((err) => console.error(`[WhatsApp] sendLeadApprovalCard failed for ${to}:`, err.message));
  });
}

/**
 * Send Stage 5 deal proposal card.
 * @param {object} creator
 * @param {object} deal
 */
export function sendDealCard(creator, deal) {
  const text = [
    `🤝 DEAL PROPOSAL`,
    ``,
    `Creator: @${creator.username}`,
    `💰 Proposed Price: $${deal.proposed_price}`,
    ``,
    `Accept this deal?`,
  ].join('\n');

  config.whatsappControlNumbers.forEach((to) => {
    sendWhatsAppButtons(to, text, [
      { id: `deal_accept:${deal.id}`, title: '✅ Accept' },
      { id: `deal_reject:${deal.id}`, title: '❌ Reject' },
    ]).catch((err) => console.error(`[WhatsApp] sendDealCard failed for ${to}:`, err.message));
  });
}

/**
 * Send a plain informational message to every control number.
 * @param {string} text
 */
export function notify(text) {
  config.whatsappControlNumbers.forEach((to) => {
    sendWhatsAppText(to, text).catch((err) => console.error(`[WhatsApp] notify failed for ${to}:`, err.message));
  });
}
