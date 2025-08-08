// Server Stats Card Component
class StatsCard extends BaseComponent {
  constructor() {
    super('statsCard', {
      autoUpdate: true,
      animateUpdates: true,
      debugMode: false
    });
    
    this.refreshInterval = null;
    this.setupAutoRefresh();
  }

  setupEventListeners() {
    // Listen for connection status changes
    WebSocketService.on('connection_status', (status) => {
      this.updateConnectionStatus(status);
    });
  }

  setupAutoRefresh() {
    // Refresh stats every 30 seconds
    this.refreshInterval = setInterval(async () => {
      await this.loadServerStats();
    }, 30000);
  }

  async loadServerStats() {
    try {
      const result = await APIService.getServerStats();
      if (result.success) {
        this.updateData(result.data);
      }
    } catch (error) {
      Helpers.debugLog('Failed to load server stats:', error.message);
    }
  }

  render() {
    if (!this.data) {
      this.showLoading('Loading server stats...');
      return;
    }

    const stats = this.data;
    const statsHTML = `
      <div class="stats-grid">
        <div class="stat-item ${this.getStatClass('totalAgents')}">
          <div class="stat-value" id="totalAgents">${stats.totalAgents || 0}</div>
          <div class="stat-label">Total Agents</div>
        </div>
        
        <div class="stat-item ${this.getStatClass('onlineAgents')}">
          <div class="stat-value" id="onlineAgents">${stats.onlineAgents || 0}</div>
          <div class="stat-label">Online Now</div>
        </div>
        
        <div class="stat-item ${this.getStatClass('activeCalls')}">
          <div class="stat-value" id="activeCalls">${stats.activeCallsCount || 0}</div>
          <div class="stat-label">Active Calls</div>
        </div>
        
        <div class="stat-item ${this.getStatClass('todayCalls')}">
          <div class="stat-value" id="todayCalls">${stats.todayCalls || 0}</div>
          <div class="stat-label">Today's Calls</div>
        </div>
      </div>
      
      <div class="stats-footer">
        <div class="server-time">
          Server Time: ${this.formatServerTime(stats.serverTime)}
        </div>
        <div class="last-refresh">
          Last Updated: ${Formatters.formatTime(new Date())}
        </div>
      </div>
    `;

    this.setContent(statsHTML);
  }

  getStatClass(statType) {
    if (!this.data) return '';
    
    const value = this.data[statType] || 0;
    
    switch (statType) {
      case 'onlineAgents':
        if (value === 0) return 'stat-warning';
        if (value >= 15) return 'stat-success';
        return 'stat-normal';
        
      case 'activeCalls':
        if (value >= 10) return 'stat-success';
        if (value >= 5) return 'stat-normal';
        return 'stat-low';
        
      case 'todayCalls':
        if (value >= 100) return 'stat-success';
        if (value >= 50) return 'stat-normal';
        return 'stat-low';
        
      default:
        return 'stat-normal';
    }
  }

  formatServerTime(serverTime) {
    if (!serverTime) return 'Unknown';
    
    return new Date(serverTime).toLocaleString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: 'short',
      hour12: false
    });
  }

  updateConnectionStatus(status) {
    const statusElement = this.element.querySelector('.connection-indicator');
    if (statusElement) {
      statusElement.className = `connection-indicator ${status.connected ? 'connected' : 'disconnected'}`;
      statusElement.textContent = status.status;
    }
  }

  // Update individual stat values with animation
  updateStatValue(statType, newValue) {
    const element = document.getElementById(statType);
    if (element) {
      const currentValue = parseInt(element.textContent) || 0;
      
      if (currentValue !== newValue) {
        // Add animation class
        element.classList.add('stat-updating');
        
        // Update value
        element.textContent = newValue;
        
        // Update parent class
        const parent = element.parentElement;
        if (parent) {
          parent.className = `stat-item ${this.getStatClass(statType)}`;
        }
        
        // Remove animation class after animation
        setTimeout(() => {
          element.classList.remove('stat-updating');
        }, 300);
      }
    }
  }

  onDataUpdated(oldData, newData) {
    // Animate individual stat changes
    if (oldData && newData) {
      ['totalAgents', 'onlineAgents', 'activeCallsCount', 'todayCalls'].forEach(stat => {
        const oldValue = oldData[stat] || 0;
        const newValue = newData[stat] || 0;
        
        if (oldValue !== newValue) {
          this.updateStatValue(stat, newValue);
          
          // Show notification for significant changes
          if (stat === 'onlineAgents') {
            const diff = newValue - oldValue;
            if (Math.abs(diff) >= 3) {
              const message = diff > 0 ? 
                `${diff} more agents came online` : 
                `${Math.abs(diff)} agents went offline`;
              NotificationService.instance.info(message);
            }
          }
        }
      });
    }
  }

  destroy() {
    super.destroy();
    
    // Clear refresh interval
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }
}

// Add stats-specific CSS
const statsStyles = `
  <style>
    .stats-footer {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.8rem;
      color: var(--text-secondary);
    }
    
    .stat-updating {
      animation: statPulse 0.3s ease-in-out;
    }
    
    .stat-success .stat-value { color: var(--success-color); }
    .stat-warning .stat-value { color: var(--warning-color); }
    .stat-low .stat-value { color: var(--text-secondary); }
    .stat-normal .stat-value { color: var(--primary-color); }
    
    @keyframes statPulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.1); }
      100% { transform: scale(1); }
    }
    
    @media (max-width: 768px) {
      .stats-footer {
        flex-direction: column;
        gap: 0.5rem;
        text-align: center;
      }
    }
  </style>
`;
document.head.insertAdjacentHTML('beforeend', statsStyles);

// Make available globally
window.StatsCard = StatsCard;