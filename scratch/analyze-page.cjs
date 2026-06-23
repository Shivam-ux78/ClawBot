const fs = require('fs');
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(fs.readFileSync('scratch/page.html', 'utf8'));
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[role="button"]')).map(b => b.innerText);
  });
  console.log('Buttons:', buttons);
  
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).map(a => a.innerText + " => " + a.href);
  });
  console.log('Links:', links);
  
  await browser.close();
})();
