import { config } from '../config.js';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

import { connection } from '../queues/dmQueue.js';
import { launchBrowser } from './browser.js';

const COOKIES_PATH = path.resolve('www.instagram.com.cookies.json');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ─────────────────────────────────────────────────
   Keyword dictionaries (plan.md Step 4)
───────────────────────────────────────────────── */
const POSITIVE_KEYWORDS = [
  'love', 'couple', 'wife', 'husband', 'girlfriend', 'boyfriend',
  'relationship', 'dating', 'marriage', 'family', 'romance',
  'parents', 'mom', 'dad', 'engaged', 'married', 'wedding',
];

const NEGATIVE_KEYWORDS = [
  'gaming', 'crypto', 'cars', 'stocks', 'anime', 'memes',
  'fitness', 'gym', 'coding', 'business', 'marketing',
];

// Categories we keep (plan.md Step 6)
const KEEP_CATEGORIES = [
  'love', 'couple', 'relationship', 'relationship coach', 'marriage', 'family',
  'lifestyle', 'travel', 'vlog', 'content creator', 'personal blog', 'mom', 'dad', 'fashion', 'beauty'
];

/** Normalise a hashtag for comparison: strip leading #, lowercase, trim. */
function normalizeTag(tag) {
  return (tag || '').toString().replace(/^#/, '').trim().toLowerCase();
}

/** Recursively extract author usernames from Instagram API/GraphQL JSON response payloads */
function extractUsernamesFromJson(obj, targetSet) {
  if (!obj || typeof obj !== 'object') return;
  
  const SKIP = new Set(['explore', 'p', 'reel', 'reels', 'stories', 'accounts', 'about', 'privacy', 'legal', 'tags', 'direct', 'directinbox', 'emails', 'help', 'meta', 'makeable.support', 'makeableofficial']);

  if (obj.username && typeof obj.username === 'string' && /^[a-zA-Z0-9._]{3,30}$/.test(obj.username)) {
    const u = obj.username.toLowerCase();
    if (!SKIP.has(u)) targetSet.add(u);
  }

  if (Array.isArray(obj)) {
    for (const item of obj) extractUsernamesFromJson(item, targetSet);
  } else {
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') extractUsernamesFromJson(obj[key], targetSet);
    }
  }
}

/**
 * Optional: use GPT to refresh trending category hashtags. Not used in the
 * default location-first flow, but kept available for callers that want it.
 */
export async function getTrendingHashtags() {
  try {
    const loc = config.discoveryLocation || 'US';
    const cat = config.discoveryCategory || 'couple';
    const openai = new OpenAI({ apiKey: config.openaiApiKey });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a social media expert specializing in Instagram influencer marketing.' },
        {
          role: 'user',
          content:
            `Give me 10 currently trending Instagram hashtags used by ${loc}-based ${cat} content creators. ` +
            'Pick hashtags with at least 100k posts. ' +
            'Return ONLY a JSON array of strings WITHOUT the # symbol. ' +
            'Example: ["couplegoals", "relationshipgoals"]',
        },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });
    const raw = response.choices[0].message.content.trim();
    const match = raw.match(/\[.*?\]/s);
    if (!match) throw new Error('No JSON array in GPT response');
    const hashtags = JSON.parse(match[0]);
    console.log(`[Discover] GPT hashtags: ${hashtags.join(', ')}`);
    return hashtags.map(normalizeTag);
  } catch (err) {
    console.warn('[Discover] GPT fallback:', err.message);
    return config.discoveryCategoryHashtags.map(normalizeTag);
  }
}

/**
 * Best-effort scrape of the "About this account" dialog. Returns the country
 * string, or null. Used only to REJECT obviously non-US creators — the primary
 * US signal is that the creator was found via a US location hashtag / is in a
 * US creator's follower network.
 */
async function extractAccountCountry(page) {
  try {
    const opened = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('svg[aria-label="Options"], button'));
      const target = btns.find(el =>
        (el.getAttribute('aria-label') || '').toLowerCase() === 'options'
      );
      const clickable = target?.closest('button, div[role="button"], svg')?.parentElement || target;
      if (clickable) { clickable.click(); return true; }
      return false;
    });
    if (!opened) return null;

    await sleep(1200);

    const clickedAbout = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('button, div[role="button"], [role="menuitem"]'));
      const about = items.find(el => /about this account/i.test(el.textContent || ''));
      if (about) { about.click(); return true; }
      return false;
    });
    if (!clickedAbout) {
      await page.keyboard.press('Escape').catch(() => {});
      return null;
    }

    await sleep(1500);

    const country = await page.evaluate(() => {
      const bodyText = document.body.innerText || '';
      const m = bodyText.match(/Based in\s*\n?\s*([A-Za-z .'-]{2,60})/i);
      return m ? m[1].trim() : null;
    });

    await page.keyboard.press('Escape').catch(() => {});
    await sleep(500);

    return country || null;
  } catch (err) {
    console.warn('[Discover] About-this-account scrape failed:', err.message);
    return null;
  }
}

function isUnitedStates(country) {
  if (!country) return false;
  const c = country.toLowerCase();
  return c.includes('united states') || c === 'usa' || c === 'us' || c.includes('america');
}

/** Does any positive category keyword appear in the given text? */
function themeMatchesCategory(text) {
  const t = (text || '').toLowerCase();
  return POSITIVE_KEYWORDS.some(k => t.includes(k));
}

/**
 * Score a bio against the positive/negative keyword lists (plan.md Step 4).
 */
function scoreBio(bio) {
  const text = (bio || '').toLowerCase();
  const positives = POSITIVE_KEYWORDS.filter(k => text.includes(k));
  const negatives = NEGATIVE_KEYWORDS.filter(k => text.includes(k));
  return { score: positives.length - negatives.length, positives, negatives };
}

/**
 * AI classification into a single category (plan.md Step 6).
 */
async function classifyProfile({ bio, postThemesText }) {
  try {
    const openai = new OpenAI({ apiKey: config.openaiApiKey });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You classify Instagram creators into exactly ONE category from this list: ' +
            'Love, Couple, Relationship Coach, Marriage, Family, Lifestyle, Travel, Food, ' +
            'Fitness, Fashion, Gaming, Business, Tech. Reply with ONLY the category name.',
        },
        {
          role: 'user',
          content: `Bio: ${bio || 'None'}\nRecent post themes: ${postThemesText || 'None'}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 12,
    });
    return response.choices[0].message.content.trim().toLowerCase();
  } catch (err) {
    console.warn('[Discover] AI classification failed, defaulting to unknown:', err.message);
    return 'unknown';
  }
}

/**
 * Compute a 0-100 confidence score (plan.md Step 7).
 *   Country = USA        40
 *   Bio = Love           20
 *   Recent Posts = Love  30
 *   Consistency          10
 */
function computeConfidence({ locationUS, bioScore, postsMatch, keepCategory }) {
  let confidence = 0;
  if (locationUS) confidence += 40;
  if (bioScore > 0) confidence += 20;
  else if (bioScore < 0) confidence -= 10;
  if (postsMatch) confidence += 30;
  if (keepCategory) confidence += 10;
  return Math.max(0, Math.min(100, confidence));
}

/**
 * Scrape a sample of a user's followers + following usernames (best-effort).
 * These cluster geographically, so they're both a confirmation of the local
 * network and a source of more same-area creators. Returns a de-duped array.
 */
async function scanConnections(page, username, sample) {
  const out = new Set();
  const SKIP = new Set(['explore', 'p', 'reel', 'reels', 'stories', 'accounts', 'about', 'privacy', 'legal', 'tags', 'direct', 'directinbox', 'emails', 'help', 'meta', 'makeable.support', 'makeableofficial']);

  for (const kind of ['followers', 'following']) {
    try {
      await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'networkidle2', timeout: 20000 });
      await sleep(1500);

      const clicked = await page.evaluate((k) => {
        const link = document.querySelector(`a[href$="/${k}/"]`);
        if (link) { link.click(); return true; }
        return false;
      }, kind);
      if (!clicked) continue;

      await sleep(2500);

      // Scroll the dialog a bit to load more entries
      await page.evaluate(async () => {
        const dialog = document.querySelector('div[role="dialog"]');
        const scroller = dialog?.querySelector('div[style*="overflow"], ul')?.parentElement || dialog;
        if (scroller) {
          for (let i = 0; i < 3; i++) {
            scroller.scrollTop = scroller.scrollHeight;
            await new Promise(r => setTimeout(r, 800));
          }
        }
      });

      const names = await page.evaluate(() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return [];
        const links = Array.from(dialog.querySelectorAll('a[href^="/"]'));
        return [...new Set(
          links
            .map(a => (a.getAttribute('href') || '').replace(/\//g, ''))
            .filter(h => h && /^[a-zA-Z0-9._]{2,30}$/.test(h))
        )];
      });

      names.filter(n => !SKIP.has(n)).slice(0, sample).forEach(n => out.add(n));

      await page.keyboard.press('Escape').catch(() => {});
      await sleep(800);
    } catch (err) {
      console.warn(`[Discover] scanConnections ${kind} failed for @${username}:`, err.message);
    }
  }

  out.delete(username);
  return [...out];
}

/**
 * Evaluate a single candidate profile through Steps 4-7 and return a creator
 * object if it qualifies, else null. Shared by post authors (with a matched
 * category hashtag) and their follower/following connections (no post context).
 */
async function evaluateProfile(page, username, { minFollowers, maxFollowers, minConfidence, categoryFilterEnabled = true, locationTag, matchedCats = null, source }) {
  await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await sleep(1000);

  const profileData = await page.evaluate((user) => {
    let followers = null;

    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      const m = meta.content.match(/([\d,]+)\s+Followers/i);
      if (m) followers = parseInt(m[1].replace(/,/g, ''), 10);
    }

    if (!followers) {
      const m2 = document.body.innerText.match(/([\d,.]+[KMkMm]?)\s+[Ff]ollowers/);
      if (m2) {
        const raw = m2[1].replace(/,/g, '').trim();
        if (/[Kk]$/.test(raw)) followers = Math.round(parseFloat(raw) * 1000);
        else if (/[Mm]$/.test(raw)) followers = Math.round(parseFloat(raw) * 1000000);
        else followers = parseInt(raw, 10);
      }
    }

    const bioEl = document.querySelector('div[class*="Biography"] span, section div span._aacl, span[dir="auto"]');
    const bio = bioEl?.innerText?.trim() ||
      document.querySelector('meta[property="og:description"]')?.content || '';

    const isPrivate = document.body.innerText.includes('This account is private');

    const postThemesText = Array.from(document.querySelectorAll('article img[alt], main img[alt]'))
      .map(img => img.getAttribute('alt') || '')
      .filter(Boolean)
      .slice(0, 12)
      .join(' | ');

    return { username: user, followers, bio, isPrivate, postThemesText };
  }, username);

  if (!profileData.followers) {
    console.log(`[Discover] ❌ @${username} — could not read follower count`);
    return null;
  }
  if (profileData.isPrivate) {
    console.log(`[Discover] ❌ @${username} — private account`);
    return null;
  }
  if (profileData.followers < minFollowers) {
    console.log(`[Discover] ❌ @${username} — ${profileData.followers.toLocaleString()} followers (below ${minFollowers.toLocaleString()})`);
    return null;
  }
  if (profileData.followers > maxFollowers) {
    console.log(`[Discover] ❌ @${username} — ${profileData.followers.toLocaleString()} followers (above ${maxFollowers.toLocaleString()})`);
    return null;
  }

  // Location: reject only if "About this account" says a clearly non-US country.
  const aboutCountry = await extractAccountCountry(page);
  if (aboutCountry && !isUnitedStates(aboutCountry)) {
    console.log(`[Discover] ❌ @${username} — About says non-US: ${aboutCountry}`);
    return null;
  }
  const locationUS = true;

  // Bio scoring + content-theme match
  const { score: bioScore } = scoreBio(profileData.bio);
  const postsMatch = (matchedCats && matchedCats.length > 0) ||
    themeMatchesCategory(`${profileData.bio} ${profileData.postThemesText}`);

  // AI classification
  const category = await classifyProfile({
    bio: profileData.bio,
    postThemesText: `${profileData.postThemesText} | ${(matchedCats || []).join(' ')}`,
  });
  const keepCategory = KEEP_CATEGORIES.includes(category);

  // When the category filter is OFF, accept any US in-range creator regardless
  // of niche — skip the keep-category and confidence gates entirely.
  if (categoryFilterEnabled) {
    if (!keepCategory) {
      console.log(`[Discover] ❌ @${username} — category "${category}" not in keep list`);
      return null;
    }
    const confidence = computeConfidence({ locationUS, bioScore, postsMatch, keepCategory });
    if (confidence < minConfidence) {
      console.log(`[Discover] ❌ @${username} — confidence ${confidence}% (below ${minConfidence}%) [cat=${category}, bio=${bioScore}, src=${source}]`);
      return null;
    }
    return buildCreator();
  }

  return buildCreator();

  function buildCreator() {
    const confidence = computeConfidence({ locationUS, bioScore, postsMatch, keepCategory: keepCategory || !categoryFilterEnabled });
    return {
      username,
      followers: profileData.followers,
      bio: profileData.bio,
      category,
      confidence,
      country: aboutCountry || 'United States',
      locationTag,
      matchedHashtags: matchedCats || [],
      source,
    };
  }
}

/**
 * Main discovery function — LOCATION-FIRST dual filter + connection expansion.
 *  1. Search a US location hashtag (country → state → city).
 *  2. For each post/reel, read its OWN hashtags.
 *  3. Keep it only if its hashtags include a CATEGORY hashtag (content dimension).
 *  4-7. Resolve author → follower range, non-US reject, bio, classification, confidence.
 *  8. On a qualifying creator, scan their followers + following for more same-area
 *     creators and evaluate those too.
 */
export async function discoverCreators({
  minFollowers = config.minFollowers ?? 3000,
  maxFollowers = config.maxFollowers ?? 10000,
  minConfidence = config.discoveryMinConfidence ?? 80,
  maxPerRun = config.discoveryMaxPerRun ?? 15,
  locationHashtags = config.discoveryLocationHashtags ?? ['usa'],
  categoryHashtags = config.discoveryCategoryHashtags ?? ['couple'],
  categoryFilterEnabled = true,
  scanConnectionsEnabled = config.discoveryScanConnections ?? true,
  onProgress = null,
  onCreatorFound = null,
} = {}) {

  // 1. Try dedicated scraper account cookies first
  let cookiesStr = await connection.get('ig_discovery_cookies');
  const DISCOVERY_COOKIES_PATH = path.resolve('www.instagram.discovery.cookies.json');

  if (!cookiesStr && fs.existsSync(DISCOVERY_COOKIES_PATH)) {
    cookiesStr = fs.readFileSync(DISCOVERY_COOKIES_PATH, 'utf8');
  }

  // 2. Fall back to main account cookies if dedicated scraper cookies not uploaded
  if (!cookiesStr) {
    cookiesStr = await connection.get('ig_cookies');
    if (!cookiesStr && fs.existsSync(COOKIES_PATH)) {
      cookiesStr = fs.readFileSync(COOKIES_PATH, 'utf8');
    }
  }

  if (!cookiesStr) {
    throw new Error(`Cookies not found! Please click 'Sync Scraper Account' or 'Save & Sync Main Account' in your ClawBot Chrome Extension.`);
  }

  let cookies;
  try { cookies = JSON.parse(cookiesStr); }
  catch { throw new Error('Failed to parse cookies JSON.'); }

  const locationTags = locationHashtags.map(normalizeTag).filter(Boolean);
  const categorySet = new Set(categoryHashtags.map(normalizeTag).filter(Boolean));

  console.log(`[Discover] Location tags: ${locationTags.join(', ')}`);
  console.log(`[Discover] Category tags: ${[...categorySet].join(', ')} | Range: ${minFollowers}-${maxFollowers} | MinConfidence: ${minConfidence} | CategoryFilter: ${categoryFilterEnabled} | Connections: ${scanConnectionsEnabled}`);
  if (onProgress) onProgress(`🔍 Location-first scan: *${locationTags.length} location tags* → filter by *${categorySet.size} category tags*`);

  const browser = await launchBrowser();

  const discovered = [];
  const seenUsernames = new Set();

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setCookie(...cookies);

    // Emit a qualifying creator to the caller.
    const emit = async (creatorObj) => {
      discovered.push(creatorObj);
      const tag = creatorObj.source === 'connection' ? `🔗#${creatorObj.locationTag} network` : `📍#${creatorObj.locationTag}`;
      console.log(`[Discover] ✅ @${creatorObj.username} — ${creatorObj.followers.toLocaleString()} followers | ${creatorObj.category} | ${creatorObj.confidence}% | ${creatorObj.source}`);
      if (onProgress) onProgress(`✅ *@${creatorObj.username}* — ${creatorObj.followers.toLocaleString()} followers | ${creatorObj.category} | ${creatorObj.confidence}% | ${tag}`);
      if (onCreatorFound) await onCreatorFound(creatorObj);
      await sleep(5000 + Math.random() * 5000);
    };

    const tagNetworkUsernames = new Set();

    page.on('response', async (response) => {
      try {
        const url = response.url();
        if (url.includes('/graphql/query') || url.includes('/api/v1/') || url.includes('/sections/') || url.includes('/web_info/')) {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('json')) {
            const json = await response.json().catch(() => null);
            if (json) extractUsernamesFromJson(json, tagNetworkUsernames);
          }
        }
      } catch (e) {
        // ignore parse error
      }
    });

    for (const locationTag of locationTags) {
      if (discovered.length >= maxPerRun) break;

      tagNetworkUsernames.clear();
      console.log(`[Discover] ⚡ High-speed network scan on location #${locationTag}...`);
      try {
        await page.goto(`https://www.instagram.com/explore/tags/${locationTag}/`, {
          waitUntil: 'domcontentloaded',
          timeout: 12000,
        });
        await sleep(1500);
      } catch (err) {
        console.warn(`[Discover] Failed to load #${locationTag}:`, err.message);
        continue;
      }

      // Extract author usernames from DOM links + Network Interception
      const domUsernames = await page.evaluate(() => {
        const SKIP = new Set(['explore', 'p', 'reel', 'reels', 'stories', 'accounts', 'about', 'privacy', 'legal', 'tags', 'direct']);
        const links = Array.from(document.querySelectorAll('a[href^="/"]'));
        return [...new Set(
          links
            .map(a => (a.getAttribute('href') || '').replace(/\//g, ''))
            .filter(h => h && !SKIP.has(h.toLowerCase()) && /^[a-zA-Z0-9._]{3,30}$/.test(h))
        )];
      });

      const candidateUsernames = [...new Set([...tagNetworkUsernames, ...domUsernames])].slice(0, 20);

      console.log(`[Discover] #${locationTag}: extracted ${candidateUsernames.length} candidate creator usernames via network stream & DOM`);
      if (onProgress) onProgress(`📍 *#${locationTag}*: extracted *${candidateUsernames.length} candidate creators* via network stream...`);

      if (candidateUsernames.length === 0) {
        console.warn(`[Discover] No posts found on #${locationTag} — cookies may have expired`);
        if (onProgress) onProgress(`⚠️ No posts on *#${locationTag}* — cookies may be expired`);
        continue;
      }

      let authorIndex = 0;
      for (const username of candidateUsernames) {
        authorIndex++;
        if (discovered.length >= maxPerRun) break;

        if (seenUsernames.has(username)) {
          console.log(`[Discover] [Author ${authorIndex}/${candidateUsernames.length}] ⏭ @${username} — already checked`);
          continue;
        }
        seenUsernames.add(username);

        console.log(`[Discover] [Author ${authorIndex}/${candidateUsernames.length}] 🔍 Evaluating @${username}...`);

        try {
          const creator = await evaluateProfile(page, username, {
            minFollowers, maxFollowers, minConfidence, categoryFilterEnabled, locationTag, matchedCats: null, source: 'post',
          });

          if (authorIndex % 5 === 0 || authorIndex === candidateUsernames.length) {
            if (onProgress) onProgress(`📊 *#${locationTag}*: evaluated *${authorIndex}/${candidateUsernames.length}* authors | *${discovered.length}* creators found`);
          }

          if (!creator) continue;

          await emit(creator);

          // Expand via connections if enabled
          if (scanConnectionsEnabled && discovered.length < maxPerRun) {
            console.log(`[Discover] 🔗 Scanning connections of @${username}...`);
            if (onProgress) onProgress(`🔗 Scanning followers/following of *@${username}* for same-area creators...`);
            const connections = await scanConnections(page, username, connectionsSample);

            for (const conn of connections) {
              if (discovered.length >= maxPerRun) break;
              if (seenUsernames.has(conn)) continue;
              seenUsernames.add(conn);

              try {
                const c2 = await evaluateProfile(page, conn, {
                  minFollowers, maxFollowers, minConfidence, categoryFilterEnabled, locationTag, matchedCats: null, source: 'connection',
                });
                if (c2) await emit(c2);
              } catch (err) {
                console.warn(`[Discover] Error evaluating connection @${conn}:`, err.message);
              }
            }
          }
        } catch (err) {
          console.warn(`[Discover] Error evaluating author @${username}:`, err.message);
        }
      }

      await sleep(2000);
    }

  } finally {
    await browser.close();
  }

  console.log(`[Discover] Complete. ${discovered.length} creators found.`);
  return discovered;
}
