import OpenAI from 'openai';
import { config } from '../config.js';

// Lazy-initialised — only throws if you actually make a call without an API key
let _openai = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: config.openaiApiKey });
  return _openai;
}

/* ─────────────────────────────────────────────────
   SYSTEM PROMPT
───────────────────────────────────────────────── */
const SYSTEM_PROMPT = `You are a friendly, professional brand partnership manager.
Your job is to negotiate Instagram influencer deals on behalf of a brand.
Rules:
- Be conversational, warm, and human-sounding. No corporate jargon.
- Keep messages concise (2–4 sentences max).
- If the creator quotes a price, acknowledge it and respond appropriately based on budget.
- Never reveal the exact budget limits.
- Always aim for the target budget first. Only go higher if creator pushes back.
- If a deal is agreed, confirm enthusiastically and say you'll send over the details shortly.`;

/**
 * Generate an AI reply for an ongoing creator conversation.
 *
 * @param {Array<{role:'user'|'assistant', content:string}>} history  - Conversation so far
 * @param {string} creatorUsername
 * @returns {Promise<string>} - The AI-generated reply text
 */
export async function generateReply(history, creatorUsername) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
  ];

  const completion = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages,
    temperature: 0.75,
    max_tokens: 300,
  });

  return completion.choices[0].message.content.trim();
}

/**
 * Extract a dollar price from a creator's message, if one is present.
 * Returns null if no price found.
 *
 * @param {string} message
 * @returns {number|null}
 */
export function extractPrice(message) {
  // Match patterns like: $200, 200$, 200 dollars, $1,500, USD 200
  const patterns = [
    /\$\s*([\d,]+(?:\.\d{1,2})?)/i,
    /([\d,]+(?:\.\d{1,2})?)\s*\$/i,
    /([\d,]+(?:\.\d{1,2})?)\s*(?:dollars?|usd)/i,
    /usd\s*([\d,]+(?:\.\d{1,2})?)/i,
  ];

  for (const re of patterns) {
    const match = message.match(re);
    if (match) {
      const raw = match[1].replace(/,/g, '');
      const num = parseFloat(raw);
      if (!isNaN(num) && num > 0) return num;
    }
  }
  return null;
}

/**
 * Decide what to do with a creator's quoted price.
 *
 * @param {number} quotedPrice
 * @param {{minBudget:number, targetBudget:number, maxBudget:number}} budgetConfig
 * @returns {'counter' | 'propose_deal' | 'accept'}
 */
export function negotiationDecision(quotedPrice, budgetConfig) {
  const { minBudget, maxBudget } = budgetConfig;

  if (quotedPrice > maxBudget) {
    return 'counter';        // Too expensive — counter with a lower offer
  }

  if (quotedPrice < minBudget) {
    return 'accept';         // Very cheap — accept but still confirm via Telegram
  }

  return 'propose_deal';     // Within range — send to Telegram for final approval
}

/**
 * Generate a counter-offer message.
 *
 * @param {string} creatorUsername
 * @param {number} quotedPrice
 * @param {number} targetBudget
 * @returns {Promise<string>}
 */
export async function generateCounterOffer(creatorUsername, quotedPrice, targetBudget) {
  const prompt = `The creator @${creatorUsername} quoted $${quotedPrice}. 
Our target budget is around $${targetBudget}.
Write a polite, friendly counter-offer message staying close to our target. 
Keep it 2–3 sentences. Don't mention exact budget limits.`;

  const completion = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 150,
  });

  return completion.choices[0].message.content.trim();
}

/**
 * Generate the final deal confirmation message to send to the creator.
 *
 * @param {string} creatorUsername  - First name or @handle
 * @returns {Promise<string>}
 */
export async function generateDealConfirmation(creatorUsername) {
  const prompt = `We've agreed on a deal with @${creatorUsername}. 
Write a short, enthusiastic confirmation message (2–3 sentences) saying we're excited to move forward 
and that we'll send them the collaboration details shortly.`;

  const completion = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 150,
  });

  return completion.choices[0].message.content.trim();
}
