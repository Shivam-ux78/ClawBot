import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const query = encodeURIComponent('site:instagram.com "#couplegoals" "Followers"');
    await page.goto(`https://www.google.com/search?q=${query}&num=20`, { waitUntil: 'networkidle2' });
    
    await page.screenshot({ path: 'scratch/google_test.png' });
    
    // Accept cookies if present (Google consent)
    try {
      const btn = await page.$('button div:contains("Accept all")');
      if (btn) await btn.click();
      await new Promise(r => setTimeout(r, 2000));
    } catch(e) {}

    const text = await page.evaluate(() => document.body.innerText);
    console.log(text.substring(0, 500));

  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
})();
