/**
 * Circuit Breaker Pattern Implementation
 * 
 * The Circuit Breaker pattern prevents cascading failures by monitoring
 * service calls and "opening" the circuit when failures exceed a threshold.
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, circuit is "open", requests fail fast
 * - HALF_OPEN: Testing if service has recovered
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

/**
 * Circuit Breaker States
 */
const States = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

/**
 * Circuit Breaker Implementation
 */
class CircuitBreaker extends EventEmitter {
  /**
   * @param {Object} options - Configuration options
   * @param {number} options.failureThreshold - Number of failures before opening circuit
   * @param {number} options.resetTimeout - Time to wait before attempting recovery (ms)
   * @param {number} options.timeout - Request timeout (ms)
   * @param {number} options.monitoringPeriod - Period for monitoring window (ms)
   * @param {string} options.name - Name of the circuit breaker
   */
  constructor(options = {}) {
    super();
    
    this.name = options.name || 'CircuitBreaker';
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.timeout = options.timeout || 10000; // 10 seconds
    this.monitoringPeriod = options.monitoringPeriod || 60000; // 1 minute
    
    // Circuit breaker state
    this.state = States.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
    
    // Metrics tracking
    this.metrics = {
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      totalTimeouts: 0,
      totalCircuitBreakerOpens: 0,
      averageResponseTime: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      stateHistory: []
    };
    
    // Start monitoring
    this.startMonitoring();
    
    logger.info(`Circuit Breaker ${this.name} initialized`, {
      failureThreshold: this.failureThreshold,
      resetTimeout: this.resetTimeout,
      timeout: this.timeout
    });
  }
  
  /**
   * Execute a function with circuit breaker protection
   * @param {Function} fn - Function to execute
   * @param {...any} args - Arguments to pass to the function
   * @returns {Promise<any>} - Result of the function execution
   */
  async execute(fn, ...args) {
    const startTime = Date.now();
    this.metrics.totalRequests++;
    
    try {
      // Check if circuit is open
      if (this.state === States.OPEN) {
        if (Date.now() < this.nextAttempt) {
          throw new Error(`Circuit breaker ${this.name} is OPEN. Fast failing request.`);
        } else {
          // Time to test recovery
          this.setState(States.HALF_OPEN);
          logger.info(`Circuit breaker ${this.name} entering HALF_OPEN state for recovery test`);
        }
      }
      
      // Execute the function with timeout
      const result = await this.executeWithTimeout(fn, args);
      
      // Success - handle state transitions
      this.onSuccess(Date.now() - startTime);
      return result;
      
    } catch (error) {
      // Failure - handle state transitions
      this.onFailure(error, Date.now() - startTime);
      throw error;
    }
  }
  
  /**
   * Execute function with timeout
   * @private
   */
  async executeWithTimeout(fn, args) {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.metrics.totalTimeouts++;
        reject(new Error(`Circuit breaker ${this.name}: Request timeout after ${this.timeout}ms`));
      }, this.timeout);
      
      try {
        const result = await fn(...args);
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }
  
  /**
   * Handle successful execution
   * @private
   */
  onSuccess(responseTime) {
    this.failureCount = 0;
    this.successCount++;
    this.metrics.totalSuccesses++;
    this.metrics.lastSuccessTime = new Date().toISOString();
    this.updateAverageResponseTime(responseTime);
    
    if (this.state === States.HALF_OPEN) {
      this.setState(States.CLOSED);
      logger.info(`Circuit breaker ${this.name} recovered - closing circuit`);
    }
    
    this.emit('success', {
      name: this.name,
      responseTime,
      state: this.state
    });
  }
  
  /**
   * Handle failed execution
   * @private
   */
  onFailure(error, responseTime) {
    this.failureCount++;
    this.metrics.totalFailures++;
    this.metrics.lastFailureTime = new Date().toISOString();
    this.updateAverageResponseTime(responseTime);
    
    logger.warn(`Circuit breaker ${this.name} recorded failure`, {
      error: error.message,
      failureCount: this.failureCount,
      threshold: this.failureThreshold
    });
    
    if (this.failureCount >= this.failureThreshold) {
      this.openCircuit();
    }
    
    this.emit('failure', {
      name: this.name,
      error: error.message,
      failureCount: this.failureCount,
      state: this.state
    });
  }
  
  /**
   * Open the circuit breaker
   * @private
   */
  openCircuit() {
    this.setState(States.OPEN);
    this.nextAttempt = Date.now() + this.resetTimeout;
    this.metrics.totalCircuitBreakerOpens++;
    
    logger.error(`Circuit breaker ${this.name} OPENED - failing fast for ${this.resetTimeout}ms`, {
      failureCount: this.failureCount,
      nextAttempt: new Date(this.nextAttempt).toISOString()
    });
    
    this.emit('circuitOpened', {
      name: this.name,
      failureCount: this.failureCount,
      nextAttempt: this.nextAttempt
    });
  }
  
  /**
   * Set circuit breaker state
   * @private
   */
  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    
    this.metrics.stateHistory.push({
      state: newState,
      timestamp: new Date().toISOString(),
      failureCount: this.failureCount
    });
    
    // Keep only last 100 state changes
    if (this.metrics.stateHistory.length > 100) {
      this.metrics.stateHistory = this.metrics.stateHistory.slice(-100);
    }
    
    if (oldState !== newState) {
      this.emit('stateChanged', {
        name: this.name,
        oldState,
        newState,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Update average response time
   * @private
   */
  updateAverageResponseTime(responseTime) {
    if (this.metrics.averageResponseTime === 0) {
      this.metrics.averageResponseTime = responseTime;
    } else {
      // Simple moving average
      this.metrics.averageResponseTime = 
        (this.metrics.averageResponseTime * 0.9) + (responseTime * 0.1);
    }
  }
  
  /**
   * Start monitoring and cleanup
   * @private
   */
  startMonitoring() {
    this.monitoringInterval = setInterval(() => {
      this.emit('metrics', {
        name: this.name,
        state: this.state,
        metrics: { ...this.metrics },
        nextAttempt: this.nextAttempt
      });
    }, this.monitoringPeriod);
  }
  
  /**
   * Get current circuit breaker status
   * @returns {Object} Current status and metrics
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      nextAttempt: this.nextAttempt,
      metrics: { ...this.metrics },
      config: {
        failureThreshold: this.failureThreshold,
        resetTimeout: this.resetTimeout,
        timeout: this.timeout
      }
    };
  }
  
  /**
   * Manually reset the circuit breaker
   */
  reset() {
    this.failureCount = 0;
    this.successCount = 0;
    this.setState(States.CLOSED);
    
    logger.info(`Circuit breaker ${this.name} manually reset`);
    
    this.emit('reset', {
      name: this.name,
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * Cleanup resources
   */
  destroy() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    this.removeAllListeners();
    
    logger.info(`Circuit breaker ${this.name} destroyed`);
  }
}

module.exports = {
  CircuitBreaker,
  States
};
