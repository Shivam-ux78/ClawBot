async function pushCookies(serverUrl, secretKey, cookies, platform) {
  try {
    const response = await fetch(serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secretKey, cookies, platform }),
    });

    const data = await response.json();
    if (response.ok) {
      console.log(`[ClawBot Sync] ${platform} cookies synced!`);
      return { success: true, message: 'Cookies synced to cloud!' };
    }
    console.error('[ClawBot Sync] Server error:', data.error);
    return { success: false, error: data.error || 'Server rejected the request.' };
  } catch (err) {
    console.error('[ClawBot Sync] Network error:', err.message);
    return { success: false, error: 'Network error connecting to server.' };
  }
}

// Instagram: no account matching — syncs whichever Instagram account is
// currently logged into this browser, same as the LinkedIn flow.
async function syncInstagramCookies() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['serverUrl', 'secretKey'], async (config) => {
      if (!config.serverUrl || !config.secretKey) {
        return resolve({ success: false, error: 'Extension not configured yet.' });
      }

      chrome.cookies.getAll({ domain: 'instagram.com' }, async (cookies) => {
        const dsUserIdCookie = cookies.find(c => c.name === 'ds_user_id');

        if (!dsUserIdCookie) {
          console.log('[ClawBot Sync] No ds_user_id cookie found. Not logged into Instagram.');
          return resolve({ success: false, error: 'Not logged into Instagram.' });
        }

        console.log('[ClawBot Sync] Pushing Instagram cookies to server...');
        resolve(await pushCookies(config.serverUrl, config.secretKey, cookies, 'instagram'));
      });
    });
  });
}

// LinkedIn: no account matching — this is meant for a dedicated temp/throwaway
// account used purely for discovery scraping, so whoever is logged in is synced.
async function syncLinkedInCookies() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['serverUrl', 'secretKey'], async (config) => {
      if (!config.serverUrl || !config.secretKey) {
        return resolve({ success: false, error: 'Extension not configured yet.' });
      }

      chrome.cookies.getAll({ domain: 'linkedin.com' }, async (cookies) => {
        const liAtCookie = cookies.find(c => c.name === 'li_at');
        if (!liAtCookie) {
          console.log('[ClawBot Sync] No li_at cookie found. Not logged into LinkedIn.');
          return resolve({ success: false, error: 'Not logged into LinkedIn.' });
        }

        console.log('[ClawBot Sync] Pushing LinkedIn cookies to server...');
        resolve(await pushCookies(config.serverUrl, config.secretKey, cookies, 'linkedin'));
      });
    });
  });
}

// Listen for manual sync trigger from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'syncNow') {
    syncInstagramCookies().then(sendResponse);
    return true; // Keep message channel open for async response
  }
  if (request.action === 'syncLinkedInNow') {
    syncLinkedInCookies().then(sendResponse);
    return true;
  }
});

// Setup alarm to periodically sync every 30 minutes
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('syncAlarm', { periodInMinutes: 30 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'syncAlarm') {
    syncInstagramCookies();
    syncLinkedInCookies();
  }
});
