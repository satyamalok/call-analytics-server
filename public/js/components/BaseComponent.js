// Base Component Class
class BaseComponent {
  constructor(elementId, options = {}) {
    this.elementId = elementId;
    this.element = document.getElementById(elementId);
    this.options = { ...this.defaultOptions, ...options };
    this.data = null;
    this.isInitialized = false;
    
    if (!this.element) {
      throw new Error(`Element with ID '${elementId}' not found`);
    }
    
    this.init();
  }

  // Default options (override in subclasses)
  get defaultOptions() {
    return {
      autoUpdate: true,
      animateUpdates: true,
      debugMode: false
    };
  }

  // Initialize component
  init() {
    // FIXED: Delay event listener setup to ensure WebSocketService is ready
    setTimeout(() => {
      this.setupEventListeners();
    }, 100);
    
    this.isInitialized = true;
    
    if (this.options.debugMode) {
      Helpers.debugLog(`${this.constructor.name} initialized`);
    }
  }

  // Setup event listeners (override in subclasses)
  setupEventListeners() {
    // Base implementation - override in subclasses
    // FIXED: Check WebSocketService availability before using
    if (window.WebSocketService && typeof window.WebSocketService.on === 'function') {
      // Safe to setup WebSocket event listeners in subclasses
    }
  }

  // Update component data
  updateData(newData) {
    const hasChanged = JSON.stringify(this.data) !== JSON.stringify(newData);
    
    if (hasChanged || !this.data) {
      const oldData = this.data;
      this.data = newData;
      
      if (this.options.animateUpdates) {
        this.element.classList.add('fade-in');
      }
      
      this.render();
      this.onDataUpdated(oldData, newData);
      
      if (this.options.debugMode) {
        Helpers.debugLog(`${this.constructor.name} data updated`, newData);
      }
    }
  }

  // Render component (override in subclasses)
  render() {
    // Base implementation - override in subclasses
  }

  // Called after data is updated (override in subclasses)
  onDataUpdated(oldData, newData) {
    // Base implementation - override in subclasses
  }

  // Show loading state
  showLoading(message = 'Loading...') {
    const loadingHTML = `<div class="loading">${message}</div>`;
    this.setContent(loadingHTML);
  }

  // Show error state
  showError(message = 'An error occurred') {
    const errorHTML = `<div class="error">❌ ${Helpers.sanitizeHTML(message)}</div>`;
    this.setContent(errorHTML);
  }

  // Show no data state
  showNoData(message = 'No data available') {
    const noDataHTML = `<div class="no-data">📭 ${Helpers.sanitizeHTML(message)}</div>`;
    this.setContent(noDataHTML);
  }

  // Set content in main content area
  setContent(html) {
    const contentArea = this.element.querySelector('.card-content') || this.element;
    contentArea.innerHTML = html;
  }

  // Update badge count
  updateBadge(count) {
    const badge = this.element.querySelector('.card-badge');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'block' : 'none';
    }
  }

  // Add CSS class with animation
  addClass(className) {
    this.element.classList.add(className);
  }

  // Remove CSS class
  removeClass(className) {
    this.element.classList.remove(className);
  }

  // Toggle CSS class
  toggleClass(className) {
    this.element.classList.toggle(className);
  }

  // Destroy component
  destroy() {
    this.isInitialized = false;
    this.data = null;
    
    if (this.options.debugMode) {
      Helpers.debugLog(`${this.constructor.name} destroyed`);
    }
  }
}

// Make available globally
window.BaseComponent = BaseComponent;