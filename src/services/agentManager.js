const fs = require('fs').promises;
const path = require('path');

class AgentManager {
  constructor() {
    this.filePath = path.join(__dirname, '../../data/agents.json');
    this.agents = {};
    this.metadata = {};
    this.init();
  }

  async init() {
    try {
      await this.loadAgents();
      console.log('✅ AgentManager initialized with JSON storage');
    } catch (error) {
      console.error('❌ AgentManager initialization failed:', error.message);
      await this.createDefaultFile();
    }
  }

  async loadAgents() {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(data);
      this.agents = parsed.agents || {};
      this.metadata = parsed.metadata || { version: "1.0", totalAgents: 0 };
      console.log(`📊 Loaded ${Object.keys(this.agents).length} agents from JSON`);
    } catch (error) {
      console.log('📄 Creating new agents.json file');
      await this.createDefaultFile();
    }
  }

  async createDefaultFile() {
    const defaultData = {
      agents: {},
      metadata: {
        version: "1.0",
        lastUpdated: new Date().toISOString(),
        totalAgents: 0
      }
    };
    
    await this.saveToFile(defaultData);
    this.agents = {};
    this.metadata = defaultData.metadata;
  }

  async saveToFile(data = null) {
    try {
      const dataToSave = data || {
        agents: this.agents,
        metadata: {
          ...this.metadata,
          lastUpdated: new Date().toISOString(),
          totalAgents: Object.keys(this.agents).length
        }
      };

      await fs.writeFile(this.filePath, JSON.stringify(dataToSave, null, 2), 'utf8');
      console.log(`💾 Saved ${Object.keys(this.agents).length} agents to JSON`);
    } catch (error) {
      console.error('❌ Error saving agents to JSON:', error.message);
      throw error;
    }
  }

  // Add or update agent
  async upsertAgent(agentCode, agentName, status = 'online') {
    try {
      const now = new Date().toISOString();
      const isNewAgent = !this.agents[agentCode];

      this.agents[agentCode] = {
        agentCode,
        agentName,
        status,
        lastSeen: now,
        reminderSettings: this.agents[agentCode]?.reminderSettings || {
          enabled: true,
          intervalMinutes: 5
        },
        createdAt: this.agents[agentCode]?.createdAt || now,
        updatedAt: now
      };

      await this.saveToFile();
      
      if (isNewAgent) {
        console.log(`➕ Added new agent: ${agentCode} (${agentName})`);
      } else {
        console.log(`🔄 Updated agent: ${agentCode} (${agentName}) - Status: ${status}`);
      }

      return this.agents[agentCode];
    } catch (error) {
      console.error('❌ Error upserting agent:', error.message);
      throw error;
    }
  }

  // Update agent status
  async updateAgentStatus(agentCode, status) {
    try {
      if (!this.agents[agentCode]) {
        console.log(`⚠️ Agent ${agentCode} not found for status update`);
        return null;
      }

      this.agents[agentCode].status = status;
      this.agents[agentCode].lastSeen = new Date().toISOString();
      this.agents[agentCode].updatedAt = new Date().toISOString();

      await this.saveToFile();
      console.log(`📊 Updated ${agentCode} status to: ${status}`);
      
      return this.agents[agentCode];
    } catch (error) {
      console.error('❌ Error updating agent status:', error.message);
      throw error;
    }
  }

  // Remove agent completely
  async removeAgent(agentCode) {
    try {
      if (!this.agents[agentCode]) {
        console.log(`⚠️ Agent ${agentCode} not found for removal`);
        return false;
      }

      const agentName = this.agents[agentCode].agentName;
      delete this.agents[agentCode];
      
      await this.saveToFile();
      console.log(`🗑️ Removed agent: ${agentCode} (${agentName}) from JSON`);
      
      return true;
    } catch (error) {
      console.error('❌ Error removing agent:', error.message);
      throw error;
    }
  }

  // Get single agent
  getAgent(agentCode) {
    return this.agents[agentCode] || null;
  }

  // Get all agents
  getAllAgents() {
    return Object.values(this.agents);
  }

  // Get agents by status
  getAgentsByStatus(status) {
    return Object.values(this.agents).filter(agent => agent.status === status);
  }

  // Get enabled reminder agents
  getEnabledReminderAgents() {
    return Object.values(this.agents).filter(agent => 
      agent.reminderSettings && 
      agent.reminderSettings.enabled === true
    );
  }

  // Update reminder settings
  async updateReminderSettings(agentCode, intervalMinutes, enabled) {
    try {
      if (!this.agents[agentCode]) {
        console.log(`⚠️ Agent ${agentCode} not found for reminder settings update`);
        return null;
      }

      this.agents[agentCode].reminderSettings = {
        enabled: enabled,
        intervalMinutes: parseInt(intervalMinutes)
      };
      this.agents[agentCode].updatedAt = new Date().toISOString();

      await this.saveToFile();
      console.log(`⚙️ Updated reminder settings for ${agentCode}: ${intervalMinutes}min, enabled: ${enabled}`);
      
      return this.agents[agentCode];
    } catch (error) {
      console.error('❌ Error updating reminder settings:', error.message);
      throw error;
    }
  }

  // Get agent count
  getAgentCount() {
    return Object.keys(this.agents).length;
  }

  // Check if agent exists
  agentExists(agentCode) {
    return this.agents.hasOwnProperty(agentCode);
  }

  // Auto-sync methods for PostgreSQL integration
  async syncAgentToPostgreSQL(agentCode) {
    try {
      const agent = this.agents[agentCode];
      if (!agent) {
        console.log(`⚠️ Agent ${agentCode} not found in JSON for PostgreSQL sync`);
        return false;
      }

      const database = require('../database');
      
      // Upsert agent in PostgreSQL
      const query = `
        INSERT INTO agents (agent_code, agent_name, status, last_seen, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (agent_code) 
        DO UPDATE SET 
          agent_name = EXCLUDED.agent_name,
          status = EXCLUDED.status,
          last_seen = EXCLUDED.last_seen,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `;
      
      const values = [
        agent.agentCode,
        agent.agentName,
        agent.status,
        agent.lastSeen,
        agent.updatedAt
      ];

      const result = await database.pool.query(query, values);
      console.log(`🔄 Synced agent ${agentCode} to PostgreSQL`);
      
      return result.rows[0];
    } catch (error) {
      console.error(`❌ Error syncing agent ${agentCode} to PostgreSQL:`, error.message);
      return false;
    }
  }

  async syncAllAgentsToPostgreSQL() {
    try {
      console.log(`🔄 Starting bulk sync of ${Object.keys(this.agents).length} agents to PostgreSQL`);
      
      const syncResults = [];
      for (const agentCode of Object.keys(this.agents)) {
        const result = await this.syncAgentToPostgreSQL(agentCode);
        syncResults.push({ agentCode, success: !!result });
      }
      
      const successCount = syncResults.filter(r => r.success).length;
      console.log(`✅ Bulk sync completed: ${successCount}/${syncResults.length} agents synced`);
      
      return syncResults;
    } catch (error) {
      console.error('❌ Error in bulk sync to PostgreSQL:', error.message);
      return [];
    }
  }

  // Enhanced upsert with auto-sync
  async upsertAgent(agentCode, agentName, status = 'online') {
    try {
      const now = new Date().toISOString();
      const isNewAgent = !this.agents[agentCode];

      this.agents[agentCode] = {
        agentCode,
        agentName,
        status,
        lastSeen: now,
        reminderSettings: this.agents[agentCode]?.reminderSettings || {
          enabled: true,
          intervalMinutes: 5
        },
        createdAt: this.agents[agentCode]?.createdAt || now,
        updatedAt: now
      };

      await this.saveToFile();
      
      // Auto-sync to PostgreSQL
      await this.syncAgentToPostgreSQL(agentCode);
      
      if (isNewAgent) {
        console.log(`➕ Added new agent: ${agentCode} (${agentName}) + synced to PostgreSQL`);
      } else {
        console.log(`🔄 Updated agent: ${agentCode} (${agentName}) - Status: ${status} + synced to PostgreSQL`);
      }

      return this.agents[agentCode];
    } catch (error) {
      console.error('❌ Error upserting agent:', error.message);
      throw error;
    }
  }

  // Enhanced status update with auto-sync
  async updateAgentStatus(agentCode, status) {
    try {
      if (!this.agents[agentCode]) {
        console.log(`⚠️ Agent ${agentCode} not found for status update`);
        return null;
      }

      this.agents[agentCode].status = status;
      this.agents[agentCode].lastSeen = new Date().toISOString();
      this.agents[agentCode].updatedAt = new Date().toISOString();

      await this.saveToFile();
      
      // Auto-sync to PostgreSQL
      await this.syncAgentToPostgreSQL(agentCode);
      
      console.log(`📊 Updated ${agentCode} status to: ${status} + synced to PostgreSQL`);
      
      return this.agents[agentCode];
    } catch (error) {
      console.error('❌ Error updating agent status:', error.message);
      throw error;
    }
  }

  // Enhanced reminder settings update with auto-sync
  async updateReminderSettings(agentCode, intervalMinutes, enabled) {
    try {
      if (!this.agents[agentCode]) {
        console.log(`⚠️ Agent ${agentCode} not found for reminder settings update`);
        return null;
      }

      this.agents[agentCode].reminderSettings = {
        enabled: enabled,
        intervalMinutes: parseInt(intervalMinutes)
      };
      this.agents[agentCode].updatedAt = new Date().toISOString();

      await this.saveToFile();
      
      // Auto-sync to PostgreSQL (agent basic info might have changed)
      await this.syncAgentToPostgreSQL(agentCode);
      
      console.log(`⚙️ Updated reminder settings for ${agentCode}: ${intervalMinutes}min, enabled: ${enabled} + synced to PostgreSQL`);
      
      return this.agents[agentCode];
    } catch (error) {
      console.error('❌ Error updating reminder settings:', error.message);
      throw error;
    }
  }
}



module.exports = new AgentManager();