const database = require('./database');
const redis = require('./redis');

class WebSocketManager {
  constructor(io) {
    this.io = io;
    this.connectedAgents = new Map(); // agentCode -> socketId
    this.init();
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

      // Update database
      await database.upsertAgent(agentCode, agentName, 'online');

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

        // Update database
        await database.updateAgentStatus(agentCode, 'offline');

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

      console.log(`📞 Call started: ${agentCode} -> ${phoneNumber} (${callType})`);

      // Update database agent status
      await database.updateAgentStatus(agentCode, 'on_call');

      // Update Redis with call data
      await redis.setCallStart(agentCode, {
        phoneNumber,
        callType,
        agentName
      });

      await redis.setAgentStatus(agentCode, 'on_call', {
        agentName,
        currentCall: phoneNumber
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
      const { agentCode, callData } = data;
      
      if (!agentCode || !callData) {
        socket.emit('error', { message: 'Agent code and call data required' });
        return;
      }

      console.log(`📴 Call ended: ${agentCode} -> ${callData.phoneNumber} (${callData.talkDuration}s)`);

      // Insert call into database
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

      // Update today's talk time in Redis
      await redis.updateTodayTalkTime(agentCode, callData.talkDuration);

      // Update agent status back to online
      await database.updateAgentStatus(agentCode, 'online');

      // Clear active call and set last call end time
      await redis.setCallEnd(agentCode);
      await redis.setAgentStatus(agentCode, 'online', {
        agentName: socket.agentName || callData.agentName
      });

      // Broadcast updated dashboard data
      await this.broadcastDashboardUpdate();

    } catch (error) {
      console.error('❌ Error handling call ended:', error.message);
      socket.emit('error', { message: 'Failed to record call end' });
    }
  }

  handleDisconnect(socket) {
    console.log(`🔌 Client disconnected: ${socket.id}`);
    
    if (socket.agentCode) {
      console.log(`👤 Agent disconnected: ${socket.agentCode}`);
      
      // Update agent to offline (don't await to prevent blocking)
      database.updateAgentStatus(socket.agentCode, 'offline').catch(console.error);
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
      // Get today's talk time from database (more accurate)
      const todayTalkTime = await database.getTodayTalkTime();
      
      // Get active calls from Redis
      const activeCalls = await redis.getAllActiveCalls();
      
      // Get all agents status from Redis
      const agentsStatus = await redis.getAllAgentsStatus();

      // Format agents on call
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
        if (activeCalls[agent.agent_code]) continue;

        const agentStatus = agentsStatus[agent.agent_code];
        if (agentStatus && agentStatus.status === 'online' && agentStatus.lastCallEnd) {
          const lastCallEnd = new Date(agentStatus.lastCallEnd);
          const minutesSinceLastCall = Math.floor((now - lastCallEnd) / (1000 * 60));
          
          if (minutesSinceLastCall >= 0) {
            agentsIdleTime.push({
              agentCode: agent.agent_code,
              agentName: agent.agent_name,
              minutesSinceLastCall,
              lastCallEnd: agentStatus.lastCallEnd
            });
          }
        }
      }

      return {
        agentsTalkTime: todayTalkTime.map(agent => ({
          agentCode: agent.agent_code,
          agentName: agent.agent_name,
          todayTalkTime: parseInt(agent.today_talk_time) || 0,
          formattedTalkTime: this.formatDuration(parseInt(agent.today_talk_time) || 0)
        })),
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