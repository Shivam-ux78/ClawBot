import puppeteer from 'puppeteer';
import { config } from '../config.js';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

const COOKIES_PATH = path.resolve('www.instagram.com.cookies.json');

/**
 * Use GPT to generate fresh trending couple hashtags (US-focused).
 */
export async function getTrendingHashtags() {
  try {
    const openai = new OpenAI({ apiKey: config.openaiApiKey });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a social media expert specializing in Instagram influencer marketing.' },
        {
          role: 'user',
          content:
            'Give me 10 currently trending Instagram hashtags used by US-based couple content creators ' +
            'with large followings (50k+). Pick hashtags with at least 1 million posts. ' +
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
    return hashtags;
  } catch (err) {
    console.warn('[Discover] GPT fallback:', err.message);
    return ['couplegoals', 'couplesofinstagram', 'relationshipgoals', 'couplelife', 'couplephotography', 'powercouple', 'coupleswhotravel', 'lovebirds', 'couplestyle', 'couplecontentcreator'];
  }
}

/**
 * Main discovery function.
 * Strategy:
 *  1. Navigate to hashtag page → collect post links
 *  2. Visit each post → extract author via og:url (most reliable method)
 *  3. Visit author profile → get follower count from meta description
 *  4. Pass if followers >= minFollowers (bio filter removed — user approves in Telegram)
 */
export async function discoverCreators({
  minFollowers = config.minFollowers ?? 50000,
  maxPerRun = config.discoveryMaxPerRun ?? 15,
  hashtags = null,
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

  if (!hashtags) {
    if (onProgress) onProgress('🤖 Asking GPT for trending hashtags...');
    hashtags = await getTrendingHashtags();
  }

  console.log(`[Discover] Hashtags: ${hashtags.join(', ')} | Min followers: ${minFollowers}`);
  if (onProgress) onProgress(`🔍 Scanning *${hashtags.length} hashtags*: ${hashtags.join(', ')}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
  });

  const discovered = [];
  const seenUsernames = new Set();

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setCookie(...cookies);

    for (const hashtag of hashtags) {
      if (discovered.length >= maxPerRun) break;

      console.log(`[Discover] Navigating to #${hashtag}...`);
      try {
        await page.goto(`https://www.instagram.com/explore/tags/${hashtag}/`, {
          waitUntil: 'networkidle2',
          timeout: 25000,
        });
        await new Promise(r => setTimeout(r, 4000));
      } catch (err) {
        console.warn(`[Discover] Failed to load #${hashtag}:`, err.message);
        continue;
      }

      // Collect post links from the hashtag explore page
      const postLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/p/"]'));
        return [...new Set(links.map(a => a.href))].slice(0, 15);
      });

      console.log(`[Discover] #${hashtag}: found ${postLinks.length} posts`);
      if (onProgress) onProgress(`📸 *#${hashtag}*: checking ${postLinks.length} posts...`);

      if (postLinks.length === 0) {
        console.warn(`[Discover] No posts found on #${hashtag} — cookies may have expired`);
        if (onProgress) onProgress(`⚠️ No posts on *#${hashtag}* — cookies may be expired`);
        continue;
      }

      for (const postUrl of postLinks) {
        if (discovered.length >= maxPerRun) break;

        try {
          // ── Step 1: Get author username from og:url meta tag ──────────────
          await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 20000 });
          await new Promise(r => setTimeout(r, 2000));

          const username = await page.evaluate(() => {
            // og:url format: https://www.instagram.com/USERNAME/p/CODE/
            const ogUrl = document.querySelector('meta[property="og:url"]')?.content || '';
            const match = ogUrl.match(/instagram\.com\/([^\/]+)\/p\//);
            if (match && match[1] !== 'p') return match[1];

            // Fallback: look for first profile link in post page header
            const SKIP = new Set(['explore', 'p', 'reel', 'reels', 'stories', 'accounts', 'about', 'privacy', 'legal', 'tags']);
            for (const a of document.querySelectorAll('header a[href], article a[href]')) {
              const href = (a.getAttribute('href') || '').replace(/\//g, '');
              if (href && !SKIP.has(href) && /^[a-zA-Z0-9._]{3,30}$/.test(href)) return href;
            }
            return null;
          });

          if (!username || seenUsernames.has(username)) continue;
          seenUsernames.add(username);

          // ── Step 2: Visit profile and check follower count ────────────────
          await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'networkidle2',
            timeout: 20000,
          });
          await new Promise(r => setTimeout(r, 2000));

          const profileData = await page.evaluate((user) => {
            let followers = null;

            // Method 1: meta description e.g. "127,432 Followers..."
            const meta = document.querySelector('meta[name="description"]');
            if (meta) {
              const m = meta.content.match(/([\d,]+)\s+Followers/i);
              if (m) followers = parseInt(m[1].replace(/,/g, ''), 10);
            }

            // Method 2: body text for condensed numbers e.g. "127K Followers"
            if (!followers) {
              const m2 = document.body.innerText.match(/([\d,.]+[KMkMm]?)\s+[Ff]ollowers/);
              if (m2) {
                const raw = m2[1].replace(/,/g, '').trim();
                if (/[Kk]$/.test(raw)) followers = Math.round(parseFloat(raw) * 1000);
                else if (/[Mm]$/.test(raw)) followers = Math.round(parseFloat(raw) * 1000000);
                else followers = parseInt(raw, 10);
              }
            }

            // Get the actual bio from the profile page
            const bioEl = document.querySelector('div[class*="Biography"] span, section div span._aacl, span[dir="auto"]');
            const bio = bioEl?.innerText?.trim() ||
              document.querySelector('meta[property="og:description"]')?.content || '';

            const isPrivate = document.body.innerText.includes('This account is private');

            return { username: user, followers, bio, isPrivate };
          }, username);

          if (!profileData.followers) {
            console.log(`[Discover] ❌ @${username} — could not read follower count`);
            continue;
          }

          if (profileData.isPrivate) {
            console.log(`[Discover] ❌ @${username} — private account`);
            continue;
          }

          if (profileData.followers < minFollowers) {
            console.log(`[Discover] ❌ @${username} — ${profileData.followers.toLocaleString()} followers (below ${minFollowers.toLocaleString()})`);
            continue;
          }

          // ✅ Passed the follower filter — let user decide in Telegram
          discovered.push({
            username,
            followers: profileData.followers,
            bio: profileData.bio,
          });

          console.log(`[Discover] ✅ @${username} — ${profileData.followers.toLocaleString()} followers`);
          if (onProgress) onProgress(`✅ *@${username}* — ${profileData.followers.toLocaleString()} followers`);

          // Human-like delay between profiles
          await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));

        } catch (err) {
          console.warn(`[Discover] Error on ${postUrl}:`, err.message);
        }
      }

      await new Promise(r => setTimeout(r, 3000));
    }

  } finally {
    await browser.close();
  }

  console.log(`[Discover] Complete. ${discovered.length} creators found.`);
  return discovered;
}
