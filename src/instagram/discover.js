import puppeteer from 'puppeteer';
import { config } from '../config.js';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

const COOKIES_PATH = path.resolve('www.instagram.com.cookies.json');

const COUPLE_KEYWORDS = [
  'couple', 'partner', 'together', 'love', 'boyfriend', 'girlfriend',
  'husband', 'wife', 'bae', 'soulmate', 'relationship', 'married',
  'anniversary', 'duo', 'him & her', 'him and her', 'she & he', '❤️', '💑', '💕',
];

/**
 * Use GPT to generate a fresh list of trending couple-content hashtags (US-focused).
 */
export async function getTrendingHashtags() {
  try {
    const openai = new OpenAI({ apiKey: config.openaiApiKey });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a social media expert specializing in Instagram influencer marketing.',
        },
        {
          role: 'user',
          content:
            'Give me 10 currently trending Instagram hashtags used by US-based couple content creators ' +
            'with large followings (100k+). Focus on hashtags that have many posts and active engagement. ' +
            'Return ONLY a JSON array of hashtag strings WITHOUT the # symbol. ' +
            'Example format: ["couplegoals", "relationshipgoals"]',
        },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    const raw = response.choices[0].message.content.trim();
    // Extract JSON array from response
    const match = raw.match(/\[.*\]/s);
    if (!match) throw new Error('No JSON array found in GPT response');
    const hashtags = JSON.parse(match[0]);
    console.log(`[Discover] GPT suggested hashtags: ${hashtags.join(', ')}`);
    return hashtags;
  } catch (err) {
    console.warn('[Discover] GPT hashtag fetch failed, using defaults:', err.message);
    return [
      'couplegoals', 'couplesofinstagram', 'relationshipgoals',
      'couplelife', 'coupletravel', 'couplephotography',
      'couplestyle', 'couplecontentcreator', 'relationshiptok', 'lovecouple',
    ];
  }
}

/**
 * Main discovery function.
 * Uses network interception to extract user data directly from Instagram's internal API.
 */
export async function discoverCreators({
  minFollowers = config.minFollowers ?? 50000,
  maxPerRun = config.discoveryMaxPerRun ?? 15,
  hashtags = null, // if null, GPT will generate them
  onProgress = null,
} = {}) {

  let cookiesStr;
  if (process.env.IG_COOKIES_JSON) {
    cookiesStr = process.env.IG_COOKIES_JSON;
  } else if (fs.existsSync(COOKIES_PATH)) {
    cookiesStr = fs.readFileSync(COOKIES_PATH, 'utf8');
  } else {
    throw new Error('Cookies not found! Provide IG_COOKIES_JSON in cloud or cookies.json locally.');
  }

  let cookies;
  try { cookies = JSON.parse(cookiesStr); }
  catch { throw new Error('Failed to parse cookies JSON.'); }

  // Get fresh hashtags from GPT if not provided
  if (!hashtags) {
    if (onProgress) onProgress('🤖 Asking GPT for trending hashtags...');
    hashtags = await getTrendingHashtags();
  }

  console.log(`[Discover] Starting scan. Hashtags: ${hashtags.join(', ')} | Min: ${minFollowers}`);
  if (onProgress) onProgress(`🔍 Got *${hashtags.length} hashtags* from GPT: ${hashtags.slice(0, 5).join(', ')}...`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
  });

  const discovered = [];
  const seenUsernames = new Set();

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setCookie(...cookies);
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    for (const hashtag of hashtags) {
      if (discovered.length >= maxPerRun) break;

      console.log(`[Discover] Scanning #${hashtag}...`);
      const capturedUsers = [];

      // ── Intercept Instagram's internal API responses ─────────────────────
      const responseHandler = async (response) => {
        const url = response.url();
        // Instagram loads hashtag feed via these endpoints
        if (
          (url.includes('/api/v1/feed/tag/') ||
            url.includes('/api/v1/tags/') ||
            url.includes('tag_name=' + hashtag) ||
            url.includes('/graphql/query')) &&
          response.status() === 200
        ) {
          try {
            const text = await response.text();
            const data = JSON.parse(text);

            // Handle both GraphQL and REST API response shapes
            const items =
              data?.data?.hashtag?.edge_hashtag_to_media?.edges ||   // GraphQL
              data?.items ||                                           // REST v1
              data?.native_elements?.edges ||
              [];

            for (const item of items) {
              // GraphQL shape
              const node = item.node || item;
              const user =
                node?.owner ||
                node?.user ||
                node?.media?.owner;
              if (!user?.username) continue;
              const username = user.username;
              const followerCount =
                user.follower_count ||
                user.edge_followed_by?.count ||
                null;
              if (username && !seenUsernames.has(username)) {
                capturedUsers.push({ username, followerCount });
                seenUsernames.add(username);
              }
            }
          } catch (_) {
            // Not JSON or wrong shape — ignore
          }
        }
      };

      page.on('response', responseHandler);

      try {
        await page.goto(`https://www.instagram.com/explore/tags/${hashtag}/`, {
          waitUntil: 'networkidle2',
          timeout: 25000,
        });
        // Extra wait so all XHR calls fire
        await new Promise(r => setTimeout(r, 5000));
      } catch (err) {
        console.warn(`[Discover] Navigation failed for #${hashtag}:`, err.message);
      }

      page.off('response', responseHandler);

      console.log(`[Discover] Captured ${capturedUsers.length} users from #${hashtag} API responses`);
      if (onProgress) onProgress(`📸 *#${hashtag}*: captured ${capturedUsers.length} profiles from API`);

      // ── Check each captured user ──────────────────────────────────────────
      for (const { username, followerCount } of capturedUsers) {
        if (discovered.length >= maxPerRun) break;

        // If we already have follower count from API, do quick check first
        if (followerCount !== null && followerCount < minFollowers) {
          console.log(`[Discover] ❌ @${username} — ${followerCount} followers (below threshold)`);
          continue;
        }

        try {
          const profileData = await visitProfile(page, username, minFollowers);
          if (!profileData) continue;

          discovered.push(profileData);
          console.log(`[Discover] ✅ Qualified: @${username} | ${profileData.followers.toLocaleString()} followers`);
          if (onProgress) onProgress(`✅ Found: *@${username}* (${profileData.followers.toLocaleString()} followers)`);

          const delay = 4000 + Math.random() * 6000;
          await new Promise(r => setTimeout(r, delay));

        } catch (err) {
          console.warn(`[Discover] Error on @${username}:`, err.message);
        }
      }

      // If API gave nothing, fall back to visiting individual posts
      if (capturedUsers.length === 0) {
        console.log(`[Discover] No API data captured for #${hashtag}, trying post-click fallback...`);
        await fallbackPostClick(page, hashtag, minFollowers, maxPerRun, seenUsernames, discovered, onProgress);
      }

      await new Promise(r => setTimeout(r, 3000));
    }

  } finally {
    await browser.close();
  }

  console.log(`[Discover] Scan complete. Found ${discovered.length} qualifying creators.`);
  return discovered;
}

/**
 * Fallback: click on individual posts and extract author username from post page.
 */
async function fallbackPostClick(page, hashtag, minFollowers, maxPerRun, seenUsernames, discovered, onProgress) {
  try {
    // Find clickable post thumbnails
    const postLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href*="/p/"]'))
        .map(a => a.href)
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .slice(0, 12);
    });

    console.log(`[Discover] Fallback: found ${postLinks.length} post links on #${hashtag}`);

    for (const postUrl of postLinks) {
      if (discovered.length >= maxPerRun) break;

      try {
        await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 20000 });
        await new Promise(r => setTimeout(r, 2000));

        const username = await page.evaluate(() => {
          // Look for author link in the post header
          const links = Array.from(document.querySelectorAll('header a[href], article a[href]'));
          for (const a of links) {
            const href = a.getAttribute('href') || '';
            const match = href.match(/^\/([a-zA-Z0-9._]{3,30})\/$/);
            if (match && !['explore', 'p', 'reel'].includes(match[1])) {
              return match[1];
            }
          }
          return null;
        });

        if (!username || seenUsernames.has(username)) continue;
        seenUsernames.add(username);

        const profileData = await visitProfile(page, username, minFollowers);
        if (!profileData) continue;

        discovered.push(profileData);
        console.log(`[Discover] ✅ (fallback) Qualified: @${username} | ${profileData.followers.toLocaleString()} followers`);
        if (onProgress) onProgress(`✅ Found: *@${username}* (${profileData.followers.toLocaleString()} followers)`);

        await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));

      } catch (err) {
        console.warn(`[Discover] Fallback error on ${postUrl}:`, err.message);
      }
    }
  } catch (err) {
    console.warn(`[Discover] Fallback failed for #${hashtag}:`, err.message);
  }
}

/**
 * Visit a creator profile page and check if they qualify.
 */
async function visitProfile(page, username, minFollowers) {
  try {
    await page.goto(`https://www.instagram.com/${username}/`, {
      waitUntil: 'networkidle2',
      timeout: 20000,
    });
    await new Promise(r => setTimeout(r, 2000));

    const data = await page.evaluate(() => {
      let followers = null;

      // Method 1: meta description tag
      const meta = document.querySelector('meta[name="description"]');
      if (meta) {
        const match = meta.content.match(/([\d,]+)\s+Followers/i);
        if (match) followers = parseInt(match[1].replace(/,/g, ''), 10);
      }

      // Method 2: body text fallback
      if (!followers) {
        const bodyText = document.body.innerText;
        const match2 = bodyText.match(/([\d,.]+[KMB]?)\s+[Ff]ollowers/);
        if (match2) {
          const raw = match2[1].replace(/,/g, '');
          if (raw.endsWith('K')) followers = Math.round(parseFloat(raw) * 1000);
          else if (raw.endsWith('M')) followers = Math.round(parseFloat(raw) * 1000000);
          else followers = parseInt(raw, 10);
        }
      }

      const metaBio = document.querySelector('meta[name="description"]')?.content || '';
      const isPrivate = document.body.innerText.includes('This account is private');
      return { followers, bio: metaBio, isPrivate };
    });

    if (!data.followers || data.followers < minFollowers) {
      console.log(`[Discover] ❌ @${username} — ${data.followers ?? 'unknown'} followers`);
      return null;
    }
    if (data.isPrivate) {
      console.log(`[Discover] ❌ @${username} — private account`);
      return null;
    }

    const bioLower = (data.bio || '').toLowerCase();
    const isCouple = COUPLE_KEYWORDS.some(kw => bioLower.includes(kw));
    if (!isCouple) {
      console.log(`[Discover] ❌ @${username} (${data.followers.toLocaleString()}) — no couple bio match`);
      return null;
    }

    return { username, followers: data.followers, bio: data.bio };

  } catch (err) {
    console.warn(`[Discover] visitProfile error @${username}:`, err.message);
    return null;
  }
}
