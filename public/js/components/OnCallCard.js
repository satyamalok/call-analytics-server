// On Call Card Component
class OnCallCard extends BaseComponent {
  constructor() {
    super('onCallCard', {
      autoUpdate: true,
      animateUpdates: true,
      debugMode: false
    });
    
    this.activeTimers = new Map(); // agentCode -> timer data
    this.setupTimerUpdates();
  }

  setupEventListeners() {
    // Listen for real-time timer updates
    WebSocketService.on('call_timer_update', (data) => {
      this.updateCallTimer(data);
    });
  }

  setupTimerUpdates() {
    // Update timers every second for smooth display
    this.timerInterval = setInterval(() => {
      this.updateLocalTimers();
    }, 1000);
  }

  render() {
    if (!this.data || !Array.isArray(this.data)) {
      this.showLoading('Loading call data...');
      this.updateBadge(0);
      return;
    }

    if (this.data.length === 0) {
      this.showNoData('📴 No agents currently on call');
      this.updateBadge(0);
      return;
    }

    // Sort by call start time (most recent first)
    const sortedData = [...this.data].sort((a, b) => {
      const timeA = new Date(a.callStartTime || 0);
      const timeB = new Date(b.callStartTime || 0);
      return timeB - timeA;
    });

    const itemsHTML = sortedData.map(agent => this.renderCallItem(agent)).join('');
    
    this.setContent(`<div class="on-call-list">${itemsHTML}</div>`);
    this.updateBadge(sortedData.length);
    
    // Initialize local timers for any new calls
    this.initializeLocalTimers(sortedData);
  }

  renderCallItem(agent) {
    const phoneNumber = Formatters.formatPhoneNumber(agent.phoneNumber);
    const duration = agent.formattedDuration || agent.currentDuration || 
                    this.calculateCallDuration(agent.callStartTime);
    
    // Store timer data for local updates
    this.activeTimers.set(agent.agentCode, {
      startTime: new Date(agent.callStartTime),
      serverDuration: agent.currentDuration || 0
    });

    return `
      <div class="on-call-item fade-in" data-agent-code="${agent.agentCode}">
        <div class="agent-info">
          <div class="agent-name">${Helpers.sanitizeHTML(agent.agentCode)} - ${Helpers.sanitizeHTML(agent.agentName)}</div>
          <div class="phone-number">${phoneNumber}</div>
          <div class="call-type">${this.getCallTypeIcon(agent.callType)} ${agent.callType}</div>
        </div>
        <div class="call-duration">
          <span class="time-badge on-call-badge" data-duration="${agent.currentDuration || 0}">
            ${duration}
          </span>
          <div class="call-start-time">${Formatters.formatTime(agent.callStartTime)}</div>
        </div>
      </div>
    `;
  }

  getCallTypeIcon(callType) {
    const icons = {
      'incoming': '📞',
      'outgoing': '📱',
      'unknown': '☎️'
    };
    return icons[callType] || icons.unknown;
  }

  calculateCallDuration(startTime) {
    if (!startTime) return '0s';
    
    const start = new Date(startTime);
    const now = new Date();
    const diffSeconds = Math.floor((now - start) / 1000);
    
    return Formatters.formatDuration(Math.max(0, diffSeconds));
  }

  // Update specific call timer from WebSocket
  updateCallTimer(data) {
    const item = this.element.querySelector(`[data-agent-code="${data.agentCode}"]`);
    if (item) {
      const badge = item.querySelector('.time-badge');
      if (badge) {
        badge.textContent = data.formattedDuration;
        badge.setAttribute('data-duration', data.duration);
        badge.classList.add('fade-in');
        
        // Update local timer data
        this.activeTimers.set(data.agentCode, {
          startTime: new Date(Date.now() - (data.duration * 1000)),
          serverDuration: data.duration
        });
      }
    }
  }

  // Initialize local timers for smooth updates
  initializeLocalTimers(callData) {
    callData.forEach(agent => {
      if (!this.activeTimers.has(agent.agentCode)) {
        this.activeTimers.set(agent.agentCode, {
          startTime: new Date(agent.callStartTime),
          serverDuration: agent.currentDuration || 0
        });
      }
    });
  }

  // Update local timers for smooth display
  updateLocalTimers() {
    if (!this.element || this.activeTimers.size === 0) return;

    for (const [agentCode, timerData] of this.activeTimers.entries()) {
      const item = this.element.querySelector(`[data-agent-code="${agentCode}"]`);
      if (item) {
        const badge = item.querySelector('.time-badge');
        if (badge) {
          const now = new Date();
          const elapsed = Math.floor((now - timerData.startTime) / 1000);
          const formattedDuration = Formatters.formatDuration(Math.max(0, elapsed));
          
          // Only update if duration has changed
          const currentDuration = badge.getAttribute('data-duration');
          if (parseInt(currentDuration) !== elapsed) {
            badge.textContent = formattedDuration;
            badge.setAttribute('data-duration', elapsed);
          }
        }
      } else {
        // Remove timer for agents no longer on call
        this.activeTimers.delete(agentCode);
      }
    }
  }

  onDataUpdated(oldData, newData) {
    // Clean up timers for ended calls
    if (oldData) {
      const endedCalls = oldData.filter(oldAgent => 
        !newData.find(newAgent => newAgent.agentCode === oldAgent.agentCode)
      );
      
      endedCalls.forEach(agent => {
        this.activeTimers.delete(agent.agentCode);
      });
      
      if (endedCalls.length > 0) {
        const agentCodes = endedCalls.map(a => a.agentCode).join(', ');
        Helpers.debugLog(`Calls ended: ${agentCodes}`);
      }
    }

    // Notify about new calls
    if (oldData && newData) {
      const newCalls = newData.filter(agent => 
        !oldData.find(oldAgent => oldAgent.agentCode === agent.agentCode)
      );
      
      if (newCalls.length > 0) {
        const agentCodes = newCalls.map(a => a.agentCode).join(', ');
        NotificationService.instance.info(`New calls started: ${agentCodes}`);
      }
    }
  }

  destroy() {
    super.destroy();
    
    // Clear timer interval
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    
    // Clear active timers
    this.activeTimers.clear();
  }
}

// Make available globally and create instance
window.OnCallCard = OnCallCard;