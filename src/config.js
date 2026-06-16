import 'dotenv/config';

export const config = {
  // Telegram
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,

  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY,

  // Instagram
  instagramAccessToken: process.env.INSTAGRAM_ACCESS_TOKEN || '',
  instagramStubMode: process.env.INSTAGRAM_STUB_MODE !== 'false',
  igUsername: process.env.IG_USERNAME || '',
  igPassword: process.env.IG_PASSWORD || '',

  // Budget
  minBudget: Number(process.env.MIN_BUDGET) || 50,
  targetBudget: Number(process.env.TARGET_BUDGET) || 100,
  maxBudget: Number(process.env.MAX_BUDGET) || 150,

  // Meta Webhook
  metaVerifyToken: process.env.META_VERIFY_TOKEN || 'clawbot_secret_token_123',

  // WhatsApp (CallMeBot)
  whatsappPhone: process.env.WHATSAPP_PHONE || '919905251524',
  whatsappApiKey: process.env.WHATSAPP_API_KEY || '',

  // Safety
  dmDailyLimit: Number(process.env.DM_DAILY_LIMIT) || 40,
  dmDelayMinSec: Number(process.env.DM_DELAY_MIN_SEC) || 60,
  dmDelayMaxSec: Number(process.env.DM_DELAY_MAX_SEC) || 90,

  // Redis & Database
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/clawbot',

  // Server
  port: Number(process.env.PORT) || 3000,

  // Discovery Engine
  minFollowers: Number(process.env.MIN_FOLLOWERS) || 500000,
  discoveryHashtags: process.env.DISCOVERY_HASHTAGS
    ? process.env.DISCOVERY_HASHTAGS.split(',').map(h => h.trim())
    : ['usacouples', 'americancouples', 'couplegoals', 'couplesofinstagram', 'relationshipgoals', 'couplelife', 'partnercontent'],
  discoveryMaxPerRun: Number(process.env.DISCOVERY_MAX_PER_RUN) || 15,
  discoveryIntervalHours: Number(process.env.DISCOVERY_INTERVAL_HOURS) || 6,
};

/**
 * Validate required env vars on startup.
 */
export function validateConfig() {
  const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'OPENAI_API_KEY', 'DATABASE_URL'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
