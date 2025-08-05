/**
 * API Gateway Service
 * 
 * This service acts as the entry point to the microservices system
 * and demonstrates all three self-healing patterns:
 * - Circuit Breakers for each downstream service
 * - Bulkheads for resource isolation
 * - Auto-Recovery mechanisms
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const { CircuitBreaker } = require('../patterns/CircuitBreaker');
const { Bulkhead } = require('../patterns/Bulkhead');
const { AutoRecovery } = require('../patterns/AutoRecovery');
const config = require('../config');
const logger = require('../utils/logger');

class ApiGateway {
  constructor() {
    this.app = express();
    this.config = config.getServiceConfig('gateway');
    this.logger = logger.createChild({ service: 'api-gateway' });
    
    // Pattern instances
    this.circuitBreakers = new Map();
    this.bulkheads = new Map();
    this.recoveryManagers = new Map();
    
    // Metrics
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      routeMetrics: new Map()
    };
    
    this.setupMiddleware();
    this.setupPatterns();
    this.setupRoutes();
    this.setupErrorHandling();
  }
  
  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // Security middleware
    this.app.use(helmet());
    this.app.use(cors({
      origin: this.config.security.corsOrigin,
      credentials: true
    }));
    
    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    
    // Request logging and metrics
    this.app.use((req, res, next) => {
      req.id = uuidv4();
      req.startTime = Date.now();
      
      this.logger.info('Incoming request', {
        requestId: req.id,
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
      
      // Response logging
      const originalSend = res.send;
      res.send = function(data) {
        const duration = Date.now() - req.startTime;
        
        // Update metrics
        this.updateMetrics(req, res, duration);
        
        this.logger.request(req, res, duration);
        
        return originalSend.call(this, data);
      }.bind(this);
      
      next();
    });
  }
  
  /**
   * Setup self-healing patterns for each service
   */
  setupPatterns() {
    const services = ['user', 'order', 'payment', 'notification'];
    
    services.forEach(serviceName => {
      // Circuit Breaker for each service
      const circuitBreaker = new CircuitBreaker({
        name: `${serviceName}-service`,
        failureThreshold: this.config.circuitBreaker.failureThreshold,
        resetTimeout: this.config.circuitBreaker.resetTimeout,
        timeout: this.config.circuitBreaker.timeout,
        monitoringPeriod: this.config.circuitBreaker.monitoringPeriod
      });
      
      // Bulkhead for resource isolation
      const bulkhead = new Bulkhead({
        name: `${serviceName}-bulkhead`,
        maxConcurrent: this.config.bulkhead.maxConcurrent,
        maxQueueSize: this.config.bulkhead.maxQueueSize,
        timeout: this.config.bulkhead.timeout,
        queueTimeout: this.config.bulkhead.queueTimeout
      });
      
      // Auto-Recovery manager
      const recovery = new AutoRecovery({
        name: `${serviceName}-recovery`,
        maxRetries: this.config.autoRecovery.maxRetries,
        initialDelay: this.config.autoRecovery.initialDelay,
        maxDelay: this.config.autoRecovery.maxDelay,
        backoffMultiplier: this.config.autoRecovery.backoffMultiplier,
        healthCheckInterval: this.config.autoRecovery.healthCheckInterval,
        failureThreshold: this.config.autoRecovery.failureThreshold,
        recoveryThreshold: this.config.autoRecovery.recoveryThreshold,
        healthCheck: () => this.performHealthCheck(serviceName),
        onRecover: (error) => this.performRecovery(serviceName, error)
      });
      
      this.circuitBreakers.set(serviceName, circuitBreaker);
      this.bulkheads.set(serviceName, bulkhead);
      this.recoveryManagers.set(serviceName, recovery);
      
      // Setup event listeners for monitoring
      this.setupPatternListeners(serviceName, circuitBreaker, bulkhead, recovery);
    });
  }
  
  /**
   * Setup event listeners for pattern monitoring
   */
  setupPatternListeners(serviceName, circuitBreaker, bulkhead, recovery) {
    // Circuit Breaker events
    circuitBreaker.on('circuitOpened', (data) => {
      this.logger.circuitBreaker('opened', data);
    });
    
    circuitBreaker.on('stateChanged', (data) => {
      this.logger.circuitBreaker('stateChanged', data);
    });
    
    // Bulkhead events
    bulkhead.on('taskQueued', (data) => {
      this.logger.bulkhead('taskQueued', data);
    });
    
    bulkhead.on('taskFailed', (data) => {
      this.logger.bulkhead('taskFailed', data);
    });
    
    // Recovery events
    recovery.on('stateChanged', (data) => {
      this.logger.recovery('stateChanged', data);
    });
    
    recovery.on('recoverySuccess', (data) => {
      this.logger.recovery('recoverySuccess', data);
    });
  }
  
  /**
   * Setup API routes
   */
  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'api-gateway',
        version: this.config.service.version,
        uptime: process.uptime(),
        patterns: {
          circuitBreakers: this.getCircuitBreakerStatus(),
          bulkheads: this.getBulkheadStatus(),
          recovery: this.getRecoveryStatus()
        }
      });
    });
    
    // Metrics endpoint
    this.app.get('/metrics', (req, res) => {
      res.json({
        metrics: this.metrics,
        patterns: {
          circuitBreakers: this.getCircuitBreakerMetrics(),
          bulkheads: this.getBulkheadMetrics(),
          recovery: this.getRecoveryMetrics()
        }
      });
    });
    
    // User service routes
    this.app.get('/api/users/:id', (req, res, next) => {
      this.proxyRequest('user', 'GET', `/users/${req.params.id}`, null, req, res, next);
    });
    
    this.app.post('/api/users', (req, res, next) => {
      this.proxyRequest('user', 'POST', '/users', req.body, req, res, next);
    });
    
    // Order service routes
    this.app.get('/api/orders/:id', (req, res, next) => {
      this.proxyRequest('order', 'GET', `/orders/${req.params.id}`, null, req, res, next);
    });
    
    this.app.post('/api/orders', (req, res, next) => {
      this.proxyRequest('order', 'POST', '/orders', req.body, req, res, next);
    });
    
    // Payment service routes
    this.app.post('/api/payments', (req, res, next) => {
      this.proxyRequest('payment', 'POST', '/payments', req.body, req, res, next);
    });
    
    // Notification service routes
    this.app.post('/api/notifications', (req, res, next) => {
      this.proxyRequest('notification', 'POST', '/notifications', req.body, req, res, next);
    });
    
    // Demo and testing routes
    this.setupDemoRoutes();
    
    // Pattern status routes
    this.setupPatternRoutes();
  }
  
  /**
   * Setup demo routes for testing patterns
   */
  setupDemoRoutes() {
    // Simulate payment failures
    this.app.post('/api/simulate/payment-failure', (req, res) => {
      this.logger.info('Simulating payment service failures');
      // This would typically set a flag to make payment service fail
      res.json({ message: 'Payment service failure simulation started' });
    });
    
    // Simulate high load
    this.app.post('/api/simulate/high-load', (req, res) => {
      this.logger.info('Simulating high load scenario');
      // Generate multiple concurrent requests
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          this.proxyRequest('order', 'GET', `/orders/${i}`, null, req, res, () => {})
            .catch(() => {}) // Ignore errors for demo
        );
      }
      
      Promise.allSettled(promises).then(() => {
        res.json({ message: 'High load simulation completed' });
      });
    });
    
    // Reset all patterns
    this.app.post('/api/reset-patterns', (req, res) => {
      this.circuitBreakers.forEach(cb => cb.reset());
      this.bulkheads.forEach(bh => bh.clearQueue());
      this.recoveryManagers.forEach(rm => rm.reset());
      
      this.logger.info('All patterns reset');
      res.json({ message: 'All patterns have been reset' });
    });
  }
  
  /**
   * Setup pattern status routes
   */
  setupPatternRoutes() {
    // Circuit breaker status
    this.app.get('/api/patterns/circuit-breakers', (req, res) => {
      res.json(this.getCircuitBreakerStatus());
    });
    
    // Bulkhead status
    this.app.get('/api/patterns/bulkheads', (req, res) => {
      res.json(this.getBulkheadStatus());
    });
    
    // Recovery status
    this.app.get('/api/patterns/recovery', (req, res) => {
      res.json(this.getRecoveryStatus());
    });
  }
  
  /**
   * Proxy request to downstream service with all patterns applied
   */
  async proxyRequest(serviceName, method, path, data, req, res, next) {
    const circuitBreaker = this.circuitBreakers.get(serviceName);
    const bulkhead = this.bulkheads.get(serviceName);
    const recovery = this.recoveryManagers.get(serviceName);
    
    try {
      // Apply bulkhead first (resource isolation)
      const result = await bulkhead.execute(async () => {
        // Apply circuit breaker (failure detection)
        return await circuitBreaker.execute(async () => {
          // Apply auto-recovery (retry logic)
          return await recovery.executeWithRecovery(async () => {
            return await this.makeHttpRequest(serviceName, method, path, data, req);
          });
        });
      });
      
      res.json(result);
      
    } catch (error) {
      this.logger.error('Request failed after all patterns applied', {
        serviceName,
        method,
        path,
        error: error.message,
        requestId: req.id
      });
      
      // Return graceful error response
      res.status(503).json({
        error: 'Service temporarily unavailable',
        message: 'The request could not be completed due to service issues',
        serviceName,
        requestId: req.id,
        retryAfter: 30 // seconds
      });
    }
  }
  
  /**
   * Make HTTP request to downstream service
   */
  async makeHttpRequest(serviceName, method, path, data, req) {
    const serviceUrl = this.config.services[serviceName].url;
    const url = `${serviceUrl}${path}`;
    
    const requestConfig = {
      method,
      url,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': req.id,
        'X-Forwarded-For': req.ip,
        'User-Agent': req.get('User-Agent')
      },
      timeout: this.config.circuitBreaker.timeout
    };
    
    if (data) {
      requestConfig.data = data;
    }
    
    this.logger.debug('Making downstream request', {
      serviceName,
      method,
      url,
      requestId: req.id
    });
    
    const response = await axios(requestConfig);
    return response.data;
  }
  
  /**
   * Perform health check on a service
   */
  async performHealthCheck(serviceName) {
    const serviceUrl = this.config.services[serviceName].url;
    const response = await axios.get(`${serviceUrl}/health`, {
      timeout: 5000
    });
    return response.data;
  }
  
  /**
   * Perform recovery action for a service
   */
  async performRecovery(serviceName, error) {
    this.logger.info(`Performing recovery for ${serviceName}`, {
      error: error.message
    });
    
    // In a real implementation, this might:
    // - Restart the service
    // - Clear caches
    // - Reset connections
    // - Switch to backup service
    
    // For demo purposes, we just log the recovery attempt
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    this.logger.info(`Recovery completed for ${serviceName}`);
  }
  
  /**
   * Update request metrics
   */
  updateMetrics(req, res, duration) {
    this.metrics.totalRequests++;
    
    if (res.statusCode < 400) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }
    
    // Update average response time
    if (this.metrics.averageResponseTime === 0) {
      this.metrics.averageResponseTime = duration;
    } else {
      this.metrics.averageResponseTime = 
        (this.metrics.averageResponseTime * 0.9) + (duration * 0.1);
    }
    
    // Update route-specific metrics
    const route = `${req.method} ${req.route ? req.route.path : req.url}`;
    if (!this.metrics.routeMetrics.has(route)) {
      this.metrics.routeMetrics.set(route, {
        count: 0,
        successCount: 0,
        failureCount: 0,
        averageResponseTime: 0
      });
    }
    
    const routeMetric = this.metrics.routeMetrics.get(route);
    routeMetric.count++;
    
    if (res.statusCode < 400) {
      routeMetric.successCount++;
    } else {
      routeMetric.failureCount++;
    }
    
    if (routeMetric.averageResponseTime === 0) {
      routeMetric.averageResponseTime = duration;
    } else {
      routeMetric.averageResponseTime = 
        (routeMetric.averageResponseTime * 0.9) + (duration * 0.1);
    }
  }
  
  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus() {
    const status = {};
    this.circuitBreakers.forEach((cb, name) => {
      status[name] = cb.getStatus();
    });
    return status;
  }
  
  /**
   * Get bulkhead status
   */
  getBulkheadStatus() {
    const status = {};
    this.bulkheads.forEach((bh, name) => {
      status[name] = bh.getStatus();
    });
    return status;
  }
  
  /**
   * Get recovery status
   */
  getRecoveryStatus() {
    const status = {};
    this.recoveryManagers.forEach((rm, name) => {
      status[name] = rm.getStatus();
    });
    return status;
  }
  
  /**
   * Get circuit breaker metrics
   */
  getCircuitBreakerMetrics() {
    const metrics = {};
    this.circuitBreakers.forEach((cb, name) => {
      metrics[name] = cb.getStatus().metrics;
    });
    return metrics;
  }
  
  /**
   * Get bulkhead metrics
   */
  getBulkheadMetrics() {
    const metrics = {};
    this.bulkheads.forEach((bh, name) => {
      metrics[name] = bh.getStatus().metrics;
    });
    return metrics;
  }
  
  /**
   * Get recovery metrics
   */
  getRecoveryMetrics() {
    const metrics = {};
    this.recoveryManagers.forEach((rm, name) => {
      metrics[name] = rm.getStats();
    });
    return metrics;
  }
  
  /**
   * Setup error handling middleware
   */
  setupErrorHandling() {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.url} not found`,
        timestamp: new Date().toISOString()
      });
    });
    
    // Global error handler
    this.app.use((err, req, res, next) => {
      this.logger.error('Unhandled error', {
        error: err.message,
        stack: err.stack,
        requestId: req.id,
        url: req.url,
        method: req.method
      });
      
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
        requestId: req.id,
        timestamp: new Date().toISOString()
      });
    });
  }
  
  /**
   * Start the gateway server
   */
  start() {
    const port = this.config.port;
    const host = this.config.host;
    
    this.server = this.app.listen(port, host, () => {
      this.logger.info('API Gateway started', {
        port,
        host,
        environment: this.config.env,
        patterns: {
          circuitBreakers: this.circuitBreakers.size,
          bulkheads: this.bulkheads.size,
          recoveryManagers: this.recoveryManagers.size
        }
      });
    });
    
    // Graceful shutdown
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }
  
  /**
   * Graceful shutdown
   */
  async shutdown() {
    this.logger.info('Starting graceful shutdown...');
    
    // Stop accepting new connections
    this.server.close(() => {
      this.logger.info('HTTP server closed');
    });
    
    // Cleanup patterns
    this.circuitBreakers.forEach(cb => cb.destroy());
    this.bulkheads.forEach(bh => bh.destroy());
    this.recoveryManagers.forEach(rm => rm.destroy());
    
    this.logger.info('Graceful shutdown completed');
    process.exit(0);
  }
}

// Start the gateway if this file is run directly
if (require.main === module) {
  const gateway = new ApiGateway();
  gateway.start();
}

module.exports = ApiGateway;
