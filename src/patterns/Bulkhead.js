/**
 * Bulkhead Pattern Implementation
 * 
 * The Bulkhead pattern isolates critical resources to prevent failures
 * in one area from affecting others. It's named after the watertight
 * compartments in ships that prevent the entire ship from sinking.
 * 
 * This implementation provides:
 * - Resource isolation through separate execution pools
 * - Configurable concurrency limits
 * - Queue management with timeouts
 * - Resource utilization monitoring
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

/**
 * Task status enumeration
 */
const TaskStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  TIMEOUT: 'TIMEOUT',
  REJECTED: 'REJECTED'
};

/**
 * Bulkhead Implementation
 * Provides resource isolation and concurrency control
 */
class Bulkhead extends EventEmitter {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.name - Name of the bulkhead
   * @param {number} options.maxConcurrent - Maximum concurrent executions
   * @param {number} options.maxQueueSize - Maximum queued tasks
   * @param {number} options.timeout - Task execution timeout (ms)
   * @param {number} options.queueTimeout - Queue waiting timeout (ms)
   */
  constructor(options = {}) {
    super();
    
    this.name = options.name || 'Bulkhead';
    this.maxConcurrent = options.maxConcurrent || 10;
    this.maxQueueSize = options.maxQueueSize || 100;
    this.timeout = options.timeout || 30000; // 30 seconds
    this.queueTimeout = options.queueTimeout || 60000; // 1 minute
    
    // Execution tracking
    this.runningTasks = new Map();
    this.taskQueue = [];
    this.currentConcurrency = 0;
    
    // Metrics
    this.metrics = {
      totalSubmitted: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalTimeout: 0,
      totalRejected: 0,
      averageExecutionTime: 0,
      averageQueueTime: 0,
      peakConcurrency: 0,
      peakQueueSize: 0,
      currentQueueSize: 0,
      currentConcurrency: 0
    };
    
    // Start monitoring
    this.startMonitoring();
    
    logger.info(`Bulkhead ${this.name} initialized`, {
      maxConcurrent: this.maxConcurrent,
      maxQueueSize: this.maxQueueSize,
      timeout: this.timeout
    });
  }
  
  /**
   * Execute a task with bulkhead protection
   * @param {Function} fn - Function to execute
   * @param {...any} args - Arguments to pass to the function
   * @param {Object} options - Execution options
   * @returns {Promise<any>} - Result of the function execution
   */
  async execute(fn, ...args) {
    const task = this.createTask(fn, args);
    
    this.metrics.totalSubmitted++;
    
    try {
      // Check if we can execute immediately
      if (this.currentConcurrency < this.maxConcurrent) {
        return await this.executeTask(task);
      }
      
      // Queue the task
      return await this.queueTask(task);
      
    } catch (error) {
      this.handleTaskFailure(task, error);
      throw error;
    }
  }
  
  /**
   * Create a task object
   * @private
   */
  createTask(fn, args) {
    return {
      id: this.generateTaskId(),
      fn,
      args,
      status: TaskStatus.PENDING,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      executionTime: 0,
      queueTime: 0
    };
  }
  
  /**
   * Generate unique task ID
   * @private
   */
  generateTaskId() {
    return `${this.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Execute a task immediately
   * @private
   */
  async executeTask(task) {
    this.currentConcurrency++;
    this.metrics.currentConcurrency = this.currentConcurrency;
    this.metrics.peakConcurrency = Math.max(this.metrics.peakConcurrency, this.currentConcurrency);
    
    task.status = TaskStatus.RUNNING;
    task.startedAt = Date.now();
    task.queueTime = task.startedAt - task.createdAt;
    
    this.runningTasks.set(task.id, task);
    
    logger.debug(`Bulkhead ${this.name} executing task ${task.id}`, {
      currentConcurrency: this.currentConcurrency,
      queueTime: task.queueTime
    });
    
    try {
      const result = await this.executeWithTimeout(task);
      this.handleTaskSuccess(task, result);
      return result;
    } catch (error) {
      this.handleTaskFailure(task, error);
      throw error;
    } finally {
      this.runningTasks.delete(task.id);
      this.currentConcurrency--;
      this.metrics.currentConcurrency = this.currentConcurrency;
      
      // Process next task in queue
      this.processQueue();
    }
  }
  
  /**
   * Execute task with timeout protection
   * @private
   */
  async executeWithTimeout(task) {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        task.status = TaskStatus.TIMEOUT;
        reject(new Error(`Bulkhead ${this.name}: Task ${task.id} timeout after ${this.timeout}ms`));
      }, this.timeout);
      
      try {
        const result = await task.fn(...task.args);
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }
  
  /**
   * Queue a task for later execution
   * @private
   */
  async queueTask(task) {
    if (this.taskQueue.length >= this.maxQueueSize) {
      const error = new Error(`Bulkhead ${this.name}: Queue is full (${this.maxQueueSize})`);
      task.status = TaskStatus.REJECTED;
      this.metrics.totalRejected++;
      throw error;
    }
    
    return new Promise((resolve, reject) => {
      task.resolve = resolve;
      task.reject = reject;
      
      // Set queue timeout
      task.queueTimeoutId = setTimeout(() => {
        this.removeFromQueue(task);
        task.status = TaskStatus.TIMEOUT;
        reject(new Error(`Bulkhead ${this.name}: Task ${task.id} queue timeout after ${this.queueTimeout}ms`));
      }, this.queueTimeout);
      
      this.taskQueue.push(task);
      this.metrics.currentQueueSize = this.taskQueue.length;
      this.metrics.peakQueueSize = Math.max(this.metrics.peakQueueSize, this.taskQueue.length);
      
      logger.debug(`Bulkhead ${this.name} queued task ${task.id}`, {
        queueSize: this.taskQueue.length,
        currentConcurrency: this.currentConcurrency
      });
      
      this.emit('taskQueued', {
        bulkhead: this.name,
        taskId: task.id,
        queueSize: this.taskQueue.length
      });
    });
  }
  
  /**
   * Process the next task in the queue
   * @private
   */
  async processQueue() {
    if (this.taskQueue.length === 0 || this.currentConcurrency >= this.maxConcurrent) {
      return;
    }
    
    const task = this.taskQueue.shift();
    this.metrics.currentQueueSize = this.taskQueue.length;
    
    if (task.queueTimeoutId) {
      clearTimeout(task.queueTimeoutId);
    }
    
    try {
      const result = await this.executeTask(task);
      task.resolve(result);
    } catch (error) {
      task.reject(error);
    }
  }
  
  /**
   * Remove task from queue
   * @private
   */
  removeFromQueue(task) {
    const index = this.taskQueue.findIndex(t => t.id === task.id);
    if (index !== -1) {
      this.taskQueue.splice(index, 1);
      this.metrics.currentQueueSize = this.taskQueue.length;
    }
  }
  
  /**
   * Handle successful task completion
   * @private
   */
  handleTaskSuccess(task, result) {
    task.status = TaskStatus.COMPLETED;
    task.completedAt = Date.now();
    task.executionTime = task.completedAt - task.startedAt;
    
    this.metrics.totalCompleted++;
    this.updateAverageExecutionTime(task.executionTime);
    this.updateAverageQueueTime(task.queueTime);
    
    logger.debug(`Bulkhead ${this.name} task ${task.id} completed`, {
      executionTime: task.executionTime,
      queueTime: task.queueTime
    });
    
    this.emit('taskCompleted', {
      bulkhead: this.name,
      taskId: task.id,
      executionTime: task.executionTime,
      queueTime: task.queueTime
    });
  }
  
  /**
   * Handle task failure
   * @private
   */
  handleTaskFailure(task, error) {
    task.status = TaskStatus.FAILED;
    task.completedAt = Date.now();
    task.executionTime = task.startedAt ? task.completedAt - task.startedAt : 0;
    
    if (error.message.includes('timeout')) {
      this.metrics.totalTimeout++;
    } else {
      this.metrics.totalFailed++;
    }
    
    if (task.startedAt) {
      this.updateAverageExecutionTime(task.executionTime);
    }
    this.updateAverageQueueTime(task.queueTime);
    
    logger.warn(`Bulkhead ${this.name} task ${task.id} failed`, {
      error: error.message,
      executionTime: task.executionTime,
      queueTime: task.queueTime
    });
    
    this.emit('taskFailed', {
      bulkhead: this.name,
      taskId: task.id,
      error: error.message,
      executionTime: task.executionTime,
      queueTime: task.queueTime
    });
  }
  
  /**
   * Update average execution time
   * @private
   */
  updateAverageExecutionTime(executionTime) {
    if (this.metrics.averageExecutionTime === 0) {
      this.metrics.averageExecutionTime = executionTime;
    } else {
      this.metrics.averageExecutionTime = 
        (this.metrics.averageExecutionTime * 0.9) + (executionTime * 0.1);
    }
  }
  
  /**
   * Update average queue time
   * @private
   */
  updateAverageQueueTime(queueTime) {
    if (this.metrics.averageQueueTime === 0) {
      this.metrics.averageQueueTime = queueTime;
    } else {
      this.metrics.averageQueueTime = 
        (this.metrics.averageQueueTime * 0.9) + (queueTime * 0.1);
    }
  }
  
  /**
   * Start monitoring
   * @private
   */
  startMonitoring() {
    this.monitoringInterval = setInterval(() => {
      this.emit('metrics', {
        name: this.name,
        metrics: { ...this.metrics },
        config: {
          maxConcurrent: this.maxConcurrent,
          maxQueueSize: this.maxQueueSize,
          timeout: this.timeout
        }
      });
    }, 10000); // Every 10 seconds
  }
  
  /**
   * Get current bulkhead status
   * @returns {Object} Current status and metrics
   */
  getStatus() {
    return {
      name: this.name,
      currentConcurrency: this.currentConcurrency,
      queueSize: this.taskQueue.length,
      runningTasks: Array.from(this.runningTasks.keys()),
      metrics: { ...this.metrics },
      config: {
        maxConcurrent: this.maxConcurrent,
        maxQueueSize: this.maxQueueSize,
        timeout: this.timeout,
        queueTimeout: this.queueTimeout
      }
    };
  }
  
  /**
   * Get resource utilization percentage
   * @returns {Object} Utilization metrics
   */
  getUtilization() {
    return {
      concurrencyUtilization: (this.currentConcurrency / this.maxConcurrent) * 100,
      queueUtilization: (this.taskQueue.length / this.maxQueueSize) * 100,
      isAtCapacity: this.currentConcurrency >= this.maxConcurrent,
      isQueueFull: this.taskQueue.length >= this.maxQueueSize
    };
  }
  
  /**
   * Clear the task queue (emergency operation)
   */
  clearQueue() {
    const clearedTasks = this.taskQueue.length;
    
    // Reject all queued tasks
    this.taskQueue.forEach(task => {
      if (task.queueTimeoutId) {
        clearTimeout(task.queueTimeoutId);
      }
      task.reject(new Error(`Bulkhead ${this.name}: Queue cleared`));
    });
    
    this.taskQueue = [];
    this.metrics.currentQueueSize = 0;
    
    logger.warn(`Bulkhead ${this.name} queue cleared`, { clearedTasks });
    
    this.emit('queueCleared', {
      bulkhead: this.name,
      clearedTasks
    });
  }
  
  /**
   * Cleanup resources
   */
  destroy() {
    // Clear monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    // Clear queue
    this.clearQueue();
    
    // Cancel running tasks (if possible)
    this.runningTasks.forEach(task => {
      logger.warn(`Bulkhead ${this.name} destroying - task ${task.id} may be interrupted`);
    });
    
    this.removeAllListeners();
    
    logger.info(`Bulkhead ${this.name} destroyed`);
  }
}

module.exports = {
  Bulkhead,
  TaskStatus
};
