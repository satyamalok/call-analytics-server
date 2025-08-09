const express = require('express');
const database = require('./database');
const redis = require('./redis');
const router = express.Router();
const agentManager = require('./services/agentManager');

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const dbHealth = await database.pool.query('SELECT 1');
    const redisHealth = await redis.ping();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealth ? 'connected' : 'disconnected',
        redis: redisHealth ? 'connected' : 'disconnected'
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

// Get live dashboard data
router.get('/dashboard/live', async (req, res) => {
  try {
    // Get today's talk time from database
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

    // Calculate idle times
    const agentsIdleTime = [];
    const now = new Date();

    for (const agent of todayTalkTime) {
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

    res.json({
      success: true,
      data: {
        agentsTalkTime: todayTalkTime.map(agent => ({
          agentCode: agent.agent_code,
          agentName: agent.agent_name,
          todayTalkTime: parseInt(agent.today_talk_time) || 0,
          formattedTalkTime: formatDuration(parseInt(agent.today_talk_time) || 0)
        })),
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

// Get agent history
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

    const history = await database.getAgentHistory(agentCode, start_date, end_date);

    res.json({
      success: true,
      data: {
        agentCode,
        startDate: start_date,
        endDate: end_date,
        history: history.map(day => ({
          date: day.call_date,
          totalTalkTime: parseInt(day.total_talk_time) || 0,
          formattedTalkTime: formatDuration(parseInt(day.total_talk_time) || 0),
          totalCalls: parseInt(day.total_calls) || 0
        }))
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
    const query = `
      SELECT agent_code, agent_name, status, last_seen 
      FROM agents 
      ORDER BY agent_code ASC
    `;
    
    const result = await database.pool.query(query);
    
    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Error getting agents list:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get server statistics
router.get('/stats', async (req, res) => {
  try {
    // Get total agents
    const agentsQuery = await database.pool.query('SELECT COUNT(*) FROM agents');
    const totalAgents = parseInt(agentsQuery.rows[0].count);

    // Get today's total calls
    const callsQuery = await database.pool.query(
      'SELECT COUNT(*) FROM calls WHERE call_date = CURRENT_DATE'
    );
    const todayCalls = parseInt(callsQuery.rows[0].count);

    // Get active calls count from Redis
    const activeCalls = await redis.getAllActiveCalls();
    const activeCallsCount = Object.keys(activeCalls).length;

    // Get online agents count from Redis
    const agentsStatus = await redis.getAllAgentsStatus();
    const onlineAgentsCount = Object.values(agentsStatus).filter(
      agent => agent.status === 'online' || agent.status === 'on_call'
    ).length;

    res.json({
      success: true,
      data: {
        totalAgents,
        onlineAgents: onlineAgentsCount,
        activeCallsCount,
        todayCalls,
        serverTime: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error getting server stats:', error.message);
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
    const settings = await database.getAllAgentReminderSettings();
    
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
    const settings = await database.getAgentReminderSettings(agentCode);
    
    if (!settings) {
      return res.status(404).json({
        success: false,
        error: 'Agent reminder settings not found'
      });
    }

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
    if (!reminder_interval_minutes || reminder_interval_minutes < 1) {
      return res.status(400).json({
        success: false,
        error: 'Invalid reminder interval. Must be at least 1 minute.'
      });
    }

    if (typeof reminders_enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'reminders_enabled must be a boolean value'
      });
    }

    const settings = await database.upsertAgentReminderSettings(
      agentCode,
      parseInt(reminder_interval_minutes),
      reminders_enabled
    );

    res.json({
      success: true,
      data: settings,
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
        const result = await database.upsertAgentReminderSettings(
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
    
    // Remove from Redis active agents
    await redis.setAgentStatus(agentCode, 'removed');
    
    // Clear any active call data
    await redis.setCallEnd(agentCode);

    console.log(`🗑️ Agent ${agentCode} removed from JSON and Redis`);

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

    // Restore agent to offline status (will be online when they connect)
    await database.updateAgentStatus(agentCode, 'offline');
    
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

module.exports = router;