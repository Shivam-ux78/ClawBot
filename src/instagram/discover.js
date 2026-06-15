import puppeteer from 'puppeteer';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';

const COOKIES_PATH = path.resolve('www.instagram.com.cookies.json');

const COUPLE_KEYWORDS = [
  'couple', 'partner', 'together', 'love', 'boyfriend', 'girlfriend',
  'husband', 'wife', 'bae', 'soulmate', 'relationship', 'married',
  'anniversary', 'duo', 'him & her', 'him and her', 'she & he',
];

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
 */
export async function discoverCreators({
  minFollowers = config.minFollowers ?? 50000,
  maxPerRun = config.discoveryMaxPerRun ?? 15,
  hashtags = config.discoveryHashtags ?? DEFAULT_HASHTAGS,
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

  console.log(`[Discover] Starting scan. Hashtags: ${hashtags.join(', ')} | Min: ${minFollowers}`);
  if (onProgress) onProgress(`🔍 Scanning ${hashtags.length} hashtags... Min followers: ${minFollowers.toLocaleString()}`);

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
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const hashtag of hashtags) {
      if (discovered.length >= maxPerRun) break;

      console.log(`[Discover] Scanning #${hashtag}...`);
      try {
        await page.goto(`https://www.instagram.com/explore/tags/${hashtag}/`, {
          waitUntil: 'networkidle2',
          timeout: 25000,
        });
        await new Promise(r => setTimeout(r, 3000));

        // Extract profile usernames directly from anchor tags on the hashtag page
        const usernames = await page.evaluate(() => {
          const found = new Set();
          const SKIP = new Set(['explore', 'p', 'reel', 'reels', 'stories', 'tv',
            'accounts', 'about', 'privacy', 'legal', 'tags', 'directory']);
          document.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href') || '';
            const match = href.match(/^\/([a-zA-Z0-9._]{3,30})\/$/);
            if (match && !SKIP.has(match[1])) found.add(match[1]);
          });
          return Array.from(found).slice(0, 25);
        });

        console.log(`[Discover] Found ${usernames.length} potential profiles on #${hashtag}`);
        if (onProgress) onProgress(`📸 #${hashtag}: checking ${usernames.length} profiles...`);

        for (const username of usernames) {
          if (discovered.length >= maxPerRun) break;
          if (seenUsernames.has(username)) continue;
          seenUsernames.add(username);

          try {
            const profileData = await visitProfile(page, username, minFollowers);
            if (!profileData) continue;

            discovered.push(profileData);
            console.log(`[Discover] ✅ Qualified: @${username} | ${profileData.followers.toLocaleString()} followers`);
            if (onProgress) onProgress(`✅ Found: @${username} (${profileData.followers.toLocaleString()} followers)`);

            const delay = 5000 + Math.random() * 7000;
            await new Promise(r => setTimeout(r, delay));

          } catch (err) {
            console.warn(`[Discover] Error visiting @${username}:`, err.message);
          }
        }

      } catch (err) {
        console.warn(`[Discover] Failed on #${hashtag}:`, err.message);
        if (onProgress) onProgress(`⚠️ Skipped #${hashtag}: ${err.message}`);
      }

      await new Promise(r => setTimeout(r, 4000));
    }

  } finally {
    await browser.close();
  }

  console.log(`[Discover] Scan complete. Found ${discovered.length} qualifying creators.`);
  return discovered;
}

async function visitProfile(page, username, minFollowers) {
  try {
    await page.goto(`https://www.instagram.com/${username}/`, {
      waitUntil: 'networkidle2',
      timeout: 20000,
    });
    await new Promise(r => setTimeout(r, 2000));

    const data = await page.evaluate(() => {
      let followers = null;
      const meta = document.querySelector('meta[name="description"]');
      if (meta) {
        const match = meta.content.match(/([\d,]+)\s+Followers/i);
        if (match) followers = parseInt(match[1].replace(/,/g, ''), 10);
      }
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
      const bio = document.querySelector('meta[name="description"]')?.content || '';
      const isPrivate = document.body.innerText.includes('This account is private');
      return { followers, bio, isPrivate };
    });

    if (!data.followers || data.followers < minFollowers) return null;
    if (data.isPrivate) return null;

    const bioLower = (data.bio || '').toLowerCase();
    const isCouple = COUPLE_KEYWORDS.some(kw => bioLower.includes(kw));
    if (!isCouple) {
      console.log(`[Discover] ❌ @${username} (${data.followers?.toLocaleString()}) — bio no couple match`);
      return null;
    }

    return { username, followers: data.followers, bio: data.bio };

  } catch (err) {
    console.warn(`[Discover] visitProfile failed for @${username}:`, err.message);
    return null;
  }
}
