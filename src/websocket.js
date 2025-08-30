const database = require('./database');
const redis = require('./redis');
const dailyTalkTimeManager = require('./services/dailyTalkTimeManager');
const nocodbService = require('./services/nocodbService');

class WebSocketManager {
  constructor(io) {
    this.io = io;
    this.recentReminders = new Set();
    this.connectedAgents = new Map();
    this.agentIdleStartTimes = new Map(); // Track when agents went idle
    // NEW: Idle session queue to prevent missing data
    this.idleSessionQueue = [];
    this.processingQueue = false;
    this.init();
    this.startReminderSystem();
  }

  init() {
    this.io.on('connection', (socket) => {
      console.log(`🔌 Client connected: ${socket.id}`);

      // Handle agent authentication/identification
      socket.on('agent_online', async (data) => {
        await this.handleAgentOnline(socket, data);
      });

      socket.on('agent_offline', async (data) => {
        await this.handleAgentOffline(socket, data);
      });

      socket.on('call_started', async (data) => {
  console.log(`📞 Raw call_started data received:`, JSON.stringify(data, null, 2));
  await this.handleCallStarted(socket, data);


  
});

      socket.on('call_ended', async (data) => {
        await this.handleCallEnded(socket, data);
      });

      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });

      socket.on('ping', () => {
        socket.emit('pong');
      });

      socket.on('reminder_acknowledged', async (data) => {
  console.log(`✅ Reminder acknowledgment received:`, JSON.stringify(data, null, 2));
  await this.handleReminderAcknowledgment(socket, data);
});

// Manual notification trigger from dashboard
socket.on('send_manual_reminder', async (data) => {
  try {
    const { agentCode, agentName } = data;
    
    console.log(`📱 Manual reminder trigger request for ${agentCode} from dashboard`);
    
    const success = await this.sendManualReminderToAgent(agentCode, agentName);
    
    // Send response back to dashboard
    socket.emit('manual_reminder_response', {
      success: success,
      agentCode: agentCode,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error handling manual reminder request:', error.message);
    socket.emit('manual_reminder_response', {
      success: false,
      agentCode: data.agentCode,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

    });
  }

  async handleAgentOnline(socket, data) {
  try {
    const { agentCode, agentName } = data;
    
    if (!agentCode || !agentName) {
      socket.emit('error', { message: 'Agent code and name required' });
      return;
    }

    console.log(`👤 Agent online: ${agentCode} (${agentName})`);

    // Store socket mapping
    this.connectedAgents.set(agentCode, socket.id);
    socket.agentCode = agentCode;
    socket.agentName = agentName;

    // HYBRID: Update JSON (which auto-syncs to PostgreSQL)
    const agentManager = require('./services/agentManager');
    await agentManager.upsertAgent(agentCode, agentName, 'online');
      // Update Redis
      await redis.setAgentStatus(agentCode, 'online', {
        agentName,
        socketId: socket.id
      });

      socket.emit('agent_status', { status: 'connected', agentCode });
      
      // Broadcast updated dashboard data
      await this.broadcastDashboardUpdate();

    } catch (error) {
      console.error('❌ Error handling agent online:', error.message);
      socket.emit('error', { message: 'Failed to set agent online' });
    }
  }

  async handleAgentOffline(socket, data) {
  try {
    const agentCode = data.agentCode || socket.agentCode;
    
    if (agentCode) {
      console.log(`👤 Agent offline: ${agentCode}`);

      // HYBRID: Update JSON (which auto-syncs to PostgreSQL)
      const agentManager = require('./services/agentManager');
      await agentManager.updateAgentStatus(agentCode, 'offline');
        // Update Redis
        await redis.setAgentStatus(agentCode, 'offline');

        // Remove from connected agents
        this.connectedAgents.delete(agentCode);

        // Broadcast updated dashboard data
        await this.broadcastDashboardUpdate();
      }

    } catch (error) {
      console.error('❌ Error handling agent offline:', error.message);
    }
  }

  async handleCallStarted(socket, data) {
  try {
    const { agentCode, agentName, phoneNumber, callType } = data;
    
    if (!agentCode) {
      socket.emit('error', { message: 'Agent code required' });
      return;
    }

// 🎯 ENHANCED: Record idle session with NocoDB
await this.recordIdleSessionToNocoDB(agentCode, agentName);

    // Enhanced logging for incoming vs outgoing
    if (callType === 'incoming' && phoneNumber === 'Incoming Call') {
      console.log(`📞 Incoming call answered: ${agentCode} (${agentName})`);
    } else if (callType === 'outgoing') {
      console.log(`📞 Outgoing call started: ${agentCode} -> ${phoneNumber}`);
    } else {
      console.log(`📞 Call started: ${agentCode} -> ${phoneNumber} (${callType})`);
    }

    // Update agent status to on_call
    const agentManager = require('./services/agentManager');
    await agentManager.updateAgentStatus(agentCode, 'on_call');

    // Update Redis with call data
    await redis.setCallStart(agentCode, {
      phoneNumber: phoneNumber || 'Unknown',
      callType: callType || 'unknown',
      agentName: agentName || 'Unknown',
      startTime: new Date().toISOString()
    });

    await redis.setAgentStatus(agentCode, 'on_call', {
      agentName: agentName || 'Unknown',
      currentCall: phoneNumber || 'Unknown'
    });

    // Broadcast updated dashboard data
    await this.broadcastDashboardUpdate();

  } catch (error) {
    console.error('❌ Error handling call started:', error.message);
    socket.emit('error', { message: 'Failed to record call start' });
  }
}

  async handleCallEnded(socket, data) {
  try {
    const { agentCode, callData, todayTotalTalkTime } = data;
    
    if (!agentCode || !callData) {
      socket.emit('error', { message: 'Agent code and call data required' });
      return;
    }

    console.log(`📴 Call ended: ${agentCode} -> ${callData.phoneNumber} (${callData.talkDuration}s)`);
    
    // 🎯 NEW: Update daily talk time from app data
    if (todayTotalTalkTime !== undefined) {
      await dailyTalkTimeManager.updateAgentTalkTime(
        agentCode, 
        callData.agentName, 
        todayTotalTalkTime
      );
      console.log(`📊 Updated daily talk time: ${agentCode} = ${todayTotalTalkTime}s`);
    }

    // Insert call into PostgreSQL (for historical storage)
    await database.insertCall({
      agentCode,
      phoneNumber: callData.phoneNumber,
      contactName: callData.contactName,
      callType: callData.callType,
      talkDuration: callData.talkDuration,
      totalDuration: callData.totalDuration,
      callDate: callData.callDate || new Date().toISOString().split('T')[0],
      startTime: callData.startTime,
      endTime: callData.endTime
    });

    // Update agent status back to online
    const agentManager = require('./services/agentManager');
    await agentManager.updateAgentStatus(agentCode, 'online');

    // Clear active call and set last call end time for idle tracking
    const lastCallEndTime = new Date().toISOString();
    await redis.setCallEnd(agentCode);
    await redis.setAgentStatus(agentCode, 'online', {
      agentName: socket.agentName || callData.agentName,
      lastCallEnd: lastCallEndTime,
      currentCall: null  // Clear current call info
    });
    
    console.log(`📊 Agent ${agentCode} status updated: online, lastCallEnd: ${lastCallEndTime}`);

    // 🎯 NEW: Start tracking idle time
    this.agentIdleStartTimes.set(agentCode, new Date());
    console.log(`⏰ Started idle tracking for ${agentCode} at ${new Date().toISOString()}`);

    // Broadcast updated dashboard data
    await this.broadcastDashboardUpdate();

  } catch (error) {
    console.error('❌ Error handling call ended:', error.message);
    socket.emit('error', { message: 'Failed to record call end' });
  }
}

// 🎯 DEBUG: Method to check current idle tracking status
getIdleTrackingStatus() {
  console.log('🔍 Current idle tracking status:');
  for (const [agentCode, startTime] of this.agentIdleStartTimes.entries()) {
    const now = new Date();
    const minutesIdle = Math.floor((now - startTime) / (1000 * 60));
    console.log(`   ${agentCode}: Idle for ${minutesIdle} minutes (started: ${startTime.toISOString()})`);
  }
  console.log(`   Total agents being tracked: ${this.agentIdleStartTimes.size}`);
}

  // NEW: Clean up timers on disconnect
  handleDisconnect(socket) {
    console.log(`🔌 Client disconnected: ${socket.id}`);
    
    if (socket.agentCode) {
      console.log(`👤 Agent disconnected: ${socket.agentCode}`);
      
      // Stop any active call timer for this agent
      this.stopCallTimer(socket.agentCode);
      
      // Update agent to offline
      // HYBRID: Update agent to offline (JSON + auto-sync to PostgreSQL)
const agentManager = require('./services/agentManager');
agentManager.updateAgentStatus(socket.agentCode, 'offline').catch(console.error);
      redis.setAgentStatus(socket.agentCode, 'offline').catch(console.error);
      
      // Remove from connected agents
      this.connectedAgents.delete(socket.agentCode);
      
      // Broadcast updated dashboard data
      this.broadcastDashboardUpdate().catch(console.error);
    }
  }

  async broadcastDashboardUpdate() {
    try {
      const dashboardData = await this.getDashboardData();
      this.io.emit('dashboard_update', dashboardData);
    } catch (error) {
      console.error('❌ Error broadcasting dashboard update:', error.message);
    }
  }

  async getDashboardData() {
  try {
    // 🎯 NEW: Get today's talk time from JSON storage
    const todayTalkTime = dailyTalkTimeManager.getTodayTalkTime();
    console.log(`📊 Dashboard: Talk time agents: ${todayTalkTime.length}`);
    
    // Get all agents status from Redis
    const agentsStatus = await redis.getAllAgentsStatus();
    const activeCalls = await redis.getAllActiveCalls();
    console.log(`📊 Dashboard: Active calls: ${Object.keys(activeCalls).length}`);
    console.log(`📊 Dashboard: Active calls data:`, Object.keys(activeCalls));
    console.log(`📊 Dashboard: Agent statuses:`, Object.keys(agentsStatus).map(code => 
      `${code}:${agentsStatus[code].status}${agentsStatus[code].lastCallEnd ? ':hasLastCall' : ':noLastCall'}`
    ));

    // Format agents on call (simplified, no timers)
    const agentsOnCall = Object.entries(activeCalls).map(([agentCode, callData]) => ({
      agentCode,
      agentName: callData.agentName || 'Unknown',
      phoneNumber: callData.phoneNumber,
      callStartTime: callData.startTime,
      callType: callData.callType
    }));

    // Calculate idle times for agents not on call
    const agentsIdleTime = [];
    const now = new Date();

    for (const agent of todayTalkTime) {
      // Skip if agent is currently on call
      if (activeCalls[agent.agentCode]) {
        console.log(`📊 ${agent.agentCode} is on call, skipping idle calculation`);
        continue;
      }

      const agentStatus = agentsStatus[agent.agentCode];
      if (agentStatus && agentStatus.status === 'online' && agentStatus.lastCallEnd) {
        const lastCallEnd = new Date(agentStatus.lastCallEnd);
        const minutesSinceLastCall = Math.floor((now - lastCallEnd) / (1000 * 60));
        
        console.log(`📊 ${agent.agentCode}: Last call ${minutesSinceLastCall} minutes ago`);
        
        if (minutesSinceLastCall >= 0) {
          agentsIdleTime.push({
            agentCode: agent.agentCode,
            agentName: agent.agentName,
            minutesSinceLastCall,
            lastCallEnd: agentStatus.lastCallEnd
          });
        }
      } else {
        console.log(`📊 ${agent.agentCode}: No idle data available (status: ${agentStatus?.status}, lastCallEnd: ${agentStatus?.lastCallEnd})`);
      }
    }

    console.log(`📊 Dashboard: Sending ${agentsIdleTime.length} idle agents`);

    return {
      agentsTalkTime: todayTalkTime.sort((a, b) => a.agentCode.localeCompare(b.agentCode)),
      agentsOnCall,
      agentsIdleTime: agentsIdleTime.sort((a, b) => b.minutesSinceLastCall - a.minutesSinceLastCall),
      lastUpdated: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Error getting dashboard data:', error.message);
    return {
      agentsTalkTime: [],
      agentsOnCall: [],
      agentsIdleTime: [],
      lastUpdated: new Date().toISOString(),
      error: 'Failed to load dashboard data'
    };
  }
}

// 🎯 ENHANCED: Record idle session to NocoDB when agent goes from idle to on call
async recordIdleSessionToNocoDB(agentCode, agentName) {
  try {
    const idleStartTime = this.agentIdleStartTimes.get(agentCode);
    
    if (idleStartTime) {
      const idleEndTime = new Date();
      const idleDurationSeconds = Math.floor((idleEndTime - idleStartTime) / 1000);
      
      // Only record if idle for more than 30 seconds (avoid quick call switches)
      if (idleDurationSeconds > 30) {
        const startTimeFormatted = nocodbService.formatTimeAmPm(idleStartTime);
        const endTimeFormatted = nocodbService.formatTimeAmPm(idleEndTime);
        const dateFormatted = nocodbService.formatDate(idleStartTime);
        
        console.log(`⏱️ Recording idle session: ${agentCode}, Duration: ${idleDurationSeconds}s, Date: ${dateFormatted}`);
        
        // Add to queue for processing
        await this.addIdleSessionToQueue({
          agentCode,
          agentName: agentName || 'Unknown',
          startTime: startTimeFormatted,
          endTime: endTimeFormatted,
          idleDurationSeconds,
          date: dateFormatted
        });
        
        console.log(`⏱️ Queued idle session: ${agentCode} - ${idleDurationSeconds}s`);
      }
      
      // Clear the idle start time
      this.agentIdleStartTimes.delete(agentCode);
    }
  } catch (error) {
    console.error('❌ Error recording idle session to NocoDB:', error.message);
  }
}



// 🎯 NEW: Queue system for idle sessions
async addIdleSessionToQueue(sessionData) {
  this.idleSessionQueue.push(sessionData);
  console.log(`📝 Added to idle queue: ${sessionData.agentCode}, Queue size: ${this.idleSessionQueue.length}`);
  
  if (!this.processingQueue) {
    await this.processIdleSessionQueue();
  }
}

async processIdleSessionQueue() {
  if (this.processingQueue || this.idleSessionQueue.length === 0) {
    return;
  }
  
  this.processingQueue = true;
  
  while (this.idleSessionQueue.length > 0) {
    const sessionData = this.idleSessionQueue.shift();
    
    try {
      await nocodbService.addIdleSession(
        sessionData.agentCode,
        sessionData.agentName,
        sessionData.startTime,
        sessionData.endTime,
        sessionData.idleDurationSeconds,
        sessionData.date
      );
      
      console.log(`✅ Idle session saved to NocoDB: ${sessionData.agentCode} - ${sessionData.idleDurationSeconds}s`);
      
      // Small delay to prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`❌ Failed to save idle session for ${sessionData.agentCode}:`, error.message);
      
      // Re-queue failed item (try again later)
      this.idleSessionQueue.push(sessionData);
      break; // Stop processing to prevent infinite loop
    }
  }
  
  this.processingQueue = false;
  
  // If queue still has items, try again in 5 seconds
  if (this.idleSessionQueue.length > 0) {
    setTimeout(() => {
      this.processIdleSessionQueue();
    }, 5000);
  }
}

  // Reminder system methods
async checkAndSendReminders() {
  try {
    // Get all enabled agent reminder settings from JSON
    const enabledReminders = require('./services/agentManager').getEnabledReminderAgents();
    
    if (enabledReminders.length === 0) {
      return; // No agents have reminders enabled
    }

    // Get current idle agents from Redis
    const agentsStatus = await redis.getAllAgentsStatus();
    const activeCalls = await redis.getAllActiveCalls();
    
    const now = new Date();

    for (const reminder of enabledReminders) {
      const { agentCode, agentName, reminderSettings } = reminder;
      const reminderIntervalMinutes = reminderSettings.intervalMinutes;
      
      // Skip if agent is currently on call
      if (activeCalls[agentCode]) {
        continue;
      }

      // Skip if agent is not online
      const agentStatus = agentsStatus[agentCode];
      if (!agentStatus || agentStatus.status !== 'online') {
        continue;
      }

      // Check if agent has been idle long enough
      if (agentStatus.lastCallEnd) {
        const lastCallEnd = new Date(agentStatus.lastCallEnd);
        const minutesIdle = Math.floor((now - lastCallEnd) / (1000 * 60));
        
        // Check if we should send a reminder (at multiples of interval)
        if (this.shouldSendReminder(agentCode, minutesIdle, reminderIntervalMinutes)) {
          await this.sendReminderToAgent(agentCode, agentName, minutesIdle, reminderIntervalMinutes);
        }
      }
    }

  } catch (error) {
    console.error('❌ Error checking reminders:', error.message);
  }
}

shouldSendReminder(agentCode, minutesIdle, intervalMinutes) {
  // Only send reminder at exact multiples of the interval
  if (minutesIdle < intervalMinutes || minutesIdle % intervalMinutes !== 0) {
    return false;
  }

  // Check if we already sent a reminder for this exact minute
  const lastReminderKey = `${agentCode}-${minutesIdle}`;
  if (this.recentReminders && this.recentReminders.has(lastReminderKey)) {
    return false;
  }

  // Mark this reminder as sent (prevent duplicates)
  if (!this.recentReminders) {
    this.recentReminders = new Set();
  }
  this.recentReminders.add(lastReminderKey);

  // Clean up old entries (keep only last 100)
  if (this.recentReminders.size > 100) {
    const oldestEntries = Array.from(this.recentReminders).slice(0, 20);
    oldestEntries.forEach(entry => this.recentReminders.delete(entry));
  }

  return true;
}

async sendReminderToAgent(agentCode, agentName, minutesIdle, intervalMinutes) {
  try {
    const socketId = this.connectedAgents.get(agentCode);
    
    if (socketId) {
      // Send to connected agent via WebSocket
      const reminderData = {
        action: 'show_reminder',
        message: `It's been ${minutesIdle} minutes since your last call. Time to make another call!`,
        idleTime: `${minutesIdle} minutes`,
        intervalMinutes: intervalMinutes,
        agentCode: agentCode,
        agentName: agentName,
        timestamp: new Date().toISOString()
      };

      this.io.to(socketId).emit('reminder_trigger', reminderData);
      
      console.log(`📱 Reminder sent to ${agentCode} (${agentName}) - ${minutesIdle} minutes idle`);
      
      // Store reminder in Redis for tracking
      await redis.setLastReminderSent(agentCode, new Date().toISOString());
      
      return true;
    } else {
      console.log(`⚠️ Agent ${agentCode} not connected, reminder not sent`);
      return false;
    }

  } catch (error) {
    console.error(`❌ Error sending reminder to ${agentCode}:`, error.message);
    return false;
  }
}

// Removed from here

// Removed from here

// ADD this entire method after the existing sendReminderToAgent method
async sendManualReminderToAgent(agentCode, agentName) {
  try {
    const socketId = this.connectedAgents.get(agentCode);
    
    if (socketId) {
      // Send manual reminder to connected agent via WebSocket
      const reminderData = {
        action: 'show_reminder',
        message: `Manual reminder: Time to make another call!`,
        idleTime: 'Manual trigger',
        intervalMinutes: 0, // 0 indicates manual trigger
        agentCode: agentCode,
        agentName: agentName,
        timestamp: new Date().toISOString(),
        isManual: true // NEW: Flag to distinguish manual vs automatic
      };

      this.io.to(socketId).emit('reminder_trigger', reminderData);
      
      console.log(`📱 Manual reminder sent to ${agentCode} (${agentName})`);
      
      // Don't store in Redis for manual reminders (they don't affect automatic timers)
      
      return true;
    } else {
      console.log(`⚠️ Agent ${agentCode} not connected, manual reminder not sent`);
      return false;
    }

  } catch (error) {
    console.error(`❌ Error sending manual reminder to ${agentCode}:`, error.message);
    return false;
  }
}

// Handle reminder acknowledgments from Android app
async handleReminderAcknowledgment(socket, data) {
  try {
    const { agentCode, timestamp, action } = data;
    
    console.log(`✅ Reminder acknowledged by ${agentCode} at ${timestamp}`);
    
    // Log acknowledgment (could store in database for analytics later)
    // For now, just log it
    
    // Optional: Send confirmation back to app
    socket.emit('reminder_ack_received', {
      status: 'acknowledged',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error handling reminder acknowledgment:', error.message);
  }
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

  startReminderSystem() {
  // Check for reminders every minute
  this.reminderInterval = setInterval(async () => {
    await this.checkAndSendReminders();
  }, 60000); // 60 seconds

  console.log('✅ Reminder system started - checking every minute');
}

//new method added Step 6
// ADD this method to the existing WebSocketManager class

handleCallUpdate(socket, data) {
  try {
    const { 
      agentCode, 
      agentName, 
      phoneNumber, 
      contactName, 
      callType, 
      talkDuration, 
      totalDuration, 
      callDate, 
      timestamp, 
      dataSource 
    } = data;

    console.log(`📞 Call update received from ${agentCode} (${dataSource}): ${callType} call`);

    // Update agent's last activity
    this.updateAgentActivity(agentCode, agentName);

    // Broadcast call update to dashboard
    this.io.emit('call_update', {
      agentCode,
      agentName,
      phoneNumber,
      contactName,
      callType,
      talkDuration,
      totalDuration,
      callDate,
      timestamp,
      dataSource,
      receivedAt: new Date().toISOString()
    });

    // Send acknowledgment back to app
    socket.emit('call_update_ack', {
      status: 'received',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error handling call update:', error.message);
  }
}

handleTalkTimeUpdate(socket, data) {
  try {
    const { agentCode, agentName, talkTime, timestamp } = data;

    console.log(`📊 Talk time update for ${agentCode}: ${talkTime}s`);

    // Broadcast updated talk time to dashboard
    this.io.emit('talktime_update', {
      agentCode,
      agentName,
      talkTime,
      timestamp,
      receivedAt: new Date().toISOString()
    });

    // Send acknowledgment
    socket.emit('talktime_update_ack', {
      status: 'received',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error handling talk time update:', error.message);
  }
}

// Enhanced cleanup method
  // Enhanced cleanup method
cleanup() {
  // Clear idle tracking
  this.agentIdleStartTimes.clear();

  if (this.reminderInterval) {
    clearInterval(this.reminderInterval);
    console.log('✅ Reminder system stopped');
  }
  
  console.log('✅ WebSocket cleanup completed');
}

  // Method to get connected agents count
  getConnectedAgentsCount() {
    return this.connectedAgents.size;
  }

  // Method to send message to specific agent
  sendToAgent(agentCode, event, data) {
    const socketId = this.connectedAgents.get(agentCode);
    if (socketId) {
      this.io.to(socketId).emit(event, data);
      return true;
    }
    return false;
  }
}

module.exports = WebSocketManager;