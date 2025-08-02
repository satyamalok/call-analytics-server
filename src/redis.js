const redis = require('redis');
const config = require('../config/config');

class RedisManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.init();
  }

  async init() {
    try {
      // Redis v4+ client configuration
      this.client = redis.createClient({
        socket: {
          host: config.redis.host,
          port: config.redis.port,
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.log('❌ Redis retry attempts exhausted');
              return new Error('Retry attempts exhausted');
            }
            return Math.min(retries * 100, 3000);
          }
        }
      });

      this.client.on('connect', () => {
        console.log('✅ Redis connected successfully');
        this.isConnected = true;
      });

      this.client.on('error', (error) => {
        console.error('❌ Redis connection error:', error.message);
        this.isConnected = false;
      });

      this.client.on('end', () => {
        console.log('⚠️ Redis connection ended');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        console.log('🔄 Redis reconnecting...');
        this.isConnected = false;
      });

      await this.client.connect();
    } catch (error) {
      console.error('❌ Redis initialization failed:', error.message);
      this.isConnected = false;
    }
  }

  // Agent real-time data methods
  async setAgentStatus(agentCode, status, additionalData = {}) {
    if (!this.isConnected) return false;

    const key = `agent:${agentCode}`;
    const data = {
      status,
      lastUpdate: new Date().toISOString(),
      ...additionalData
    };

    try {
      await this.client.hSet(key, data);
      return true;
    } catch (error) {
      console.error('❌ Error setting agent status:', error.message);
      return false;
    }
  }

  async getAgentStatus(agentCode) {
    if (!this.isConnected) return null;

    try {
      const data = await this.client.hGetAll(`agent:${agentCode}`);
      return Object.keys(data).length > 0 ? data : null;
    } catch (error) {
      console.error('❌ Error getting agent status:', error.message);
      return null;
    }
  }

  async getAllAgentsStatus() {
    if (!this.isConnected) return {};

    try {
      const keys = await this.client.keys('agent:*');
      const agentsData = {};

      for (const key of keys) {
        const agentCode = key.replace('agent:', '');
        const data = await this.client.hGetAll(key);
        if (Object.keys(data).length > 0) {
          agentsData[agentCode] = data;
        }
      }

      return agentsData;
    } catch (error) {
      console.error('❌ Error getting all agents status:', error.message);
      return {};
    }
  }

  // Today's talk time methods
  async updateTodayTalkTime(agentCode, additionalSeconds) {
    if (!this.isConnected) return false;

    const key = `today_talk:${agentCode}`;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    try {
      await this.client.hIncrBy(key, 'seconds', additionalSeconds);
      await this.client.hSet(key, 'date', today);
      await this.client.expire(key, 86400); // Expire at end of day
      return true;
    } catch (error) {
      console.error('❌ Error updating today talk time:', error.message);
      return false;
    }
  }

  async getTodayTalkTime(agentCode) {
    if (!this.isConnected) return 0;

    try {
      const seconds = await this.client.hGet(`today_talk:${agentCode}`, 'seconds');
      return parseInt(seconds) || 0;
    } catch (error) {
      console.error('❌ Error getting today talk time:', error.message);
      return 0;
    }
  }

  // Call tracking methods
  async setCallStart(agentCode, callData) {
    if (!this.isConnected) return false;

    const key = `call:${agentCode}`;
    const data = {
      ...callData,
      startTime: new Date().toISOString(),
      status: 'active'
    };

    try {
      await this.client.hSet(key, data);
      await this.client.expire(key, 3600); // Expire after 1 hour
      return true;
    } catch (error) {
      console.error('❌ Error setting call start:', error.message);
      return false;
    }
  }

  async setCallEnd(agentCode) {
    if (!this.isConnected) return false;

    try {
      await this.client.del(`call:${agentCode}`);
      
      // Set last call end time for idle calculation
      await this.client.hSet(`agent:${agentCode}`, 'lastCallEnd', new Date().toISOString());
      return true;
    } catch (error) {
      console.error('❌ Error setting call end:', error.message);
      return false;
    }
  }

  async getActiveCall(agentCode) {
    if (!this.isConnected) return null;

    try {
      const data = await this.client.hGetAll(`call:${agentCode}`);
      return Object.keys(data).length > 0 ? data : null;
    } catch (error) {
      console.error('❌ Error getting active call:', error.message);
      return null;
    }
  }

  async getAllActiveCalls() {
    if (!this.isConnected) return {};

    try {
      const keys = await this.client.keys('call:*');
      const activeCalls = {};

      for (const key of keys) {
        const agentCode = key.replace('call:', '');
        const data = await this.client.hGetAll(key);
        if (Object.keys(data).length > 0) {
          activeCalls[agentCode] = data;
        }
      }

      return activeCalls;
    } catch (error) {
      console.error('❌ Error getting all active calls:', error.message);
      return {};
    }
  }

  // Utility methods
  async cleanup() {
    if (this.client) {
      await this.client.quit();
      console.log('✅ Redis connection closed');
    }
  }

  // Health check
  async ping() {
    if (!this.isConnected) return false;
    
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      return false;
    }
  }
}

module.exports = new RedisManager();