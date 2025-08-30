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

// NEW: Send manual reminder to agent
async function sendManualReminder(agentCode, agentName) {
  if (!isConnected) {
    showToast('Not connected to server', 'error');
    return;
  }

  try {
    debugLog(`Sending manual reminder to ${agentCode}`);
    
    // Disable button temporarily to prevent spam
    const button = document.querySelector(`[data-agent="${agentCode}"] .manual-reminder-btn`);
    if (button) {
      button.disabled = true;
      button.innerHTML = 'Sending...';
    }

    // Send manual reminder request via WebSocket
    socket.emit('send_manual_reminder', {
      agentCode: agentCode,
      agentName: agentName,
      timestamp: new Date().toISOString()
    });

    showToast(`Manual reminder sent to ${agentCode}`, 'success');

  } catch (error) {
    debugLog(`Error sending manual reminder to ${agentCode}:`, error.message);
    showToast(`Failed to send reminder: ${error.message}`, 'error');
  }
}

// NEW: Handle manual reminder response from server
function handleManualReminderResponse(data) {
  const { success, agentCode, error } = data;
  
  // Re-enable button
  const button = document.querySelector(`[data-agent="${agentCode}"] .manual-reminder-btn`);
  if (button) {
    button.disabled = false;
    button.innerHTML = '📱 Notify';
  }

  if (success) {
    debugLog(`Manual reminder sent successfully to ${agentCode}`);
  } else {
    debugLog(`Manual reminder failed for ${agentCode}: ${error}`);
    showToast(`Failed to notify ${agentCode}: ${error}`, 'error');
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
    socket.on('manual_reminder_response', handleManualReminderResponse);
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

function updateIdleTimeList(agents) {
 const container = document.getElementById('idleTimeList');
 const badge = document.getElementById('idleCount');
 
 if (!container || !badge) return;

 badge.textContent = agents.length;
 badge.style.display = agents.length > 0 ? 'block' : 'none';

 if (!agents || agents.length === 0) {
   container.innerHTML = '<div class="no-data">📞 All agents recently active</div>';
   return;
 }

 // Sort by idle time (longest idle first)
 const sortedAgents = [...agents].sort((a, b) => {
   return (b.minutesSinceLastCall || 0) - (a.minutesSinceLastCall || 0);
 });

 const items = sortedAgents.map(agent => {
   const idleTime = formatIdleTime(agent.minutesSinceLastCall);
   const urgencyClass = getUrgencyClass(agent.minutesSinceLastCall);
   
   return `
     <div class="idle-item ${urgencyClass} fade-in" data-agent-code="${agent.agentCode}">
       <div class="agent-info">
         <div class="agent-name">${sanitizeHTML(agent.agentCode)} - ${sanitizeHTML(agent.agentName)}</div>
         <div class="last-call-time">Last call: ${formatLastCallTime(agent.lastCallEnd)}</div>
       </div>
       <div class="idle-duration">
         <span class="time-badge idle-badge ${urgencyClass}" data-minutes="${agent.minutesSinceLastCall}">
           ${idleTime}
         </span>
         <div class="idle-status">${getIdleStatusText(agent.minutesSinceLastCall)}</div>
         <button class="manual-reminder-btn" data-agent-code="${agent.agentCode}" data-agent-name="${agent.agentName}" title="Send notification to agent">
           📱 Notify
         </button>
       </div>
     </div>
   `;
 }).join('');

 container.innerHTML = items;
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

// Missing functions for manual notification feature
function formatTimeSinceCall(minutes) {
  if (!minutes || minutes < 0) return '0m';
  
  if (minutes < 60) {
    return `${minutes}m`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
}

function getIdleUrgencyClass(minutes) {
  if (minutes >= 60) return 'urgent';
  if (minutes >= 30) return 'warning';
  if (minutes >= 15) return 'caution';
  return 'normal';
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
      loadAgentsList();
    });
  }
  
  if (closeSettings && settingsPanel) {
    closeSettings.addEventListener('click', () => {
      settingsPanel.classList.remove('show');
    });
  }

  // Agent management controls
  const addAgentBtn = document.getElementById('addAgentBtn');
  const refreshAgentsBtn = document.getElementById('refreshAgentsBtn');
  const saveNewAgent = document.getElementById('saveNewAgent');
  const cancelNewAgent = document.getElementById('cancelNewAgent');
  
  if (addAgentBtn) {
    addAgentBtn.addEventListener('click', showAddAgentForm);
  }
  
  if (refreshAgentsBtn) {
    refreshAgentsBtn.addEventListener('click', () => {
      showToast('Refreshing agents list...', 'info');
      loadAgentsList();
    });
  }
  
  if (saveNewAgent) {
    saveNewAgent.addEventListener('click', handleAddAgent);
  }
  
  if (cancelNewAgent) {
    cancelNewAgent.addEventListener('click', hideAddAgentForm);
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

  // Manual reminder button click handler
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('manual-reminder-btn')) {
    const agentCode = e.target.getAttribute('data-agent-code');
    const agentName = e.target.getAttribute('data-agent-name');
    
    if (agentCode && agentName) {
      sendManualReminder(agentCode, agentName);
    }
  }
});

// Remove agent button click handler
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
   
   // Initialize performance dashboard
   performanceDashboard = new AgentPerformanceDashboard();
   
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

// js code for Idle Time or Gap Duration

// Idle Sessions Management
class IdleSessionsManager {
  constructor() {
    this.currentPage = 1;
    this.recordsPerPage = 20;
    this.currentSort = { field: 'start_time', order: 'desc' };
    this.currentFilters = { agentCode: '', date: '' };
    this.totalRecords = 0;
    this.totalPages = 0;
    
    this.init();
  }
  
  init() {
    this.setupEventListeners();
    this.loadAgentOptions();
    this.setDefaultDate();
    this.loadIdleSessions();
  }
  
  setupEventListeners() {
    // Filter buttons
    const applyBtn = document.getElementById('applyFilters');
    const clearBtn = document.getElementById('clearFilters');
    
    if (applyBtn) {
      applyBtn.addEventListener('click', () => this.applyFilters());
    }
    
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearFilters());
    }
    
    // Sorting
    document.querySelectorAll('[data-sort]').forEach(header => {
      header.addEventListener('click', () => {
        this.handleSort(header.dataset.sort);
      });
    });
    
    // Pagination
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          this.loadIdleSessions();
        }
      });
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (this.currentPage < this.totalPages) {
          this.currentPage++;
          this.loadIdleSessions();
        }
      });
    }
  }
  
  loadAgentOptions() {
    const agentSelect = document.getElementById('agentSelect');
    if (!agentSelect) return;
    
    // Add Agent1 to Agent25 options
    for (let i = 1; i <= 25; i++) {
      const option = document.createElement('option');
      option.value = `Agent${i}`;
      option.textContent = `Agent${i}`;
      agentSelect.appendChild(option);
    }
  }
  
  setDefaultDate() {
    const dateSelect = document.getElementById('dateSelect');
    if (!dateSelect) return;
    
    const today = new Date().toISOString().split('T')[0];
    dateSelect.value = today;
    this.currentFilters.date = today;
  }
  
  applyFilters() {
    const agentSelect = document.getElementById('agentSelect');
    const dateSelect = document.getElementById('dateSelect');
    
    if (agentSelect) this.currentFilters.agentCode = agentSelect.value;
    if (dateSelect) this.currentFilters.date = dateSelect.value;
    
    this.currentPage = 1; // Reset to first page
    this.loadIdleSessions();
  }
  
  clearFilters() {
    const agentSelect = document.getElementById('agentSelect');
    const dateSelect = document.getElementById('dateSelect');
    
    if (agentSelect) agentSelect.value = '';
    this.setDefaultDate();
    
    this.currentFilters = { 
      agentCode: '', 
      date: dateSelect ? dateSelect.value : ''
    };
    this.currentPage = 1;
    this.loadIdleSessions();
  }
  
  handleSort(field) {
    if (this.currentSort.field === field) {
      // Toggle order if same field
      this.currentSort.order = this.currentSort.order === 'asc' ? 'desc' : 'asc';
    } else {
      // New field, default to desc
      this.currentSort.field = field;
      this.currentSort.order = 'desc';
    }
    
    this.updateSortIndicators();
    this.currentPage = 1; // Reset to first page
    this.loadIdleSessions();
  }
  
  updateSortIndicators() {
    // Clear all active sort indicators
    document.querySelectorAll('[data-sort]').forEach(header => {
      header.classList.remove('sort-active', 'sort-asc', 'sort-desc');
    });
    
    // Set active sort indicator
    const activeHeader = document.querySelector(`[data-sort="${this.currentSort.field}"]`);
    if (activeHeader) {
      activeHeader.classList.add('sort-active', `sort-${this.currentSort.order}`);
    }
  }
  
  async loadIdleSessions() {
    this.showLoading();
    
    try {
      const params = new URLSearchParams({
        page: this.currentPage,
        limit: this.recordsPerPage,
        sort: this.currentSort.field,
        order: this.currentSort.order
      });
      
      if (this.currentFilters.agentCode) {
        params.append('agent_code', this.currentFilters.agentCode);
      }
      
      if (this.currentFilters.date) {
        params.append('start_date', this.currentFilters.date);
        params.append('end_date', this.currentFilters.date);
      }
      
      const response = await fetch(`/api/idle-sessions?${params}`);
      const data = await response.json();
      
      if (data.success) {
        this.renderIdleSessions(data.data.idleSessions);
        this.updatePagination(data.data.totalRecords);
        this.updateCount(data.data.totalRecords);
      } else {
        this.showError('Failed to load idle sessions');
      }
    } catch (error) {
      console.error('Error loading idle sessions:', error);
      this.showError('Error loading idle sessions');
    }
  }
  
  showLoading() {
    const loading = document.getElementById('idleSessionsLoading');
    const empty = document.getElementById('idleSessionsEmpty');
    const table = document.getElementById('idleSessionsTable');
    
    if (loading) loading.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
    if (table) table.classList.add('hidden');
  }
  
  showError(message) {
    const loading = document.getElementById('idleSessionsLoading');
    const empty = document.getElementById('idleSessionsEmpty');
    const table = document.getElementById('idleSessionsTable');
    
    if (loading) loading.classList.add('hidden');
    if (empty) {
      empty.classList.remove('hidden');
      empty.innerHTML = `<p style="color: var(--error-color);">${message}</p>`;
    }
    if (table) table.classList.add('hidden');
  }
  
  renderIdleSessions(sessions) {
    const loading = document.getElementById('idleSessionsLoading');
    const empty = document.getElementById('idleSessionsEmpty');
    const table = document.getElementById('idleSessionsTable');
    
    if (loading) loading.classList.add('hidden');
    
    if (sessions.length === 0) {
      if (empty) empty.classList.remove('hidden');
      if (table) table.classList.add('hidden');
      return;
    }
    
    if (empty) empty.classList.add('hidden');
    if (table) table.classList.remove('hidden');
    
    const tbody = document.getElementById('idleSessionsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    sessions.forEach(session => {
      const row = this.createSessionRow(session);
      tbody.appendChild(row);
    });
  }
  
  createSessionRow(session) {
    const row = document.createElement('tr');
    
    const startTime = new Date(session.start_time).toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
    
    const endTime = new Date(session.end_time).toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
    
    const duration = this.formatDuration(session.idle_duration);
    const durationClass = this.getDurationClass(session.idle_duration);
    
    row.innerHTML = `
      <td style="font-weight: 600;">${session.agent_code}</td>
      <td>${session.agent_name || 'Unknown'}</td>
      <td>${startTime}</td>
      <td>${endTime}</td>
      <td>
        <span class="${durationClass}">${duration}</span>
      </td>
    `;
    
    return row;
  }
  
  formatDuration(seconds) {
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
  
  getDurationClass(seconds) {
    const minutes = seconds / 60;
    
    if (minutes < 5) {
      return 'duration-green';
    } else if (minutes >= 5 && minutes <= 10) {
      return 'duration-yellow';
    } else {
      return 'duration-red';
    }
  }
  
  updatePagination(totalRecords) {
    this.totalRecords = totalRecords;
    this.totalPages = Math.ceil(totalRecords / this.recordsPerPage);
    
    const recordsInfo = document.getElementById('recordsInfo');
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    
    // Update records info
    if (recordsInfo) {
      const start = (this.currentPage - 1) * this.recordsPerPage + 1;
      const end = Math.min(this.currentPage * this.recordsPerPage, totalRecords);
      recordsInfo.textContent = 
        totalRecords > 0 ? `${start}-${end} of ${totalRecords}` : '0';
    }
    
    // Update page info
    if (pageInfo) {
      pageInfo.textContent = `Page ${this.currentPage} of ${this.totalPages || 1}`;
    }
    
    // Update buttons
    if (prevBtn) prevBtn.disabled = this.currentPage <= 1;
    if (nextBtn) nextBtn.disabled = this.currentPage >= this.totalPages;
  }
  
  updateCount(totalRecords) {
    const countBadge = document.getElementById('idleSessionsCount');
    if (countBadge) {
      countBadge.textContent = `${totalRecords} sessions`;
    }
  }
}

// Initialize Idle Sessions Manager when dashboard is loaded
if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    // Add a small delay to ensure other components are loaded
    setTimeout(() => {
      window.idleSessionsManager = new IdleSessionsManager();
    }, 2000);
  });
}

function cleanup() {
 debugLog('🧹 Cleaning up dashboard...');
 
 if (socket) {
   socket.disconnect();
 }
}

// 🎯 Agent Performance Dashboard Functions
class AgentPerformanceDashboard {
  constructor() {
    this.init();
  }
  
  init() {
    this.bindEvents();
    this.loadAgentOptions();
  }
  
  bindEvents() {
    const loadBtn = document.getElementById('loadPerformanceData');
    const dateModeSelect = document.getElementById('performanceDateMode');
    
    if (loadBtn) {
      loadBtn.addEventListener('click', () => this.loadPerformanceData());
    }
    
    if (dateModeSelect) {
      dateModeSelect.addEventListener('change', (e) => this.toggleDateMode(e.target.value));
    }
  }
  
  async loadAgentOptions() {
    try {
      const response = await fetchAPI('/agents');
      if (response.success && response.data) {
        const agentSelect = document.getElementById('performanceAgentSelect');
        if (agentSelect) {
          // Clear existing options except the first one
          agentSelect.innerHTML = '<option value="">Select Agent</option>';
          
          response.data.forEach(agent => {
            const option = document.createElement('option');
            option.value = agent.agentCode;
            option.textContent = `${agent.agentCode} - ${agent.agentName}`;
            agentSelect.appendChild(option);
          });
        }
      }
    } catch (error) {
      console.error('Error loading agent options:', error);
    }
  }
  
  toggleDateMode(mode) {
    const singleDateContainer = document.getElementById('singleDateContainer');
    const startDateContainer = document.getElementById('startDateContainer');
    const endDateContainer = document.getElementById('endDateContainer');
    
    if (mode === 'single') {
      singleDateContainer.classList.remove('hidden');
      startDateContainer.classList.add('hidden');
      endDateContainer.classList.add('hidden');
    } else {
      singleDateContainer.classList.add('hidden');
      startDateContainer.classList.remove('hidden');
      endDateContainer.classList.remove('hidden');
    }
  }
  
  async loadPerformanceData() {
    const agentCode = document.getElementById('performanceAgentSelect').value;
    const dateMode = document.getElementById('performanceDateMode').value;
    
    if (!agentCode) {
      showToast('Please select an agent', 'error');
      return;
    }
    
    let queryParams = '';
    
    if (dateMode === 'single') {
      const date = document.getElementById('performanceDate').value;
      if (!date) {
        showToast('Please select a date', 'error');
        return;
      }
      queryParams = `?date=${date}`;
    } else {
      const startDate = document.getElementById('performanceStartDate').value;
      const endDate = document.getElementById('performanceEndDate').value;
      
      if (!startDate || !endDate) {
        showToast('Please select both start and end dates', 'error');
        return;
      }
      
      if (new Date(startDate) > new Date(endDate)) {
        showToast('Start date must be before end date', 'error');
        return;
      }
      
      queryParams = `?start_date=${startDate}&end_date=${endDate}`;
    }
    
    this.showLoading();
    
    try {
      const response = await fetchAPI(`/agent-performance/${agentCode}${queryParams}`);
      
      if (response.success) {
        this.displayPerformanceData(response.data);
        debugLog(`Performance data loaded: ${response.data.totalRecords} records`);
      } else {
        this.showError(response.error || 'Failed to load performance data');
      }
    } catch (error) {
      console.error('Error loading performance data:', error);
      this.showError('Error loading performance data');
    }
  }
  
  displayPerformanceData(data) {
    const { agentCode, dateRange, dailyStats, totalRecords } = data;
    
    // Update badge
    const performanceCount = document.getElementById('performanceCount');
    if (performanceCount) {
      performanceCount.textContent = `${totalRecords} day${totalRecords !== 1 ? 's' : ''}`;
    }
    
    // Show data container and hide others
    this.hideLoading();
    this.hideEmpty();
    
    const dataContainer = document.getElementById('performanceData');
    if (dataContainer) {
      dataContainer.classList.remove('hidden');
      
      // Generate summary
      this.renderSummary(agentCode, dateRange, dailyStats);
      
      // Generate list
      this.renderPerformanceList(dailyStats);
    }
  }
  
  renderSummary(agentCode, dateRange, dailyStats) {
    const summaryContainer = document.getElementById('performanceSummary');
    if (!summaryContainer) return;
    
    const totalTalktime = dailyStats.reduce((sum, day) => sum + day.talktime, 0);
    const totalCalls = dailyStats.reduce((sum, day) => sum + day.totalCalls, 0);
    const avgTalktime = dailyStats.length > 0 ? Math.round(totalTalktime / dailyStats.length) : 0;
    const avgCalls = dailyStats.length > 0 ? Math.round(totalCalls / dailyStats.length) : 0;
    
    summaryContainer.innerHTML = `
      <h3>${agentCode} - ${dateRange}</h3>
      <div class="performance-summary-stats">
        <div class="performance-stat">
          <div class="performance-stat-label">Total Talktime</div>
          <div class="performance-stat-value">${Math.floor(totalTalktime / 60)}h ${totalTalktime % 60}m</div>
        </div>
        <div class="performance-stat">
          <div class="performance-stat-label">Total Calls</div>
          <div class="performance-stat-value">${totalCalls}</div>
        </div>
        <div class="performance-stat">
          <div class="performance-stat-label">Avg Talktime/Day</div>
          <div class="performance-stat-value">${Math.floor(avgTalktime / 60)}h ${avgTalktime % 60}m</div>
        </div>
        <div class="performance-stat">
          <div class="performance-stat-label">Avg Calls/Day</div>
          <div class="performance-stat-value">${avgCalls}</div>
        </div>
        <div class="performance-stat">
          <div class="performance-stat-label">Days Tracked</div>
          <div class="performance-stat-value">${dailyStats.length}</div>
        </div>
      </div>
    `;
  }
  
  renderPerformanceList(dailyStats) {
    const listContainer = document.getElementById('performanceList');
    if (!listContainer) return;
    
    if (dailyStats.length === 0) {
      listContainer.innerHTML = '<div class="performance-no-data">No performance data found for the selected period.</div>';
      return;
    }
    
    const listHtml = dailyStats.map(day => `
      <div class="performance-item">
        <div class="performance-item-date">
          ${new Date(day.date).toLocaleDateString('en-US', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric' 
          })}
        </div>
        <div class="performance-item-stats">
          <div class="performance-item-stat">
            <div class="performance-item-stat-label">Talktime</div>
            <div class="performance-item-stat-value talktime">${day.talktimeFormatted}</div>
          </div>
          <div class="performance-item-stat">
            <div class="performance-item-stat-label">Calls</div>
            <div class="performance-item-stat-value calls">${day.totalCalls}</div>
          </div>
        </div>
      </div>
    `).join('');
    
    listContainer.innerHTML = listHtml;
  }
  
  showLoading() {
    const loading = document.getElementById('performanceLoading');
    const empty = document.getElementById('performanceEmpty');
    const data = document.getElementById('performanceData');
    
    if (loading) loading.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
    if (data) data.classList.add('hidden');
  }
  
  hideLoading() {
    const loading = document.getElementById('performanceLoading');
    if (loading) loading.classList.add('hidden');
  }
  
  showEmpty() {
    const empty = document.getElementById('performanceEmpty');
    if (empty) empty.classList.remove('hidden');
  }
  
  hideEmpty() {
    const empty = document.getElementById('performanceEmpty');
    if (empty) empty.classList.add('hidden');
  }
  
  showError(message) {
    this.hideLoading();
    this.showEmpty();
    showToast(message, 'error');
  }
}

// Initialize performance dashboard
let performanceDashboard;

// 🎯 Agent Management Functions (New Simplified UI)
function showAddAgentForm() {
  const form = document.getElementById('addAgentForm');
  if (form) {
    form.classList.remove('hidden');
    document.getElementById('newAgentCode').focus();
  }
}

function hideAddAgentForm() {
  const form = document.getElementById('addAgentForm');
  if (form) {
    form.classList.add('hidden');
    // Clear form
    document.getElementById('newAgentCode').value = '';
    document.getElementById('newAgentName').value = '';
  }
}

async function handleAddAgent() {
  const agentCode = document.getElementById('newAgentCode').value.trim();
  const agentName = document.getElementById('newAgentName').value.trim();
  
  if (!agentCode || !agentName) {
    showToast('Please enter both agent code and name', 'error');
    return;
  }
  
  if (agentCode.length < 2 || agentCode.length > 20) {
    showToast('Agent code must be 2-20 characters', 'error');
    return;
  }
  
  if (agentName.length < 2 || agentName.length > 100) {
    showToast('Agent name must be 2-100 characters', 'error');
    return;
  }
  
  try {
    const response = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentCode, agentName })
    });
    
    const result = await response.json();
    
    if (result.success) {
      showToast(`Agent ${agentCode} added successfully`, 'success');
      hideAddAgentForm();
      loadAgentsList();
    } else {
      throw new Error(result.error || 'Failed to add agent');
    }
  } catch (error) {
    console.error('Error adding agent:', error);
    showToast(error.message || 'Failed to add agent', 'error');
  }
}

async function loadAgentsList() {
  try {
    const result = await fetchAPI('/agents');
    if (result.success) {
      updateAgentsTable(result.data);
    } else {
      throw new Error(result.error || 'Failed to load agents');
    }
  } catch (error) {
    console.error('Failed to load agents list:', error);
    showToast('Failed to load agents list', 'error');
    showEmptyAgentsTable();
  }
}

function updateAgentsTable(agents) {
  const tableContainer = document.getElementById('agentsTable');
  const emptyState = document.getElementById('agentsTableEmpty');
  const tbody = document.getElementById('agentsTableBody');
  
  if (!agents || agents.length === 0) {
    showEmptyAgentsTable();
    return;
  }
  
  // Hide empty state and show table
  if (emptyState) emptyState.classList.add('hidden');
  if (tableContainer) tableContainer.classList.remove('hidden');
  
  if (tbody) {
    tbody.innerHTML = agents.map(agent => `
      <tr>
        <td><strong>${agent.agentCode}</strong></td>
        <td>${agent.agentName}</td>
        <td>${formatDate(agent.createdAt)}</td>
        <td>
          <div class="agent-actions">
            <button class="action-btn edit-btn" onclick="editAgent('${agent.agentCode}', '${agent.agentName}')">
              ✏️ Edit
            </button>
            <button class="action-btn delete-btn" onclick="deleteAgent('${agent.agentCode}', '${agent.agentName}')">
              🗑️ Delete
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }
  
  debugLog(`Updated agents table with ${agents.length} agents`);
}

function showEmptyAgentsTable() {
  const tableContainer = document.getElementById('agentsTable');
  const emptyState = document.getElementById('agentsTableEmpty');
  
  if (tableContainer) tableContainer.classList.add('hidden');
  if (emptyState) emptyState.classList.remove('hidden');
}

async function editAgent(agentCode, currentName) {
  const newName = prompt(`Edit agent name for ${agentCode}:`, currentName);
  
  if (newName === null) return; // Cancelled
  
  if (!newName.trim()) {
    showToast('Agent name cannot be empty', 'error');
    return;
  }
  
  if (newName.trim() === currentName) {
    showToast('No changes made', 'info');
    return;
  }
  
  try {
    const response = await fetch(`/api/agents/${agentCode}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: newName.trim() })
    });
    
    const result = await response.json();
    
    if (result.success) {
      showToast(`Agent ${agentCode} updated successfully`, 'success');
      loadAgentsList();
    } else {
      throw new Error(result.error || 'Failed to update agent');
    }
  } catch (error) {
    console.error('Error updating agent:', error);
    showToast(error.message || 'Failed to update agent', 'error');
  }
}

async function deleteAgent(agentCode, agentName) {
  const confirmed = confirm(`Are you sure you want to delete agent "${agentCode} - ${agentName}"?\n\nThis action cannot be undone.`);
  
  if (!confirmed) return;
  
  try {
    const response = await fetch(`/api/agents/${agentCode}`, {
      method: 'DELETE'
    });
    
    const result = await response.json();
    
    if (result.success) {
      showToast(`Agent ${agentCode} deleted successfully`, 'success');
      loadAgentsList();
    } else {
      throw new Error(result.error || 'Failed to delete agent');
    }
  } catch (error) {
    console.error('Error deleting agent:', error);
    showToast(error.message || 'Failed to delete agent', 'error');
  }
}

function formatDate(dateString) {
  if (!dateString) return 'Unknown';
  
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (error) {
    return 'Unknown';
  }
}

// Make functions globally available for HTML onclick handlers
window.editAgent = editAgent;
window.deleteAgent = deleteAgent;

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
window.removeToast = removeToast;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init);