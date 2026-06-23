document.addEventListener('DOMContentLoaded', () => {
  const serverUrlInput = document.getElementById('serverUrl');
  const secretKeyInput = document.getElementById('secretKey');
  const accountIdInput = document.getElementById('accountId');
  const saveBtn = document.getElementById('saveBtn');
  const statusDiv = document.getElementById('status');

  // Load saved settings
  chrome.storage.local.get(['serverUrl', 'secretKey', 'accountId'], (res) => {
    if (res.serverUrl) serverUrlInput.value = res.serverUrl;
    if (res.secretKey) secretKeyInput.value = res.secretKey;
    if (res.accountId) accountIdInput.value = res.accountId;
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = type;
    statusDiv.style.display = 'block';
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 5000);
  }

  saveBtn.addEventListener('click', () => {
    const serverUrl = serverUrlInput.value.trim();
    const secretKey = secretKeyInput.value.trim();
    const accountId = accountIdInput.value.trim();

    if (!serverUrl || !secretKey || !accountId) {
      showStatus('Please fill in all fields', 'error');
      return;
    }

    // Save to storage
    chrome.storage.local.set({ serverUrl, secretKey, accountId }, () => {
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
});
