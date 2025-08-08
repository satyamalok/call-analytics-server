// Toast Notification Service
class NotificationService {
  constructor() {
    this.container = null;
    this.toasts = new Map();
    this.init();
  }

  init() {
    this.container = document.getElementById('toastContainer');
    if (!this.container) {
      Helpers.debugLog('Toast container not found');
      return;
    }
    Helpers.debugLog('NotificationService initialized');
  }

  // Show notification
  show(message, type = 'info', duration = 4000) {
    if (!this.container) return;

    const toastId = Helpers.generateId();
    const toast = this.createToast(toastId, message, type, duration);
    
    this.container.appendChild(toast);
    this.toasts.set(toastId, toast);

    // Auto remove after duration
    if (duration > 0) {
      setTimeout(() => {
        this.remove(toastId);
      }, duration);
    }

    Helpers.debugLog(`Toast shown: ${type} - ${message}`);
    return toastId;
  }

  // Create toast element
  createToast(id, message, type, duration) {
    const toast = document.createElement('div');
    toast.className = `toast ${type} fade-in`;
    toast.setAttribute('data-toast-id', id);

    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };

    toast.innerHTML = `
      <div class="toast-content">
        <div class="toast-message">
          ${icons[type] || icons.info} ${Helpers.sanitizeHTML(message)}
        </div>
        <button class="toast-close" onclick="NotificationService.instance.remove('${id}')">&times;</button>
      </div>
      ${duration > 0 ? '<div class="toast-progress"></div>' : ''}
    `;

    return toast;
  }

  // Remove toast
  remove(toastId) {
    const toast = this.toasts.get(toastId);
    if (toast && toast.parentNode) {
      toast.style.transform = 'translateX(100%)';
      toast.style.opacity = '0';
      
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
        this.toasts.delete(toastId);
      }, 300);
    }
  }

  // Convenience methods
  success(message, duration = 4000) {
    return this.show(message, 'success', duration);
  }

  error(message, duration = 6000) {
    return this.show(message, 'error', duration);
  }

  warning(message, duration = 5000) {
    return this.show(message, 'warning', duration);
  }

  info(message, duration = 4000) {
    return this.show(message, 'info', duration);
  }

  // Clear all toasts
  clear() {
    for (const [id, toast] of this.toasts) {
      this.remove(id);
    }
  }
}

// Create global instance
NotificationService.instance = new NotificationService();

// Make available globally
window.NotificationService = NotificationService;