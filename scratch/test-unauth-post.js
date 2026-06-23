import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Some public post
    const url = 'https://www.instagram.com/p/C6rI-K-P-jX/'; // just an example, hopefully public
    console.log('Navigating to', url);
    const response = await page.goto(url, { waitUntil: 'networkidle2' });
    
    console.log('Status:', response.status());
    await new Promise(r => setTimeout(r, 4000));
    
    const html = await page.content();
    console.log('Page title:', await page.title());
    
    // Check if we hit the login wall or the actual post
    const username = await page.evaluate(() => {
      const meta = document.querySelector('meta[property="og:url"]');
      if (meta) {
        const match = meta.content.match(/instagram\.com\/([^\/]+)\/p\//);
        if (match && match[1] !== 'p') return match[1];
      }
      return null;
    });
    console.log('Username extracted:', username);
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
})();
