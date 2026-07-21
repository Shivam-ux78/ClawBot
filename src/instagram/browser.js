import puppeteer from 'puppeteer';

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage', // Render containers use a small /dev/shm; Chrome crashes without this
  '--window-size=1280,800',
];

/**
 * Launch a headless Chrome instance shared by discovery + DM sending.
 * On Render (Docker), PUPPETEER_EXECUTABLE_PATH points at the apt-installed
 * chromium binary instead of puppeteer's own downloaded copy.
 */
export async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: LAUNCH_ARGS,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
}
