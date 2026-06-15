import puppeteer from 'puppeteer';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';

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

  let cookiesStr;
  if (process.env.IG_COOKIES_JSON) {
    cookiesStr = process.env.IG_COOKIES_JSON;
  } else if (fs.existsSync(COOKIES_PATH)) {
    cookiesStr = fs.readFileSync(COOKIES_PATH, 'utf8');
  } else {
    console.warn('[getProfileInfo] No cookies found, skipping follower lookup.');
    return { followers: null };
  }

  let cookies;
  try { cookies = JSON.parse(cookiesStr); }
  catch { return { followers: null }; }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
  });

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
  let cookiesStr;
  
  if (process.env.IG_COOKIES_JSON) {
    // Cloud environment (Railway/Render)
    cookiesStr = process.env.IG_COOKIES_JSON;
  } else if (fs.existsSync(COOKIES_PATH)) {
    // Local development
    cookiesStr = fs.readFileSync(COOKIES_PATH, 'utf8');
  } else {
    throw new Error(`Cookies not found! Provide IG_COOKIES_JSON in cloud or cookies.json locally.`);
  }

  let cookies;
  try {
    cookies = JSON.parse(cookiesStr);
  } catch (err) {
    throw new Error('Failed to parse cookies JSON. Make sure the file is valid JSON.');
  }

  console.log(`[Puppeteer] Launching hidden browser...`);
  const browser = await puppeteer.launch({
    headless: true, // change to false if you want to visually see the browser
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    // Inject browser cookies
    await page.setCookie(...cookies);

    console.log(`[Puppeteer] Navigating to @${username}...`);
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'networkidle2' });

    // 1. Follow the user
    const didFollow = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const followBtn = btns.find((b) => b.textContent === 'Follow');
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

    // 2. Click Message Button
    const clickedMessage = await page.evaluate(() => {
      // Instagram's message button can be a div, button, or anchor link
      const allEls = Array.from(document.querySelectorAll('div[role="button"], button, a'));
      const msgBtn = allEls.find(el => {
        const text = el.textContent.trim().toLowerCase();
        return text === 'message' || text === 'send message';
      });
      if (msgBtn) {
        msgBtn.click();
        return true;
      }
      return false;
    });

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
