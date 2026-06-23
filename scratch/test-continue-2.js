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

    await page.goto('https://www.instagram.com/explore/tags/couplegoals/', {
      waitUntil: 'networkidle2',
    });
    await new Promise(r => setTimeout(r, 4000));

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="button"]'));
      const continueBtn = btns.find(b => b.innerText.includes('Continue'));
      if (continueBtn) continueBtn.click();
    });

    await new Promise(r => setTimeout(r, 8000));
    
    await page.goto('https://www.instagram.com/explore/tags/couplegoals/', {
      waitUntil: 'networkidle2',
    });
    await new Promise(r => setTimeout(r, 4000));

    const text = await page.evaluate(() => document.body.innerText);
    console.log(text.substring(0, 1000));

  } finally {
    await browser.close();
  }
})();
