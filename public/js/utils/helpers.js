// Helper Utilities
const Helpers = {
  // Debug logging function
  debugLog(message, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${message}`;
    
    console.log(logMessage, data || '');
    
    // Add to debug console if exists
    const debugContent = document.getElementById('debugContent');
    if (debugContent) {
      debugContent.textContent += `\n${logMessage}${data ? ' ' + JSON.stringify(data, null, 2) : ''}`;
      debugContent.scrollTop = debugContent.scrollHeight;
    }
  },

  // Sanitize HTML to prevent XSS
  sanitizeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // Deep clone object
  deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  },

  // Debounce function calls
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  // Throttle function calls
  throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },

  // Generate unique ID
  generateId() {
    return 'id_' + Math.random().toString(36).substr(2, 9);
  },

  // Check if element is visible
  isElementVisible(element) {
    return element && element.offsetParent !== null;
  },

  // Smooth scroll to element
  scrollToElement(element, offset = 0) {
    if (element) {
      const targetPosition = element.offsetTop - offset;
      window.scrollTo({
        top: targetPosition,
        behavior: 'smooth'
      });
    }
  },

  // Local storage helpers with error handling
  setStorageItem(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      this.debugLog(`Failed to save to localStorage: ${error.message}`);
      return false;
    }
  },

  getStorageItem(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
      this.debugLog(`Failed to read from localStorage: ${error.message}`);
      return defaultValue;
    }
  },

  // Sort array by multiple criteria
  sortBy(array, criteria) {
    return array.sort((a, b) => {
      for (const criterion of criteria) {
        const { key, direction = 'asc' } = criterion;
        const aVal = this.getNestedValue(a, key);
        const bVal = this.getNestedValue(b, key);
        
        let comparison = 0;
        if (aVal > bVal) comparison = 1;
        if (aVal < bVal) comparison = -1;
        
        if (comparison !== 0) {
          return direction === 'desc' ? comparison * -1 : comparison;
        }
      }
      return 0;
    });
  },

  // Get nested object value by string path
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  },

  // Format bytes to readable format
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  },

  // Simple event emitter
  createEventEmitter() {
    const events = {};
    
    return {
      on(event, callback) {
        if (!events[event]) events[event] = [];
        events[event].push(callback);
      },
      
      off(event, callback) {
        if (events[event]) {
          events[event] = events[event].filter(cb => cb !== callback);
        }
      },
      
      emit(event, data) {
        if (events[event]) {
          events[event].forEach(callback => callback(data));
        }
      }
    };
  }
};

// Make available globally
window.Helpers = Helpers;