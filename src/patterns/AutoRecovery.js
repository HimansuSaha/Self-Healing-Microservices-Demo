/**
 * Auto-Recovery Pattern Implementation
 * 
 * The Auto-Recovery pattern automatically detects failures and attempts
 * to recover from them without human intervention. It includes:
 * - Health monitoring and checks
 * - Exponential backoff retry mechanisms
 * - Automatic service restart capabilities
 * - Graceful degradation strategies
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

/**
 * Recovery states
 */
const RecoveryStates = {
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  RECOVERING: 'RECOVERING',
  FAILED: 'FAILED'
};

/**
 * Recovery strategies
 */
const RecoveryStrategies = {
  RETRY: 'RETRY',
  RESTART: 'RESTART',
  FAILOVER: 'FAILOVER',
  DEGRADE: 'DEGRADE'
};

/**
 * Auto-Recovery Implementation
 */
class AutoRecovery extends EventEmitter {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.name - Name of the recovery system
   * @param {number} options.maxRetries - Maximum retry attempts
   * @param {number} options.initialDelay - Initial retry delay (ms)
   * @param {number} options.maxDelay - Maximum retry delay (ms)
   * @param {number} options.backoffMultiplier - Exponential backoff multiplier
   * @param {number} options.healthCheckInterval - Health check interval (ms)
   * @param {number} options.failureThreshold - Failures before marking as unhealthy
   * @param {number} options.recoveryThreshold - Successes needed for recovery
   * @param {Function} options.healthCheck - Health check function
   * @param {Function} options.onRecover - Recovery action function
   */
  constructor(options = {}) {
    super();
    
    this.name = options.name || 'AutoRecovery';
    this.maxRetries = options.maxRetries || 3;
    this.initialDelay = options.initialDelay || 1000; // 1 second
    this.maxDelay = options.maxDelay || 30000; // 30 seconds
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.healthCheckInterval = options.healthCheckInterval || 5000; // 5 seconds
    this.failureThreshold = options.failureThreshold || 3;
    this.recoveryThreshold = options.recoveryThreshold || 2;
    this.healthCheck = options.healthCheck;
    this.onRecover = options.onRecover;
    
    // Recovery state
    this.state = RecoveryStates.HEALTHY;
    this.failureCount = 0;
    this.successCount = 0;
    this.retryCount = 0;
    this.lastHealthCheck = null;
    this.isRecovering = false;
    
    // Metrics
    this.metrics = {
      totalFailures: 0,
      totalRecoveries: 0,
      totalRetries: 0,
      averageRecoveryTime: 0,
      longestOutage: 0,
      currentOutageStart: null,
      healthCheckSuccesses: 0,
      healthCheckFailures: 0,
      stateHistory: []
    };
    
    // Recovery strategies registry
    this.strategies = new Map();
    this.registerDefaultStrategies();
    
    // Start health monitoring
    if (this.healthCheck) {
      this.startHealthMonitoring();
    }
    
    logger.info(`Auto-Recovery ${this.name} initialized`, {
      maxRetries: this.maxRetries,
      initialDelay: this.initialDelay,
      healthCheckInterval: this.healthCheckInterval
    });
  }
  
  /**
   * Execute a function with auto-recovery protection
   * @param {Function} fn - Function to execute
   * @param {...any} args - Arguments to pass to the function
   * @param {Object} options - Execution options
   * @returns {Promise<any>} - Result of the function execution
   */
  async executeWithRecovery(fn, ...args) {
    let attempt = 0;
    let lastError;
    
    while (attempt <= this.maxRetries) {
      try {
        const result = await fn(...args);
        
        // Success - reset counters and update state
        if (attempt > 0) {
          this.handleRecoverySuccess(attempt);
        }
        
        this.onSuccess();
        return result;
        
      } catch (error) {
        lastError = error;
        attempt++;
        this.metrics.totalRetries++;
        
        logger.warn(`Auto-Recovery ${this.name} attempt ${attempt} failed`, {
          error: error.message,
          remainingAttempts: this.maxRetries - attempt
        });
        
        if (attempt <= this.maxRetries) {
          const delay = this.calculateDelay(attempt);
          await this.delay(delay);
        }
      }
    }
    
    // All retries exhausted
    this.handleFailure(lastError);
    throw lastError;
  }
  
  /**
   * Calculate exponential backoff delay
   * @private
   */
  calculateDelay(attempt) {
    const delay = Math.min(
      this.initialDelay * Math.pow(this.backoffMultiplier, attempt - 1),
      this.maxDelay
    );
    
    // Add jitter to prevent thundering herd
    const jitter = delay * 0.1 * Math.random();
    return Math.floor(delay + jitter);
  }
  
  /**
   * Delay execution
   * @private
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Handle successful execution
   * @private
   */
  onSuccess() {
    this.successCount++;
    this.failureCount = 0;
    this.retryCount = 0;
    
    if (this.state !== RecoveryStates.HEALTHY && this.successCount >= this.recoveryThreshold) {
      this.setState(RecoveryStates.HEALTHY);
      this.endOutage();
    }
    
    this.emit('success', {
      name: this.name,
      successCount: this.successCount
    });
  }
  
  /**
   * Handle failure
   * @private
   */
  handleFailure(error) {
    this.failureCount++;
    this.successCount = 0;
    this.metrics.totalFailures++;
    
    if (this.failureCount >= this.failureThreshold) {
      this.setState(RecoveryStates.FAILED);
      this.startOutage();
    } else if (this.state === RecoveryStates.HEALTHY) {
      this.setState(RecoveryStates.DEGRADED);
    }
    
    this.emit('failure', {
      name: this.name,
      error: error.message,
      failureCount: this.failureCount
    });
    
    // Attempt recovery
    this.attemptRecovery(error);
  }
  
  /**
   * Handle successful recovery
   * @private
   */
  handleRecoverySuccess(attempts) {
    this.metrics.totalRecoveries++;
    const recoveryTime = Date.now() - (this.metrics.currentOutageStart || Date.now());
    this.updateAverageRecoveryTime(recoveryTime);
    
    logger.info(`Auto-Recovery ${this.name} successful after ${attempts} attempts`, {
      recoveryTime
    });
    
    this.emit('recoverySuccess', {
      name: this.name,
      attempts,
      recoveryTime
    });
  }
  
  /**
   * Start tracking outage
   * @private
   */
  startOutage() {
    if (!this.metrics.currentOutageStart) {
      this.metrics.currentOutageStart = Date.now();
    }
  }
  
  /**
   * End tracking outage
   * @private
   */
  endOutage() {
    if (this.metrics.currentOutageStart) {
      const outageTime = Date.now() - this.metrics.currentOutageStart;
      this.metrics.longestOutage = Math.max(this.metrics.longestOutage, outageTime);
      this.metrics.currentOutageStart = null;
    }
  }
  
  /**
   * Set recovery state
   * @private
   */
  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    
    this.metrics.stateHistory.push({
      state: newState,
      timestamp: new Date().toISOString(),
      failureCount: this.failureCount,
      successCount: this.successCount
    });
    
    // Keep only last 100 state changes
    if (this.metrics.stateHistory.length > 100) {
      this.metrics.stateHistory = this.metrics.stateHistory.slice(-100);
    }
    
    if (oldState !== newState) {
      logger.info(`Auto-Recovery ${this.name} state changed: ${oldState} -> ${newState}`);
      
      this.emit('stateChanged', {
        name: this.name,
        oldState,
        newState,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Attempt recovery using registered strategies
   * @private
   */
  async attemptRecovery(error) {
    if (this.isRecovering) {
      return; // Already recovering
    }
    
    this.isRecovering = true;
    this.setState(RecoveryStates.RECOVERING);
    
    try {
      // Try each recovery strategy
      for (const [strategyName, strategy] of this.strategies) {
        try {
          logger.info(`Auto-Recovery ${this.name} attempting strategy: ${strategyName}`);
          
          await strategy.execute(error, this);
          
          // Strategy succeeded
          logger.info(`Auto-Recovery ${this.name} strategy ${strategyName} completed`);
          break;
          
        } catch (strategyError) {
          logger.warn(`Auto-Recovery ${this.name} strategy ${strategyName} failed`, {
            error: strategyError.message
          });
        }
      }
    } finally {
      this.isRecovering = false;
    }
  }
  
  /**
   * Register default recovery strategies
   * @private
   */
  registerDefaultStrategies() {
    // Retry strategy
    this.registerStrategy(RecoveryStrategies.RETRY, {
      execute: async (error, recovery) => {
        // Already handled by executeWithRecovery
        await recovery.delay(1000);
      }
    });
    
    // Restart strategy
    this.registerStrategy(RecoveryStrategies.RESTART, {
      execute: async (error, recovery) => {
        if (recovery.onRecover) {
          await recovery.onRecover(error);
        }
      }
    });
    
    // Graceful degradation strategy
    this.registerStrategy(RecoveryStrategies.DEGRADE, {
      execute: async (error, recovery) => {
        recovery.setState(RecoveryStates.DEGRADED);
        recovery.emit('degraded', {
          name: recovery.name,
          reason: error.message
        });
      }
    });
  }
  
  /**
   * Register a recovery strategy
   * @param {string} name - Strategy name
   * @param {Object} strategy - Strategy implementation
   */
  registerStrategy(name, strategy) {
    this.strategies.set(name, strategy);
    
    logger.info(`Auto-Recovery ${this.name} registered strategy: ${name}`);
  }
  
  /**
   * Start health monitoring
   * @private
   */
  startHealthMonitoring() {
    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error(`Auto-Recovery ${this.name} health check error`, {
          error: error.message
        });
      }
    }, this.healthCheckInterval);
    
    logger.info(`Auto-Recovery ${this.name} health monitoring started`);
  }
  
  /**
   * Perform health check
   * @private
   */
  async performHealthCheck() {
    try {
      const healthResult = await this.healthCheck();
      this.metrics.healthCheckSuccesses++;
      this.lastHealthCheck = {
        timestamp: new Date().toISOString(),
        status: 'healthy',
        result: healthResult
      };
      
      // If we were unhealthy, this might indicate recovery
      if (this.state !== RecoveryStates.HEALTHY) {
        this.onSuccess();
      }
      
      this.emit('healthCheck', {
        name: this.name,
        status: 'healthy',
        result: healthResult
      });
      
    } catch (error) {
      this.metrics.healthCheckFailures++;
      this.lastHealthCheck = {
        timestamp: new Date().toISOString(),
        status: 'unhealthy',
        error: error.message
      };
      
      this.handleFailure(error);
      
      this.emit('healthCheck', {
        name: this.name,
        status: 'unhealthy',
        error: error.message
      });
    }
  }
  
  /**
   * Update average recovery time
   * @private
   */
  updateAverageRecoveryTime(recoveryTime) {
    if (this.metrics.averageRecoveryTime === 0) {
      this.metrics.averageRecoveryTime = recoveryTime;
    } else {
      this.metrics.averageRecoveryTime = 
        (this.metrics.averageRecoveryTime * 0.9) + (recoveryTime * 0.1);
    }
  }
  
  /**
   * Get current recovery status
   * @returns {Object} Current status and metrics
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      isRecovering: this.isRecovering,
      failureCount: this.failureCount,
      successCount: this.successCount,
      retryCount: this.retryCount,
      lastHealthCheck: this.lastHealthCheck,
      metrics: { ...this.metrics },
      config: {
        maxRetries: this.maxRetries,
        initialDelay: this.initialDelay,
        maxDelay: this.maxDelay,
        backoffMultiplier: this.backoffMultiplier,
        healthCheckInterval: this.healthCheckInterval,
        failureThreshold: this.failureThreshold,
        recoveryThreshold: this.recoveryThreshold
      }
    };
  }
  
  /**
   * Get recovery statistics
   * @returns {Object} Recovery statistics
   */
  getStats() {
    const currentOutage = this.metrics.currentOutageStart ? 
      Date.now() - this.metrics.currentOutageStart : 0;
    
    return {
      totalFailures: this.metrics.totalFailures,
      totalRecoveries: this.metrics.totalRecoveries,
      totalRetries: this.metrics.totalRetries,
      successRate: this.metrics.healthCheckSuccesses / 
        (this.metrics.healthCheckSuccesses + this.metrics.healthCheckFailures) * 100,
      averageRecoveryTime: this.metrics.averageRecoveryTime,
      longestOutage: this.metrics.longestOutage,
      currentOutage
    };
  }
  
  /**
   * Manually trigger recovery
   */
  async triggerRecovery() {
    logger.info(`Auto-Recovery ${this.name} manual recovery triggered`);
    
    const error = new Error('Manual recovery triggered');
    await this.attemptRecovery(error);
    
    this.emit('manualRecovery', {
      name: this.name,
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * Reset recovery state
   */
  reset() {
    this.failureCount = 0;
    this.successCount = 0;
    this.retryCount = 0;
    this.isRecovering = false;
    this.setState(RecoveryStates.HEALTHY);
    this.endOutage();
    
    logger.info(`Auto-Recovery ${this.name} state reset`);
    
    this.emit('reset', {
      name: this.name,
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * Cleanup resources
   */
  destroy() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    this.removeAllListeners();
    
    logger.info(`Auto-Recovery ${this.name} destroyed`);
  }
}

module.exports = {
  AutoRecovery,
  RecoveryStates,
  RecoveryStrategies
};
