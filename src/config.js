import 'dotenv/config';

export const config = {
  // Telegram
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatIds: process.env.TELEGRAM_CHAT_ID ? process.env.TELEGRAM_CHAT_ID.split(',').map(id => id.trim()) : [],

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

  // WhatsApp (Meta WhatsApp Cloud API - business.facebook.com)
  whatsappCloudToken: process.env.WHATSAPP_CLOUD_TOKEN || '',
  whatsappCloudPhoneNumberId: process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID || '',
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN || 'clawbot_secret_token_123',
  // Numbers allowed to send control commands (E.164 without '+', e.g. 919905251524), comma separated
  whatsappControlNumbers: process.env.WHATSAPP_CONTROL_NUMBERS
    ? process.env.WHATSAPP_CONTROL_NUMBERS.split(',').map((n) => n.trim())
    : ['919905251524'],

  // Safety
  dmDailyLimit: Number(process.env.DM_DAILY_LIMIT) || 40,
  dmDelayMinSec: Number(process.env.DM_DELAY_MIN_SEC) || 60,
  dmDelayMaxSec: Number(process.env.DM_DELAY_MAX_SEC) || 90,

  // Redis & Database
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/clawbot',

  // Server
  port: Number(process.env.PORT) || 3000,
  extensionSecretKey: process.env.EXTENSION_SECRET_KEY || 'default-secret-change-me',

  // Discovery Engine
  minFollowers: Number(process.env.MIN_FOLLOWERS) || 3000,
  maxFollowers: Number(process.env.MAX_FOLLOWERS) || 10000,
  // Content hashtags (the "what" dimension — Love/Couple content)
  discoveryHashtags: process.env.DISCOVERY_HASHTAGS
    ? process.env.DISCOVERY_HASHTAGS.split(',').map(h => h.trim())
    : ['usacouples', 'americancouples', 'couplegoals', 'couplesofinstagram', 'relationshipgoals', 'couplelife', 'partnercontent'],
  // Location hashtags (the "where" dimension — searched FIRST). Country → state → city.
  discoveryLocationHashtags: process.env.DISCOVERY_LOCATION_HASHTAGS
    ? process.env.DISCOVERY_LOCATION_HASHTAGS.split(',').map(h => h.trim())
    : [
        // Country
        'usa', 'unitedstates', 'america', 'madeinusa',
        // States
        'california', 'texas', 'florida', 'newyork', 'arizona',
        // Cities
        'losangeles', 'newyorkcity', 'chicago', 'houston', 'miami',
        'dallas', 'seattle', 'sanfrancisco',
      ],
  // Category hashtags (the "what" dimension — matched against each post's own hashtags)
  discoveryCategoryHashtags: process.env.DISCOVERY_CATEGORY_HASHTAGS
    ? process.env.DISCOVERY_CATEGORY_HASHTAGS.split(',').map(h => h.trim())
    : [
        'couple', 'couplegoals', 'relationship', 'relationshipgoals', 'love',
        'dating', 'marriedlife', 'husbandandwife', 'girlfriend', 'boyfriend',
        'romance', 'family', 'couplesofinstagram', 'lovebirds', 'engaged',
        'wedding', 'anniversary',
      ],
  discoveryMaxPerRun: Number(process.env.DISCOVERY_MAX_PER_RUN) || 15,
  discoveryIntervalHours: Number(process.env.DISCOVERY_INTERVAL_HOURS) || 6,
  discoveryLocation: process.env.DISCOVERY_LOCATION || 'US',
  discoveryCategory: process.env.DISCOVERY_CATEGORY || 'couple',
  discoveryMinConfidence: Number(process.env.DISCOVERY_MIN_CONFIDENCE) || 80,
  // After finding a local creator, scan their followers + following list for
  // more creators from the same area (they cluster geographically).
  discoveryScanConnections: process.env.DISCOVERY_SCAN_CONNECTIONS !== 'false',
  discoveryConnectionsSample: Number(process.env.DISCOVERY_CONNECTIONS_SAMPLE) || 10,

  // LinkedIn → Email outreach — free pipeline: Puppeteer LinkedIn search
  // (temp account) + pattern-guess/SMTP-verify email finder + Gmail SMTP send.
  linkedinSearchKeywords: process.env.LINKEDIN_SEARCH_KEYWORDS
    ? process.env.LINKEDIN_SEARCH_KEYWORDS.split(',').map((k) => k.trim())
    : ['founder', 'marketing manager', 'content creator'],
  linkedinDiscoveryMaxPerRun: Number(process.env.LINKEDIN_DISCOVERY_MAX_PER_RUN) || 15,
  linkedinSyncIntervalHours: Number(process.env.LINKEDIN_SYNC_INTERVAL_HOURS) || 6,

  // Google Workspace SMTP (e.g. outreach@makeable.nyc) for sending outreach emails
  gmailUser: process.env.GMAIL_USER || '',
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD || '',
  emailDailyLimit: Number(process.env.EMAIL_DAILY_LIMIT) || 30,
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
