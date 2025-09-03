const dailyTalkTimeManager = require('./services/dailyTalkTimeManager');
const nocodbService = require('./services/nocodbService');

class WebSocketManager {
  constructor(io) {
    this.io = io;
    this.recentReminders = new Set();
    this.connectedAgents = new Map();
    this.agentIdleStartTimes = new Map(); // Track when agents went idle
    
    // In-memory state management (replacing Redis)
    this.agentStatuses = new Map(); // agent status and metadata
    this.activeCalls = new Map(); // active call information
    this.lastReminders = new Map(); // last reminder timestamps
    
    this.init();
    this.startReminderSystem();
    this.startAgentStatusPingSystem();
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

      // Handle agent status response from ping
      socket.on('agent_status_response', async (data) => {
        await this.handleAgentStatusResponse(socket, data);
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

    // Update in-memory status
    this.agentStatuses.set(agentCode, {
      status: 'online',
      agentName,
      socketId: socket.id,
      lastUpdate: new Date().toISOString()
    });
    
    // Update agent in JSON storage
    const agentManager = require('./services/agentManager');
    await agentManager.upsertAgent(agentCode, agentName);

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

      // Update in-memory status
      this.agentStatuses.set(agentCode, {
        status: 'offline',
        lastUpdate: new Date().toISOString()
      });

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

    // 🎯 NEW: Record idle session if agent was idle
    await this.recordIdleSession(agentCode, agentName);

    // Enhanced logging for incoming vs outgoing
    if (callType === 'incoming' && phoneNumber === 'Incoming Call') {
      console.log(`📞 Incoming call answered: ${agentCode} (${agentName})`);
    } else if (callType === 'outgoing') {
      console.log(`📞 Outgoing call started: ${agentCode} -> ${phoneNumber}`);
    } else {
      console.log(`📞 Call started: ${agentCode} -> ${phoneNumber} (${callType})`);
    }

    // Update in-memory status
    const startTime = new Date().toISOString();
    
    this.agentStatuses.set(agentCode, {
      status: 'on_call',
      agentName: agentName || 'Unknown',
      currentCall: phoneNumber || 'Unknown',
      lastUpdate: startTime
    });
    
    this.activeCalls.set(agentCode, {
      phoneNumber: phoneNumber || 'Unknown',
      callType: callType || 'unknown',
      agentName: agentName || 'Unknown',
      startTime: startTime
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

    // Note: Call records are now handled by n8n webhooks, not stored locally
    
    // Update in-memory status back to online
    const endTime = new Date().toISOString();
    
    this.agentStatuses.set(agentCode, {
      status: 'online',
      agentName: socket.agentName || callData.agentName,
      lastCallEnd: endTime,
      lastUpdate: endTime
    });
    
    // Clear active call
    this.activeCalls.delete(agentCode);

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
      
      // Update in-memory status to offline
      this.agentStatuses.set(socket.agentCode, {
        status: 'offline',
        lastUpdate: new Date().toISOString()
      });
      
      // Clear any active call
      this.activeCalls.delete(socket.agentCode);
      
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
    // 🎯 NEW: Get ALL agents from JSON storage, then merge with today's talk time
    const agentManager = require('./services/agentManager');
    const allAgents = agentManager.getAllAgents();
    const todayTalkTime = dailyTalkTimeManager.getTodayTalkTime();
    
    // Create a map of today's talk time data for quick lookup
    const todayTalkTimeMap = {};
    todayTalkTime.forEach(agent => {
      todayTalkTimeMap[agent.agentCode] = agent;
    });
    
    // Create comprehensive agent list showing ALL agents in JSON
    const agentsTalkTime = allAgents.map(agent => ({
      agentCode: agent.agentCode,
      agentName: agent.agentName,
      totalTalkTime: todayTalkTimeMap[agent.agentCode]?.totalTalkTime || 0,
      formattedTalkTime: todayTalkTimeMap[agent.agentCode]?.formattedTalkTime || '0s',
      callCount: todayTalkTimeMap[agent.agentCode]?.callCount || 0,
      lastUpdated: todayTalkTimeMap[agent.agentCode]?.lastUpdated || null
    }));
    
    console.log(`📊 Dashboard: Showing ${allAgents.length} total agents (${todayTalkTime.length} have talk time today)`);
    
    // Get all agents status from in-memory storage
    const agentsStatus = Object.fromEntries(this.agentStatuses);
    const activeCalls = Object.fromEntries(this.activeCalls);
    console.log(`📊 Dashboard: Active calls: ${Object.keys(activeCalls).length}`);

    // Format agents on call (simplified, no timers)
    const agentsOnCall = Object.entries(activeCalls).map(([agentCode, callData]) => ({
      agentCode,
      agentName: callData.agentName || 'Unknown',
      phoneNumber: callData.phoneNumber,
      callStartTime: callData.startTime,
      callType: callData.callType
    }));

    // Calculate idle times for ALL agents (not just those with talk time today)
    const agentsIdleTime = [];
    const now = new Date();

    for (const agent of allAgents) {
      // Skip if agent is currently on call
      if (activeCalls[agent.agentCode]) {
        console.log(`📊 ${agent.agentCode} is on call, skipping idle calculation`);
        continue;
      }

      const agentStatus = agentsStatus[agent.agentCode];
      
      if (agentStatus && agentStatus.lastCallEnd) {
        // Agent has made calls before - show actual idle time
        const lastCallEnd = new Date(agentStatus.lastCallEnd);
        const minutesSinceLastCall = Math.floor((now - lastCallEnd) / (1000 * 60));
        
        console.log(`📊 ${agent.agentCode}: Last call ${minutesSinceLastCall} minutes ago (status: ${agentStatus.status})`);
        
        if (minutesSinceLastCall >= 0) {
          agentsIdleTime.push({
            agentCode: agent.agentCode,
            agentName: agent.agentName,
            minutesSinceLastCall,
            lastCallEnd: agentStatus.lastCallEnd,
            isOnline: agentStatus ? agentStatus.status === 'online' : false
          });
        }
      } else {
        // Agent has no call history - calculate idle time from when they first went online
        let minutesSinceLastCall = 0;
        
        if (agentStatus && agentStatus.lastUpdate) {
          const lastUpdate = new Date(agentStatus.lastUpdate);
          minutesSinceLastCall = Math.floor((now - lastUpdate) / (1000 * 60));
        }
        
        console.log(`📊 ${agent.agentCode}: No call history - idle for ${minutesSinceLastCall} minutes since going online`);
        agentsIdleTime.push({
          agentCode: agent.agentCode,
          agentName: agent.agentName,
          minutesSinceLastCall,
          lastCallEnd: null,
          isOnline: agentStatus ? agentStatus.status === 'online' : false
        });
      }
    }

    console.log(`📊 Dashboard: Sending ${agentsIdleTime.length} idle agents`);

    return {
      agentsTalkTime: agentsTalkTime.sort((a, b) => (b.totalTalkTime || 0) - (a.totalTalkTime || 0)),
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

// 🎯 NEW: Record idle session when agent goes from idle to on call
async recordIdleSession(agentCode, agentName) {
  try {
    const idleStartTime = this.agentIdleStartTimes.get(agentCode);
    
    if (idleStartTime) {
      const idleEndTime = new Date();
      const idleDurationSeconds = Math.floor((idleEndTime - idleStartTime) / 1000);
      
      // Only record if idle for more than 30 seconds (avoid quick call switches)
      if (idleDurationSeconds > 30) {
        const sessionDate = idleStartTime.toISOString().split('T')[0];
        const startTimeFormatted = nocodbService.formatTimeForIdleSessions(idleStartTime);
        
        // Queue idle session for NocoDB (prevents data loss during high-frequency updates)
        nocodbService.queueIdleSession(
          agentCode,
          agentName || 'Unknown',
          sessionDate,
          startTimeFormatted,
          idleDurationSeconds
        );
        
        console.log(`⏱️ Queued idle session: ${agentCode} - ${idleDurationSeconds}s`);
      }
      
      // Clear the idle start time
      this.agentIdleStartTimes.delete(agentCode);
    }
  } catch (error) {
    console.error('❌ Error recording idle session:', error.message);
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

    // Get current idle agents from in-memory storage
    const agentsStatus = Object.fromEntries(this.agentStatuses);
    const activeCalls = Object.fromEntries(this.activeCalls);
    
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
      let minutesIdle = 0;
      
      if (agentStatus.lastCallEnd) {
        // Agent has call history - calculate from last call end
        const lastCallEnd = new Date(agentStatus.lastCallEnd);
        minutesIdle = Math.floor((now - lastCallEnd) / (1000 * 60));
      } else if (agentStatus.lastUpdate) {
        // Agent has no call history - calculate from when they went online
        const lastUpdate = new Date(agentStatus.lastUpdate);
        minutesIdle = Math.floor((now - lastUpdate) / (1000 * 60));
      }
      
      // Check if we should send a reminder (at multiples of interval)
      if (minutesIdle > 0 && this.shouldSendReminder(agentCode, minutesIdle, reminderIntervalMinutes)) {
        await this.sendReminderToAgent(agentCode, agentName, minutesIdle, reminderIntervalMinutes);
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
      
      // Store reminder timestamp in memory
      this.lastReminders.set(agentCode, new Date().toISOString());
      
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
      
      // Store reminder timestamp in memory
      this.lastReminders.set(agentCode, new Date().toISOString());
      
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

  // Start agent status ping system
  startAgentStatusPingSystem() {
    // Ping agents on call every minute to verify their status
    this.statusPingInterval = setInterval(async () => {
      await this.pingAgentsOnCall();
    }, 60000); // 60 seconds

    console.log('✅ Agent status ping system started - pinging every minute');
  }

  // Ping all agents currently on call to verify their status
  async pingAgentsOnCall() {
    try {
      const activeCalls = Object.fromEntries(this.activeCalls);
      
      if (Object.keys(activeCalls).length === 0) {
        return; // No agents on call
      }

      console.log(`🔍 Pinging ${Object.keys(activeCalls).length} agents on call for status verification`);

      for (const [agentCode, callData] of Object.entries(activeCalls)) {
        const socketId = this.connectedAgents.get(agentCode);
        
        if (socketId) {
          const requestId = `status_${Date.now()}_${agentCode}`;
          const pingData = {
            agentCode: agentCode,
            requestId: requestId,
            timestamp: new Date().toISOString()
          };

          // Send status request to agent
          this.io.to(socketId).emit('agent_status_request', pingData);
          
          console.log(`📍 Status ping sent to ${agentCode} (request: ${requestId})`);

          // Set timeout to handle non-responsive agents (10 seconds)
          setTimeout(() => {
            this.handleStatusPingTimeout(agentCode, requestId);
          }, 10000);
        } else {
          // Agent not connected but still in active calls - move them to idle
          console.log(`⚠️ Agent ${agentCode} in active calls but not connected - moving to idle`);
          await this.moveAgentToIdleStatus(agentCode, callData.agentName);
        }
      }
    } catch (error) {
      console.error('❌ Error pinging agents on call:', error.message);
    }
  }

  // Handle agent status response from ping
  async handleAgentStatusResponse(socket, data) {
    try {
      const { agentCode, requestId, status, timestamp, lastCallTime } = data;
      
      console.log(`📍 Status response from ${agentCode}: ${status} (request: ${requestId})`);

      if (status === 'free') {
        // Agent is no longer on call - move to idle
        await this.moveAgentToIdleStatus(agentCode, socket.agentName, lastCallTime);
      } else if (status === 'on_call') {
        // Agent confirmed still on call - update timestamp
        const agentStatus = this.agentStatuses.get(agentCode);
        if (agentStatus) {
          agentStatus.lastUpdate = timestamp;
          this.agentStatuses.set(agentCode, agentStatus);
        }
        console.log(`✅ ${agentCode} confirmed still on call`);
      }
    } catch (error) {
      console.error('❌ Error handling agent status response:', error.message);
    }
  }

  // Handle timeout when agent doesn't respond to status ping
  async handleStatusPingTimeout(agentCode, requestId) {
    try {
      // Check if agent is still in active calls (response might have been received)
      if (this.activeCalls.has(agentCode)) {
        console.log(`⏰ Agent ${agentCode} didn't respond to status ping ${requestId} - assuming offline/disconnected`);
        
        // Get agent info before removing
        const callData = this.activeCalls.get(agentCode);
        
        // Move agent to offline status
        this.agentStatuses.set(agentCode, {
          status: 'offline',
          lastUpdate: new Date().toISOString()
        });
        
        // Clear active call
        this.activeCalls.delete(agentCode);
        
        // Remove from connected agents
        this.connectedAgents.delete(agentCode);
        
        console.log(`📴 ${agentCode} moved to offline due to no response`);
        
        // Broadcast updated dashboard data
        await this.broadcastDashboardUpdate();
      }
    } catch (error) {
      console.error('❌ Error handling status ping timeout:', error.message);
    }
  }

  // Move agent from active call to idle status
  async moveAgentToIdleStatus(agentCode, agentName, lastCallTime) {
    try {
      const endTime = lastCallTime || new Date().toISOString();
      
      // Update agent status to online
      this.agentStatuses.set(agentCode, {
        status: 'online',
        agentName: agentName || 'Unknown',
        lastCallEnd: endTime,
        lastUpdate: endTime
      });
      
      // Clear active call
      this.activeCalls.delete(agentCode);

      // Start tracking idle time
      this.agentIdleStartTimes.set(agentCode, new Date(endTime));
      
      console.log(`🔄 ${agentCode} moved from active call to idle status`);
      
      // Broadcast updated dashboard data
      await this.broadcastDashboardUpdate();
    } catch (error) {
      console.error('❌ Error moving agent to idle status:', error.message);
    }
  }

// 🎯 REMOVED: Call timers are no longer needed in the dashboard
// Real-time updates are handled by WebSocket events only



// Enhanced cleanup method
  // Enhanced cleanup method
cleanup() {
  // Clear idle tracking
  this.agentIdleStartTimes.clear();

  if (this.reminderInterval) {
    clearInterval(this.reminderInterval);
    console.log('✅ Reminder system stopped');
  }
  
  if (this.statusPingInterval) {
    clearInterval(this.statusPingInterval);
    console.log('✅ Agent status ping system stopped');
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