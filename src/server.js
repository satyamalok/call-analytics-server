const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('../config/config');
const routes = require('./routes');
const WebSocketManager = require('./websocket');
const dailyTalkTimeManager = require('./services/dailyTalkTimeManager');
const schedulerService = require('./services/schedulerService');
const nocodbService = require('./services/nocodbService');

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
    this.setupWebSocket();
    this.setupRoutes();
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
    // Middleware to pass WebSocket manager to routes
    this.app.use('/api', (req, res, next) => {
      req.webSocketManager = this.wsManager;
      next();
    });
    
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
    // Initialize daily talk time manager
    console.log('🔄 Initializing daily talk time manager...');
    await dailyTalkTimeManager.init();

    // Initialize scheduler service
    console.log('🔄 Initializing scheduler service for daily stats automation...');
    // Scheduler is already initialized in its constructor, just log
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

      // Shutdown scheduler service
      schedulerService.destroy();
      
      // Shutdown NocoDB service (process any remaining queue items)
      nocodbService.destroy();

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