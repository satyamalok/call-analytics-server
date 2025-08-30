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
      console.log('✅ AgentManager initialized - Local JSON storage for agent settings');
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
      this.metadata = parsed.metadata || { version: "2.0", totalAgents: 0 };
      console.log(`📊 Loaded ${Object.keys(this.agents).length} agents from local JSON`);
    } catch (error) {
      console.log('📄 Creating new agents.json file');
      await this.createDefaultFile();
    }
  }

  async createDefaultFile() {
    const defaultData = {
      agents: {},
      metadata: {
        version: "2.0",
        lastUpdated: new Date().toISOString(),
        totalAgents: 0,
        description: "Local agent settings - only agent codes and names"
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
      console.log(`💾 Saved ${Object.keys(this.agents).length} agent settings to local JSON`);
    } catch (error) {
      console.error('❌ Error saving agents to JSON:', error.message);
      throw error;
    }
  }

  // Add or update agent settings
  async upsertAgent(agentCode, agentName) {
    try {
      const now = new Date().toISOString();
      const isNewAgent = !this.agents[agentCode];

      this.agents[agentCode] = {
        agentCode,
        agentName,
        createdAt: this.agents[agentCode]?.createdAt || now,
        updatedAt: now
      };

      await this.saveToFile();
      
      if (isNewAgent) {
        console.log(`➕ Added new agent: ${agentCode} (${agentName})`);
      } else {
        console.log(`🔄 Updated agent: ${agentCode} (${agentName})`);
      }

      return this.agents[agentCode];
    } catch (error) {
      console.error('❌ Error upserting agent:', error.message);
      throw error;
    }
  }

  // Update agent name
  async updateAgentName(agentCode, agentName) {
    try {
      if (!this.agents[agentCode]) {
        console.log(`⚠️ Agent ${agentCode} not found for name update`);
        return null;
      }

      this.agents[agentCode].agentName = agentName;
      this.agents[agentCode].updatedAt = new Date().toISOString();

      await this.saveToFile();
      console.log(`📝 Updated ${agentCode} name to: ${agentName}`);
      
      return this.agents[agentCode];
    } catch (error) {
      console.error('❌ Error updating agent name:', error.message);
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
      
      // Remove from JSON completely
      delete this.agents[agentCode];
      
      await this.saveToFile();
      console.log(`🗑️ Removed agent settings: ${agentCode} (${agentName})`);
      
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

  // Get agent count
  getAgentCount() {
    return Object.keys(this.agents).length;
  }

  // Check if agent exists
  agentExists(agentCode) {
    return this.agents.hasOwnProperty(agentCode);
  }

  // Get all agent codes
  getAgentCodes() {
    return Object.keys(this.agents);
  }

  // Get agent name by code
  getAgentName(agentCode) {
    return this.agents[agentCode]?.agentName || null;
  }

}



module.exports = new AgentManager();