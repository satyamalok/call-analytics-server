// Main Dashboard Application
class Dashboard {
  constructor() {
    this.components = {};
    this.isInitialized = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    
    this.init();
  }

  async init() {
    try {
      Helpers.debugLog('🚀 Initializing Call Analytics Dashboard...');
      
      // Setup debug console
      this.setupDebugConsole();
      
      // Wait for WebSocketService to be fully ready
      await this.waitForWebSocketService();
      
      // Initialize components
      this.initializeComponents();
      
      // Setup global event listeners (now that WebSocketService is ready)
      this.setupEventListeners();
      
      // Connect to WebSocket
      this.connectWebSocket();
      
      // Load initial data
      await this.loadInitialData();
      
      this.isInitialized = true;
      Helpers.debugLog('✅ Dashboard initialized successfully');
      
      // Show success notification
      NotificationService.instance.success('Dashboard loaded successfully');
      
    } catch (error) {
      Helpers.debugLog('❌ Dashboard initialization failed:', error.message);
      NotificationService.instance.error(`Failed to initialize dashboard: ${error.message}`);
      this.showInitializationError(error);
    }
  }

  // NEW: Wait for WebSocketService to be fully ready
  async waitForWebSocketService() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 10;
      
      const checkService = () => {
        attempts++;
        
        // Check if WebSocketService exists and has the methods we need
        if (window.WebSocketService && 
            typeof window.WebSocketService.on === 'function' &&
            typeof window.WebSocketService.connect === 'function' &&
            window.WebSocketService.eventEmitter) {
          
          Helpers.debugLog('✅ WebSocketService is ready');
          resolve();
          return;
        }
        
        if (attempts >= maxAttempts) {
          reject(new Error('WebSocketService failed to initialize after maximum attempts'));
          return;
        }
        
        Helpers.debugLog(`⏳ Waiting for WebSocketService... (${attempts}/${maxAttempts})`);
        setTimeout(checkService, 100); // Check every 100ms
      };
      
      checkService();
    });
  }

  setupDebugConsole() {
    const debugToggle = document.getElementById('debugToggle');
    const debugConsole = document.getElementById('debugConsole');
    const clearDebug = document.getElementById('clearDebug');
    
    if (debugToggle && debugConsole) {
      debugToggle.addEventListener('click', () => {
        debugConsole.classList.toggle('show');
        debugToggle.textContent = debugConsole.classList.contains('show') ? 'Hide Debug' : 'Debug';
      });
    }
    
    if (clearDebug) {
      clearDebug.addEventListener('click', () => {
        const debugContent = document.getElementById('debugContent');
        if (debugContent) {
          debugContent.textContent = 'Debug console cleared\n';
        }
      });
    }
  }

  initializeComponents() {
    try {
      // Verify all required DOM elements exist
      const requiredElements = ['talkTimeCard', 'onCallCard', 'idleTimeCard', 'statsCard'];
      const missingElements = requiredElements.filter(id => !document.getElementById(id));
      
      if (missingElements.length > 0) {
        throw new Error(`Missing required DOM elements: ${missingElements.join(', ')}`);
      }
      
      // Initialize all dashboard components
      this.components.talkTime = new TalkTimeCard();
      this.components.onCall = new OnCallCard();
      this.components.idleTime = new IdleTimeCard();
      this.components.stats = new StatsCard();
      
      // Make components globally available for easy access
      window.talkTimeCard = this.components.talkTime;
      window.onCallCard = this.components.onCall;
      window.idleTimeCard = this.components.idleTime;
      window.statsCard = this.components.stats;
      
      Helpers.debugLog('✅ All components initialized');
      
    } catch (error) {
      throw new Error(`Component initialization failed: ${error.message}`);
    }
  }

  setupEventListeners() {
    try {
      // Ensure WebSocketService is available
      if (!window.WebSocketService || typeof window.WebSocketService.on !== 'function') {
        throw new Error('WebSocketService not properly initialized');
      }

      // WebSocket connection status
      WebSocketService.on('connection_status', (status) => {
        this.updateConnectionStatus(status);
      });

      // Dashboard data updates
      WebSocketService.on('dashboard_update', (data) => {
        this.handleDashboardUpdate(data);
      });

      // Call timer updates
      WebSocketService.on('call_timer_update', (data) => {
        this.components.onCall.updateCallTimer(data);
      });

      // Server errors
      WebSocketService.on('server_error', (error) => {
        NotificationService.instance.error(`Server error: ${error.message || error}`);
      });

      // Window events
      window.addEventListener('beforeunload', () => {
        this.cleanup();
      });

      // Visibility change (tab switching)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.onTabVisible();
        } else {
          this.onTabHidden();
        }
      });

      // Online/offline events
      window.addEventListener('online', () => {
        this.onNetworkOnline();
      });

      window.addEventListener('offline', () => {
        this.onNetworkOffline();
      });

      Helpers.debugLog('✅ Event listeners setup complete');
      
    } catch (error) {
      throw new Error(`Event listener setup failed: ${error.message}`);
    }
  }

  connectWebSocket() {
    try {
      WebSocketService.connect();
      Helpers.debugLog('🔌 WebSocket connection initiated');
    } catch (error) {
      throw new Error(`WebSocket connection failed: ${error.message}`);
    }
  }

  async loadInitialData() {
    try {
      Helpers.debugLog('📡 Loading initial dashboard data...');
      
      // Load dashboard data
      const dashboardResult = await APIService.getDashboardData();
      if (dashboardResult.success) {
        this.handleDashboardUpdate(dashboardResult.data);
      }
      
      // Load server stats
      const statsResult = await APIService.getServerStats();
      if (statsResult.success) {
        this.components.stats.updateData(statsResult.data);
      }
      
      Helpers.debugLog('✅ Initial data loaded successfully');
      
    } catch (error) {
      Helpers.debugLog('⚠️ Failed to load initial data:', error.message);
      // Don't throw error - WebSocket will provide updates
    }
  }

  handleDashboardUpdate(data) {
    try {
      if (!data) {
        Helpers.debugLog('⚠️ Received empty dashboard data');
        return;
      }

      Helpers.debugLog('📊 Processing dashboard update');
      
      // Update components
      if (data.agentsTalkTime) {
        this.components.talkTime.updateData(data.agentsTalkTime);
      }
      
      if (data.agentsOnCall) {
        this.components.onCall.updateData(data.agentsOnCall);
      }
      
      if (data.agentsIdleTime) {
        this.components.idleTime.updateData(data.agentsIdleTime);
      }
      
      // Update header stats
      this.updateHeaderStats(data);
      
      // Update last updated time
      if (data.lastUpdated) {
        this.updateLastUpdatedTime(data.lastUpdated);
      }
      
    } catch (error) {
      Helpers.debugLog('❌ Error processing dashboard update:', error.message);
      NotificationService.instance.error('Failed to update dashboard data');
    }
  }

  updateConnectionStatus(status) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    
    if (statusDot && statusText) {
      statusDot.className = `status-dot ${status.connected ? 'connected' : ''}`;
      statusText.textContent = status.status;
      
      if (status.connected) {
        this.reconnectAttempts = 0;
      } else {
        this.reconnectAttempts = status.attempt || 0;
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          NotificationService.instance.error('Connection lost. Please refresh the page.');
        }
      }
    }
    
    Helpers.debugLog(`🔗 Connection status: ${status.status}`);
  }

  updateHeaderStats(data) {
    const agentCount = document.getElementById('agentCount');
    if (agentCount) {
      const totalAgents = (data.agentsTalkTime?.length || 0) + 
                         (data.agentsOnCall?.length || 0) + 
                         (data.agentsIdleTime?.length || 0);
      agentCount.textContent = Formatters.formatAgentCount(totalAgents);
    }
  }

  updateLastUpdatedTime(timestamp) {
    const lastUpdated = document.getElementById('lastUpdated');
    if (lastUpdated) {
      lastUpdated.textContent = `Updated: ${Formatters.formatLastUpdated(timestamp)}`;
    }
  }

  // Tab visibility events
  onTabVisible() {
    Helpers.debugLog('📱 Tab became visible - resuming updates');
    
    // Reconnect WebSocket if needed
    if (!WebSocketService.getConnectionStatus().connected) {
      WebSocketService.connect();
    }
    
    // Refresh data
    this.loadInitialData();
  }

  onTabHidden() {
    Helpers.debugLog('📱 Tab hidden - reducing activity');
    // Could reduce update frequency here if needed
  }

  // Network events
  onNetworkOnline() {
    Helpers.debugLog('🌐 Network came online');
    NotificationService.instance.success('Connection restored');
    
    // Reconnect WebSocket
    setTimeout(() => {
      WebSocketService.connect();
    }, 1000);
  }

  onNetworkOffline() {
    Helpers.debugLog('🌐 Network went offline');
    NotificationService.instance.warning('Network connection lost');
  }

  // Error handling
  showInitializationError(error) {
    const errorHTML = `
      <div class="dashboard-error">
        <div class="error-content">
          <h2>❌ Dashboard Initialization Failed</h2>
          <p>Unable to load the dashboard. Please try refreshing the page.</p>
          <p class="error-details">${Helpers.sanitizeHTML(error.message)}</p>
          <button onclick="window.location.reload()" class="retry-button">
            🔄 Retry
          </button>
        </div>
      </div>
    `;
    
    const mainGrid = document.querySelector('.dashboard-grid');
    if (mainGrid) {
      mainGrid.innerHTML = errorHTML;
    }
  }

  // Utility methods
  async refreshAllData() {
    try {
      await this.loadInitialData();
      NotificationService.instance.success('Data refreshed successfully');
    } catch (error) {
      NotificationService.instance.error(`Refresh failed: ${error.message}`);
    }
  }

  getSystemInfo() {
    return {
      initialized: this.isInitialized,
      components: Object.keys(this.components),
      websocketStatus: WebSocketService.getConnectionStatus(),
      reconnectAttempts: this.reconnectAttempts
    };
  }

  // Cleanup
  cleanup() {
    Helpers.debugLog('🧹 Cleaning up dashboard...');
    
    // Cleanup components
    Object.values(this.components).forEach(component => {
      if (component.destroy) {
        component.destroy();
      }
    });
    
    // Disconnect WebSocket
    WebSocketService.disconnect();
    
    // Clear notifications
    NotificationService.instance.clear();
  }
}

// Error handling styles
const errorStyles = `
  <style>
    .dashboard-error {
      grid-column: 1 / -1;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 400px;
      background: var(--card-background);
      border-radius: var(--border-radius);
      box-shadow: var(--shadow);
    }
    
    .error-content {
      text-align: center;
      padding: 2rem;
      max-width: 500px;
    }
    
    .error-content h2 {
      color: var(--error-color);
      margin-bottom: 1rem;
    }
    
    .error-details {
      font-family: monospace;
      background: #f8f9fa;
      padding: 1rem;
      border-radius: 4px;
      margin: 1rem 0;
      font-size: 0.9rem;
      border-left: 4px solid var(--error-color);
    }
    
    .retry-button {
      background: var(--primary-color);
      color: white;
      border: none;
      padding: 1rem 2rem;
      border-radius: var(--border-radius);
      cursor: pointer;
      font-size: 1rem;
      transition: background-color 0.2s ease;
    }
    
    .retry-button:hover {
      background: var(--primary-dark);
    }
  </style>
`;
document.head.insertAdjacentHTML('beforeend', errorStyles);

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Create global dashboard instance
  window.dashboard = new Dashboard();
  
  // Make dashboard methods available globally for debugging
  window.refreshDashboard = () => window.dashboard.refreshAllData();
  window.getDashboardInfo = () => window.dashboard.getSystemInfo();
});

// Global error handler
window.addEventListener('error', (event) => {
  Helpers.debugLog(`🚨 Global error: ${event.error?.message || event.message}`);
  NotificationService.instance.error(`Unexpected error: ${event.error?.message || 'Unknown error'}`);
});

// Global promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
  Helpers.debugLog(`🚨 Unhandled promise rejection: ${event.reason}`);
  NotificationService.instance.error(`Promise rejection: ${event.reason}`);
});