const fetch = require('node-fetch');

class NocoDBService {
  constructor() {
    this.baseURL = 'https://db.tsblive.in/api/v2/tables';
    this.token = 'FuBOYV-1tJ4QmwSwHMyCx0mF6JJNGcnViRa3oGcy';
    this.tables = {
      callRecords: 'mp8za08hwm8rxst',
      dailyTalktime: 'mqw7q3yi3hr32kf',
      idleSessions: 'me5fh6tz1pm1o4b'
    };
  }

  async makeRequest(method, tableId, data = null, queryParams = '') {
    const url = `${this.baseURL}/${tableId}/records${queryParams}`;
    
    const options = {
      method,
      headers: {
        'xc-token': this.token,
        'Content-Type': 'application/json'
      }
    };

    if (data && (method === 'POST' || method === 'PATCH')) {
      options.body = JSON.stringify(data);
    }

    try {
      console.log(`🔄 NocoDB ${method} request to: ${url}`);
      const response = await fetch(url, options);
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(`NocoDB API error: ${response.status} - ${JSON.stringify(result)}`);
      }
      
      console.log(`✅ NocoDB ${method} successful`);
      return result;
    } catch (error) {
      console.error(`❌ NocoDB ${method} error:`, error.message);
      throw error;
    }
  }

  // Search phone number in Call Records
  async searchCallsByPhone(phoneNumber) {
    const queryParams = `?where=(Mobile,eq,${phoneNumber})&sort=-Id`;
    return await this.makeRequest('GET', this.tables.callRecords, null, queryParams);
  }

  // Get idle sessions by agent and/or date
  async getIdleSessions(agentCode = null, date = null, limit = 25, offset = 0) {
    let whereClause = '';
    
    if (agentCode && date) {
      whereClause = `(Agent Code,eq,${agentCode})~and(Date,eq,${date})`;
    } else if (date) {
      whereClause = `(Date,eq,${date})`;
    } else if (agentCode) {
      whereClause = `(Agent Code,eq,${agentCode})`;
    }
    
    const queryParams = `?${whereClause ? `where=${whereClause}&` : ''}limit=${limit}&offset=${offset}&sort=-Id`;
    return await this.makeRequest('GET', this.tables.idleSessions, null, queryParams);
  }

  // Add idle session
  async addIdleSession(agentCode, agentName, startTime, idleDurationSeconds, date) {
    const data = [{
      "Date": date,
      "Agent Name": agentName,
      "Agent Code": agentCode,
      "Start Time": startTime,
      "Idle Duration": idleDurationSeconds.toString()
    }];
    
    return await this.makeRequest('POST', this.tables.idleSessions, data);
  }

  // Get daily talktime by agent and date range
  async getDailyTalktime(agentCode = null, startDate = null, endDate = null, limit = 25, offset = 0) {
    let whereClause = '';
    
    if (agentCode && startDate && endDate) {
      whereClause = `(Agent Code,eq,${agentCode})~and(Date,gte,${startDate})~and(Date,lte,${endDate})`;
    } else if (agentCode && startDate) {
      whereClause = `(Agent Code,eq,${agentCode})~and(Date,eq,${startDate})`;
    } else if (startDate && endDate) {
      whereClause = `(Date,gte,${startDate})~and(Date,lte,${endDate})`;
    } else if (startDate) {
      whereClause = `(Date,eq,${startDate})`;
    }
    
    const queryParams = `?${whereClause ? `where=${whereClause}&` : ''}limit=${limit}&offset=${offset}&sort=-Talktime`;
    return await this.makeRequest('GET', this.tables.dailyTalktime, null, queryParams);
  }

  // Add daily talktime stats
  async addDailyTalktime(agentCode, agentName, date, talktimeSeconds, totalCalls) {
    const data = [{
      "Date": date,
      "Agent Name": agentName,
      "Agent Code": agentCode,
      "Talktime": talktimeSeconds.toString(),
      "Total Calls": totalCalls.toString()
    }];
    
    return await this.makeRequest('POST', this.tables.dailyTalktime, data);
  }

  // Utility function to format time as HH:MM am/pm
  formatTimeAmPm(date) {
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  }

  // Utility function to format date as YYYY-MM-DD
  formatDate(date) {
    return date.toISOString().split('T')[0];
  }
}

module.exports = new NocoDBService();