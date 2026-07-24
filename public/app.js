/* ─────────────────────────────────────────────────────────────
   ClawBot Dashboard App Engine
───────────────────────────────────────────────────────────── */

let activeStateFilter = 'all';
let activeSearchQuery = '';
let currentActiveCreator = null;
let authToken = localStorage.getItem('cb_auth_token') || '';

document.addEventListener('DOMContentLoaded', async () => {
  initAuth();
  initTabs();
  initStateFilters();
  initSearch();
  initModals();
  initDrawer();
  initForms();
  initTriggers();
  
  if (await checkAuth()) {
    hideLoginScreen();
    loadAllData();
    setInterval(loadAllData, 8000);
  } else {
    showLoginScreen();
  }

  document.getElementById('btnRefresh').addEventListener('click', () => {
    loadAllData();
    showToast('Dashboard data refreshed!', 'success');
  });
});

function initAuth() {
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');
  const btnLogout = document.getElementById('btnLogout');

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      loginError.style.display = 'none';

      const username = document.getElementById('loginUsername').value.trim();
      const password = document.getElementById('loginPassword').value.trim();

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (data.success && data.token) {
          authToken = data.token;
          localStorage.setItem('cb_auth_token', authToken);
          hideLoginScreen();
          loadAllData();
          setInterval(loadAllData, 8000);
          showToast('Welcome back, Admin!', 'success');
        } else {
          loginError.textContent = data.error || 'Invalid credentials';
          loginError.style.display = 'block';
        }
      } catch (err) {
        loginError.textContent = 'Connection error: ' + err.message;
        loginError.style.display = 'block';
      }
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
      } catch (e) {}

      authToken = '';
      localStorage.removeItem('cb_auth_token');
      showLoginScreen();
      showToast('Logged out successfully', 'info');
    });
  }
}

async function checkAuth() {
  if (!authToken) return false;
  try {
    const res = await fetch(`/api/auth/check?token=${encodeURIComponent(authToken)}`);
    const data = await res.json();
    return data.authenticated === true;
  } catch (e) {
    return false;
  }
}

function showLoginScreen() {
  document.getElementById('loginScreen').classList.add('active');
}

function hideLoginScreen() {
  document.getElementById('loginScreen').classList.remove('active');
}

/* ─────────────────────────────────────────────────────────────
   Data Fetching & Rendering
───────────────────────────────────────────────────────────── */
async function loadAllData() {
  await Promise.all([
    fetchStats(),
    fetchCreators(),
    fetchDeals(),
    fetchEmailLeads(),
    fetchSettings(),
  ]);
}

// 1. Fetch Stats
async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (!data.success) return;

    const { stats, system } = data;

    // Stat Values
    document.getElementById('statTotalCreators').textContent = stats.totalCreators;
    document.getElementById('statPendingCount').textContent = stats.creatorStates.pending || 0;
    document.getElementById('statOutreachCount').textContent = (stats.creatorStates.outreach_sent || 0) + (stats.creatorStates.negotiating || 0);
    document.getElementById('statClosedDeals').textContent = stats.closedDeals;
    document.getElementById('statDealValueText').textContent = `$${stats.totalDealValue.toLocaleString()} Total Value`;

    // Meter Fill
    document.getElementById('statDmMeterVal').textContent = `${stats.dmsSentToday} / ${stats.dmDailyLimit}`;
    const pct = Math.min(100, Math.round((stats.dmsSentToday / (stats.dmDailyLimit || 30)) * 100));
    document.getElementById('meterDmFill').style.width = `${pct}%`;

    // Badges
    document.getElementById('badgeMode').innerHTML = `<span class="dot"></span> IG Mode: ${system.instagramStubMode ? 'STUB 🧪' : 'REAL 📡'}`;
  } catch (err) {
    console.error('Error fetching stats:', err);
  }
}

// 2. Fetch Creators
async function fetchCreators() {
  try {
    const query = new URLSearchParams();
    if (activeStateFilter !== 'all') query.append('state', activeStateFilter);
    if (activeSearchQuery) query.append('search', activeSearchQuery);

    const res = await fetch(`/api/creators?${query.toString()}`);
    const data = await res.json();
    if (!data.success) return;

    renderCreatorsTable(data.creators);
  } catch (err) {
    console.error('Error fetching creators:', err);
  }
}

function renderCreatorsTable(creators) {
  const tbody = document.getElementById('creatorsTableBody');
  if (!creators || creators.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-cell">No creators found matching criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = creators.map((c) => {
    const followersText = c.followers ? Number(c.followers).toLocaleString() : 'N/A';
    const locationText = c.location || 'US';
    const nicheText = c.niche || 'Couple';
    const priceText = c.quoted_price ? `$${c.quoted_price}` : '—';
    const botMode = c.bot_state || 'active';

    return `
      <tr>
        <td>
          <div style="font-weight: 600; color: #fff;">@${escapeHtml(c.username)}</div>
          <div style="font-size: 0.775rem; color: var(--text-dim);">${c.bio ? escapeHtml(c.bio.substring(0, 40)) + '...' : ''}</div>
        </td>
        <td><strong>${followersText}</strong></td>
        <td>
          <div>${escapeHtml(nicheText)}</div>
          <div style="font-size: 0.775rem; color: var(--text-dim);">${escapeHtml(locationText)}</div>
        </td>
        <td><span class="badge badge-${c.state}">${c.state.replace('_', ' ')}</span></td>
        <td>
          <select class="btn-sm" style="background: rgba(0,0,0,0.5);" onchange="updateBotState(${c.id}, this.value)">
            <option value="active" ${botMode === 'active' ? 'selected' : ''}>🤖 Active (AI)</option>
            <option value="paused" ${botMode === 'paused' ? 'selected' : ''}>⏸️ Paused</option>
            <option value="manual" ${botMode === 'manual' ? 'selected' : ''}>👤 Manual</option>
          </select>
        </td>
        <td><strong>${priceText}</strong></td>
        <td>
          <div style="display: flex; gap: 0.4rem;">
            ${c.state === 'pending' ? `
              <button class="btn btn-primary btn-sm" onclick="approveCreator(${c.id})">Approve</button>
              <button class="btn btn-secondary btn-sm" style="color: #f87171;" onclick="rejectCreator(${c.id})">Reject</button>
            ` : ''}
            <button class="btn btn-secondary btn-sm" onclick="openChatDrawer(${c.id}, '${escapeHtml(c.username)}', '${c.state}')">💬 Chat</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// 3. Fetch Deals
async function fetchDeals() {
  try {
    const res = await fetch('/api/deals');
    const data = await res.json();
    if (!data.success) return;

    renderDealsTable(data.deals);
  } catch (err) {
    console.error('Error fetching deals:', err);
  }
}

function renderDealsTable(deals) {
  const tbody = document.getElementById('dealsTableBody');
  if (!deals || deals.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-cell">No active deal proposals found.</td></tr>`;
    return;
  }

  tbody.innerHTML = deals.map((d) => {
    const dateText = new Date(d.created_at).toLocaleDateString();
    return `
      <tr>
        <td>#${d.id}</td>
        <td><strong>@${escapeHtml(d.username)}</strong></td>
        <td><strong style="color: #34d399; font-size: 1rem;">$${d.proposed_price}</strong></td>
        <td>Target: $100 (Range $50–$150)</td>
        <td><span class="badge badge-${d.status}">${d.status}</span></td>
        <td>${dateText}</td>
        <td>
          ${d.status === 'pending' ? `
            <button class="btn btn-primary btn-sm" onclick="resolveDeal(${d.id}, 'approve')">Accept Offer</button>
            <button class="btn btn-secondary btn-sm" style="color: #f87171;" onclick="resolveDeal(${d.id}, 'reject')">Reject</button>
          ` : '<span style="color: var(--text-dim);">Resolved</span>'}
        </td>
      </tr>
    `;
  }).join('');
}

// 4. Fetch Email Leads
async function fetchEmailLeads() {
  try {
    const res = await fetch('/api/email-leads');
    const data = await res.json();
    if (!data.success) return;

    renderLeadsTable(data.leads);
  } catch (err) {
    console.error('Error fetching email leads:', err);
  }
}

function renderLeadsTable(leads) {
  const tbody = document.getElementById('leadsTableBody');
  if (!leads || leads.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="loading-cell">No email leads in discovery pipeline.</td></tr>`;
    return;
  }

  tbody.innerHTML = leads.map((l) => {
    const dateText = new Date(l.created_at).toLocaleDateString();
    return `
      <tr>
        <td><strong>${escapeHtml(l.full_name || 'N/A')}</strong></td>
        <td><code style="color: #a5b4fc;">${escapeHtml(l.email)}</code></td>
        <td>
          <div>${escapeHtml(l.company || 'N/A')}</div>
          <div style="font-size: 0.775rem; color: var(--text-dim);">${escapeHtml(l.title || '')}</div>
        </td>
        <td>${escapeHtml(l.location || 'US')}</td>
        <td><span class="badge badge-${l.state}">${l.state}</span></td>
        <td>${dateText}</td>
      </tr>
    `;
  }).join('');
}

let isAutoDmModeActive = false;
let autoDmThresholdVal = 50;

// 5. Fetch Settings
async function fetchSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (!data.success) return;

    const { config, dbSettings } = data;
    if (dbSettings && dbSettings.AUTO_DM_MODE !== undefined) {
      isAutoDmModeActive = dbSettings.AUTO_DM_MODE === true || dbSettings.AUTO_DM_MODE === 'true';
    }
    if (config.autoDmMinConfidence !== undefined) {
      autoDmThresholdVal = Number(config.autoDmMinConfidence) || 50;
      const inputVal = document.getElementById('inputAutoDmThreshold');
      if (inputVal && document.activeElement !== inputVal) {
        inputVal.value = autoDmThresholdVal;
      }
      const cfgVal = document.getElementById('cfgAutoDmThreshold');
      if (cfgVal) cfgVal.value = autoDmThresholdVal;
    }

    updateOutreachModeUI(isAutoDmModeActive, autoDmThresholdVal);

    if (config.extensionSecretKey) {
      document.getElementById('secretKeyDisplay').textContent = config.extensionSecretKey;
    }

    document.getElementById('cfgMinFollowers').value = config.minFollowers;
    document.getElementById('cfgMaxFollowers').value = config.maxFollowers;
    document.getElementById('cfgLocation').value = config.discoveryLocation;
    document.getElementById('cfgCategory').value = config.discoveryCategory;
    document.getElementById('cfgDmLimit').value = config.dmDailyLimit;
    if (document.getElementById('cfgAutoDmThreshold')) {
      document.getElementById('cfgAutoDmThreshold').value = autoDmThresholdVal;
    }
    document.getElementById('cfgTelegramChatIds').value = config.telegramChatIds ? config.telegramChatIds.join(', ') : '';
  } catch (err) {
    console.error('Error fetching settings:', err);
  }
}

function updateOutreachModeUI(isAuto, threshold = 50) {
  const pill = document.getElementById('modePill');
  const headline = document.getElementById('modeHeadline');
  const desc = document.getElementById('modeDesc');
  const btn = document.getElementById('btnToggleAutoDM');

  if (!pill || !btn) return;

  if (isAuto) {
    pill.innerHTML = `⚡ AUTO DM MODE: <strong style="color: #34d399;">ON 🟢</strong> (≥${threshold}% match)`;
    pill.className = 'mode-pill mode-auto-dm';
    headline.textContent = `Auto DMs ON — Creators with ≥${threshold}% target match auto-contacted`;
    desc.innerHTML = `Discovered creators with <strong>≥${threshold}% confidence match</strong> will be automatically approved & sent DMs immediately.`;
    btn.innerHTML = '<span>Auto DM: <strong style="text-decoration: underline;">ON 🟢</strong></span> &nbsp;|&nbsp; <span style="font-weight: 400; opacity: 0.9;">Click to Turn OFF 🔴</span>';
    btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
    btn.style.boxShadow = '0 4px 14px rgba(16, 185, 129, 0.4)';
  } else {
    pill.innerHTML = '🔍 SCRAPE ONLY MODE: <strong style="color: #fbbf24;">OFF 🔴</strong>';
    pill.className = 'mode-pill mode-scrape-only';
    headline.textContent = 'Auto DMs OFF — Accounts collected for manual review';
    desc.innerHTML = 'All discovered creators are stored in PostgreSQL & listed below. DMs will <strong>ONLY</strong> be sent when you click <strong>Approve & Send DM</strong>.';
    btn.innerHTML = '<span>Auto DM: <strong style="text-decoration: underline;">OFF 🔴</strong></span> &nbsp;|&nbsp; <span style="font-weight: 400; opacity: 0.9;">Click to Turn ON 🟢</span>';
    btn.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
    btn.style.boxShadow = '0 4px 14px rgba(245, 158, 11, 0.4)';
  }
}

/* ─────────────────────────────────────────────────────────────
   Actions (Approve, Reject, Bot Mode, Chat, Deals)
───────────────────────────────────────────────────────────── */
window.approveCreator = async function(id) {
  try {
    const res = await fetch(`/api/creators/${id}/approve`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Creator approved! Outreach DM queued.', 'success');
      loadAllData();
    } else {
      showToast(data.error || 'Failed to approve creator', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.rejectCreator = async function(id) {
  try {
    const res = await fetch(`/api/creators/${id}/reject`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Creator rejected.', 'success');
      loadAllData();
    } else {
      showToast(data.error || 'Failed to reject creator', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.updateBotState = async function(id, botState) {
  try {
    const res = await fetch(`/api/creators/${id}/bot-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botState }),
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Bot mode updated to ${botState}`, 'success');
      loadAllData();
    } else {
      showToast(data.error || 'Failed to update bot mode', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.resolveDeal = async function(id, action) {
  try {
    const res = await fetch(`/api/deals/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Deal ${action}d successfully!`, 'success');
      loadAllData();
    } else {
      showToast(data.error || 'Failed to resolve deal', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

/* ─────────────────────────────────────────────────────────────
   Slide-over Chat Drawer
───────────────────────────────────────────────────────────── */
window.openChatDrawer = async function(creatorId, username, state) {
  currentActiveCreator = { id: creatorId, username, state };
  document.getElementById('drawerUsername').textContent = `@${username}`;
  
  const badge = document.getElementById('drawerStateBadge');
  badge.textContent = state.replace('_', ' ');
  badge.className = `badge badge-${state}`;

  document.getElementById('chatDrawerOverlay').classList.add('active');
  document.getElementById('chatDrawer').classList.add('active');

  await loadChatHistory(creatorId);
};

function closeChatDrawer() {
  document.getElementById('chatDrawerOverlay').classList.remove('active');
  document.getElementById('chatDrawer').classList.remove('active');
  currentActiveCreator = null;
}

async function loadChatHistory(creatorId) {
  const container = document.getElementById('drawerChatMessages');
  container.innerHTML = '<div class="empty-chat">Loading messages...</div>';

  try {
    const res = await fetch(`/api/creators/${creatorId}/conversations`);
    const data = await res.json();

    if (!data.success || !data.conversations || data.conversations.length === 0) {
      container.innerHTML = '<div class="empty-chat">No messages in conversation history yet.</div>';
      return;
    }

    container.innerHTML = data.conversations.map((m) => {
      const isOut = m.direction === 'out';
      const timeStr = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="chat-bubble ${isOut ? 'out' : 'in'}">
          <div>${escapeHtml(m.message)}</div>
          <div class="chat-meta">${isOut ? (m.sent_by === 'ai' ? '🤖 AI' : '👤 Outgoing') : '📩 Creator'} • ${timeStr}</div>
        </div>
      `;
    }).join('');

    container.scrollTop = container.scrollHeight;
  } catch (err) {
    container.innerHTML = `<div class="empty-chat" style="color: #f87171;">Error loading messages: ${err.message}</div>`;
  }
}

/* ─────────────────────────────────────────────────────────────
   Tab Navigation & Filters
───────────────────────────────────────────────────────────── */
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));

      btn.classList.add('active');
      const targetId = `tab${capitalize(btn.dataset.tab)}`;
      document.getElementById(targetId).classList.add('active');
    });
  });
}

function initStateFilters() {
  const pills = document.querySelectorAll('#stateFilters .filter-pill');
  pills.forEach((p) => {
    p.addEventListener('click', () => {
      pills.forEach((x) => x.classList.remove('active'));
      p.classList.add('active');
      activeStateFilter = p.dataset.state;
      fetchCreators();
    });
  });
}

function initSearch() {
  const searchInput = document.getElementById('searchInput');
  let timeout = null;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      activeSearchQuery = e.target.value.trim();
      fetchCreators();
    }, 300);
  });
}

/* ─────────────────────────────────────────────────────────────
   Modals & Forms Initialization
───────────────────────────────────────────────────────────── */
function initModals() {
  // Add Creator Modal
  document.getElementById('btnAddCreatorModal').addEventListener('click', () => {
    openModal('addCreatorModal');
  });
  document.getElementById('btnCloseAddModal').addEventListener('click', () => closeModal('addCreatorModal'));
  document.getElementById('btnCancelAdd').addEventListener('click', () => closeModal('addCreatorModal'));

  // Add Lead Modal
  document.getElementById('btnAddLeadModal').addEventListener('click', () => openModal('addLeadModal'));
  document.getElementById('btnCloseLeadModal').addEventListener('click', () => closeModal('addLeadModal'));
  document.getElementById('btnCancelLead').addEventListener('click', () => closeModal('addLeadModal'));

  // Simulate Reply Modal
  document.getElementById('btnSimulateModal').addEventListener('click', () => openModal('simulateModal'));
  document.getElementById('btnCloseSimulateModal').addEventListener('click', () => closeModal('simulateModal'));
  document.getElementById('btnCancelSimulate').addEventListener('click', () => closeModal('simulateModal'));
}

function initDrawer() {
  document.getElementById('btnCloseDrawer').addEventListener('click', closeChatDrawer);
  document.getElementById('chatDrawerOverlay').addEventListener('click', closeChatDrawer);

  document.getElementById('btnSendDrawerMessage').addEventListener('click', async () => {
    if (!currentActiveCreator) return;
    const input = document.getElementById('drawerMessageInput');
    const msg = input.value.trim();
    if (!msg) return;

    try {
      const res = await fetch(`/api/creators/${currentActiveCreator.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Message queued for delivery!', 'success');
        input.value = '';
        await loadChatHistory(currentActiveCreator.id);
      } else {
        showToast(data.error || 'Failed to queue message', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function initForms() {
  // Add Creator Form
  document.getElementById('addCreatorForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('addUsername').value;
    const followers = document.getElementById('addFollowers').value;
    const niche = document.getElementById('addNiche').value;
    const location = document.getElementById('addLocation').value;

    try {
      const res = await fetch('/api/creators/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, followers, niche, location }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Creator @${data.creator.username} added & stage 1 approval triggered!`, 'success');
        closeModal('addCreatorModal');
        document.getElementById('addCreatorForm').reset();
        loadAllData();
      } else {
        showToast(data.error || 'Failed to add creator', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Add Lead Form
  document.getElementById('addLeadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const full_name = document.getElementById('leadName').value;
    const email = document.getElementById('leadEmail').value;
    const company = document.getElementById('leadCompany').value;
    const title = document.getElementById('leadTitle').value;
    const linkedin_url = document.getElementById('leadLinkedin').value;

    try {
      const res = await fetch('/api/email-leads/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name, email, company, title, linkedin_url }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Lead ${data.lead.email} added!`, 'success');
        closeModal('addLeadModal');
        document.getElementById('addLeadForm').reset();
        loadAllData();
      } else {
        showToast(data.error || 'Failed to add lead', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Simulate Form
  document.getElementById('simulateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('simUsername').value;
    const message = document.getElementById('simMessage').value;

    try {
      const res = await fetch('/instagram/webhook/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, message }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Incoming reply simulated! Telegram & WhatsApp notified.', 'success');
        closeModal('simulateModal');
        document.getElementById('simulateForm').reset();
        loadAllData();
      } else {
        showToast(data.error || 'Simulation failed', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // System Settings Form
  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      minFollowers: document.getElementById('cfgMinFollowers').value,
      maxFollowers: document.getElementById('cfgMaxFollowers').value,
      discoveryLocation: document.getElementById('cfgLocation').value,
      discoveryCategory: document.getElementById('cfgCategory').value,
      dmDailyLimit: document.getElementById('cfgDmLimit').value,
      autoDmMinConfidence: document.getElementById('cfgAutoDmThreshold') ? document.getElementById('cfgAutoDmThreshold').value : 50,
      telegramChatIds: document.getElementById('cfgTelegramChatIds').value,
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        showToast('System settings saved!', 'success');
        loadAllData();
      } else {
        showToast(data.error || 'Failed to save settings', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function initTriggers() {
  const btnSaveThreshold = document.getElementById('btnSaveThreshold');
  if (btnSaveThreshold) {
    btnSaveThreshold.addEventListener('click', async () => {
      const val = Number(document.getElementById('inputAutoDmThreshold').value);
      if (isNaN(val) || val < 0 || val > 100) {
        showToast('Please enter a match threshold between 0% and 100%', 'error');
        return;
      }
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autoDmMinConfidence: val }),
        });
        const data = await res.json();
        if (data.success) {
          autoDmThresholdVal = val;
          updateOutreachModeUI(isAutoDmModeActive, autoDmThresholdVal);
          showToast(`Auto DM Min Match target updated to ${val}%!`, 'success');
        } else {
          showToast(data.error || 'Failed to save threshold', 'error');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  const btnToggleAutoDM = document.getElementById('btnToggleAutoDM');
  if (btnToggleAutoDM) {
    btnToggleAutoDM.addEventListener('click', async () => {
      const nextState = !isAutoDmModeActive;
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autoDmMode: nextState }),
        });
        const data = await res.json();
        if (data.success) {
          isAutoDmModeActive = nextState;
          updateOutreachModeUI(isAutoDmModeActive, autoDmThresholdVal);
          showToast(
            nextState ? '⚡ Auto DM Mode enabled! Matching creators will be auto-contacted.' : '🔍 Scrape Only Mode enabled! DMs will only be sent when manually approved.',
            'success'
          );
        } else {
          showToast(data.error || 'Failed to update mode', 'error');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  document.getElementById('btnTriggerDiscovery').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/jobs/trigger-discovery', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Instagram discovery job started in background!', 'success');
      } else {
        showToast(data.error || 'Trigger failed', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btnTriggerLinkedIn').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/jobs/trigger-linkedin', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('LinkedIn email discovery started in background!', 'success');
      } else {
        showToast(data.error || 'Trigger failed', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  initCookieUpload('fileCookiesMain', 'statusCookiesMain', 'instagram', 'DM Account');
  initCookieUpload('fileCookiesDiscovery', 'statusCookiesDiscovery', 'instagram_discovery', 'Scraping Account');
}

/**
 * Wires a hidden <input type="file"> to read the selected cookies JSON and
 * POST it to /api/cookies/update for the given platform, replacing the need
 * for the Chrome extension when cookies expire.
 */
function initCookieUpload(inputId, statusId, platform, label) {
  const input = document.getElementById(inputId);
  const status = document.getElementById(statusId);
  if (!input) return;

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    status.textContent = `Uploading ${file.name}...`;
    status.className = 'cookie-upload-status';

    try {
      const text = await file.text();
      let cookies;
      try {
        cookies = JSON.parse(text);
      } catch {
        throw new Error('That file is not valid JSON.');
      }
      if (!Array.isArray(cookies)) {
        throw new Error('Expected a JSON array of cookie objects.');
      }

      const secretKey = document.getElementById('secretKeyDisplay').textContent.trim();

      const res = await fetch('/api/cookies/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secretKey, cookies, platform }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        status.textContent = `✅ ${label} cookies synced (${cookies.length} cookies) at ${new Date().toLocaleTimeString()}`;
        status.className = 'cookie-upload-status success';
        showToast(`${label} cookies updated!`, 'success');
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (err) {
      status.textContent = `❌ ${err.message}`;
      status.className = 'cookie-upload-status error';
      showToast(err.message, 'error');
    } finally {
      input.value = '';
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */
function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
