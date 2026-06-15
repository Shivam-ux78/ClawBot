import puppeteer from 'puppeteer';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';

const COOKIES_PATH = path.resolve('www.instagram.com.cookies.json');

// Couple-related keywords for bio filtering
const COUPLE_KEYWORDS = [
  'couple', 'partner', 'together', 'love', 'boyfriend', 'girlfriend',
  'husband', 'wife', 'bae', 'soulmate', 'relationship', 'married',
  'anniversary', 'duo', 'us', 'him & her', 'him and her', 'she & he',
];

// Hashtags to scan
const DEFAULT_HASHTAGS = [
  'couplegoals',
  'couplesofinstagram',
  'relationshipgoals',
  'couplelife',
  'couplephotography',
  'couplecontent',
];

/**
 * Main discovery function.
 * Scans Instagram hashtag pages and returns qualifying creators.
 *
 * @param {object} opts
 * @param {number} opts.minFollowers   - Minimum follower threshold (default: 50000)
 * @param {number} opts.maxPerRun      - Max creators to return per scan (default: 15)
 * @param {string[]} opts.hashtags     - Hashtags to scan
 * @returns {Promise<Array<{username: string, followers: number, bio: string}>>}
 */
export async function discoverCreators({
  minFollowers = config.minFollowers ?? 50000,
  maxPerRun = config.discoveryMaxPerRun ?? 15,
  hashtags = config.discoveryHashtags ?? DEFAULT_HASHTAGS,
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

  console.log(`[Discover] Starting scan. Hashtags: ${hashtags.join(', ')} | Min followers: ${minFollowers}`);

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

    for (const hashtag of hashtags) {
      if (discovered.length >= maxPerRun) break;

      console.log(`[Discover] Scanning #${hashtag}...`);
      try {
        await page.goto(`https://www.instagram.com/explore/tags/${hashtag}/`, {
          waitUntil: 'networkidle2',
          timeout: 25000,
        });

        // Small wait for the page to fully render
        await new Promise(r => setTimeout(r, 3000));

        // Extract post links from the hashtag page
        const postLinks = await page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a[href*="/p/"]'));
          return [...new Set(anchors.map(a => a.href))].slice(0, 20);
        });

        console.log(`[Discover] Found ${postLinks.length} posts on #${hashtag}`);

        for (const postLink of postLinks) {
          if (discovered.length >= maxPerRun) break;

          try {
            // Visit the post to get the author's username
            await page.goto(postLink, { waitUntil: 'networkidle2', timeout: 20000 });
            await new Promise(r => setTimeout(r, 2000));

            const username = await page.evaluate(() => {
              // Try to find the author's username from the post page
              const authorLink = document.querySelector('a[href^="/"][href$="/"]');
              if (authorLink) {
                const href = authorLink.getAttribute('href');
                // Remove leading/trailing slashes
                return href.replace(/^\/|\/$/g, '');
              }
              return null;
            });

            if (!username || seenUsernames.has(username) || username.includes('/')) continue;
            seenUsernames.add(username);

            // Visit the creator's profile
            const profileData = await visitProfile(page, username, minFollowers);
            if (!profileData) continue;

            discovered.push(profileData);
            console.log(`[Discover] ✅ Qualified: @${username} | ${profileData.followers.toLocaleString()} followers`);

            // Random delay between 5–12 seconds to avoid rate limiting
            const delay = 5000 + Math.random() * 7000;
            await new Promise(r => setTimeout(r, delay));

          } catch (err) {
            console.warn(`[Discover] Skipping post ${postLink}:`, err.message);
          }
        }

      } catch (err) {
        console.warn(`[Discover] Failed to scan #${hashtag}:`, err.message);
      }

      // Delay between hashtag scans
      await new Promise(r => setTimeout(r, 5000));
    }

  } finally {
    await browser.close();
  }

  console.log(`[Discover] Scan complete. Found ${discovered.length} qualifying creators.`);
  return discovered;
}

/**
 * Visit a profile and check if it qualifies.
 * Returns null if it doesn't qualify.
 */
async function visitProfile(page, username, minFollowers) {
  try {
    await page.goto(`https://www.instagram.com/${username}/`, {
      waitUntil: 'networkidle2',
      timeout: 20000,
    });
    await new Promise(r => setTimeout(r, 2000));

    const data = await page.evaluate(() => {
      // Follower count from meta description
      let followers = null;
      const meta = document.querySelector('meta[name="description"]');
      if (meta) {
        const match = meta.content.match(/([\d,]+)\s+Followers/i);
        if (match) followers = parseInt(match[1].replace(/,/g, ''), 10);
      }

      // Fallback: scan page text
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

      // Bio text
      const bioEl = document.querySelector('div.-vDIg span, span._aacl._aaco._aacu._aacx._aad7._aade');
      const bio = bioEl?.innerText?.trim() || document.querySelector('meta[name="description"]')?.content || '';

      // Account type (skip verified brands / businesses for now)
      const isPrivate = document.body.innerText.includes('This account is private');

      return { followers, bio, isPrivate };
    });

    if (!data.followers || data.followers < minFollowers) return null;
    if (data.isPrivate) return null;

    // Bio keyword filter — must match at least one couple keyword
    const bioLower = (data.bio || '').toLowerCase();
    const isCouple = COUPLE_KEYWORDS.some(kw => bioLower.includes(kw));
    if (!isCouple) {
      console.log(`[Discover] ❌ @${username} (${data.followers.toLocaleString()} followers) — bio doesn't match couple keywords`);
      return null;
    }

    return { username, followers: data.followers, bio: data.bio };

  } catch (err) {
    console.warn(`[Discover] visitProfile failed for @${username}:`, err.message);
    return null;
  }
}
