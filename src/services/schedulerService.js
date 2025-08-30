const nocodbService = require('./nocodbService');
const agentManager = require('./agentManager');
const dailyTalkTimeManager = require('./dailyTalkTimeManager');

class SchedulerService {
  constructor() {
    this.scheduledJobs = {};
    this.isRunning = false;
    this.init();
  }

  init() {
    console.log('✅ SchedulerService initialized');
    this.startDailyStatsScheduler();
  }

  startDailyStatsScheduler() {
    // Schedule daily stats upload at 11:55 PM IST
    this.scheduleIST('daily-stats-upload', '23:55', async () => {
      await this.uploadDailyStatsToNocoDB();
    });

    // Schedule counter reset at 11:56 PM IST (after stats upload)
    this.scheduleIST('daily-counter-reset', '23:56', async () => {
      await this.resetDailyCounters();
    });

    console.log('📅 Daily stats scheduler started - Upload at 11:55 PM IST, Reset at 11:56 PM IST');
  }

  scheduleIST(jobName, timeString, callback) {
    const [hour, minute] = timeString.split(':').map(Number);
    
    const scheduleNext = () => {
      const now = new Date();
      const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
      const istNow = new Date(now.getTime() + istOffset);
      
      // Create next execution time in IST
      const nextExecution = new Date(istNow);
      nextExecution.setHours(hour, minute, 0, 0);
      
      // If the time has passed today, schedule for tomorrow
      if (nextExecution <= istNow) {
        nextExecution.setDate(nextExecution.getDate() + 1);
      }
      
      // Convert back to UTC for setTimeout
      const utcNextExecution = new Date(nextExecution.getTime() - istOffset);
      const delay = utcNextExecution.getTime() - now.getTime();
      
      console.log(`⏰ Scheduled ${jobName} for ${nextExecution.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
      
      if (this.scheduledJobs[jobName]) {
        clearTimeout(this.scheduledJobs[jobName]);
      }
      
      this.scheduledJobs[jobName] = setTimeout(async () => {
        try {
          console.log(`🚀 Executing scheduled job: ${jobName}`);
          await callback();
          console.log(`✅ Completed scheduled job: ${jobName}`);
        } catch (error) {
          console.error(`❌ Error in scheduled job ${jobName}:`, error.message);
        }
        
        // Schedule next execution
        scheduleNext();
      }, delay);
    };
    
    scheduleNext();
  }

  async uploadDailyStatsToNocoDB() {
    try {
      console.log('📊 Starting daily stats upload to NocoDB...');
      
      const today = this.getTodayIST();
      const allAgents = agentManager.getAllAgents();
      const dailyData = dailyTalkTimeManager.getAllAgentData();
      
      if (allAgents.length === 0) {
        console.log('⚠️ No agents found for daily stats upload');
        return;
      }
      
      let uploadCount = 0;
      const statsToUpload = [];
      
      for (const agent of allAgents) {
        const agentCode = agent.agentCode;
        const agentName = agent.agentName;
        const agentStats = dailyData[agentCode];
        
        if (agentStats) {
          // Convert seconds to minutes for talktime
          const talktimeMinutes = Math.floor(agentStats.totalTalkTime / 60);
          const totalCalls = agentStats.totalCalls;
          
          statsToUpload.push({
            agentCode,
            agentName,
            date: today,
            talktime: talktimeMinutes,
            totalCalls
          });
          
          console.log(`📈 Prepared stats for ${agentCode}: ${talktimeMinutes}min talktime, ${totalCalls} calls`);
        } else {
          // Agent had no activity today, still record with 0 values
          statsToUpload.push({
            agentCode,
            agentName,
            date: today,
            talktime: 0,
            totalCalls: 0
          });
          
          console.log(`📊 Prepared stats for ${agentCode}: No activity today`);
        }
      }
      
      // Upload stats in bulk
      if (statsToUpload.length > 0) {
        try {
          await nocodbService.bulkCreateDailyStats(statsToUpload);
          uploadCount = statsToUpload.length;
          console.log(`✅ Successfully uploaded daily stats for ${uploadCount} agents to NocoDB`);
        } catch (error) {
          // If bulk upload fails, try individual uploads
          console.log('⚠️ Bulk upload failed, trying individual uploads...');
          
          for (const stats of statsToUpload) {
            try {
              await nocodbService.upsertDailyStats(
                stats.agentCode,
                stats.agentName,
                stats.date,
                stats.talktime,
                stats.totalCalls
              );
              uploadCount++;
            } catch (individualError) {
              console.error(`❌ Failed to upload stats for ${stats.agentCode}:`, individualError.message);
            }
          }
          
          console.log(`✅ Individual uploads completed: ${uploadCount}/${statsToUpload.length} successful`);
        }
      }
      
      console.log(`🎯 Daily stats upload completed: ${uploadCount} records uploaded for ${today}`);
      
      // Also process any remaining queue items
      await nocodbService.forceProcessQueue();
      
    } catch (error) {
      console.error('❌ Error during daily stats upload:', error.message);
    }
  }

  async resetDailyCounters() {
    try {
      console.log('🔄 Resetting daily counters...');
      
      // Reset daily talk time manager
      dailyTalkTimeManager.resetAllData();
      
      // Force save empty data
      await dailyTalkTimeManager.saveData();
      
      console.log('✅ Daily counters reset completed - Ready for new day');
      
    } catch (error) {
      console.error('❌ Error during daily counter reset:', error.message);
    }
  }

  // Manual triggers for testing
  async manualUploadStats() {
    console.log('🔧 Manual trigger: Uploading daily stats...');
    await this.uploadDailyStatsToNocoDB();
  }

  async manualResetCounters() {
    console.log('🔧 Manual trigger: Resetting counters...');
    await this.resetDailyCounters();
  }

  // Utility methods
  getTodayIST() {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    const istTime = new Date(now.getTime() + istOffset);
    return istTime.toISOString().split('T')[0];
  }

  getISTTime() {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    const istTime = new Date(now.getTime() + istOffset);
    return istTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  }

  // Status and management
  getSchedulerStatus() {
    const jobNames = Object.keys(this.scheduledJobs);
    return {
      isRunning: this.isRunning,
      activeJobs: jobNames,
      jobCount: jobNames.length,
      currentISTTime: this.getISTTime(),
      todayDate: this.getTodayIST()
    };
  }

  // Shutdown
  destroy() {
    console.log('🛑 Shutting down scheduler...');
    
    for (const [jobName, timeoutId] of Object.entries(this.scheduledJobs)) {
      clearTimeout(timeoutId);
      console.log(`⏰ Cancelled scheduled job: ${jobName}`);
    }
    
    this.scheduledJobs = {};
    this.isRunning = false;
    
    console.log('✅ SchedulerService destroyed');
  }
}

module.exports = new SchedulerService();