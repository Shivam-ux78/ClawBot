import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

(async () => {
  const cookiesPath = path.resolve('www.instagram.com.cookies.json');
  const cookiesStr = fs.readFileSync(cookiesPath, 'utf8');
  const cookies = JSON.parse(cookiesStr);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setCookie(...cookies);

    console.log('Navigating to hashtag explore...');
    await page.goto('https://www.instagram.com/explore/tags/couplegoals/', {
      waitUntil: 'networkidle2',
      timeout: 25000,
    });
    await new Promise(r => setTimeout(r, 4000));

    let continueClicked = false;
    // Check for "Continue" interstitial
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="button"]'));
      const continueBtn = btns.find(b => b.innerText.includes('Continue'));
      if (continueBtn) {
        continueBtn.click();
        return true;
      }
      return false;
    });

    if (clicked) {
      console.log('Clicked continue on interstitial, waiting 8s for redirect...');
      await new Promise(r => setTimeout(r, 8000));
      
      console.log('Redirected URL:', page.url());
      console.log('Re-navigating to hashtag explore...');
      await page.goto('https://www.instagram.com/explore/tags/couplegoals/', {
        waitUntil: 'networkidle2',
        timeout: 25000,
      });
      await new Promise(r => setTimeout(r, 4000));
    }

    const postLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/p/"]'));
      return [...new Set(links.map(a => a.href))].slice(0, 15);
    });
    console.log('Found /p/ links:', postLinks.length);
    if (postLinks.length > 0) {
      console.log('SUCCESS! Sample link:', postLinks[0]);
    } else {
      console.log('Still no posts found. Maybe we need to scroll or login is required.');
      await page.screenshot({ path: 'scratch/final_screenshot.png' });
    }

  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
})();
