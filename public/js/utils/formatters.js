// Formatting Utilities
const Formatters = {
  // Format duration in seconds to readable format
  formatDuration(seconds) {
    if (!seconds || seconds < 0) return '0s';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${remainingSeconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${remainingSeconds}s`;
    }
  },

  // Format time since last call
  formatIdleTime(minutes) {
    if (!minutes || minutes < 0) return '0m';
    
    if (minutes < 60) {
      return `${minutes}m`;
    } else {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    }
  },

  // Format timestamp to readable time
  formatTime(timestamp) {
    if (!timestamp) return 'Unknown';
    
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  },

  // Format phone number for display
  formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) return 'Unknown';
    
    // Clean the number
    const cleaned = phoneNumber.replace(/\D/g, '');
    
    // Format Indian numbers
    if (cleaned.startsWith('91') && cleaned.length === 12) {
      return `+91 ${cleaned.substring(2, 7)} ${cleaned.substring(7)}`;
    } else if (cleaned.length === 10) {
      return `${cleaned.substring(0, 5)} ${cleaned.substring(5)}`;
    }
    
    return phoneNumber;
  },

  // Format agent count display
  formatAgentCount(count, label = 'agents') {
    if (count === 0) return `No ${label}`;
    if (count === 1) return `1 ${label.slice(0, -1)}`;
    return `${count} ${label}`;
  },

  // Format last updated time
  formatLastUpdated(timestamp) {
    if (!timestamp) return '';
    
    const now = new Date();
    const updated = new Date(timestamp);
    const diffSeconds = Math.floor((now - updated) / 1000);
    
    if (diffSeconds < 10) return 'Just now';
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    
    const diffHours = Math.floor(diffMinutes / 60);
    return `${diffHours}h ago`;
  }
};

// Make available globally
window.Formatters = Formatters;