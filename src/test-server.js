const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

class TestServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    
    this.connectedClients = new Map();
    this.init();
  }

  init() {
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    this.app.use(helmet());
    this.app.use(cors({ origin: "*" }));
    this.app.use(morgan('dev'));
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  setupRoutes() {
    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Call Analytics Test Server',
        version: '1.0.0',
        status: 'running',
        mode: 'TEST MODE - No Database/Redis',
        timestamp: new Date().toISOString(),
        connectedClients: this.connectedClients.size,
        endpoints: {
          health: '/api/health',
          dashboard: '/api/dashboard/live',
          stats: '/api/stats'
        }
      });
    });

    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'healthy',
        mode: 'test',
        timestamp: new Date().toISOString(),
        services: {
          server: 'running',
          websocket: 'running',
          database: 'bypassed',
          redis: 'bypassed'
        }
      });
    });

    // Mock dashboard data
    this.app.get('/api/dashboard/live', (req, res) => {
      res.json({
        success: true,
        mode: 'test',
        data: {
          agentsTalkTime: [
            { agentCode: 'Agent1', agentName: 'Test Agent 1', todayTalkTime: 3600, formattedTalkTime: '1h 0m 0s' },
            { agentCode: 'Agent2', agentName: 'Test Agent 2', todayTalkTime: 2400, formattedTalkTime: '40m 0s' }
          ],
          agentsOnCall: [
            { agentCode: 'Agent3', agentName: 'Test Agent 3', phoneNumber: '+919876543210', callStartTime: new Date().toISOString() }
          ],
          agentsIdleTime: [
            { agentCode: 'Agent1', agentName: 'Test Agent 1', minutesSinceLastCall: 15 }
          ],
          lastUpdated: new Date().toISOString()
        }
      });
    });

    // Mock stats
    this.app.get('/api/stats', (req, res) => {
      res.json({
        success: true,
        mode: 'test',
        data: {
          totalAgents: 5,
          onlineAgents: 3,
          activeCallsCount: 1,
          todayCalls: 25,
          connectedClients: this.connectedClients.size,
          serverTime: new Date().toISOString()
        }
      });
    });

    // Mock agent history
    this.app.get('/api/agent/:agentCode/history', (req, res) => {
      const { agentCode } = req.params;
      const { start_date, end_date } = req.query;

      res.json({
        success: true,
        mode: 'test',
        data: {
          agentCode,
          startDate: start_date || '2025-08-01',
          endDate: end_date || '2025-08-02',
          history: [
            { date: '2025-08-02', totalTalkTime: 3600, formattedTalkTime: '1h 0m 0s', totalCalls: 15 },
            { date: '2025-08-01', totalTalkTime: 7200, formattedTalkTime: '2h 0m 0s', totalCalls: 20 }
          ]
        }
      });
    });

    // 404 handler
    this.app.all('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.path,
        method: req.method,
        availableEndpoints: ['/', '/api/health', '/api/dashboard/live', '/api/stats']
      });
    });
  }

  setupWebSocket() {
    this.io.on('connection', (socket) => {
      console.log(`🔌 Client connected: ${socket.id}`);
      
      socket.on('agent_online', (data) => {
        console.log(`👤 Agent online: ${data.agentCode} (${data.agentName})`);
        this.connectedClients.set(data.agentCode, {
          socketId: socket.id,
          agentName: data.agentName,
          status: 'online',
          connectedAt: new Date().toISOString()
        });
        
        socket.emit('agent_status', { status: 'connected', agentCode: data.agentCode });
        this.broadcastUpdate();
      });

      socket.on('call_started', (data) => {
        console.log(`📞 Call started: ${data.agentCode} -> ${data.phoneNumber}`);
        
        if (this.connectedClients.has(data.agentCode)) {
          this.connectedClients.get(data.agentCode).status = 'on_call';
          this.connectedClients.get(data.agentCode).currentCall = data.phoneNumber;
        }
        
        this.broadcastUpdate();
      });

      socket.on('call_ended', (data) => {
        console.log(`📴 Call ended: ${data.agentCode} -> ${data.callData.phoneNumber} (${data.callData.talkDuration}s)`);
        
        if (this.connectedClients.has(data.agentCode)) {
          this.connectedClients.get(data.agentCode).status = 'online';
          delete this.connectedClients.get(data.agentCode).currentCall;
        }
        
        this.broadcastUpdate();
      });

      socket.on('disconnect', () => {
        console.log(`🔌 Client disconnected: ${socket.id}`);
        
        // Find and remove agent by socket ID
        for (const [agentCode, clientData] of this.connectedClients.entries()) {
          if (clientData.socketId === socket.id) {
            this.connectedClients.delete(agentCode);
            console.log(`👤 Agent disconnected: ${agentCode}`);
            break;
          }
        }
        
        this.broadcastUpdate();
      });

      socket.on('ping', () => {
        socket.emit('pong');
      });
    });

    console.log('✅ WebSocket server initialized (TEST MODE)');
  }

  broadcastUpdate() {
    const mockData = {
      agentsTalkTime: Array.from(this.connectedClients.entries()).map(([agentCode, data]) => ({
        agentCode,
        agentName: data.agentName,
        todayTalkTime: Math.floor(Math.random() * 7200),
        formattedTalkTime: '1h 30m 15s'
      })),
      agentsOnCall: Array.from(this.connectedClients.entries())
        .filter(([_, data]) => data.status === 'on_call')
        .map(([agentCode, data]) => ({
          agentCode,
          agentName: data.agentName,
          phoneNumber: data.currentCall || '+919876543210',
          callStartTime: new Date().toISOString()
        })),
      agentsIdleTime: Array.from(this.connectedClients.entries())
        .filter(([_, data]) => data.status === 'online')
        .map(([agentCode, data]) => ({
          agentCode,
          agentName: data.agentName,
          minutesSinceLastCall: Math.floor(Math.random() * 60)
        })),
      lastUpdated: new Date().toISOString()
    };

    this.io.emit('dashboard_update', mockData);
  }

  setupErrorHandling() {
    this.app.use((error, req, res, next) => {
      console.error('❌ Error:', error.message);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        mode: 'test'
      });
    });

    process.on('SIGINT', () => {
      console.log('📴 SIGINT received, shutting down test server...');
      this.server.close(() => {
        console.log('✅ Test server closed');
        process.exit(0);
      });
    });
  }

  start(port = 3000) {
    this.server.listen(port, '0.0.0.0', () => {
      console.log('🚀 Call Analytics TEST Server Started');
      console.log(`📡 Server: http://localhost:${port}`);
      console.log(`🔌 WebSocket: ws://localhost:${port}`);
      console.log(`🧪 Mode: TEST (No Database/Redis)`);
      console.log(`⏰ Started at: ${new Date().toISOString()}`);
      console.log('\n📋 Test the following endpoints:');
      console.log(`   GET  http://localhost:${port}/`);
      console.log(`   GET  http://localhost:${port}/api/health`);
      console.log(`   GET  http://localhost:${port}/api/dashboard/live`);
      console.log(`   GET  http://localhost:${port}/api/stats`);
    });
  }
}

const server = new TestServer();
server.start();