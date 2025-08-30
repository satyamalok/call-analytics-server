const fs = require('fs').promises;
const path = require('path');

class DailyTalkTimeManager {
  constructor() {
    this.filePath = path.join(__dirname, '../../data/daily-talk-time.json');
    this.data = { dailyData: {}, metadata: {} };
    this.init();
  }

  async init() {
    try {
      await this.loadData();
      console.log('✅ DailyTalkTimeManager initialized');
    } catch (error) {
      console.error('❌ DailyTalkTimeManager initialization failed:', error.message);
      await this.createDefaultFile();
    }
  }

  async loadData() {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(data);
      this.data = parsed;
      console.log(`📊 Loaded daily talk time data for ${Object.keys(this.data.dailyData).length} days`);
    } catch (error) {
      console.log('📄 Creating new daily-talk-time.json file');
      await this.createDefaultFile();
    }
  }

  async createDefaultFile() {
    const defaultData = {
      metadata: {
        version: "1.0",
        lastUpdated: new Date().toISOString()
      },
      dailyData: {}
    };
    
    await this.saveToFile(defaultData);
    this.data = defaultData;
  }

  async saveToFile(data = null) {
    try {
      const dataToSave = data || {
        ...this.data,
        metadata: {
          ...this.data.metadata,
          lastUpdated: new Date().toISOString()
        }
      };

      await fs.writeFile(this.filePath, JSON.stringify(dataToSave, null, 2), 'utf8');
      console.log(`💾 Saved daily talk time data`);
    } catch (error) {
      console.error('❌ Error saving daily talk time data:', error.message);
      throw error;
    }
  }

  // Update agent's total talk time for today
  async updateAgentTalkTime(agentCode, agentName, totalTalkTimeSeconds, callCount = null) {
    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      // Initialize day if not exists
      if (!this.data.dailyData[today]) {
        this.data.dailyData[today] = {};
      }

      // Initialize agent if not exists for today
      if (!this.data.dailyData[today][agentCode]) {
        this.data.dailyData[today][agentCode] = {
          agentName: agentName,
          totalTalkTime: 0,
          lastUpdated: new Date().toISOString(),
          callCount: 0
        };
      }

      // Update data
      this.data.dailyData[today][agentCode].totalTalkTime = totalTalkTimeSeconds;
      this.data.dailyData[today][agentCode].agentName = agentName; // Update in case name changed
      this.data.dailyData[today][agentCode].lastUpdated = new Date().toISOString();
      
      if (callCount !== null) {
        this.data.dailyData[today][agentCode].callCount = callCount;
      }

      await this.saveToFile();
      
      console.log(`📊 Updated ${agentCode} total talk time: ${totalTalkTimeSeconds}s (${this.formatDuration(totalTalkTimeSeconds)})`);
      
      return this.data.dailyData[today][agentCode];
    } catch (error) {
      console.error('❌ Error updating agent talk time:', error.message);
      throw error;
    }
  }

  // Get today's talk time for all agents
  getTodayTalkTime() {
    const today = new Date().toISOString().split('T')[0];
    const todayData = this.data.dailyData[today] || {};
    
    return Object.entries(todayData).map(([agentCode, data]) => ({
      agentCode,
      agentName: data.agentName,
      totalTalkTime: data.totalTalkTime || 0,
      formattedTalkTime: this.formatDuration(data.totalTalkTime || 0),
      callCount: data.callCount || 0,
      lastUpdated: data.lastUpdated
    }));
  }

  // Get specific agent's talk time for today
  getAgentTodayTalkTime(agentCode) {
    const today = new Date().toISOString().split('T')[0];
    const todayData = this.data.dailyData[today] || {};
    return todayData[agentCode] || { totalTalkTime: 0, callCount: 0 };
  }

  // Get talk time for specific date
  getDateTalkTime(date) {
    const dateData = this.data.dailyData[date] || {};
    
    return Object.entries(dateData).map(([agentCode, data]) => ({
      agentCode,
      agentName: data.agentName,
      totalTalkTime: data.totalTalkTime || 0,
      formattedTalkTime: this.formatDuration(data.totalTalkTime || 0),
      callCount: data.callCount || 0,
      lastUpdated: data.lastUpdated
    }));
  }

  // Get agent history for date range
  getAgentHistory(agentCode, startDate, endDate) {
    const history = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      const dateStr = date.toISOString().split('T')[0];
      const dayData = this.data.dailyData[dateStr] || {};
      const agentData = dayData[agentCode];
      
      if (agentData) {
        history.push({
          date: dateStr,
          totalTalkTime: agentData.totalTalkTime || 0,
          formattedTalkTime: this.formatDuration(agentData.totalTalkTime || 0),
          callCount: agentData.callCount || 0
        });
      }
    }
    
    return history;
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

  // Get all available dates
  getAvailableDates() {
    return Object.keys(this.data.dailyData).sort().reverse(); // Latest first
  }

  // Get all agent data for today (used by scheduler)
  getAllAgentData() {
    const today = new Date().toISOString().split('T')[0];
    const todayData = this.data.dailyData[today] || {};
    
    const result = {};
    for (const [agentCode, data] of Object.entries(todayData)) {
      result[agentCode] = {
        agentName: data.agentName,
        totalTalkTime: data.totalTalkTime || 0,
        totalCalls: data.callCount || 0,
        lastUpdated: data.lastUpdated
      };
    }
    
    return result;
  }

  // Reset all data (used by scheduler after daily upload)
  resetAllData() {
    const today = new Date().toISOString().split('T')[0];
    
    // Keep historical data, just reset today's data
    if (this.data.dailyData[today]) {
      console.log(`🔄 Resetting data for ${Object.keys(this.data.dailyData[today]).length} agents on ${today}`);
      delete this.data.dailyData[today];
    }
  }

  // Force save current data (used by scheduler)
  async saveData() {
    await this.saveToFile();
  }

  // Cleanup old data (if needed in future)
  async cleanupOldData(daysToKeep = 1095) { // 3 years default
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      const cutoffStr = cutoffDate.toISOString().split('T')[0];
      
      let removedCount = 0;
      for (const date of Object.keys(this.data.dailyData)) {
        if (date < cutoffStr) {
          delete this.data.dailyData[date];
          removedCount++;
        }
      }
      
      if (removedCount > 0) {
        await this.saveToFile();
        console.log(`🧹 Cleaned up ${removedCount} old daily records`);
      }
      
      return removedCount;
    } catch (error) {
      console.error('❌ Error cleaning up old data:', error.message);
      return 0;
    }
  }
}

module.exports = new DailyTalkTimeManager();