const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('../config/config');
const database = require('./database');
const redis = require('./redis');
const routes = require('./routes');
const WebSocketManager = require('./websocket');
const dailyTalkTimeManager = require('./services/dailyTalkTimeManager');

class CallAnalyticsServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: config.cors.origin,
        methods: ["GET", "POST"]
      }
    });
    
    this.wsManager = null;
    this.dailyStatsScheduler = null;  // ADD THIS LINE
    this.init();
  }

  init() {
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    // Updated Helmet configuration to allow inline scripts for dashboard
    this.app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'", 
        "'unsafe-inline'",  // Allow inline scripts for dashboard
        "https://cdnjs.cloudflare.com"  // For socket.io CDN
      ],
      styleSrc: ["'self'", "'unsafe-inline'"],  // Allow inline styles
      connectSrc: ["'self'", "ws:", "wss:"],  // Allow WebSocket connections
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https:", "data:"]
    }
  }
}));
    
    // CORS middleware
    this.app.use(cors({
      origin: config.cors.origin,
      credentials: true
    }));

    // Logging middleware
    if (config.server.env === 'development') {
      this.app.use(morgan('dev'));
    } else {
      this.app.use(morgan('combined'));
    }

    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Static files (for dashboard)
    this.app.use(express.static('public'));
  }

  setupRoutes() {
    // API routes
    this.app.use('/api', routes);

    // Dashboard route
    this.app.get('/dashboard', (req, res) => {
        res.sendFile('dashboard.html', { root: 'public' });
    });

    // Root endpoint
    this.app.get('/', (req, res) => {
        res.json({
            name: 'Call Analytics Server',
            version: '1.0.0',
            status: 'running',
            timestamp: new Date().toISOString(),
            endpoints: {
                dashboard: '/dashboard',
                health: '/api/health',
                dashboardData: '/api/dashboard/live',
                agents: '/api/agents',
                stats: '/api/stats',
                agentHistory: '/api/agent/:agentCode/history?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD'
            }
        });
    });

    // Catch all other routes
    this.app.all('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.path,
        method: req.method
      });
    });
  }

  setupWebSocket() {
    this.wsManager = new WebSocketManager(this.io);
    console.log('✅ WebSocket manager initialized');
  }

  setupErrorHandling() {
    // Global error handler
    this.app.use((error, req, res, next) => {
      console.error('❌ Global error handler:', error);
      
      res.status(error.status || 500).json({
        success: false,
        error: config.server.env === 'development' ? error.message : 'Internal server error',
        ...(config.server.env === 'development' && { stack: error.stack })
      });
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      this.gracefulShutdown();
    });

    // Handle SIGTERM signal
    process.on('SIGTERM', () => {
      console.log('📴 SIGTERM received, shutting down gracefully');
      this.gracefulShutdown();
    });

    // Handle SIGINT signal (Ctrl+C)
    process.on('SIGINT', () => {
      console.log('📴 SIGINT received, shutting down gracefully');
      this.gracefulShutdown();
    });
  }

async start() {
  try {
    // Wait for database and redis to be ready
    console.log('🔄 Waiting for database and redis connections...');
    await this.waitForConnections();

    // Initialize daily talk time manager
    console.log('🔄 Initializing daily talk time manager...');
    await dailyTalkTimeManager.init();

    

 // Start daily stats scheduler
    this.startDailyStatsScheduler();  // ADD THIS LINE
    // Start the server
    this.server.listen(config.server.port, '0.0.0.0', () => {
        console.log('🚀 Call Analytics Server Started');
        console.log(`📡 Server: http://0.0.0.0:${config.server.port}`);
        console.log(`🔌 WebSocket: ws://0.0.0.0:${config.server.port}`);
        console.log(`🌍 Environment: ${config.server.env}`);
        console.log(`⏰ Started at: ${new Date().toISOString()}`);
      });

    } catch (error) {
      console.error('❌ Failed to start server:', error.message);
      process.exit(1);
    }
  }

  async waitForConnections() {
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      try {
        // Test redis connection only (no PostgreSQL)
        const redisHealthy = await redis.ping();
        
        if (redisHealthy) {
          console.log('✅ All connections ready (Redis only)');
          return;
        }
      } catch (error) {
        console.log(`🔄 Waiting for connections... (${attempts + 1}/${maxAttempts})`);
      }
      
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    throw new Error('Failed to establish connections after maximum attempts');
  }

  // Daily stats scheduler - runs at 11:55 PM IST
  startDailyStatsScheduler() {
    const scheduleNextRun = () => {
      const now = new Date();
      
      // Convert to IST
      const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
      const istNow = new Date(now.getTime() + istOffset);
      
      // Set target time to 11:55 PM IST today
      const targetTime = new Date(istNow);
      targetTime.setHours(23, 55, 0, 0);
      
      // If target time has already passed today, schedule for tomorrow
      if (istNow > targetTime) {
        targetTime.setDate(targetTime.getDate() + 1);
      }
      
      // Convert back to UTC for setTimeout
      const targetTimeUTC = new Date(targetTime.getTime() - istOffset);
      const msUntilRun = targetTimeUTC.getTime() - now.getTime();
      
      console.log(`📅 Daily stats scheduled for: ${targetTime.toISOString()} IST (in ${Math.round(msUntilRun / 1000 / 60)} minutes)`);
      
      this.dailyStatsScheduler = setTimeout(async () => {
        await this.saveDailyStatsToNocoDB();
        scheduleNextRun(); // Schedule next day
      }, msUntilRun);
    };
    
    scheduleNextRun();
    console.log('✅ Daily stats scheduler started');
  }

  async saveDailyStatsToNocoDB() {
    try {
      console.log('🔄 Starting daily stats save to NocoDB...');
      
      const nocodbService = require('./services/nocodbService');
      const todayTalkTime = dailyTalkTimeManager.getTodayTalkTime();
      
      if (todayTalkTime.length === 0) {
        console.log('⚠️ No talk time data to save today');
        return;
      }
      
      const today = nocodbService.formatDate(new Date());
      let savedCount = 0;
      let errorCount = 0;
      
      for (const agent of todayTalkTime) {
        try {
          // Only save if agent has some talk time or calls
          if (agent.totalTalkTime > 0 || agent.callCount > 0) {
            await nocodbService.addDailyTalktime(
              agent.agentCode,
              agent.agentName,
              today,
              agent.totalTalkTime,
              agent.callCount || 0
            );
            
            savedCount++;
            console.log(`✅ Saved daily stats: ${agent.agentCode} - ${agent.formattedTalkTime}`);
            
            // Small delay to prevent rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (error) {
          errorCount++;
          console.error(`❌ Failed to save daily stats for ${agent.agentCode}:`, error.message);
        }
      }
      
      console.log(`📊 Daily stats save completed: ${savedCount} saved, ${errorCount} errors`);
      
      // Reset daily talk time for next day (optional - depends on your preference)
      // await dailyTalkTimeManager.resetForNewDay();
      
    } catch (error) {
      console.error('❌ Error in daily stats save:', error.message);
    }
  }

  async gracefulShutdown() {
    console.log('🔄 Starting graceful shutdown...');
    
    try {
      // Clear daily stats scheduler
      if (this.dailyStatsScheduler) {
        clearTimeout(this.dailyStatsScheduler);
        console.log('✅ Daily stats scheduler cleared');
      }

      // Close HTTP server
      this.server.close(() => {
        console.log('✅ HTTP server closed');
      });

      // Close WebSocket connections
      if (this.io) {
        this.io.close(() => {
          console.log('✅ WebSocket server closed');
        });
      }

      // Close database connections
      await database.cleanup();

      // Close Redis connections
      await redis.cleanup();

      console.log('✅ Graceful shutdown completed');
      process.exit(0);

    } catch (error) {
      console.error('❌ Error during shutdown:', error.message);
      process.exit(1);
    }
  }

  // Method to broadcast to all dashboard clients
  broadcastDashboardUpdate() {
    if (this.wsManager) {
      this.wsManager.broadcastDashboardUpdate();
    }
  }

  // Method to get server status
  getStatus() {
    return {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      connectedClients: this.io ? this.io.sockets.sockets.size : 0,
      connectedAgents: this.wsManager ? this.wsManager.getConnectedAgentsCount() : 0
    };
  }
}

// Create and start the server
const server = new CallAnalyticsServer();
server.start().catch(error => {
  console.error('❌ Server startup failed:', error);
  process.exit(1);
});

// Export for testing purposes
module.exports = server;