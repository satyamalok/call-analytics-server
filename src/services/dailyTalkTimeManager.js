const fs = require('fs').promises;
const path = require('path');

class DailyTalkTimeManager {
  constructor() {
    this.filePath = path.join(__dirname, '../../data/daily-talk-time.json');
    this.todayData = {}; // Store only today's data in memory
    this.today = new Date().toISOString().split('T')[0];
    this.init();
  }

  async init() {
    try {
      await this.loadTodayData();
      this.startDayResetChecker();
      console.log('✅ DailyTalkTimeManager initialized (memory-based for today only)');
    } catch (error) {
      console.error('❌ DailyTalkTimeManager initialization failed:', error.message);
      this.todayData = {};
    }
  }

  async loadTodayData() {
    try {
      // Check if file exists and load only today's data
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(data);
      
      // Only keep today's data in memory
      const today = new Date().toISOString().split('T')[0];
      this.todayData = parsed.dailyData?.[today] || {};
      this.today = today;
      
      console.log(`📊 Loaded today's talk time data for ${Object.keys(this.todayData).length} agents`);
    } catch (error) {
      console.log('📄 Starting fresh - no existing daily talk time data');
      this.todayData = {};
    }
  }

  async saveTodayData() {
    try {
      // Save only today's data to file (backup)
      const dataToSave = {
        metadata: {
          version: "2.0",
          lastUpdated: new Date().toISOString(),
          date: this.today
        },
        dailyData: {
          [this.today]: this.todayData
        }
      };

      await fs.writeFile(this.filePath, JSON.stringify(dataToSave, null, 2), 'utf8');
    } catch (error) {
      console.error('❌ Error saving today talk time data:', error.message);
    }
  }

  // Update agent's total talk time for today
  async updateAgentTalkTime(agentCode, agentName, totalTalkTimeSeconds, callCount = null) {
    try {
      // Initialize agent if not exists for today
      if (!this.todayData[agentCode]) {
        this.todayData[agentCode] = {
          agentName: agentName,
          totalTalkTime: 0,
          lastUpdated: new Date().toISOString(),
          callCount: 0
        };
      }

      // Update data
      this.todayData[agentCode].totalTalkTime = totalTalkTimeSeconds;
      this.todayData[agentCode].agentName = agentName; // Update in case name changed
      this.todayData[agentCode].lastUpdated = new Date().toISOString();
      
      if (callCount !== null) {
        this.todayData[agentCode].callCount = callCount;
      }

      // Save to file as backup
      await this.saveTodayData();
      
      console.log(`📊 Updated ${agentCode} total talk time: ${totalTalkTimeSeconds}s (${this.formatDuration(totalTalkTimeSeconds)})`);
      
      return this.todayData[agentCode];
    } catch (error) {
      console.error('❌ Error updating agent talk time:', error.message);
      throw error;
    }
  }

  // Get today's talk time for all agents
  getTodayTalkTime() {
    return Object.entries(this.todayData).map(([agentCode, data]) => ({
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
    return this.todayData[agentCode] || { totalTalkTime: 0, callCount: 0 };
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

  // Check if day has changed and reset data
  startDayResetChecker() {
    setInterval(() => {
      const currentDay = new Date().toISOString().split('T')[0];
      
      if (currentDay !== this.today) {
        console.log(`🌅 New day detected: ${currentDay}. Resetting daily data.`);
        this.todayData = {};
        this.today = currentDay;
        this.saveTodayData();
      }
    }, 60000); // Check every minute
  }

  // Get all agents with current data
  getAllActiveAgents() {
    return Object.keys(this.todayData);
  }

  // Reset for new day (called by server at midnight)
  async resetForNewDay() {
    console.log('🌅 Resetting daily talk time for new day');
    this.todayData = {};
    this.today = new Date().toISOString().split('T')[0];
    await this.saveTodayData();
  }
}

module.exports = new DailyTalkTimeManager();