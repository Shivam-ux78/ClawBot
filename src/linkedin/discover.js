import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { connection } from '../queues/dmQueue.js';
import { launchBrowser } from '../instagram/browser.js';

const COOKIES_PATH = path.resolve('www.linkedin.com.cookies.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Free LinkedIn discovery via Puppeteer, logged in as your own account
 * through injected session cookies (same pattern as the Instagram pipeline).
 *
 * IMPORTANT: use a throwaway/temp LinkedIn account for this, not your main
 * one. LinkedIn detects and bans automated browsing far more aggressively
 * than Instagram, and scraping search results is a ToS violation — this
 * carries real account-ban risk that you've already accepted using a temp
 * account for.
 */

async function loadCookies() {
  let cookiesStr = await connection.get('li_cookies');
  if (!cookiesStr && fs.existsSync(COOKIES_PATH)) {
    cookiesStr = fs.readFileSync(COOKIES_PATH, 'utf8');
  }
  if (!cookiesStr) {
    throw new Error(`LinkedIn cookies not found! Push fresh cookies via the ClawBot Sync extension (LinkedIn tab) or place them at ${COOKIES_PATH}.`);
  }
  try {
    return JSON.parse(cookiesStr);
  } catch {
    throw new Error('Failed to parse LinkedIn cookies JSON.');
  }
}

/**
 * Search LinkedIn's people search for a keyword and scrape name/headline/
 * profile URL from the results page. Headline is parsed into title + company
 * on a best-effort basis (LinkedIn headlines are free text, e.g.
 * "Founder at Acme Inc" or "Marketing Manager, Acme Inc").
 */
async function scrapeSearchResults(page, keyword, maxResults) {
  const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keyword)}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
  await sleep(3000);

  // Scroll a bit to load more results.
  await page.evaluate(async () => {
    for (let i = 0; i < 4; i++) {
      window.scrollBy(0, window.innerHeight);
      await new Promise((r) => setTimeout(r, 800));
    }
  });
  await sleep(1500);

  const results = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('li.reusable-search__result-container, div.entity-result'));
    return cards.map((card) => {
      const nameEl = card.querySelector('span[aria-hidden="true"]');
      const linkEl = card.querySelector('a.app-aware-link, a[href*="/in/"]');
      const headlineEl = card.querySelector('.entity-result__primary-subtitle');

      const name = nameEl?.innerText?.trim() || null;
      const profileUrl = linkEl?.href?.split('?')[0] || null;
      const headline = headlineEl?.innerText?.trim() || '';

      return { name, profileUrl, headline };
    }).filter((r) => r.name && r.profileUrl);
  });

  return results.slice(0, maxResults);
}

/** Best-effort split of a LinkedIn headline into { title, company }. */
function parseHeadline(headline) {
  if (!headline) return { title: null, company: null };
  const atMatch = headline.match(/^(.+?)\s+at\s+(.+)$/i);
  if (atMatch) return { title: atMatch[1].trim(), company: atMatch[2].trim() };
  const commaMatch = headline.match(/^(.+?),\s*(.+)$/);
  if (commaMatch) return { title: commaMatch[1].trim(), company: commaMatch[2].trim() };
  return { title: headline.trim(), company: null };
}

/**
 * Main discovery entry point. Searches each configured keyword, dedupes
 * profiles, and returns candidates ready for email-finding.
 */
export async function discoverLinkedInProfiles({
  keywords = config.linkedinSearchKeywords ?? ['founder', 'marketing manager'],
  maxPerRun = config.linkedinDiscoveryMaxPerRun ?? 15,
  onProgress = null,
} = {}) {
  const cookies = await loadCookies();

  console.log(`[LinkedInDiscover] Keywords: ${keywords.join(', ')} | Max: ${maxPerRun}`);
  if (onProgress) onProgress(`🔍 Searching LinkedIn for: *${keywords.join(', ')}*`);

  const browser = await launchBrowser();
  const discovered = [];
  const seen = new Set();

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setCookie(...cookies);

    for (const keyword of keywords) {
      if (discovered.length >= maxPerRun) break;

      console.log(`[LinkedInDiscover] Searching "${keyword}"...`);
      let results;
      try {
        results = await scrapeSearchResults(page, keyword, maxPerRun - discovered.length);
      } catch (err) {
        console.warn(`[LinkedInDiscover] Search failed for "${keyword}": ${err.message}`);
        continue;
      }

      if (onProgress) onProgress(`📇 "${keyword}": found ${results.length} profiles`);

      for (const result of results) {
        if (discovered.length >= maxPerRun) break;
        if (seen.has(result.profileUrl)) continue;
        seen.add(result.profileUrl);

        const { title, company } = parseHeadline(result.headline);
        if (!company) {
          console.log(`[LinkedInDiscover] ❌ ${result.name} — no company parsed from headline, skipping`);
          continue;
        }

        const candidate = {
          fullName: result.name,
          title,
          company,
          linkedinUrl: result.profileUrl,
        };

        discovered.push(candidate);
        console.log(`[LinkedInDiscover] ✅ ${candidate.fullName} — ${title || '?'} @ ${company}`);
        if (onProgress) onProgress(`✅ *${candidate.fullName}* — ${title || '?'} @ ${company}`);

        await sleep(3000 + Math.random() * 3000);
      }

      await sleep(4000);
    }
  } finally {
    await browser.close();
  }

  console.log(`[LinkedInDiscover] Complete. ${discovered.length} profiles found.`);
  return discovered;
}
