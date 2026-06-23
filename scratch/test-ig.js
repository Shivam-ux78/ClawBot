import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

(async () => {
  const cookiesPath = path.resolve('www.instagram.com.cookies.json');
  const cookiesStr = fs.readFileSync(cookiesPath, 'utf8');
  const cookies = JSON.parse(cookiesStr);

  const browser = await puppeteer.launch({
    headless: true, // We can run headless and take a screenshot
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setCookie(...cookies);

    console.log('Navigating to explore page...');
    await page.goto('https://www.instagram.com/explore/tags/couplegoals/', {
      waitUntil: 'networkidle2',
      timeout: 25000,
    });
    
    await new Promise(r => setTimeout(r, 5000));
    
    await page.screenshot({ path: 'scratch/screenshot.png' });
    console.log('Screenshot saved to scratch/screenshot.png');

    const html = await page.content();
    fs.writeFileSync('scratch/page.html', html);
    console.log('HTML saved to scratch/page.html');

    const links = await page.evaluate(() => {
      const allLinks = Array.from(document.querySelectorAll('a')).map(a => a.href);
      return allLinks;
    });
    
    console.log('Found total links:', links.length);
    console.log('Sample links:', links.slice(0, 10));

    const postLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/p/"]'));
      return [...new Set(links.map(a => a.href))].slice(0, 15);
    });
    console.log('Found /p/ links:', postLinks.length);

  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
})();
