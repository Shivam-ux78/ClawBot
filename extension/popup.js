// Defaults — keep these in sync with .env (EXTENSION_SECRET_KEY) and your
// actual deployment URL once you have one.
const DEFAULT_SECRET_KEY = 'ec60ed7c3da70862d55fb472e8014ba2';
const LOCAL_URL = 'http://localhost:3000/api/cookies/update';
const RENDER_URL = 'https://https-github-com-shivam-ux78-clawbot.onrender.com/api/cookies/update';

document.addEventListener('DOMContentLoaded', () => {
  const serverUrlInput = document.getElementById('serverUrl');
  const secretKeyInput = document.getElementById('secretKey');
  const saveBtn = document.getElementById('saveBtn');
  const linkedinBtn = document.getElementById('linkedinBtn');
  const useLocalUrl = document.getElementById('useLocalUrl');
  const useRenderUrl = document.getElementById('useRenderUrl');
  const statusDiv = document.getElementById('status');

  // Load saved settings, falling back to defaults so first-run is pre-filled.
  chrome.storage.local.get(['serverUrl', 'secretKey'], (res) => {
    serverUrlInput.value = res.serverUrl || LOCAL_URL;
    secretKeyInput.value = res.secretKey || DEFAULT_SECRET_KEY;
  });

  useLocalUrl.addEventListener('click', (e) => {
    e.preventDefault();
    serverUrlInput.value = LOCAL_URL;
  });

  useRenderUrl.addEventListener('click', (e) => {
    e.preventDefault();
    serverUrlInput.value = RENDER_URL;
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = type;
    statusDiv.style.display = 'block';
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 5000);
  }

  function normalizeUrl(url) {
    if (!url) return '';
    let cleanUrl = url.trim();
    cleanUrl = cleanUrl.replace(/^(https?:\/\/)+/i, '$1');
    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = 'https://' + cleanUrl;
    }
    cleanUrl = cleanUrl.replace(/\/+$/, '');
    if (!cleanUrl.endsWith('/api/cookies/update')) {
      cleanUrl += '/api/cookies/update';
    }
    return cleanUrl;
  }

  saveBtn.addEventListener('click', () => {
    const rawUrl = serverUrlInput.value.trim();
    const secretKey = secretKeyInput.value.trim();

    if (!rawUrl || !secretKey) {
      showStatus('Please fill in all fields', 'error');
      return;
    }

    const serverUrl = normalizeUrl(rawUrl);
    serverUrlInput.value = serverUrl;

    // Save to storage
    chrome.storage.local.set({ serverUrl, secretKey }, () => {
      showStatus('Settings saved! Syncing...', 'info');

      // Trigger a sync
      chrome.runtime.sendMessage({ action: 'syncNow' }, (response) => {
        if (chrome.runtime.lastError) {
          showStatus('Error: ' + chrome.runtime.lastError.message, 'error');
        } else if (response && response.success) {
          showStatus(response.message || 'Synced successfully!', 'success');
        } else {
          showStatus((response && response.error) || 'Sync failed', 'error');
        }
      });
    });
  });

  const scraperBtn = document.getElementById('scraperBtn');

  scraperBtn.addEventListener('click', () => {
    const rawUrl = serverUrlInput.value.trim();
    const secretKey = secretKeyInput.value.trim();

    if (!rawUrl || !secretKey) {
      showStatus('Please fill in all fields', 'error');
      return;
    }

    const serverUrl = normalizeUrl(rawUrl);
    serverUrlInput.value = serverUrl;

    chrome.storage.local.set({ serverUrl, secretKey }, () => {
      showStatus('Syncing Scraper Account cookies...', 'info');

      chrome.runtime.sendMessage({ action: 'syncScraperNow' }, (response) => {
        if (chrome.runtime.lastError) {
          showStatus('Error: ' + chrome.runtime.lastError.message, 'error');
        } else if (response && response.success) {
          showStatus(response.message || 'Scraper account cookies synced!', 'success');
        } else {
          showStatus((response && response.error) || 'Sync failed', 'error');
        }
      });
    });
  });

  linkedinBtn.addEventListener('click', () => {
    const rawUrl = serverUrlInput.value.trim();
    const secretKey = secretKeyInput.value.trim();

    if (!rawUrl || !secretKey) {
      showStatus('Fill in Cloud API URL + Secret Key first', 'error');
      return;
    }

    const serverUrl = normalizeUrl(rawUrl);
    serverUrlInput.value = serverUrl;

    chrome.storage.local.set({ serverUrl, secretKey }, () => {
      showStatus('Syncing LinkedIn cookies...', 'info');

      chrome.runtime.sendMessage({ action: 'syncLinkedInNow' }, (response) => {
        if (chrome.runtime.lastError) {
          showStatus('Error: ' + chrome.runtime.lastError.message, 'error');
        } else if (response && response.success) {
          showStatus(response.message || 'Synced successfully!', 'success');
        } else {
          showStatus((response && response.error) || 'Sync failed', 'error');
        }
      });
    });
  });
});
