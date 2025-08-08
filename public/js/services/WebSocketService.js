// WebSocket Service for real-time communication
class WebSocketService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000;
    this.eventEmitter = Helpers.createEventEmitter();
    this.messageQueue = [];
  }

  // Initialize WebSocket connection
  connect() {
    try {
      Helpers.debugLog('Connecting to WebSocket server...');
      
      this.socket = io({
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectDelay
      });

      this.setupEventListeners();
      
    } catch (error) {
      Helpers.debugLog('Failed to initialize WebSocket:', error.message);
      this.handleConnectionError(error);
    }
  }

  // Set up all WebSocket event listeners
  setupEventListeners() {
    // Connection events
    this.socket.on('connect', () => {
      this.handleConnect();
    });

    this.socket.on('disconnect', (reason) => {
      this.handleDisconnect(reason);
    });

    this.socket.on('connect_error', (error) => {
      this.handleConnectionError(error);
    });

    // Dashboard events
    this.socket.on('dashboard_update', (data) => {
      Helpers.debugLog('Dashboard update received');
      this.eventEmitter.emit('dashboard_update', data);
    });

    this.socket.on('call_timer_update', (data) => {
      Helpers.debugLog(`Call timer update: ${data.agentCode} - ${data.formattedDuration}`);
      this.eventEmitter.emit('call_timer_update', data);
    });

    // Server events
    this.socket.on('error', (error) => {
      Helpers.debugLog('Server error:', error);
      this.eventEmitter.emit('server_error', error);
    });

    this.socket.on('pong', () => {
      Helpers.debugLog('Pong received');
    });

    // Agent events
    this.socket.on('agent_status', (data) => {
      this.eventEmitter.emit('agent_status', data);
    });

    // Reminder events
    this.socket.on('reminder_trigger', (data) => {
      this.eventEmitter.emit('reminder_trigger', data);
    });
  }

  // Handle successful connection
  handleConnect() {
    this.isConnected = true;
    this.reconnectAttempts = 0;
    
    Helpers.debugLog('WebSocket connected successfully');
    this.eventEmitter.emit('connection_status', { 
      connected: true, 
      status: 'Connected' 
    });

    // Process queued messages
    this.processMessageQueue();
  }

  // Handle disconnection
  handleDisconnect(reason) {
    this.isConnected = false;
    
    Helpers.debugLog(`WebSocket disconnected: ${reason}`);
    this.eventEmitter.emit('connection_status', { 
      connected: false, 
      status: 'Disconnected',
      reason 
    });
  }

  // Handle connection errors
  handleConnectionError(error) {
    this.isConnected = false;
    this.reconnectAttempts++;
    
    Helpers.debugLog(`WebSocket connection error (attempt ${this.reconnectAttempts}): ${error.message}`);
    
    this.eventEmitter.emit('connection_status', { 
      connected: false, 
      status: 'Connection Error',
      error: error.message,
      attempt: this.reconnectAttempts
    });

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      NotificationService.instance.error('Failed to connect to server. Please refresh the page.');
    }
  }

  // Send message to server
  emit(event, data = null) {
    if (this.isConnected && this.socket) {
      this.socket.emit(event, data);
      Helpers.debugLog(`Sent WebSocket event: ${event}`, data);
    } else {
      // Queue message for later
      this.messageQueue.push({ event, data });
      Helpers.debugLog(`Queued WebSocket event: ${event} (not connected)`, data);
    }
  }

  // Process queued messages after reconnection
  processMessageQueue() {
    if (this.messageQueue.length > 0) {
      Helpers.debugLog(`Processing ${this.messageQueue.length} queued messages`);
      
      this.messageQueue.forEach(({ event, data }) => {
        this.socket.emit(event, data);
      });
      
      this.messageQueue = [];
    }
  }

  // Event listener management
  on(event, callback) {
    this.eventEmitter.on(event, callback);
  }

  off(event, callback) {
    this.eventEmitter.off(event, callback);
  }

  // Utility methods
  ping() {
    this.emit('ping');
  }

  getConnectionStatus() {
    return {
      connected: this.isConnected,
      socketId: this.socket?.id || null,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  // Disconnect
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      Helpers.debugLog('WebSocket disconnected manually');
    }
  }
}

// Create and initialize global instance
window.WebSocketService = new WebSocketService();

// Ensure the instance has all methods
console.log('WebSocketService initialized with methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(window.WebSocketService)));