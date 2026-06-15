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
            'with large followings (50k+). Pick hashtags that have at least 1 million posts. ' +
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
    console.warn('[Discover] GPT fallback to defaults:', err.message);
    return ['couplegoals', 'couplesofinstagram', 'relationshipgoals', 'couplelife', 'couplephotography', 'powercouple', 'coupleswhotravel', 'lovebirds', 'couplestyle', 'couplecontentcreator'];
  }
}

/**
 * Main discovery function.
 * Makes Instagram internal API calls from WITHIN the browser context so
 * session cookies and CSRF tokens are automatically included.
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

  console.log(`[Discover] Hashtags: ${hashtags.join(', ')} | Min: ${minFollowers}`);
  if (onProgress) onProgress(`🔍 Scanning *${hashtags.length} hashtags*: ${hashtags.slice(0, 5).join(', ')}...`);

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

    // Navigate to Instagram home to establish full session context
    console.log('[Discover] Establishing Instagram session...');
    await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    for (const hashtag of hashtags) {
      if (discovered.length >= maxPerRun) break;
      console.log(`[Discover] Querying #${hashtag}...`);

      // ── Make API call from WITHIN the browser so cookies are auto-included ──
      const users = await page.evaluate(async (tag) => {
        const results = [];

        // Try endpoint 1: Instagram tag sections API
        try {
          const r1 = await fetch(`/api/v1/tags/${tag}/sections/`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-CSRFToken': document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '',
              'X-IG-App-ID': '936619743392459',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: 'tab=top&page=1&next_max_id=',
          });
          if (r1.ok) {
            const d1 = await r1.json();
            const sections = d1?.sections || [];
            for (const s of sections) {
              const medias = s?.layout_content?.medias || [];
              for (const m of medias) {
                const user = m?.media?.user;
                if (user?.username) {
                  results.push({
                    username: user.username,
                    followers: user.follower_count || null,
                    bio: user.biography || '',
                  });
                }
              }
            }
          }
        } catch (_) {}

        // Try endpoint 2: feed/tag REST API
        if (results.length === 0) {
          try {
            const r2 = await fetch(`/api/v1/feed/tag/?tag_name=${encodeURIComponent(tag)}&tab=top`, {
              headers: {
                'X-CSRFToken': document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '',
                'X-IG-App-ID': '936619743392459',
                'X-Requested-With': 'XMLHttpRequest',
              },
            });
            if (r2.ok) {
              const d2 = await r2.json();
              const items = d2?.items || [];
              for (const item of items) {
                const user = item?.user;
                if (user?.username) {
                  results.push({
                    username: user.username,
                    followers: user.follower_count || null,
                    bio: user.biography || '',
                  });
                }
              }
            }
          } catch (_) {}
        }

        // Try endpoint 3: web info
        if (results.length === 0) {
          try {
            const r3 = await fetch(`/api/v1/tags/web_info/?tag_name=${encodeURIComponent(tag)}`, {
              headers: {
                'X-CSRFToken': document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '',
                'X-IG-App-ID': '936619743392459',
              },
            });
            if (r3.ok) {
              const d3 = await r3.json();
              // Grab top posts
              const top = d3?.data?.top?.sections || [];
              for (const s of top) {
                const medias = s?.layout_content?.medias || [];
                for (const m of medias) {
                  const user = m?.media?.user;
                  if (user?.username) {
                    results.push({
                      username: user.username,
                      followers: user.follower_count || null,
                      bio: user.biography || '',
                    });
                  }
                }
              }
            }
          } catch (_) {}
        }

        return results;
      }, hashtag);

      console.log(`[Discover] #${hashtag}: got ${users.length} users from internal API`);
      if (onProgress) onProgress(`📸 *#${hashtag}*: ${users.length} profiles found in API`);

      // ── Filter & qualify users ────────────────────────────────────────────
      for (const { username, followers, bio } of users) {
        if (discovered.length >= maxPerRun) break;
        if (seenUsernames.has(username)) continue;
        seenUsernames.add(username);

        // Quick follower pre-filter using API data (avoid visiting profile)
        if (followers !== null && followers < minFollowers) {
          console.log(`[Discover] ❌ @${username} — ${followers} followers (too few)`);
          continue;
        }

        // Check couple keywords in bio (from API data)
        const bioLower = (bio || '').toLowerCase();
        const hasCoupleBio = COUPLE_KEYWORDS.some(kw => bioLower.includes(kw));

        if (followers && followers >= minFollowers && hasCoupleBio) {
          // We have all data from API — no need to visit profile!
          discovered.push({ username, followers, bio });
          console.log(`[Discover] ✅ @${username} — ${followers.toLocaleString()} followers (API data)`);
          if (onProgress) onProgress(`✅ Found: *@${username}* (${followers.toLocaleString()} followers)`);
          continue;
        }

        // Follower count unknown from API — visit profile to verify
        if (followers === null) {
          const profileData = await visitProfile(page, username, minFollowers);
          if (!profileData) continue;
          discovered.push(profileData);
          console.log(`[Discover] ✅ @${username} — ${profileData.followers.toLocaleString()} followers (profile visit)`);
          if (onProgress) onProgress(`✅ Found: *@${username}* (${profileData.followers.toLocaleString()} followers)`);
          await new Promise(r => setTimeout(r, 4000 + Math.random() * 4000));
        }
      }

      // If API returned nothing at all — use fallback post scraping
      if (users.length === 0) {
        console.log(`[Discover] API returned 0 for #${hashtag}. Trying post fallback...`);
        await fallbackPostScrape(page, hashtag, minFollowers, maxPerRun, seenUsernames, discovered, onProgress);
      }

      await new Promise(r => setTimeout(r, 3000));
    }

  } finally {
    await browser.close();
  }

  console.log(`[Discover] Done. ${discovered.length} qualifying creators found.`);
  return discovered;
}

/**
 * Fallback: visit hashtag page, find post links, click each, extract author.
 */
async function fallbackPostScrape(page, hashtag, minFollowers, maxPerRun, seenUsernames, discovered, onProgress) {
  try {
    await page.goto(`https://www.instagram.com/explore/tags/${hashtag}/`, {
      waitUntil: 'networkidle2',
      timeout: 25000,
    });
    await new Promise(r => setTimeout(r, 4000));

    const postLinks = await page.evaluate(() =>
      [...new Set(Array.from(document.querySelectorAll('a[href*="/p/"]')).map(a => a.href))].slice(0, 10)
    );

    console.log(`[Discover] Fallback: ${postLinks.length} posts found on #${hashtag}`);

    for (const postUrl of postLinks) {
      if (discovered.length >= maxPerRun) break;

      try {
        await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 20000 });
        await new Promise(r => setTimeout(r, 2000));

        // Get author from page URL redirect or from page content
        const username = await page.evaluate(() => {
          // Look for the author link in the post page
          const allLinks = Array.from(document.querySelectorAll('a[href]'));
          const SKIP = new Set(['explore', 'p', 'reel', 'reels', 'stories', 'accounts', 'about', 'privacy', 'legal', 'tags']);
          for (const a of allLinks) {
            const href = a.getAttribute('href') || '';
            const match = href.match(/^\/([a-zA-Z0-9._]{3,30})\/$/);
            if (match && !SKIP.has(match[1])) return match[1];
          }
          return null;
        });

        if (!username || seenUsernames.has(username)) continue;
        seenUsernames.add(username);

        const profileData = await visitProfile(page, username, minFollowers);
        if (!profileData) continue;

        discovered.push(profileData);
        console.log(`[Discover] ✅ (fallback) @${username} — ${profileData.followers.toLocaleString()} followers`);
        if (onProgress) onProgress(`✅ Found: *@${username}* (${profileData.followers.toLocaleString()} followers)`);

        await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));

      } catch (err) {
        console.warn(`[Discover] Fallback post error:`, err.message);
      }
    }
  } catch (err) {
    console.warn(`[Discover] fallbackPostScrape error:`, err.message);
  }
}

/**
 * Visit a profile page and check follower count + couple bio.
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
      const meta = document.querySelector('meta[name="description"]');
      if (meta) {
        const m = meta.content.match(/([\d,]+)\s+Followers/i);
        if (m) followers = parseInt(m[1].replace(/,/g, ''), 10);
      }
      if (!followers) {
        const bodyText = document.body.innerText;
        const m2 = bodyText.match(/([\d,.]+[KMB]?)\s+[Ff]ollowers/);
        if (m2) {
          const raw = m2[1].replace(/,/g, '');
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
      console.log(`[Discover] ❌ @${username} (${data.followers?.toLocaleString()}) — no couple match in bio`);
      return null;
    }

    return { username, followers: data.followers, bio: data.bio };

  } catch (err) {
    console.warn(`[Discover] visitProfile error @${username}:`, err.message);
    return null;
  }
}
