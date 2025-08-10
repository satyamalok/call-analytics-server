// Global Variables
let socket = null;
let dashboardData = {};
let isConnected = false;
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let sortBy = 'agentCode';
let sortDirection = 'asc';

// Debug logging
function debugLog(message, data = null) {
  const timestamp = new Date().toLocaleTimeString();
  const logMessage = `[${timestamp}] ${message}`;
  
  console.log(logMessage, data || '');
  
  const debugContent = document.getElementById('debugContent');
  if (debugContent) {
    debugContent.textContent += `\n${logMessage}${data ? ' ' + JSON.stringify(data, null, 2) : ''}`;
    debugContent.scrollTop = debugContent.scrollHeight;
  }
}

// Utility Functions
function sanitizeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0s';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${remainingSeconds}s`;
  }
}

function formatTime(timestamp) {
  if (!timestamp) return 'Unknown';
  
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function formatPhoneNumber(phoneNumber) {
  if (!phoneNumber) return 'Unknown';
  
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return `+91 ${cleaned.substring(2, 7)} ${cleaned.substring(7)}`;
  } else if (cleaned.length === 10) {
    return `${cleaned.substring(0, 5)} ${cleaned.substring(5)}`;
  }
  
  return phoneNumber;
}

function formatAgentCount(count) {
  if (count === 0) return 'No agents';
  if (count === 1) return '1 agent';
  return `${count} agents`;
}

function formatLastUpdated(timestamp) {
  if (!timestamp) return '';
  
  const now = new Date();
  const updated = new Date(timestamp);
  const diffSeconds = Math.floor((now - updated) / 1000);
  
  if (diffSeconds < 10) return 'Just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  
  const diffHours = Math.floor(diffMinutes / 60);
  return `${diffHours}h ago`;
}

// Toast Notifications
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toastId = 'toast_' + Date.now();
  const toast = document.createElement('div');
  toast.className = `toast ${type} fade-in`;
  toast.id = toastId;

  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };

  toast.innerHTML = `
    <div class="toast-content">
      <div class="toast-message">
        ${icons[type] || icons.info} ${sanitizeHTML(message)}
      </div>
      <button class="toast-close" onclick="removeToast('${toastId}')">&times;</button>
    </div>
    ${duration > 0 ? '<div class="toast-progress"></div>' : ''}
  `;

  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => removeToast(toastId), duration);
  }

  debugLog(`Toast shown: ${type} - ${message}`);
}

function removeToast(toastId) {
  const toast = document.getElementById(toastId);
  if (toast) {
    toast.style.transform = 'translateX(100%)';
    toast.style.opacity = '0';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }
}

// API Functions
async function fetchAPI(endpoint) {
  try {
    debugLog(`API Request: GET ${endpoint}`);
    
    const response = await fetch(`/api${endpoint}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    debugLog(`API Success: ${endpoint}`, data);
    return data;

  } catch (error) {
    debugLog(`API Error: ${endpoint} - ${error.message}`);
    throw error;
  }
}

async function removeAgent(agentCode) {
  if (!confirm(`Are you sure you want to remove ${agentCode} from the dashboard?\n\nThis will hide the agent but preserve their call history.`)) {
    return;
  }

  try {
    const response = await fetch(`/api/agents/${agentCode}/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast(`Agent ${agentCode} removed from dashboard`, 'success');
      loadDashboardData(); // Refresh data
    } else {
      throw new Error(data.error || 'Failed to remove agent');
    }

  } catch (error) {
    showToast(`Failed to remove agent: ${error.message}`, 'error');
    debugLog(`Error removing agent ${agentCode}:`, error.message);
  }
}

// WebSocket Functions
function initWebSocket() {
  try {
    debugLog('Connecting to WebSocket server...');
    
    socket = io({
      timeout: 10000,
      reconnection: true,
      reconnectionAttempts: maxReconnectAttempts,
      reconnectionDelay: 2000
    });

    setupWebSocketEvents();
    
  } catch (error) {
    debugLog('Failed to initialize WebSocket:', error.message);
    updateConnectionStatus(false, 'Connection Failed');
  }
}

function setupWebSocketEvents() {
  socket.on('connect', () => {
    isConnected = true;
    reconnectAttempts = 0;
    debugLog('WebSocket connected successfully');
    updateConnectionStatus(true, 'Connected');
  });

  socket.on('disconnect', (reason) => {
    isConnected = false;
    debugLog(`WebSocket disconnected: ${reason}`);
    updateConnectionStatus(false, 'Disconnected');
  });

  socket.on('connect_error', (error) => {
    isConnected = false;
    reconnectAttempts++;
    debugLog(`WebSocket connection error (attempt ${reconnectAttempts}): ${error.message}`);
    updateConnectionStatus(false, 'Connection Error');

    if (reconnectAttempts >= maxReconnectAttempts) {
      showToast('Failed to connect to server. Please refresh the page.', 'error');
    }
  });

  socket.on('dashboard_update', (data) => {
    debugLog('Dashboard update received');
    handleDashboardUpdate(data);
  });

  socket.on('error', (error) => {
    debugLog('Server error:', error);
    showToast(`Server error: ${error.message || error}`, 'error');
  });
}

// Data Loading Functions
async function loadDashboardData() {
  try {
    const result = await fetchAPI('/dashboard/live');
    if (result.success) {
      handleDashboardUpdate(result.data);
    }
  } catch (error) {
    debugLog('Failed to load dashboard data:', error.message);
    showError('Failed to load dashboard data');
  }
}

// 🎯 REMOVED: Server stats no longer needed
// Dashboard now focuses on agent data only}

// UI Update Functions
function handleDashboardUpdate(data) {
  try {
    if (!data) {
      debugLog('Received empty dashboard data');
      return;
    }

    debugLog('Processing dashboard update');
    dashboardData = data;
    
    updateTalkTimeTable(data.agentsTalkTime || []);
    updateOnCallList(data.agentsOnCall || []);
    updateIdleTimeList(data.agentsIdleTime || []);
    updateHeaderStats(data);
    
    if (data.lastUpdated) {
      updateLastUpdatedTime(data.lastUpdated);
    }
    
  } catch (error) {
    debugLog('Error processing dashboard update:', error.message);
    showToast('Failed to update dashboard data', 'error');
  }
}

//new search funtion
// 🎯 NEW: Phone number search functions
async function searchPhoneNumber() {
  const input = document.getElementById('phoneSearchInput');
  const resultsContainer = document.getElementById('searchResults');
  
  if (!input || !resultsContainer) return;
  
  const phoneNumber = input.value.trim();
  
  if (phoneNumber.length < 3) {
    showToast('Please enter at least 3 digits', 'warning');
    return;
  }
  
  try {
    resultsContainer.innerHTML = '<div class="loading">🔍 Searching...</div>';
    
    const result = await fetchAPI(`/search/phone/${encodeURIComponent(phoneNumber)}`);
    
    if (result.success) {
      displaySearchResults(result.data);
      debugLog(`Search completed: ${result.data.totalResults} results for ${phoneNumber}`);
    } else {
      throw new Error(result.error || 'Search failed');
    }
    
  } catch (error) {
    debugLog('Search error:', error.message);
    resultsContainer.innerHTML = `<div class="error">❌ Search failed: ${sanitizeHTML(error.message)}</div>`;
    showToast(`Search failed: ${error.message}`, 'error');
  }
}

function displaySearchResults(data) {
  const resultsContainer = document.getElementById('searchResults');
  
  if (!resultsContainer) return;
  
  if (!data.calls || data.calls.length === 0) {
    resultsContainer.innerHTML = `
      <div class="no-data">
        📭 No calls found for "${sanitizeHTML(data.phoneNumber)}"
      </div>
    `;
    return;
  }
  
  const resultItems = data.calls.map(call => {
    const callTypeClass = `call-type-${call.callType}`;
    const contactName = call.contactName ? sanitizeHTML(call.contactName) : 'Unknown';
    
    return `
      <div class="search-result-item fade-in">
        <div class="search-result-header">
          <div class="search-result-phone">${formatPhoneNumber(call.phoneNumber)}</div>
          <div class="search-result-type ${callTypeClass}">
            ${getCallTypeIcon(call.callType)} ${call.callType.toUpperCase()}
          </div>
        </div>
        <div class="search-result-details">
          <div><strong>Contact:</strong> ${contactName}</div>
          <div><strong>Agent:</strong> ${sanitizeHTML(call.agentCode)} - ${sanitizeHTML(call.agentName)}</div>
          <div><strong>Date:</strong> ${call.callDate}</div>
          <div><strong>Time:</strong> ${call.startTime} - ${call.endTime}</div>
          <div><strong>Talk Duration:</strong> ${call.formattedTalkDuration}</div>
          <div><strong>Total Duration:</strong> ${formatDuration(call.totalDuration)}</div>
        </div>
      </div>
    `;
  }).join('');
  
  resultsContainer.innerHTML = `
    <div class="search-header">
      <strong>📞 Found ${data.totalResults} call(s) for "${sanitizeHTML(data.phoneNumber)}"</strong>
    </div>
    ${resultItems}
  `;
}

function clearSearch() {
  const input = document.getElementById('phoneSearchInput');
  const resultsContainer = document.getElementById('searchResults');
  
  if (input) input.value = '';
  if (resultsContainer) {
    resultsContainer.innerHTML = '<div class="no-data">Enter a phone number to search call history</div>';
  }
  
  debugLog('Search cleared');
}

function updateTalkTimeTable(agents) {
  const tbody = document.getElementById('talkTimeTableBody');
  if (!tbody) return;

  if (!agents || agents.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="no-data">📭 No agents found</td></tr>';
    return;
  }

  // Sort data
  const sortedAgents = [...agents].sort((a, b) => {
    let aValue, bValue;
    
    switch (sortBy) {
      case 'agentCode':
        aValue = a.agentCode.toLowerCase();
        bValue = b.agentCode.toLowerCase();
        break;
      case 'talkTime':
        aValue = a.totalTalkTime || 0;
        bValue = b.totalTalkTime || 0;
        break;
      default:
        aValue = a.agentCode.toLowerCase();
        bValue = b.agentCode.toLowerCase();
    }

    let comparison = 0;
    if (aValue > bValue) comparison = 1;
    if (aValue < bValue) comparison = -1;

    return sortDirection === 'desc' ? comparison * -1 : comparison;
  });

  const rows = sortedAgents.map(agent => `
    <tr data-agent-code="${agent.agentCode}" class="fade-in">
      <td><strong>${sanitizeHTML(agent.agentCode)}</strong></td>
      <td>${sanitizeHTML(agent.agentName)}</td>
      <td><span class="talk-time-value">${agent.formattedTalkTime}</span></td>
      <td><span class="call-count">${agent.callCount || 0}</span></td>
      <td>
        <button 
          class="remove-agent-btn" 
          data-agent-code="${agent.agentCode}"
          title="Remove agent from dashboard"
          aria-label="Remove ${agent.agentCode}">
          ❌
        </button>
      </td>
    </tr>
  `).join('');

  tbody.innerHTML = rows;
}

function updateOnCallList(agents) {
 const container = document.getElementById('onCallList');
 const badge = document.getElementById('onCallCount');
 
 if (!container || !badge) return;

 badge.textContent = agents.length;
 badge.style.display = agents.length > 0 ? 'block' : 'none';

 if (!agents || agents.length === 0) {
   container.innerHTML = '<div class="no-data">📴 No agents currently on call</div>';
   return;
 }

 // Sort by call start time (most recent first)
 const sortedAgents = [...agents].sort((a, b) => {
   const timeA = new Date(a.callStartTime || 0);
   const timeB = new Date(b.callStartTime || 0);
   return timeB - timeA;
 });

 // 🎯 NEW: Simplified display without timers
 const items = sortedAgents.map(agent => {
   const phoneNumber = formatPhoneNumber(agent.phoneNumber);
   const callTypeIcon = getCallTypeIcon(agent.callType);
   const startTime = formatTime(agent.callStartTime);
   
   return `
     <div class="on-call-item fade-in" data-agent-code="${agent.agentCode}">
       <div class="agent-info">
         <div class="agent-name">${sanitizeHTML(agent.agentCode)} - ${sanitizeHTML(agent.agentName)}</div>
         <div class="phone-number">${phoneNumber}</div>
         <div class="call-type">${callTypeIcon} ${agent.callType}</div>
       </div>
       <div class="call-info">
         <div class="call-start-time">Started: ${startTime}</div>
         <span class="status-badge on-call">On Call</span>
       </div>
     </div>
   `;
 }).join('');

 container.innerHTML = items;
}


function updateConnectionStatus(connected, status) {
 const statusDot = document.getElementById('statusDot');
 const statusText = document.getElementById('statusText');
 
 if (statusDot && statusText) {
   statusDot.className = `status-dot ${connected ? 'connected' : ''}`;
   statusText.textContent = status;
 }
 
 debugLog(`Connection status: ${status}`);
}

function updateHeaderStats(data) {
 const agentCount = document.getElementById('agentCount');
 if (agentCount) {
   const totalAgents = (data.agentsTalkTime?.length || 0) + 
                      (data.agentsOnCall?.length || 0) + 
                      (data.agentsIdleTime?.length || 0);
   agentCount.textContent = formatAgentCount(totalAgents);
 }
}

function updateLastUpdatedTime(timestamp) {
 const lastUpdated = document.getElementById('lastUpdated');
 if (lastUpdated) {
   lastUpdated.textContent = `Updated: ${formatLastUpdated(timestamp)}`;
 }
}

// Helper Functions
function getCallTypeIcon(callType) {
 const icons = {
   'incoming': '📞',
   'outgoing': '📱',
   'unknown': '☎️'
 };
 return icons[callType] || icons.unknown;
}

function formatIdleTime(minutes) {
 if (!minutes || minutes < 0) return '0m';
 
 if (minutes < 60) {
   return `${minutes}m`;
 } else {
   const hours = Math.floor(minutes / 60);
   const remainingMinutes = minutes % 60;
   return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
 }
}

function formatLastCallTime(lastCallEnd) {
 if (!lastCallEnd) return 'Unknown';
 
 const endTime = new Date(lastCallEnd);
 const now = new Date();
 const diffHours = Math.floor((now - endTime) / (1000 * 60 * 60));
 
 if (diffHours < 1) {
   return formatTime(lastCallEnd);
 } else if (diffHours < 24) {
   return `${diffHours}h ago`;
 } else {
   return endTime.toLocaleDateString();
 }
}

function getUrgencyClass(minutes) {
 if (minutes >= 60) return 'urgent';
 if (minutes >= 30) return 'warning';
 if (minutes >= 15) return 'caution';
 return 'normal';
}

function getIdleStatusText(minutes) {
 if (minutes >= 120) return 'Very Long Idle';
 if (minutes >= 60) return 'Long Idle';
 if (minutes >= 30) return 'Extended Idle';
 if (minutes >= 15) return 'Idle';
 return 'Recently Active';
}

function showError(message) {
 const errorHTML = `<div class="error">❌ ${sanitizeHTML(message)}</div>`;
 // Show error in all card contents
 const cards = document.querySelectorAll('.card-content');
 cards.forEach(card => {
   if (!card.querySelector('.error')) {
     card.innerHTML = errorHTML;
   }
 });
}

// Event Handlers
function setupEventListeners() {
  // Debug console toggle
  const debugToggle = document.getElementById('debugToggle');
  const debugConsole = document.getElementById('debugConsole');
  // 🎯 NEW: Phone search event listeners
  const phoneSearchBtn = document.getElementById('phoneSearchBtn');
  const phoneSearchInput = document.getElementById('phoneSearchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  
  if (phoneSearchBtn) {
    phoneSearchBtn.addEventListener('click', searchPhoneNumber);
  }
  
  if (phoneSearchInput) {
    phoneSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        searchPhoneNumber();
      }
    });
    
    // Only allow numbers, +, spaces, hyphens, parentheses
    phoneSearchInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/[^\d+\s\-()]/g, '');
    });
  }
  
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', clearSearch);
  }

  if (debugToggle && debugConsole) {
    debugToggle.addEventListener('click', () => {
      debugConsole.classList.toggle('show');
      debugToggle.textContent = debugConsole.classList.contains('show') ? 'Hide Debug' : 'Debug';
    });
  }

  // Settings panel toggle
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsPanel = document.getElementById('settingsPanel');
  const closeSettings = document.getElementById('closeSettings');
  
  if (settingsToggle && settingsPanel) {
    settingsToggle.addEventListener('click', () => {
      settingsPanel.classList.add('show');
      loadAgentSettings();
    });
  }
  
  if (closeSettings && settingsPanel) {
    closeSettings.addEventListener('click', () => {
      settingsPanel.classList.remove('show');
    });
  }

  // Settings panel controls
  const enableAllBtn = document.getElementById('enableAllReminders');
  const disableAllBtn = document.getElementById('disableAllReminders');
  const saveAllBtn = document.getElementById('saveAllSettings');
  
  if (enableAllBtn) {
    enableAllBtn.addEventListener('click', () => {
      document.querySelectorAll('.reminder-checkbox').forEach(checkbox => {
        checkbox.checked = true;
      });
    });
  }
  
  if (disableAllBtn) {
    disableAllBtn.addEventListener('click', () => {
      document.querySelectorAll('.reminder-checkbox').forEach(checkbox => {
        checkbox.checked = false;
      });
    });
  }
  
  if (saveAllBtn) {
    saveAllBtn.addEventListener('click', saveAllAgentSettings);
  }

  // Clear debug console
  const clearDebug = document.getElementById('clearDebug');
  if (clearDebug) {
    clearDebug.addEventListener('click', () => {
      const debugContent = document.getElementById('debugContent');
      if (debugContent) {
        debugContent.textContent = 'Debug console cleared\n';
      }
    });
  }

  // Sort dropdown
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      const [newSortBy, newDirection] = e.target.value.split('-');
      sortBy = newSortBy;
      sortDirection = newDirection;
      
      if (dashboardData.agentsTalkTime) {
        updateTalkTimeTable(dashboardData.agentsTalkTime);
      }
      
      debugLog(`Talk time sorting changed: ${sortBy} ${sortDirection}`);
    });
  }

  // Event delegation for remove agent buttons
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-agent-btn')) {
      const agentCode = e.target.getAttribute('data-agent-code');
      if (agentCode) {
        removeAgent(agentCode);
      }
    }
  });

  // Window events
  window.addEventListener('beforeunload', cleanup);
  
  // Visibility change (tab switching)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      onTabVisible();
    } else {
      onTabHidden();
    }
  });

  // Online/offline events
  window.addEventListener('online', onNetworkOnline);
  window.addEventListener('offline', onNetworkOffline);
}

 // Clear debug console
 const clearDebug = document.getElementById('clearDebug');
 if (clearDebug) {
   clearDebug.addEventListener('click', () => {
     const debugContent = document.getElementById('debugContent');
     if (debugContent) {
       debugContent.textContent = 'Debug console cleared\n';
     }
   });
 }

 // Sort dropdown
 const sortSelect = document.getElementById('sortSelect');
 if (sortSelect) {
   sortSelect.addEventListener('change', (e) => {
     const [newSortBy, newDirection] = e.target.value.split('-');
     sortBy = newSortBy;
     sortDirection = newDirection;
     
     if (dashboardData.agentsTalkTime) {
       updateTalkTimeTable(dashboardData.agentsTalkTime);
     }
     
     debugLog(`Talk time sorting changed: ${sortBy} ${sortDirection}`);
   });
 }

 // Window events
 window.addEventListener('beforeunload', cleanup);
 
 // Visibility change (tab switching)
 document.addEventListener('visibilitychange', () => {
   if (document.visibilityState === 'visible') {
     onTabVisible();
   } else {
     onTabHidden();
   }
 });

 // Online/offline events
 window.addEventListener('online', onNetworkOnline);
 window.addEventListener('offline', onNetworkOffline);


function onTabVisible() {
 debugLog('Tab became visible - resuming updates');
 
 if (!isConnected && socket) {
   socket.connect();
 }
 
 loadDashboardData();
}

function onTabHidden() {
 debugLog('Tab hidden - reducing activity');
}

function onNetworkOnline() {
 debugLog('Network came online');
 showToast('Connection restored', 'success');
 
 setTimeout(() => {
   if (socket) socket.connect();
 }, 1000);
}

function onNetworkOffline() {
 debugLog('Network went offline');
 showToast('Network connection lost', 'warning');
}

// Initialization
async function init() {
 try {
   debugLog('🚀 Initializing Call Analytics Dashboard...');
   
   // Setup event listeners
   setupEventListeners();
   
   // Initialize WebSocket
   initWebSocket();
   
   // Load initial data
   await loadDashboardData();
   
   // 🎯 REMOVED: No more server stats polling
   // Dashboard is now purely event-driven via WebSocket
   
   debugLog('✅ Dashboard initialized successfully');
   showToast('Dashboard loaded successfully', 'success');
   
 } catch (error) {
   debugLog('❌ Dashboard initialization failed:', error.message);
   showToast(`Failed to initialize dashboard: ${error.message}`, 'error');
   showError(`Dashboard initialization failed: ${error.message}`);
 }
}

// Settings Management Functions
async function loadAgentSettings() {
  try {
    const result = await fetchAPI('/reminder-settings');
    if (result.success) {
      updateSettingsTable(result.data);
    }
  } catch (error) {
    debugLog('Failed to load agent settings:', error.message);
    showToast('Failed to load settings', 'error');
  }
}

function updateSettingsTable(settings) {
  const tbody = document.getElementById('settingsTableBody');
  if (!tbody) return;

  if (!settings || settings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="no-data">No agents found</td></tr>';
    return;
  }

  const rows = settings.map(setting => {
    const statusClass = `status-${setting.agent_status || 'offline'}`;
    const statusText = (setting.agent_status || 'offline').replace('_', ' ').toUpperCase();
    
    // Ensure we get the correct interval value
    const intervalValue = setting.reminder_interval_minutes || 5;
    const reminderEnabled = setting.reminders_enabled !== false; // Default to true
    
    debugLog(`Loading setting for ${setting.agent_code}: interval=${intervalValue}, enabled=${reminderEnabled}`);
    
    return `
      <tr data-agent-code="${setting.agent_code}">
        <td><strong>${sanitizeHTML(setting.agent_code)}</strong></td>
        <td>${sanitizeHTML(setting.agent_name || 'Unknown')}</td>
        <td><span class="agent-status ${statusClass}">${statusText}</span></td>
        <td>
          <input 
            type="number" 
            class="interval-input" 
            min="1" 
            max="60" 
            value="${intervalValue}"
            data-agent-code="${setting.agent_code}"
            data-original-value="${intervalValue}"
          />
        </td>
        <td>
          <label class="reminder-toggle">
            <input 
              type="checkbox" 
              class="reminder-checkbox"
              data-agent-code="${setting.agent_code}"
              ${reminderEnabled ? 'checked' : ''}
            />
            <span class="toggle-slider"></span>
          </label>
        </td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = rows;
  debugLog(`Settings table updated with ${settings.length} agents`);
}

async function saveAllAgentSettings() {
  try {
    const settings = [];
    const rows = document.querySelectorAll('#settingsTableBody tr[data-agent-code]');
    
    rows.forEach(row => {
      const agentCode = row.getAttribute('data-agent-code');
      const intervalInput = row.querySelector('.interval-input');
      const reminderCheckbox = row.querySelector('.reminder-checkbox');
      
      if (agentCode && intervalInput && reminderCheckbox) {
        settings.push({
          agentCode: agentCode,
          reminder_interval_minutes: parseInt(intervalInput.value),
          reminders_enabled: reminderCheckbox.checked
        });
      }
    });

    if (settings.length === 0) {
      showToast('No settings to save', 'warning');
      return;
    }

    showToast('Saving settings...', 'info');

    const response = await fetch('/api/reminder-settings-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings })
    });
    
    const result = await response.json();
    
    if (result.success) {
  showToast(`Settings saved for ${settings.length} agents`, 'success');
  debugLog('Settings saved successfully', result);
  
  // Reload settings to show updated values
  setTimeout(() => {
    loadAgentSettings();
  }, 500);
} else {
  throw new Error(result.error || 'Failed to save settings');
}

  } catch (error) {
    debugLog('Failed to save settings:', error.message);
    showToast(`Failed to save settings: ${error.message}`, 'error');
  }
}

function cleanup() {
 debugLog('🧹 Cleaning up dashboard...');
 
 if (socket) {
   socket.disconnect();
 }
}

// Global error handlers
window.addEventListener('error', (event) => {
 debugLog(`🚨 Global error: ${event.error?.message || event.message}`);
 showToast(`Unexpected error: ${event.error?.message || 'Unknown error'}`, 'error');
});

window.addEventListener('unhandledrejection', (event) => {
 debugLog(`🚨 Unhandled promise rejection: ${event.reason}`);
 showToast(`Promise rejection: ${event.reason}`, 'error');
});

// Global functions (accessible from HTML onclick)
window.removeAgent = removeAgent;
window.removeToast = removeToast;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init);