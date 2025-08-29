const config = require('../config/config');
const agentManager = require('./services/agentManager');

class Database {
  constructor() {
    // No more PostgreSQL pool - using NocoDB API only
    console.log('📊 Database service: Using NocoDB API (No local PostgreSQL)');
    this.init();
  }

  async init() {
    try {
      console.log('✅ Database service initialized (NocoDB API mode)');
    } catch (error) {
      console.error('❌ Database service initialization error:', error.message);
    }
  }

  // Keep only agent management methods (for JSON sync)
  async upsertAgent(agentCode, agentName, status = 'online') {
    try {
      console.log(`📊 JSON: Upserting agent ${agentCode} (${agentName}) with status ${status}`);
      return await agentManager.upsertAgent(agentCode, agentName, status);
    } catch (error) {
      console.error('❌ Error upserting agent via JSON:', error.message);
      throw error;
    }
  }

  async updateAgentStatus(agentCode, status) {
    try {
      console.log(`📊 JSON: Updating agent ${agentCode} status to ${status}`);
      return await agentManager.updateAgentStatus(agentCode, status);
    } catch (error) {
      console.error('❌ Error updating agent status via JSON:', error.message);
      throw error;
    }
  }

  // Reminder settings methods (JSON-based)
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

  // Dummy cleanup method
  async cleanup() {
    console.log('✅ Database cleanup completed (No connections to close)');
  }
}

module.exports = new Database();