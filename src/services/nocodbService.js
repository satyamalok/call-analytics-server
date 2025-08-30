const axios = require('axios');

class NocodbService {
  constructor() {
    this.baseUrl = 'https://db.tsblive.in/api/v2/tables';
    this.token = 'FuBOYV-1tJ4QmwSwHMyCx0mF6JJNGcnViRa3oGcy';
    this.tables = {
      callRecords: 'mp8za08hwm8rxst',
      dailyStats: 'mqw7q3yi3hr32kf', 
      idleSessions: 'me5fh6tz1pm1o4b'
    };
    this.viewIds = {
      callRecords: 'vw3z8uy3w6cbjhnh',
      dailyStats: 'vwkyuop9h5x05obe',
      idleSessions: 'vwcs7uhru2zrupli'
    };
    
    // Queue for idle sessions to prevent data loss
    this.idleSessionsQueue = [];
    this.isProcessingQueue = false;
    this.queueProcessor = null;
    
    this.init();
  }

  init() {
    console.log('✅ NocodbService initialized');
    this.startQueueProcessor();
  }

  // Base API request method
  async makeRequest(method, endpoint, data = null, params = {}) {
    try {
      const config = {
        method,
        url: `${this.baseUrl}${endpoint}`,
        headers: {
          'xc-token': this.token,
          'Content-Type': 'application/json'
        }
      };

      if (data) {
        config.data = data;
      }

      if (Object.keys(params).length > 0) {
        config.params = params;
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      console.error('❌ NocoDB API Error:', error.response?.data || error.message);
      throw error;
    }
  }

  // ===== CALL RECORDS API (Read Only) =====
  
  async searchCallRecords(filters = {}, limit = 25, offset = 0, sort = null) {
    try {
      const params = {
        offset,
        limit,
        viewId: this.viewIds.callRecords
      };

      // Build where clause
      let whereConditions = [];
      
      if (filters.mobile) {
        whereConditions.push(`(Mobile,eq,${filters.mobile})`);
      }
      
      if (filters.agentCode) {
        whereConditions.push(`(Agent Code,eq,${filters.agentCode})`);
      }
      
      if (filters.date) {
        whereConditions.push(`(Date,eq,exactDate,${filters.date})`);
      }
      
      if (filters.dateRange && filters.dateRange.start && filters.dateRange.end) {
        // For date ranges, we'll need multiple API calls or use different approach
        whereConditions.push(`(Date,gte,${filters.dateRange.start})`);
        whereConditions.push(`(Date,lte,${filters.dateRange.end})`);
      }

      if (whereConditions.length > 0) {
        params.where = whereConditions.join('~and');
      }

      if (sort) {
        params.sort = sort;
      }

      const response = await this.makeRequest('GET', `/${this.tables.callRecords}/records`, null, params);
      return response[0] || { list: [], pageInfo: {} };
    } catch (error) {
      console.error('❌ Error searching call records:', error.message);
      return { list: [], pageInfo: {} };
    }
  }

  async searchByPhoneNumber(mobile, limit = 50) {
    return await this.searchCallRecords({ mobile }, limit, 0, '-Id');
  }

  async getAgentCallHistory(agentCode, date = null, limit = 100) {
    const filters = { agentCode };
    if (date) {
      filters.date = date;
    }
    return await this.searchCallRecords(filters, limit, 0, '-Id');
  }

  // ===== DAILY STATS API =====
  
  async getDailyStats(filters = {}, limit = 25, offset = 0) {
    try {
      const params = {
        offset,
        limit,
        viewId: this.viewIds.dailyStats
      };

      let whereConditions = [];
      
      if (filters.agentCode) {
        whereConditions.push(`(Agent Code,eq,${filters.agentCode})`);
      }
      
      if (filters.date) {
        whereConditions.push(`(Date,eq,exactDate,${filters.date})`);
      }

      if (whereConditions.length > 0) {
        params.where = whereConditions.join('~and');
      }

      const response = await this.makeRequest('GET', `/${this.tables.dailyStats}/records`, null, params);
      return response[0] || { list: [], pageInfo: {} };
    } catch (error) {
      console.error('❌ Error getting daily stats:', error.message);
      return { list: [], pageInfo: {} };
    }
  }

  async getAgentDailyStats(agentCode, date = null) {
    const filters = { agentCode };
    if (date) {
      filters.date = date;
    }
    const result = await this.getDailyStats(filters, 1);
    return result.list[0] || null;
  }

  async getAgentStatsDateRange(agentCode, startDate, endDate) {
    try {
      // For date ranges, we need to make multiple calls or use a different approach
      // For now, let's get all stats for the agent and filter client-side
      const allStats = await this.getDailyStats({ agentCode }, 1000);
      
      const filteredStats = allStats.list.filter(stat => {
        const statDate = new Date(stat.Date);
        const start = new Date(startDate);
        const end = new Date(endDate);
        return statDate >= start && statDate <= end;
      });

      return filteredStats.sort((a, b) => new Date(b.Date) - new Date(a.Date));
    } catch (error) {
      console.error('❌ Error getting agent stats date range:', error.message);
      return [];
    }
  }

  async createDailyStats(agentCode, agentName, date, talktime, totalCalls) {
    try {
      const data = [{
        "Agent Code": agentCode,
        "Agent Name": agentName,
        "Date": date,
        "Talktime": talktime.toString(),
        "Total Calls": totalCalls.toString()
      }];

      const response = await this.makeRequest('POST', `/${this.tables.dailyStats}/records`, data);
      console.log(`✅ Created daily stats for ${agentCode} on ${date}`);
      return response;
    } catch (error) {
      console.error(`❌ Error creating daily stats for ${agentCode}:`, error.message);
      throw error;
    }
  }

  async updateDailyStats(recordId, talktime, totalCalls) {
    try {
      const data = [{
        "Id": recordId.toString(),
        "Talktime": talktime.toString(),
        "Total Calls": totalCalls.toString()
      }];

      const response = await this.makeRequest('PATCH', `/${this.tables.dailyStats}/records`, data);
      console.log(`✅ Updated daily stats record ${recordId}`);
      return response;
    } catch (error) {
      console.error(`❌ Error updating daily stats record ${recordId}:`, error.message);
      throw error;
    }
  }

  async upsertDailyStats(agentCode, agentName, date, talktime, totalCalls) {
    try {
      // Check if record exists
      const existing = await this.getAgentDailyStats(agentCode, date);
      
      if (existing) {
        // Update existing record
        return await this.updateDailyStats(existing.Id, talktime, totalCalls);
      } else {
        // Create new record
        return await this.createDailyStats(agentCode, agentName, date, talktime, totalCalls);
      }
    } catch (error) {
      console.error(`❌ Error upserting daily stats for ${agentCode}:`, error.message);
      throw error;
    }
  }

  // ===== IDLE SESSIONS API WITH QUEUE =====
  
  async getIdleSessions(filters = {}, limit = 25, offset = 0, sort = null) {
    try {
      const params = {
        offset,
        limit,
        viewId: this.viewIds.idleSessions
      };

      let whereConditions = [];
      
      if (filters.agentCode) {
        whereConditions.push(`(Agent Code,eq,${filters.agentCode})`);
      }
      
      if (filters.date) {
        whereConditions.push(`(Date,eq,exactDate,${filters.date})`);
      }

      if (filters.startDate) {
        whereConditions.push(`(Date,gte,${filters.startDate})`);
      }

      if (filters.endDate) {
        whereConditions.push(`(Date,lte,${filters.endDate})`);
      }

      if (whereConditions.length > 0) {
        params.where = whereConditions.join('~and');
      }

      if (sort) {
        params.sort = sort;
      }

      const response = await this.makeRequest('GET', `/${this.tables.idleSessions}/records`, null, params);
      return response[0] || { list: [], pageInfo: {} };
    } catch (error) {
      console.error('❌ Error getting idle sessions:', error.message);
      return { list: [], pageInfo: {} };
    }
  }

  // Enhanced idle sessions for analytics with proper pagination
  async getIdleSessionsForAnalytics(queryParams = {}) {
    try {
      const {
        agent_code,
        start_date,
        end_date,
        limit = 20,
        page = 1,
        sort = 'Start Time',
        order = 'desc'
      } = queryParams;

      // Calculate offset for pagination
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 20;
      const offset = (pageNum - 1) * limitNum;

      // Build filters
      const filters = {};
      if (agent_code) filters.agentCode = agent_code;
      if (start_date) filters.startDate = start_date;
      if (end_date) filters.endDate = end_date;

      // Build sort parameter
      let sortParam = null;
      if (sort) {
        const sortOrder = order.toLowerCase() === 'asc' ? '' : '-';
        
        // Map sort fields to NocoDB field names
        const fieldMap = {
          'agent_code': 'Agent Code',
          'start_time': 'Start Time',
          'idle_duration': 'Idle Duration'
        };
        
        const nocoField = fieldMap[sort] || 'Start Time';
        sortParam = `${sortOrder}Id`; // Default to ID sort since NocoDB field name sorting can be tricky
      }

      console.log(`🔍 Getting idle sessions: agent=${agent_code}, dates=${start_date}-${end_date}, page=${pageNum}`);
      
      const result = await this.getIdleSessions(filters, limitNum, offset, sortParam);

      // Since NocoDB doesn't provide exact total count easily, we'll estimate based on response
      const totalRecords = result.pageInfo?.totalRows || result.list.length;
      const totalPages = Math.ceil(totalRecords / limitNum);

      return {
        success: true,
        data: {
          idleSessions: result.list.map(session => ({
            id: session.Id,
            agent_code: session["Agent Code"],
            agent_name: session["Agent Name"],
            start_time: session["Start Time"],
            idle_duration: parseInt(session["Idle Duration"]) || 0,
            session_date: session.Date,
            formattedIdleDuration: this.formatDuration(parseInt(session["Idle Duration"]) || 0)
          })),
          totalRecords,
          totalPages,
          currentPage: pageNum,
          recordsPerPage: limitNum
        }
      };

    } catch (error) {
      console.error('❌ Error getting idle sessions for analytics:', error.message);
      return {
        success: false,
        error: error.message,
        data: {
          idleSessions: [],
          totalRecords: 0,
          totalPages: 0,
          currentPage: 1,
          recordsPerPage: 20
        }
      };
    }
  }

  // Format duration helper (moved from routes)
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

  async createIdleSession(agentCode, agentName, date, startTime, idleDuration) {
    try {
      const data = [{
        "Agent Code": agentCode,
        "Agent Name": agentName,
        "Date": date,
        "Start Time": startTime,
        "Idle Duration": idleDuration.toString()
      }];

      const response = await this.makeRequest('POST', `/${this.tables.idleSessions}/records`, data);
      console.log(`✅ Created idle session for ${agentCode} at ${startTime}`);
      return response;
    } catch (error) {
      console.error(`❌ Error creating idle session for ${agentCode}:`, error.message);
      throw error;
    }
  }

  // Queue idle session for processing to prevent data loss
  queueIdleSession(agentCode, agentName, date, startTime, idleDuration) {
    const sessionData = {
      agentCode,
      agentName,
      date,
      startTime,
      idleDuration,
      timestamp: Date.now()
    };

    this.idleSessionsQueue.push(sessionData);
    console.log(`📝 Queued idle session for ${agentCode} (Queue size: ${this.idleSessionsQueue.length})`);
  }

  // Start queue processor
  startQueueProcessor() {
    if (this.queueProcessor) {
      clearInterval(this.queueProcessor);
    }

    this.queueProcessor = setInterval(async () => {
      if (this.idleSessionsQueue.length > 0 && !this.isProcessingQueue) {
        await this.processIdleSessionsQueue();
      }
    }, 2000); // Process every 2 seconds

    console.log('🔄 Idle sessions queue processor started');
  }

  // Process idle sessions queue
  async processIdleSessionsQueue() {
    if (this.isProcessingQueue || this.idleSessionsQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      const batchSize = 5; // Process 5 sessions at a time
      const batch = this.idleSessionsQueue.splice(0, batchSize);

      console.log(`🔄 Processing ${batch.length} idle sessions from queue`);

      for (const session of batch) {
        try {
          await this.createIdleSession(
            session.agentCode,
            session.agentName,
            session.date,
            session.startTime,
            session.idleDuration
          );
        } catch (error) {
          // If individual session fails, log and continue
          console.error(`❌ Failed to process idle session for ${session.agentCode}:`, error.message);
        }
      }

      if (this.idleSessionsQueue.length > 0) {
        console.log(`📝 ${this.idleSessionsQueue.length} idle sessions remaining in queue`);
      }

    } catch (error) {
      console.error('❌ Error processing idle sessions queue:', error.message);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  // Get queue status
  getQueueStatus() {
    return {
      queueSize: this.idleSessionsQueue.length,
      isProcessing: this.isProcessingQueue,
      oldestItemAge: this.idleSessionsQueue.length > 0 ? 
        Date.now() - this.idleSessionsQueue[0].timestamp : 0
    };
  }

  // Force process queue (for manual triggers)
  async forceProcessQueue() {
    console.log('🔧 Force processing idle sessions queue...');
    await this.processIdleSessionsQueue();
  }

  // ===== BULK OPERATIONS FOR DAILY STATS =====
  
  async bulkCreateDailyStats(statsArray) {
    try {
      const data = statsArray.map(stat => ({
        "Agent Code": stat.agentCode,
        "Agent Name": stat.agentName,
        "Date": stat.date,
        "Talktime": stat.talktime.toString(),
        "Total Calls": stat.totalCalls.toString()
      }));

      const response = await this.makeRequest('POST', `/${this.tables.dailyStats}/records`, data);
      console.log(`✅ Bulk created ${statsArray.length} daily stats records`);
      return response;
    } catch (error) {
      console.error('❌ Error bulk creating daily stats:', error.message);
      throw error;
    }
  }

  // ===== UTILITY METHODS =====
  
  // Get today's date in YYYY-MM-DD format (IST)
  getTodayIST() {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    const istTime = new Date(now.getTime() + istOffset);
    return istTime.toISOString().split('T')[0];
  }

  // Format time for idle sessions (12-hour format)
  formatTimeForIdleSessions(date) {
    return date.toLocaleTimeString('en-US', { 
      hour12: true, 
      hour: 'numeric', 
      minute: '2-digit'
    }).toLowerCase();
  }

  // Clean up and stop queue processor
  destroy() {
    if (this.queueProcessor) {
      clearInterval(this.queueProcessor);
      this.queueProcessor = null;
    }
    
    // Process remaining queue items
    if (this.idleSessionsQueue.length > 0) {
      console.log(`🔄 Processing ${this.idleSessionsQueue.length} remaining queue items...`);
      this.forceProcessQueue();
    }
    
    console.log('🛑 NocodbService destroyed');
  }
}

module.exports = new NocodbService();