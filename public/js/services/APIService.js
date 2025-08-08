// API Service for REST calls
class APIService {
  constructor() {
    this.baseURL = '/api';
    this.defaultHeaders = {
      'Content-Type': 'application/json'
    };
  }

  // Generic request method
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      headers: { ...this.defaultHeaders, ...options.headers },
      ...options
    };

    try {
      Helpers.debugLog(`API Request: ${config.method || 'GET'} ${endpoint}`);
      
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      Helpers.debugLog(`API Success: ${endpoint}`, data);
      return data;

    } catch (error) {
      Helpers.debugLog(`API Error: ${endpoint} - ${error.message}`);
      throw error;
    }
  }

  // GET request
  async get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  }

  // POST request
  async post(endpoint, data = null) {
    return this.request(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : null
    });
  }

  // PUT request
  async put(endpoint, data = null) {
    return this.request(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : null
    });
  }

  // DELETE request
  async delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }

  // Dashboard specific methods
  async getDashboardData() {
    return this.get('/dashboard/live');
  }

  async getServerStats() {
    return this.get('/stats');
  }

  async removeAgent(agentCode) {
    return this.post(`/agents/${agentCode}/remove`);
  }

  async restoreAgent(agentCode) {
    return this.post(`/agents/${agentCode}/restore`);
  }

  async getAgentHistory(agentCode, startDate, endDate) {
    return this.get(`/agent/${agentCode}/history?start_date=${startDate}&end_date=${endDate}`);
  }

  async getHealthCheck() {
    return this.get('/health');
  }

  // Batch operations
  async batchRequest(requests) {
    const promises = requests.map(req => this.request(req.endpoint, req.options));
    
    try {
      const results = await Promise.allSettled(promises);
      return results.map((result, index) => ({
        success: result.status === 'fulfilled',
        data: result.status === 'fulfilled' ? result.value : null,
        error: result.status === 'rejected' ? result.reason.message : null,
        request: requests[index]
      }));
    } catch (error) {
      Helpers.debugLog('Batch request error:', error.message);
      throw error;
    }
  }

  // Health check with retry
  async checkHealth(retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const result = await this.getHealthCheck();
        return result;
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
}

// Create global instance
const apiService = new APIService();

// Make available globally
window.APIService = apiService;