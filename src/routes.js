const express = require('express');
const agentManager = require('./services/agentManager');
const dailyTalkTimeManager = require('./services/dailyTalkTimeManager');
const nocodbService = require('./services/nocodbService');
const router = express.Router();


// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    // Test NocoDB service health
    const queueStatus = nocodbService.getQueueStatus();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      storage: 'NocoDB (cloud)',
      queueStatus: {
        idleSessionsQueue: queueStatus.queueSize,
        processing: queueStatus.isProcessing
      },
      services: {
        scheduler: 'running',
        agentManager: 'running',
        dailyTalkTime: 'running'
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get live dashboard data (New: JSON-based talk time)
router.get('/dashboard/live', async (req, res) => {
  try {
    // 🎯 NEW: Get today's talk time directly from JSON storage
    const agentsTalkTime = dailyTalkTimeManager.getTodayTalkTime();
    console.log(`📊 Dashboard: Found ${agentsTalkTime.length} agents with talk time data`);
    
    // Get active calls and agent status from WebSocket manager's in-memory storage
    const webSocketManager = req.webSocketManager;
    const activeCalls = webSocketManager ? Object.fromEntries(webSocketManager.activeCalls) : {};
    const agentsStatus = webSocketManager ? Object.fromEntries(webSocketManager.agentStatuses) : {};

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

    for (const agent of agentsTalkTime) {
      // Skip if agent is currently on call
      if (activeCalls[agent.agentCode]) continue;

      const agentStatus = agentsStatus[agent.agentCode];
      if (agentStatus && agentStatus.status === 'online' && agentStatus.lastCallEnd) {
        const lastCallEnd = new Date(agentStatus.lastCallEnd);
        const minutesSinceLastCall = Math.floor((now - lastCallEnd) / (1000 * 60));
        
        if (minutesSinceLastCall >= 0) {
          agentsIdleTime.push({
            agentCode: agent.agentCode,
            agentName: agent.agentName,
            minutesSinceLastCall,
            lastCallEnd: agentStatus.lastCallEnd
          });
        }
      }
    }

    res.json({
      success: true,
      data: {
        agentsTalkTime: agentsTalkTime.sort((a, b) => a.agentCode.localeCompare(b.agentCode)),
        agentsOnCall,
        agentsIdleTime: agentsIdleTime.sort((a, b) => b.minutesSinceLastCall - a.minutesSinceLastCall),
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error getting live dashboard data:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get agent history (Now from JSON storage)
router.get('/agent/:agentCode/history', async (req, res) => {
  try {
    const { agentCode } = req.params;
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        error: 'start_date and end_date are required'
      });
    }

    // 🎯 NEW: Get history from JSON storage instead of PostgreSQL
    const history = dailyTalkTimeManager.getAgentHistory(agentCode, start_date, end_date);

    res.json({
      success: true,
      data: {
        agentCode,
        startDate: start_date,
        endDate: end_date,
        history: history
      }
    });

  } catch (error) {
    console.error('❌ Error getting agent history:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all agents list
router.get('/agents', async (req, res) => {
  try {
    const agentManager = require('./services/agentManager');
    const agents = agentManager.getAllAgents();
    
    // Format agents data to match expected structure
    const formattedAgents = agents.map(agent => ({
      agent_code: agent.agentCode,
      agent_name: agent.agentName,
      status: 'unknown', // Status is now managed in real-time via WebSocket
      last_seen: null // Not tracked in local storage
    }));
    
    res.json({
      success: true,
      data: formattedAgents
    });

  } catch (error) {
    console.error('❌ Error getting agents list:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 🎯 Phone number search using NocoDB
router.get('/search/phone/:phoneNumber', async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const { limit = 50 } = req.query;

    if (!phoneNumber || phoneNumber.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Phone number must be at least 3 digits'
      });
    }

    console.log(`🔍 Searching calls for phone number: ${phoneNumber}`);
    const result = await nocodbService.searchByPhoneNumber(phoneNumber, parseInt(limit));

    res.json({
      success: true,
      data: {
        phoneNumber,
        totalResults: result.list.length,
        calls: result.list.map(call => ({
          id: call.Id,
          agentCode: call["Agent Code"],
          agentName: call["Agent Name"] || 'Unknown',
          phoneNumber: call.Mobile,
          contactName: call["Contact Name"],
          callType: call["Call Type"],
          talkDuration: parseInt(call["Talk Duration"]) || 0,
          formattedTalkDuration: formatDuration(parseInt(call["Talk Duration"]) || 0),
          totalDuration: parseInt(call["Total Duration"]) || 0,
          callDate: call.Date,
          startTime: call["Start Time"],
          endTime: call["End Time"],
          timestamp: call.Timestamp
        }))
      }
    });

    console.log(`✅ Phone search completed: ${result.list.length} results for ${phoneNumber}`);

  } catch (error) {
    console.error('❌ Error searching calls by phone number:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 🎯 Idle sessions analytics using NocoDB
router.get('/idle-sessions', async (req, res) => {
  try {
    console.log('🔍 Getting idle sessions from NocoDB with params:', req.query);
    const result = await nocodbService.getIdleSessionsForAnalytics(req.query);

    if (result.success) {
      console.log(`✅ Idle sessions retrieved: ${result.data.idleSessions.length} records`);
    } else {
      console.log('⚠️ Failed to get idle sessions from NocoDB');
    }

    res.json(result);

  } catch (error) {
    console.error('❌ Error getting idle sessions:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get idle sessions'
    });
  }
});

// 🎯 Agent performance dashboard - get agent stats for date range
router.get('/agent-performance/:agentCode', async (req, res) => {
  try {
    const { agentCode } = req.params;
    const { start_date, end_date, date } = req.query;

    console.log(`🔍 Getting performance data for agent: ${agentCode}`);

    if (date) {
      // Single date query
      const result = await nocodbService.getAgentDailyStats(agentCode, date);
      const statsArray = result ? [result] : [];
      
      res.json({
        success: true,
        data: {
          agentCode,
          dateRange: date,
          dailyStats: statsArray.map(stat => ({
            date: stat.Date,
            agentName: stat["Agent Name"],
            talktime: parseInt(stat.Talktime) || 0,
            talktimeFormatted: nocodbService.formatDuration((parseInt(stat.Talktime) || 0) * 60), // Convert minutes to seconds for formatting
            totalCalls: parseInt(stat["Total Calls"]) || 0
          })),
          totalRecords: statsArray.length
        }
      });

    } else if (start_date && end_date) {
      // Date range query
      const statsArray = await nocodbService.getAgentStatsDateRange(agentCode, start_date, end_date);
      
      res.json({
        success: true,
        data: {
          agentCode,
          dateRange: `${start_date} to ${end_date}`,
          dailyStats: statsArray.map(stat => ({
            date: stat.Date,
            agentName: stat["Agent Name"],
            talktime: parseInt(stat.Talktime) || 0,
            talktimeFormatted: nocodbService.formatDuration((parseInt(stat.Talktime) || 0) * 60),
            totalCalls: parseInt(stat["Total Calls"]) || 0
          })),
          totalRecords: statsArray.length
        }
      });

    } else {
      // No date specified - return error
      return res.status(400).json({
        success: false,
        error: 'Please specify either date or date range (start_date and end_date)'
      });
    }

    console.log(`✅ Agent performance data retrieved for ${agentCode}`);

  } catch (error) {
    console.error('❌ Error getting agent performance:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get agent performance data'
    });
  }
});

// 🎯 Simplified Agent Management API
router.get('/agents', async (req, res) => {
  try {
    const agents = agentManager.getAllAgents();
    
    res.json({
      success: true,
      data: agents.map(agent => ({
        agentCode: agent.agentCode,
        agentName: agent.agentName,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt
      }))
    });
  } catch (error) {
    console.error('❌ Error getting agents:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/agents', async (req, res) => {
  try {
    const { agentCode, agentName } = req.body;
    
    if (!agentCode || !agentName) {
      return res.status(400).json({
        success: false,
        error: 'Agent code and name are required'
      });
    }
    
    if (agentManager.agentExists(agentCode)) {
      return res.status(409).json({
        success: false,
        error: `Agent with code ${agentCode} already exists`
      });
    }
    
    const newAgent = await agentManager.upsertAgent(agentCode, agentName);
    
    res.status(201).json({
      success: true,
      data: {
        agentCode: newAgent.agentCode,
        agentName: newAgent.agentName,
        createdAt: newAgent.createdAt
      },
      message: `Agent ${agentCode} created successfully`
    });
    
  } catch (error) {
    console.error('❌ Error creating agent:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.put('/agents/:agentCode', async (req, res) => {
  try {
    const { agentCode } = req.params;
    const { agentName } = req.body;
    
    if (!agentName) {
      return res.status(400).json({
        success: false,
        error: 'Agent name is required'
      });
    }
    
    if (!agentManager.agentExists(agentCode)) {
      return res.status(404).json({
        success: false,
        error: `Agent ${agentCode} not found`
      });
    }
    
    const updatedAgent = await agentManager.updateAgentName(agentCode, agentName);
    
    res.json({
      success: true,
      data: {
        agentCode: updatedAgent.agentCode,
        agentName: updatedAgent.agentName,
        updatedAt: updatedAgent.updatedAt
      },
      message: `Agent ${agentCode} updated successfully`
    });
    
  } catch (error) {
    console.error('❌ Error updating agent:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.delete('/agents/:agentCode', async (req, res) => {
  try {
    const { agentCode } = req.params;
    
    if (!agentManager.agentExists(agentCode)) {
      return res.status(404).json({
        success: false,
        error: `Agent ${agentCode} not found`
      });
    }
    
    const success = await agentManager.removeAgent(agentCode);
    
    if (success) {
      res.json({
        success: true,
        message: `Agent ${agentCode} deleted successfully`
      });
    } else {
      throw new Error('Failed to delete agent');
    }
    
  } catch (error) {
    console.error('❌ Error deleting agent:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Utility function
function formatDuration(seconds) {
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

// Agent reminder settings routes
router.get('/reminder-settings', async (req, res) => {
  try {
    const allAgents = agentManager.getAllAgents();
    const settings = allAgents.map(agent => {
      const reminderSettings = agent.reminderSettings || { intervalMinutes: 5, enabled: true };
      
      return {
        agent_code: agent.agentCode,
        agent_name: agent.agentName,
        reminder_interval_minutes: reminderSettings.intervalMinutes,
        reminders_enabled: reminderSettings.enabled,
        agent_status: agent.status || 'offline'
      };
    });
    
    console.log(`📊 JSON: Loaded ${settings.length} agent reminder settings`);
    console.log(`📊 Settings details:`, settings.map(s => `${s.agent_code}:${s.reminder_interval_minutes}min`).join(', '));
    
    res.json({
      success: true,
      data: settings
    });

  } catch (error) {
    console.error('❌ Error getting reminder settings:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/reminder-settings/:agentCode', async (req, res) => {
  try {
    const { agentCode } = req.params;
    const agent = agentManager.getAgent(agentCode);
    
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found'
      });
    }

    const settings = {
      agent_code: agent.agentCode,
      agent_name: agent.agentName,
      reminder_interval_minutes: agent.reminderSettings?.intervalMinutes || 5,
      reminders_enabled: agent.reminderSettings?.enabled !== false,
      agent_status: agent.status || 'offline'
    };

    res.json({
      success: true,
      data: settings
    });

  } catch (error) {
    console.error('❌ Error getting agent reminder settings:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/reminder-settings/:agentCode', async (req, res) => {
  try {
    const { agentCode } = req.params;
    const { reminder_interval_minutes, reminders_enabled } = req.body;

    // Validation
    if (!reminder_interval_minutes || reminder_interval_minutes < 1 || reminder_interval_minutes > 60) {
      return res.status(400).json({
        success: false,
        error: 'Invalid reminder interval. Must be between 1-60 minutes.'
      });
    }

    if (typeof reminders_enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'reminders_enabled must be a boolean value'
      });
    }

    const updatedAgent = await agentManager.updateReminderSettings(
      agentCode,
      parseInt(reminder_interval_minutes),
      reminders_enabled
    );

    if (!updatedAgent) {
      return res.status(404).json({
        success: false,
        error: `Agent ${agentCode} not found`
      });
    }

    const responseData = {
      agent_code: updatedAgent.agentCode,
      agent_name: updatedAgent.agentName,
      reminder_interval_minutes: updatedAgent.reminderSettings.intervalMinutes,
      reminders_enabled: updatedAgent.reminderSettings.enabled
    };

    res.json({
      success: true,
      data: responseData,
      message: `Reminder settings updated for ${agentCode}`
    });

  } catch (error) {
    console.error('❌ Error updating reminder settings:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Bulk update reminder settings
// Bulk update reminder settings (JSON-based)
router.post('/reminder-settings-bulk', async (req, res) => {
  try {
    const { settings } = req.body;

    if (!Array.isArray(settings)) {
      return res.status(400).json({
        success: false,
        error: 'Settings must be an array'
      });
    }

    console.log(`📊 Bulk update request for ${settings.length} agents`);
    const results = [];

    for (const setting of settings) {
      const { agentCode, reminder_interval_minutes, reminders_enabled } = setting;
      
      // Validation
      const intervalInt = parseInt(reminder_interval_minutes);
      if (isNaN(intervalInt) || intervalInt < 1 || intervalInt > 60) {
        results.push({ 
          success: false, 
          agentCode, 
          error: `Invalid interval: ${reminder_interval_minutes}. Must be 1-60 minutes.` 
        });
        continue;
      }

      if (typeof reminders_enabled !== 'boolean') {
        results.push({ 
          success: false, 
          agentCode, 
          error: 'reminders_enabled must be boolean' 
        });
        continue;
      }
      
      try {
        console.log(`📊 Updating ${agentCode}: ${intervalInt} minutes, enabled: ${reminders_enabled}`);
        
        const result = await agentManager.updateReminderSettings(
          agentCode,
          intervalInt,
          reminders_enabled
        );
        
        if (result) {
          results.push({ success: true, agentCode, data: result });
          console.log(`✅ Updated ${agentCode} settings successfully`);
        } else {
          results.push({ success: false, agentCode, error: 'Agent not found' });
        }
      } catch (error) {
        results.push({ success: false, agentCode, error: error.message });
        console.error(`❌ Error updating ${agentCode}:`, error.message);
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`📊 Bulk update completed: ${successCount}/${results.length} successful`);

    res.json({
      success: true,
      data: results,
      message: `Bulk update completed: ${successCount}/${results.length} agents updated`
    });

  } catch (error) {
    console.error('❌ Error bulk updating reminder settings:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/agents/:agentCode/remove', async (req, res) => {
  try {
    const { agentCode } = req.params;

    if (!agentCode) {
      return res.status(400).json({
        success: false,
        error: 'Agent code is required'
      });
    }

    // 🎯 NEW: Remove agent from JSON instead of database
    const removed = await agentManager.removeAgent(agentCode);
    
    if (!removed) {
      return res.status(404).json({
        success: false,
        error: `Agent ${agentCode} not found`
      });
    }
    
    // Agent removal is now handled entirely by local JSON storage
    // Real-time status is managed by WebSocket connections
    // No Redis cleanup needed

    console.log(`🗑️ Agent ${agentCode} removed from JSON storage`);

    res.json({
      success: true,
      message: `Agent ${agentCode} removed successfully`,
      agentCode
    });

  } catch (error) {
    console.error('❌ Error removing agent:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 🎯 NEW: Get all agents from JSON
router.get('/agents/json', async (req, res) => {
  try {
    const agents = agentManager.getAllAgents();
    
    res.json({
      success: true,
      data: agents,
      count: agents.length
    });

  } catch (error) {
    console.error('❌ Error getting agents from JSON:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// NEW: Reset/restore agent
router.post('/agents/:agentCode/restore', async (req, res) => {
  try {
    const { agentCode } = req.params;

    if (!agentCode) {
      return res.status(400).json({
        success: false,
        error: 'Agent code is required'
      });
    }

    // Agent status is now managed entirely by WebSocket connections
    // No database status updates needed
    
    console.log(`♻️ Agent ${agentCode} restored to dashboard`);

    res.json({
      success: true,
      message: `Agent ${agentCode} restored successfully`,
      agentCode
    });

  } catch (error) {
    console.error('❌ Error restoring agent:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Bulk update reminder settings (JSON-based)
router.post('/reminder-settings-bulk', async (req, res) => {
  try {
    const { settings } = req.body;

    if (!Array.isArray(settings)) {
      return res.status(400).json({
        success: false,
        error: 'Settings must be an array'
      });
    }

    const results = [];

    for (const setting of settings) {
      const { agentCode, reminder_interval_minutes, reminders_enabled } = setting;
      
      try {
        const result = await agentManager.updateReminderSettings(
          agentCode,
          parseInt(reminder_interval_minutes),
          reminders_enabled
        );
        results.push({ success: true, agentCode, data: result });
      } catch (error) {
        results.push({ success: false, agentCode, error: error.message });
      }
    }

    res.json({
      success: true,
      data: results,
      message: `Bulk update completed for ${results.length} agents`
    });

  } catch (error) {
    console.error('❌ Error bulk updating reminder settings:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;