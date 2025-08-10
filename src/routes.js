const express = require('express');
const database = require('./database');
const redis = require('./redis');
const agentManager = require('./services/agentManager');
const dailyTalkTimeManager = require('./services/dailyTalkTimeManager');
const router = express.Router();


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

// Get live dashboard data (New: JSON-based talk time)
router.get('/dashboard/live', async (req, res) => {
  try {
    // 🎯 NEW: Get today's talk time directly from JSON storage
    const agentsTalkTime = dailyTalkTimeManager.getTodayTalkTime();
    console.log(`📊 Dashboard: Found ${agentsTalkTime.length} agents with talk time data`);
    
    // Get active calls from Redis
    const activeCalls = await redis.getAllActiveCalls();
    
    // Get all agents status from Redis
    const agentsStatus = await redis.getAllAgentsStatus();

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

// 🎯 NEW: Search calls by phone number
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

    const calls = await database.searchCallsByPhoneNumber(phoneNumber, parseInt(limit));

    res.json({
      success: true,
      data: {
        phoneNumber,
        totalResults: calls.length,
        calls: calls.map(call => ({
          id: call.id,
          agentCode: call.agent_code,
          agentName: call.agent_name || 'Unknown',
          phoneNumber: call.phone_number,
          contactName: call.contact_name,
          callType: call.call_type,
          talkDuration: call.talk_duration,
          formattedTalkDuration: formatDuration(call.talk_duration),
          totalDuration: call.total_duration,
          callDate: call.call_date,
          startTime: call.start_time,
          endTime: call.end_time,
          createdAt: call.created_at
        }))
      }
    });

  } catch (error) {
    console.error('❌ Error searching calls by phone number:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 🎯 NEW: Get idle sessions for analytics
// 🎯 ENHANCED: Get idle sessions for analytics with pagination and sorting
router.get('/idle-sessions', async (req, res) => {
  try {
    const { 
      agent_code, 
      start_date, 
      end_date, 
      limit = 20, 
      page = 1,
      sort = 'start_time',
      order = 'desc'
    } = req.query;
    
    // Validate sort field
    const validSortFields = ['agent_code', 'start_time', 'idle_duration'];
    const sortField = validSortFields.includes(sort) ? sort : 'start_time';
    const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    
    // Calculate offset for pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const offset = (pageNum - 1) * limitNum;
    
    // Build query
    let query = `
      SELECT * FROM idle_sessions 
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (agent_code) {
      paramCount++;
      query += ` AND agent_code = $${paramCount}`;
      params.push(agent_code);
    }

    if (start_date) {
      paramCount++;
      query += ` AND session_date >= $${paramCount}`;
      params.push(start_date);
    }

    if (end_date) {
      paramCount++;
      query += ` AND session_date <= $${paramCount}`;
      params.push(end_date);
    }

    // Add sorting and pagination
    query += ` ORDER BY ${sortField} ${sortOrder}`;
    query += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limitNum, offset);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total FROM idle_sessions 
      WHERE 1=1
    `;
    const countParams = [];
    let countParamCount = 0;

    if (agent_code) {
      countParamCount++;
      countQuery += ` AND agent_code = $${countParamCount}`;
      countParams.push(agent_code);
    }

    if (start_date) {
      countParamCount++;
      countQuery += ` AND session_date >= $${countParamCount}`;
      countParams.push(start_date);
    }

    if (end_date) {
      countParamCount++;
      countQuery += ` AND session_date <= $${countParamCount}`;
      countParams.push(end_date);
    }

    // Execute both queries
    const [result, countResult] = await Promise.all([
      database.pool.query(query, params),
      database.pool.query(countQuery, countParams)
    ]);

    const totalRecords = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalRecords / limitNum);

    res.json({
      success: true,
      data: {
        idleSessions: result.rows.map(session => ({
          ...session,
          formattedIdleDuration: formatDuration(session.idle_duration)
        })),
        totalRecords,
        totalPages,
        currentPage: pageNum,
        recordsPerPage: limitNum
      }
    });

  } catch (error) {
    console.error('❌ Error getting idle sessions:', error.message);
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