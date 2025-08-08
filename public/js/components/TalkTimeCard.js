// Talk Time Card Component
class TalkTimeCard extends BaseComponent {
  constructor() {
    super('talkTimeCard', {
      autoUpdate: true,
      animateUpdates: true,
      debugMode: false
    });
    
    this.sortBy = 'agentCode';
    this.sortDirection = 'asc';
    this.setupSortControls();
  }

  get defaultOptions() {
    return {
      ...super.defaultOptions,
      allowSorting: true,
      allowAgentRemoval: true
    };
  }

  setupEventListeners() {
    // Sort dropdown change
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        const [sortBy, direction] = e.target.value.split('-');
        this.setSorting(sortBy, direction);
      });
    }
  }

  setupSortControls() {
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      // Set initial value
      sortSelect.value = `${this.sortBy}-${this.sortDirection}`;
    }
  }

  setSorting(sortBy, direction) {
    this.sortBy = sortBy;
    this.sortDirection = direction;
    
    if (this.data) {
      this.render(); // Re-render with new sorting
    }
    
    Helpers.debugLog(`Talk time sorting changed: ${sortBy} ${direction}`);
  }

  render() {
    if (!this.data || !Array.isArray(this.data)) {
      this.showLoading('Loading agent data...');
      return;
    }

    if (this.data.length === 0) {
      this.showNoData('No agents found');
      return;
    }

    // Sort data
    const sortedData = this.sortData([...this.data]);
    
    // Generate table HTML
    const tableHTML = `
      <div class="table-container">
        <table class="talk-time-table">
          <thead>
            <tr>
              <th>Agent Code</th>
              <th>Agent Name</th>
              <th>Talk Time</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${sortedData.map(agent => this.renderAgentRow(agent)).join('')}
          </tbody>
        </table>
      </div>
    `;

    this.setContent(tableHTML);
    this.updateBadge(sortedData.length);
  }

  renderAgentRow(agent) {
    const talkTime = agent.formattedTalkTime || Formatters.formatDuration(agent.todayTalkTime || 0);
    
    return `
      <tr data-agent-code="${agent.agentCode}" class="fade-in">
        <td><strong>${Helpers.sanitizeHTML(agent.agentCode)}</strong></td>
        <td>${Helpers.sanitizeHTML(agent.agentName)}</td>
        <td><span class="talk-time-value">${talkTime}</span></td>
        <td>
          <button 
            class="remove-agent-btn" 
            onclick="talkTimeCard.removeAgent('${agent.agentCode}')"
            title="Remove agent from dashboard"
            aria-label="Remove ${agent.agentCode}">
            ❌
          </button>
        </td>
      </tr>
    `;
  }

  sortData(data) {
    return data.sort((a, b) => {
      let aValue, bValue;
      
      switch (this.sortBy) {
        case 'agentCode':
          aValue = a.agentCode.toLowerCase();
          bValue = b.agentCode.toLowerCase();
          break;
        case 'talkTime':
          aValue = a.todayTalkTime || 0;
          bValue = b.todayTalkTime || 0;
          break;
        default:
          aValue = a.agentCode.toLowerCase();
          bValue = b.agentCode.toLowerCase();
      }

      let comparison = 0;
      if (aValue > bValue) comparison = 1;
      if (aValue < bValue) comparison = -1;

      return this.sortDirection === 'desc' ? comparison * -1 : comparison;
    });
  }

  async removeAgent(agentCode) {
    // Confirm removal
    if (!confirm(`Are you sure you want to remove ${agentCode} from the dashboard?\n\nThis will hide the agent but preserve their call history.`)) {
      return;
    }

    try {
      // Show loading state for this agent
      const row = this.element.querySelector(`tr[data-agent-code="${agentCode}"]`);
      if (row) {
        row.style.opacity = '0.5';
        row.style.pointerEvents = 'none';
      }

      // Call API
      const result = await APIService.removeAgent(agentCode);
      
      if (result.success) {
        // Remove from current data
        this.data = this.data.filter(agent => agent.agentCode !== agentCode);
        
        // Re-render
        this.render();
        
        // Show success notification
        NotificationService.instance.success(`Agent ${agentCode} removed from dashboard`);
        
        Helpers.debugLog(`Agent ${agentCode} removed successfully`);
      } else {
        throw new Error(result.error || 'Failed to remove agent');
      }

    } catch (error) {
      // Restore row state
      const row = this.element.querySelector(`tr[data-agent-code="${agentCode}"]`);
      if (row) {
        row.style.opacity = '1';
        row.style.pointerEvents = 'auto';
      }

      NotificationService.instance.error(`Failed to remove agent: ${error.message}`);
      Helpers.debugLog(`Error removing agent ${agentCode}:`, error.message);
    }
  }

  // Update specific agent's talk time (for real-time updates)
  updateAgentTalkTime(agentCode, newTalkTime, formattedTime) {
    if (!this.data) return;

    const agent = this.data.find(a => a.agentCode === agentCode);
    if (agent) {
      agent.todayTalkTime = newTalkTime;
      agent.formattedTalkTime = formattedTime;
      
      // Update specific row
      const row = this.element.querySelector(`tr[data-agent-code="${agentCode}"]`);
      if (row) {
        const talkTimeCell = row.querySelector('.talk-time-value');
        if (talkTimeCell) {
          talkTimeCell.textContent = formattedTime;
          talkTimeCell.classList.add('fade-in');
        }
      }
    }
  }

  onDataUpdated(oldData, newData) {
    // Check for new agents
    if (oldData && newData) {
      const newAgents = newData.filter(agent => 
        !oldData.find(oldAgent => oldAgent.agentCode === agent.agentCode)
      );
      
      if (newAgents.length > 0) {
        const agentCodes = newAgents.map(a => a.agentCode).join(', ');
        NotificationService.instance.info(`New agents connected: ${agentCodes}`);
      }
    }
  }
}

// Make available globally and create instance
window.TalkTimeCard = TalkTimeCard;