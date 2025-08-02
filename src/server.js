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
    this.init();
  }

  init() {
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet());
    
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

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Call Analytics Server',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
          health: '/api/health',
          dashboard: '/api/dashboard/live',
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
        // Test database connection
        await database.pool.query('SELECT 1');
        
        // Test redis connection
        const redisHealthy = await redis.ping();
        
        if (redisHealthy) {
          console.log('✅ All connections ready');
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

  async gracefulShutdown() {
    console.log('🔄 Starting graceful shutdown...');
    
    try {
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