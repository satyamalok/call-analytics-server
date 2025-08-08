// Idle Time Card Component
class IdleTimeCard extends BaseComponent {
  constructor() {
    super('idleTimeCard', {
      autoUpdate: true,
      animateUpdates: true,
      debugMode: false
    });
    
    this.idleTimers = new Map(); // agentCode -> idle data
    this.setupIdleUpdates();
  }

  setupIdleUpdates() {
    // Update idle times every 30 seconds
    this.idleInterval = setInterval(() => {
      this.updateIdleTimes();
    }, 30000);
  }

  render() {
    if (!this.data || !Array.isArray(this.data)) {
      this.showLoading('Loading idle data...');
      this.updateBadge(0);
      return;
    }

    if (this.data.length === 0) {
      this.showNoData('📞 All agents recently active');
      this.updateBadge(0);
      return;
    }

    // Sort by idle time (longest idle first)
    const sortedData = [...this.data].sort((a, b) => {
      return (b.minutesSinceLastCall || 0) - (a.minutesSinceLastCall || 0);
    });

    const itemsHTML = sortedData.map(agent => this.renderIdleItem(agent)).join('');
    
    this.setContent(`<div class="idle-time-list">${itemsHTML}</div>`);
    this.updateBadge(sortedData.length);
    
    // Store idle data for local updates
    this.storeIdleData(sortedData);
  }

  renderIdleItem(agent) {
    const idleTime = this.formatIdleTime(agent.minutesSinceLastCall);
    const urgencyClass = this.getUrgencyClass(agent.minutesSinceLastCall);
    
    return `
      <div class="idle-item ${urgencyClass} fade-in" data-agent-code="${agent.agentCode}">
        <div class="agent-info">
          <div class="agent-name">${Helpers.sanitizeHTML(agent.agentCode)} - ${Helpers.sanitizeHTML(agent.agentName)}</div>
          <div class="last-call-time">Last call: ${this.formatLastCallTime(agent.lastCallEnd)}</div>
        </div>
        <div class="idle-duration">
          <span class="time-badge idle-badge ${urgencyClass}" data-minutes="${agent.minutesSinceLastCall}">
            ${idleTime}
          </span>
          <div class="idle-status">${this.getIdleStatusText(agent.minutesSinceLastCall)}</div>
        </div>
      </div>
    `;
  }

  formatIdleTime(minutes) {
    if (!minutes || minutes < 0) return '0m';
    
    if (minutes < 60) {
      return `${minutes}m`;
    } else {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    }
  }

  formatLastCallTime(lastCallEnd) {
    if (!lastCallEnd) return 'Unknown';
    
    const endTime = new Date(lastCallEnd);
    const now = new Date();
    const diffHours = Math.floor((now - endTime) / (1000 * 60 * 60));
    
    if (diffHours < 1) {
      return Formatters.formatTime(lastCallEnd);
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else {
      return endTime.toLocaleDateString();
    }
  }

  getUrgencyClass(minutes) {
    if (minutes >= 60) return 'urgent'; // Red for 1+ hours
    if (minutes >= 30) return 'warning'; // Orange for 30+ minutes  
    if (minutes >= 15) return 'caution'; // Yellow for 15+ minutes
    return 'normal'; // Default
  }

  getIdleStatusText(minutes) {
    if (minutes >= 120) return 'Very Long Idle';
    if (minutes >= 60) return 'Long Idle';
    if (minutes >= 30) return 'Extended Idle';
    if (minutes >= 15) return 'Idle';
    return 'Recently Active';
  }

  storeIdleData(idleData) {
    idleData.forEach(agent => {
      this.idleTimers.set(agent.agentCode, {
        lastCallEnd: new Date(agent.lastCallEnd),
        initialMinutes: agent.minutesSinceLastCall,
        lastUpdated: new Date()
      });
    });
  }

  updateIdleTimes() {
    if (!this.element || this.idleTimers.size === 0) return;

    for (const [agentCode, idleData] of this.idleTimers.entries()) {
      const item = this.element.querySelector(`[data-agent-code="${agentCode}"]`);
      if (item) {
        const badge = item.querySelector('.time-badge');
        const statusElement = item.querySelector('.idle-status');
        
        if (badge && idleData.lastCallEnd) {
          const now = new Date();
          const currentIdleMinutes = Math.floor((now - idleData.lastCallEnd) / (1000 * 60));
          
          // Update display
          const formattedTime = this.formatIdleTime(currentIdleMinutes);
          const urgencyClass = this.getUrgencyClass(currentIdleMinutes);
          const statusText = this.getIdleStatusText(currentIdleMinutes);
          
          badge.textContent = formattedTime;
          badge.setAttribute('data-minutes', currentIdleMinutes);
          
          // Update classes
          badge.className = `time-badge idle-badge ${urgencyClass}`;
          item.className = `idle-item ${urgencyClass} fade-in`;
          
          if (statusElement) {
            statusElement.textContent = statusText;
          }
        }
      } else {
        // Remove timer for agents no longer idle
        this.idleTimers.delete(agentCode);
      }
    }
  }

  onDataUpdated(oldData, newData) {
    // Clean up timers for agents no longer idle
    if (oldData) {
      const noLongerIdle = oldData.filter(oldAgent => 
        !newData.find(newAgent => newAgent.agentCode === oldAgent.agentCode)
      );
      
      noLongerIdle.forEach(agent => {
        this.idleTimers.delete(agent.agentCode);
      });
    }

    // Check for agents with extended idle times
    if (newData) {
      const longIdleAgents = newData.filter(agent => agent.minutesSinceLastCall >= 60);
      
      if (longIdleAgents.length > 0) {
        const agentCodes = longIdleAgents.map(a => `${a.agentCode} (${this.formatIdleTime(a.minutesSinceLastCall)})`).join(', ');
        
        if (longIdleAgents.some(a => a.minutesSinceLastCall >= 120)) {
          NotificationService.instance.warning(`Agents with very long idle times: ${agentCodes}`);
        }
      }
    }
  }

  destroy() {
    super.destroy();
    
    // Clear idle interval
    if (this.idleInterval) {
      clearInterval(this.idleInterval);
    }
    
    // Clear idle timers
    this.idleTimers.clear();
  }
}

// Add CSS for urgency classes
const urgencyStyles = `
  <style>
    .idle-item.caution { border-left-color: #FFC107; background: #FFFDE7; }
    .idle-item.warning { border-left-color: #FF9800; background: #FFF3E0; }
    .idle-item.urgent { border-left-color: #F44336; background: #FFEBEE; }
    
    .idle-badge.caution { background: #FFC107; }
    .idle-badge.warning { background: #FF9800; }
    .idle-badge.urgent { background: #F44336; animation: pulse 1.5s infinite; }
    
    .idle-status { font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem; }
    .last-call-time { font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem; }
  </style>
`;
document.head.insertAdjacentHTML('beforeend', urgencyStyles);

// Make available globally and create instance
window.IdleTimeCard = IdleTimeCard;