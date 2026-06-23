// Function to extract cookies and push to server
async function syncCookies() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['serverUrl', 'secretKey', 'accountId'], async (config) => {
      if (!config.serverUrl || !config.secretKey || !config.accountId) {
        return resolve({ success: false, error: 'Extension not configured yet.' });
      }

      chrome.cookies.getAll({ domain: 'instagram.com' }, async (cookies) => {
        // Find who is logged in
        const dsUserIdCookie = cookies.find(c => c.name === 'ds_user_id');
        
        if (!dsUserIdCookie) {
          console.log('[ClawBot Sync] No ds_user_id cookie found. Not logged into Instagram.');
          return resolve({ success: false, error: 'Not logged into Instagram.' });
        }

        if (dsUserIdCookie.value !== config.accountId) {
          console.log(`[ClawBot Sync] Account mismatch. Logged in: ${dsUserIdCookie.value}, Target: ${config.accountId}`);
          return resolve({ success: false, error: 'Logged into a different account. Ignoring.' });
        }

        console.log('[ClawBot Sync] Account matched! Pushing cookies to server...');

        try {
          const response = await fetch(config.serverUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              secretKey: config.secretKey,
              cookies: cookies
            })
          });

          const data = await response.json();
          if (response.ok) {
            console.log('[ClawBot Sync] Successfully synced!');
            return resolve({ success: true, message: 'Cookies synced to cloud!' });
          } else {
            console.error('[ClawBot Sync] Server error:', data.error);
            return resolve({ success: false, error: data.error || 'Server rejected the request.' });
          }
        } catch (err) {
          console.error('[ClawBot Sync] Network error:', err.message);
          return resolve({ success: false, error: 'Network error connecting to server.' });
        }
      });
    });
  });
}

// Listen for manual sync trigger from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'syncNow') {
    syncCookies().then(sendResponse);
    return true; // Keep message channel open for async response
  }
});

// Setup alarm to periodically sync every 30 minutes
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('syncAlarm', { periodInMinutes: 30 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'syncAlarm') {
    syncCookies();
  }
});
