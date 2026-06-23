import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log('Navigating to Picuki...');
    const response = await page.goto('https://www.picuki.com/tag/couplegoals', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    console.log('Status:', response.status());

    await new Promise(r => setTimeout(r, 4000));
    
    const postLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/media/"]'));
      return [...new Set(links.map(a => a.href))].slice(0, 5);
    });
    console.log('Found post links:', postLinks);

    if (postLinks.length > 0) {
      await page.goto(postLinks[0], { waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 4000));
      
      const profileInfo = await page.evaluate(() => {
        const username = document.querySelector('.single-profile-name')?.innerText.trim() || document.querySelector('.profile-name')?.innerText.trim();
        return { username };
      });
      console.log('Profile Info from post:', profileInfo);

      if (profileInfo.username) {
        await page.goto(`https://www.picuki.com/profile/${profileInfo.username}`, { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000));
        
        const stats = await page.evaluate(() => {
          const els = document.querySelectorAll('.content-title');
          let followers = 0;
          els.forEach(el => {
            if (el.innerText.includes('Followers')) {
              followers = parseInt(el.querySelector('.number').innerText.replace(/,/g, ''));
            }
          });
          const bio = document.querySelector('.profile-description')?.innerText.trim();
          return { followers, bio };
        });
        console.log('Stats:', stats);
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
})();
