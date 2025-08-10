const { Pool } = require('pg');
const config = require('../config/config');
const agentManager = require('./services/agentManager');

class Database {
  constructor() {
    this.pool = new Pool(config.database);
    this.init();
  }

  async init() {
    try {
      // Test connection
      const client = await this.pool.connect();
      console.log('✅ PostgreSQL connected successfully');
      client.release();
      
      // Create tables if they don't exist
      await this.createTables();
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
    }
  }

  async createTables() {
    const createAgentsTable = `
      CREATE TABLE IF NOT EXISTS agents (
        agent_code VARCHAR(50) PRIMARY KEY,
        agent_name VARCHAR(100) NOT NULL,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'offline',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createCallsTable = `
      CREATE TABLE IF NOT EXISTS calls (
        id SERIAL PRIMARY KEY,
        agent_code VARCHAR(50) REFERENCES agents(agent_code),
        phone_number VARCHAR(20),
        contact_name VARCHAR(100),
        call_type VARCHAR(20) NOT NULL,
        talk_duration INTEGER DEFAULT 0,
        total_duration INTEGER DEFAULT 0,
        call_date DATE NOT NULL,
        start_time TIME,
        end_time TIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createIndexes = `
      CREATE INDEX IF NOT EXISTS idx_calls_agent_date ON calls(agent_code, call_date);
      CREATE INDEX IF NOT EXISTS idx_calls_date ON calls(call_date);
      CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    `;

    try {
      await this.pool.query(createAgentsTable);
      await this.pool.query(createCallsTable);
      await this.pool.query(createIndexes);
      console.log('✅ Database tables created/verified');
    } catch (error) {
      console.error('❌ Error creating tables:', error.message);
    }
  }

  // Agent methods
  // 🎯 NEW: Use JSON instead of PostgreSQL
async upsertAgent(agentCode, agentName, status = 'online') {
  try {
    console.log(`📊 JSON: Upserting agent ${agentCode} (${agentName}) with status ${status}`);
    return await agentManager.upsertAgent(agentCode, agentName, status);
  } catch (error) {
    console.error('❌ Error upserting agent via JSON:', error.message);
    throw error;
  }
}

  // 🎯 NEW: Use JSON instead of PostgreSQL
async updateAgentStatus(agentCode, status) {
  try {
    console.log(`📊 JSON: Updating agent ${agentCode} status to ${status}`);
    return await agentManager.updateAgentStatus(agentCode, status);
  } catch (error) {
    console.error('❌ Error updating agent status via JSON:', error.message);
    throw error;
  }
}

// 🎯 NEW: JSON-based reminder methods
async getEnabledAgentReminders() {
  try {
    const enabledAgents = agentManager.getEnabledReminderAgents();
    console.log(`📊 JSON: Found ${enabledAgents.length} agents with reminders enabled`);
    return enabledAgents;
  } catch (error) {
    console.error('❌ Error getting enabled agent reminders via JSON:', error.message);
    throw error;
  }
}

async getAgentReminderSettings(agentCode) {
  try {
    const agent = agentManager.getAgent(agentCode);
    return agent ? {
      agent_code: agent.agentCode,
      reminder_interval_minutes: agent.reminderSettings.intervalMinutes,
      reminders_enabled: agent.reminderSettings.enabled
    } : null;
  } catch (error) {
    console.error('❌ Error getting agent reminder settings via JSON:', error.message);
    throw error;
  }
}

async getAllAgentReminderSettings() {
  try {
    const agents = agentManager.getAllAgents();
    return agents.map(agent => ({
      agent_code: agent.agentCode,
      agent_name: agent.agentName,
      reminder_interval_minutes: agent.reminderSettings.intervalMinutes,
      reminders_enabled: agent.reminderSettings.enabled,
      agent_status: agent.status
    }));
  } catch (error) {
    console.error('❌ Error getting all agent reminder settings via JSON:', error.message);
    throw error;
  }
}

async upsertAgentReminderSettings(agentCode, intervalMinutes, enabled) {
  try {
    console.log(`📊 JSON: Updating reminder settings for ${agentCode}: ${intervalMinutes}min, enabled: ${enabled}`);
    return await agentManager.updateReminderSettings(agentCode, intervalMinutes, enabled);
  } catch (error) {
    console.error('❌ Error upserting agent reminder settings via JSON:', error.message);
    throw error;
  }
}

  // Call methods
  async insertCall(callData) {
    const query = `
      INSERT INTO calls (
        agent_code, phone_number, contact_name, call_type,
        talk_duration, total_duration, call_date, start_time, end_time
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    
    const values = [
      callData.agentCode,
      callData.phoneNumber,
      callData.contactName || null,
      callData.callType,
      callData.talkDuration || 0,
      callData.totalDuration || 0,
      callData.callDate,
      callData.startTime,
      callData.endTime
    ];
    
    try {
      const result = await this.pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error inserting call:', error.message);
      throw error;
    }
  }

  // Analytics methods
  async getTodayTalkTime() {
  const query = `
    SELECT 
      a.agent_code,
      a.agent_name,
      COALESCE(SUM(c.talk_duration), 0) as today_talk_time
    FROM agents a
    LEFT JOIN calls c ON a.agent_code = c.agent_code 
      AND c.call_date = CURRENT_DATE
    WHERE a.status != 'removed'  -- NEW: Exclude removed agents
    GROUP BY a.agent_code, a.agent_name
    ORDER BY a.agent_code ASC
  `;
  
  try {
    const result = await this.pool.query(query);
    return result.rows;
  } catch (error) {
    console.error('❌ Error getting today talk time:', error.message);
    throw error;
  }
}

  async getAgentHistory(agentCode, startDate, endDate) {
    const query = `
      SELECT 
        call_date,
        SUM(talk_duration) as total_talk_time,
        COUNT(*) as total_calls
      FROM calls
      WHERE agent_code = $1 
        AND call_date >= $2 
        AND call_date <= $3
      GROUP BY call_date
      ORDER BY call_date DESC
    `;
    
    try {
      const result = await this.pool.query(query, [agentCode, startDate, endDate]);
      return result.rows;
    } catch (error) {
      console.error('❌ Error getting agent history:', error.message);
      throw error;
    }
  }

  // Phone number search method
  async searchCallsByPhoneNumber(phoneNumber, limit = 50) {
    const query = `
      SELECT 
        c.*,
        a.agent_name
      FROM calls c
      LEFT JOIN agents a ON c.agent_code = a.agent_code
      WHERE c.phone_number LIKE $1 
        OR c.phone_number LIKE $2
        OR c.phone_number LIKE $3
      ORDER BY c.created_at DESC
      LIMIT $4
    `;
    
    // Clean the phone number and create search patterns
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    const patterns = [
      `%${cleanNumber}%`,
      `%${cleanNumber.substring(cleanNumber.length - 10)}%`, // Last 10 digits
      `%+91${cleanNumber}%` // Add country code
    ];
    
    try {
      const result = await this.pool.query(query, [...patterns, limit]);
      return result.rows;
    } catch (error) {
      console.error('❌ Error searching calls by phone number:', error.message);
      throw error;
    }
  }

  // Insert idle session
  async insertIdleSession(sessionData) {
    const query = `
      INSERT INTO idle_sessions (
        agent_code, agent_name, start_time, end_time, 
        idle_duration, session_date
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const values = [
      sessionData.agentCode,
      sessionData.agentName,
      sessionData.startTime,
      sessionData.endTime,
      sessionData.idleDuration,
      sessionData.sessionDate
    ];
    
    try {
      const result = await this.pool.query(query, values);
      console.log(`💾 Idle session saved: ${sessionData.agentCode} - ${sessionData.idleDuration}s`);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error inserting idle session:', error.message);
      throw error;
    }
  }

  // Reminder settings methods
async upsertAgentReminderSettings(agentCode, intervalMinutes, enabled) {
  const query = `
    INSERT INTO agent_reminder_settings (agent_code, reminder_interval_minutes, reminders_enabled, updated_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    ON CONFLICT (agent_code) 
    DO UPDATE SET 
      reminder_interval_minutes = EXCLUDED.reminder_interval_minutes,
      reminders_enabled = EXCLUDED.reminders_enabled,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;
  
  try {
    const result = await this.pool.query(query, [agentCode, intervalMinutes, enabled]);
    return result.rows[0];
  } catch (error) {
    console.error('❌ Error upserting agent reminder settings:', error.message);
    throw error;
  }
}

async getAgentReminderSettings(agentCode) {
  const query = `
    SELECT * FROM agent_reminder_settings 
    WHERE agent_code = $1
  `;
  
  try {
    const result = await this.pool.query(query, [agentCode]);
    return result.rows[0];
  } catch (error) {
    console.error('❌ Error getting agent reminder settings:', error.message);
    throw error;
  }
}

async getAllAgentReminderSettings() {
  const query = `
    SELECT 
      ars.*,
      a.agent_name,
      a.status as agent_status
    FROM agent_reminder_settings ars
    LEFT JOIN agents a ON ars.agent_code = a.agent_code
    ORDER BY ars.agent_code ASC
  `;
  
  try {
    const result = await this.pool.query(query);
    return result.rows;
  } catch (error) {
    console.error('❌ Error getting all agent reminder settings:', error.message);
    throw error;
  }
}

async getEnabledAgentReminders() {
  try {
    const enabledAgents = agentManager.getEnabledReminderAgents();
    console.log(`📊 JSON: Found ${enabledAgents.length} agents with reminders enabled`);
    return enabledAgents.map(agent => ({
      agent_code: agent.agentCode,
      agent_name: agent.agentName,
      reminder_interval_minutes: agent.reminderSettings.intervalMinutes,
      reminders_enabled: agent.reminderSettings.enabled,
      agent_status: agent.status
    }));
  } catch (error) {
    console.error('❌ Error getting enabled agent reminders via JSON:', error.message);
    throw error;
  }
}

  async cleanup() {
    await this.pool.end();
  }
}

module.exports = new Database();