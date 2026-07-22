import { config } from '../config.js';
import fs from 'fs';
import path from 'path';
import { connection } from '../queues/dmQueue.js';
import { launchBrowser } from './browser.js';

const COOKIES_PATH = path.resolve('www.instagram.com.cookies.json');

/**
 * Send a DM to a creator.
 *
 * STUB MODE:
 *   Logs all outgoing DMs to console.
 *
 * REAL MODE (Puppeteer):
 *   Injects session cookies and uses a hidden browser to send DMs.
 */
export async function sendDM(username, message, extras = {}) {
  if (config.instagramStubMode) {
    return sendStub(username, message, extras);
  }
  return await sendReal(username, message, extras);
}

/**
 * Fetch real follower count from Instagram profile (Puppeteer).
 * Falls back to null if it fails (e.g. private account, cookies expired).
 */
export async function getProfileInfo(username) {
  if (config.instagramStubMode) {
    console.log(`[Instagram STUB] getProfileInfo @${username} → skipping`);
    return { followers: null };
  }

  let cookiesStr = await connection.get('ig_cookies');
  
  if (!cookiesStr) {
    if (fs.existsSync(COOKIES_PATH)) {
      cookiesStr = fs.readFileSync(COOKIES_PATH, 'utf8');
    } else {
      console.warn('[getProfileInfo] No cookies found, skipping follower lookup.');
      return { followers: null };
    }
  }

  let cookies;
  try { cookies = JSON.parse(cookiesStr); }
  catch { return { followers: null }; }

  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setCookie(...cookies);

    console.log(`[Puppeteer] Fetching profile info for @${username}...`);
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'networkidle2', timeout: 20000 });

    // Try to grab follower count from the meta description tag (most reliable)
    const followers = await page.evaluate(() => {
      // Method 1: meta description (e.g. "50,234 Followers")
      const meta = document.querySelector('meta[name="description"]');
      if (meta) {
        const match = meta.content.match(/([\d,]+)\s+Followers/i);
        if (match) return parseInt(match[1].replace(/,/g, ''), 10);
      }
      // Method 2: look in the page text
      const bodyText = document.body.innerText;
      const match2 = bodyText.match(/([\d,.]+[KMB]?)\s+[Ff]ollowers/);
      if (match2) {
        const raw = match2[1].replace(/,/g, '');
        if (raw.endsWith('K')) return Math.round(parseFloat(raw) * 1000);
        if (raw.endsWith('M')) return Math.round(parseFloat(raw) * 1000000);
        return parseInt(raw, 10);
      }
      return null;
    });

    console.log(`[Puppeteer] @${username} has ${followers ?? 'unknown'} followers.`);
    return { followers };
  } catch (err) {
    console.warn(`[getProfileInfo] Failed for @${username}:`, err.message);
    return { followers: null };
  } finally {
    await browser.close();
  }
}

/* ─────────────────────────────────────────────────
   STUB — Safe for development & testing
───────────────────────────────────────────────── */
async function sendStub(username, message, extras) {
  console.log('\n════════════════════════════════════════');
  console.log(`[Instagram STUB] → DM to @${username}`);
  console.log('────────────────────────────────────────');
  console.log(message);
  if (extras.imageUrl) console.log(`[Attached image]: ${extras.imageUrl}`);
  if (extras.postLinks?.length) {
    console.log('[Post links]:');
    extras.postLinks.forEach((l, i) => console.log(`  ${i + 1}. ${l}`));
  }
  console.log('════════════════════════════════════════\n');

  const fakeId = `stub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return { success: true, messageId: fakeId };
}

/* ─────────────────────────────────────────────────
   REAL — Puppeteer Hidden Browser
───────────────────────────────────────────────── */
async function sendReal(username, message, extras) {
  let cookiesStr = await connection.get('ig_cookies');
  
  if (!cookiesStr) {
    if (fs.existsSync(COOKIES_PATH)) {
      // Local development fallback
      cookiesStr = fs.readFileSync(COOKIES_PATH, 'utf8');
    } else {
      throw new Error(`Cookies not found! The server may have restarted. Please click 'Save & Sync Now' in your ClawBot Chrome Extension to push fresh cookies to Redis.`);
    }
  }

  let cookies;
  try {
    cookies = JSON.parse(cookiesStr);
  } catch (err) {
    throw new Error('Failed to parse cookies JSON. Make sure the file is valid JSON.');
  }

  console.log(`[Puppeteer] Launching hidden browser...`);
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    // Inject browser cookies
    await page.setCookie(...cookies);

    console.log(`[Puppeteer] Navigating to @${username}...`);
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 2500)); // Wait for React profile header buttons to hydrate

    // 1. Follow the user if not already following
    const didFollow = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const followBtn = btns.find((b) => (b.textContent || '').trim().toLowerCase() === 'follow');
      if (followBtn) {
        followBtn.click();
        return true;
      }
      return false;
    });

    if (didFollow) {
      console.log(`[Puppeteer] Followed @${username}`);
      await new Promise((r) => setTimeout(r, 2000));
    }

    // 2. Click Message Button (with retry loop for React hydration)
    let clickedMessage = false;
    let directHref = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await page.evaluate(() => {
        const allEls = Array.from(document.querySelectorAll('div[role="button"], button, a'));
        
        // Strategy A: Check for explicit "Message" / "Send Message" text
        const msgBtn = allEls.find(el => {
          const text = (el.textContent || '').trim().toLowerCase();
          return text === 'message' || text === 'send message';
        });
        if (msgBtn) {
          msgBtn.click();
          return { clicked: true };
        }

        // Strategy B: Check for direct DM link
        const directLink = allEls.find(el => {
          const href = el.getAttribute('href') || '';
          return href.includes('/direct/t/') || href.includes('/direct/inbox/');
        });
        if (directLink) {
          return { clicked: false, href: directLink.getAttribute('href') };
        }

        return { clicked: false };
      });

      if (res.clicked) {
        clickedMessage = true;
        break;
      }
      if (res.href) {
        directHref = res.href;
        break;
      }

      await new Promise((r) => setTimeout(r, 1500));
    }

    if (directHref) {
      console.log(`[Puppeteer] Navigating directly to DM thread: ${directHref}...`);
      await page.goto(`https://www.instagram.com${directHref}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      clickedMessage = true;
    }

    if (!clickedMessage) {
      throw new Error(`Message button not found on @${username}'s profile. They might have DMs disabled.`);
    }

    console.log(`[Puppeteer] Opened chat, waiting for input box...`);

    // 3. Wait for chat input box
    const inputBoxSelector = 'div[contenteditable="true"]';
    await page.waitForSelector(inputBoxSelector, { timeout: 15000 });
    
    // Handle Instagram's occasional "Turn on Notifications" popup in DMs
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const notNow = btns.find(b => b.textContent === 'Not Now');
      if (notNow) notNow.click();
    }).catch(() => {}); // ignore errors if popup doesn't exist

    // 4. Type and send message
    await page.type(inputBoxSelector, message, { delay: 20 }); // delay mimics human typing
    await page.keyboard.press('Enter');

    console.log(`[Puppeteer] ✓ Message sent!`);
    
    // Wait for the message to actually go through over the network
    await new Promise((r) => setTimeout(r, 3000));

    return { success: true, messageId: `pupp_` + Date.now() };
  } finally {
    // Always close browser to save memory
    await browser.close();
  }
}
