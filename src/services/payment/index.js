/**
 * Payment Service
 * 
 * A microservice that handles payment operations and is designed to fail
 * frequently for demonstration purposes. This service showcases how
 * circuit breakers and auto-recovery patterns handle unreliable services.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { AutoRecovery } = require('../../patterns/AutoRecovery');
const config = require('../../config');
const logger = require('../../utils/logger');

class PaymentService {
  constructor() {
    this.app = express();
    this.config = config.getServiceConfig('payment');
    this.logger = logger.createChild({ service: 'payment-service' });
    
    // Payment storage (for demo purposes)
    this.payments = new Map();
    this.isHealthy = true;
    this.failureRate = this.config.demo.failureRate * 2; // Higher failure rate for demo
    this.consecutiveFailures = 0;
    this.maxConsecutiveFailures = 8; // Will cause circuit breaker to open
    
    // Auto-recovery setup
    this.recovery = new AutoRecovery({
      name: 'payment-service-recovery',
      maxRetries: this.config.autoRecovery.maxRetries,
      initialDelay: this.config.autoRecovery.initialDelay,
      maxDelay: this.config.autoRecovery.maxDelay,
      backoffMultiplier: this.config.autoRecovery.backoffMultiplier,
      healthCheckInterval: this.config.autoRecovery.healthCheckInterval,
      failureThreshold: this.config.autoRecovery.failureThreshold,
      recoveryThreshold: this.config.autoRecovery.recoveryThreshold,
      healthCheck: () => this.performHealthCheck(),
      onRecover: (error) => this.performRecovery(error)
    });
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupRecoveryPatterns();
    this.startFailureSimulation();
  }
  
  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    this.app.use(express.json());
    
    // Request logging
    this.app.use((req, res, next) => {
      req.id = req.get('X-Request-ID') || uuidv4();
      req.startTime = Date.now();
      
      this.logger.info('Payment service request', {
        requestId: req.id,
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        forwardedFor: req.get('X-Forwarded-For')
      });
      
      next();
    });
  }
  
  /**
   * Setup API routes
   */
  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', async (req, res) => {
      try {
        const healthStatus = await this.performHealthCheck();
        res.json({
          status: 'healthy',
          service: 'payment-service',
          timestamp: new Date().toISOString(),
          details: healthStatus,
          recovery: this.recovery.getStatus(),
          failureRate: this.failureRate,
          consecutiveFailures: this.consecutiveFailures
        });
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          service: 'payment-service',
          timestamp: new Date().toISOString(),
          error: error.message,
          recovery: this.recovery.getStatus(),
          failureRate: this.failureRate,
          consecutiveFailures: this.consecutiveFailures
        });
      }
    });
    
    // Process payment
    this.app.post('/payments', async (req, res) => {
      try {
        const result = await this.executeWithRecovery(async () => {
          return await this.processPayment(req.body);
        });
        
        res.status(201).json(result);
        
      } catch (error) {
        this.logger.error('Failed to process payment', {
          paymentData: this.sanitizePaymentData(req.body),
          error: error.message,
          requestId: req.id
        });
        
        res.status(error.statusCode || 500).json({
          error: error.message,
          requestId: req.id,
          timestamp: new Date().toISOString(),
          retryable: error.retryable !== false
        });
      }
    });
    
    // Get payment status
    this.app.get('/payments/:id', async (req, res) => {
      try {
        const result = await this.executeWithRecovery(async () => {
          return await this.getPayment(req.params.id);
        });
        
        res.json(result);
        
      } catch (error) {
        this.logger.error('Failed to get payment', {
          paymentId: req.params.id,
          error: error.message,
          requestId: req.id
        });
        
        res.status(error.statusCode || 500).json({
          error: error.message,
          requestId: req.id,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    // Refund payment
    this.app.post('/payments/:id/refund', async (req, res) => {
      try {
        const result = await this.executeWithRecovery(async () => {
          return await this.refundPayment(req.params.id, req.body);
        });
        
        res.json(result);
        
      } catch (error) {
        this.logger.error('Failed to refund payment', {
          paymentId: req.params.id,
          refundData: req.body,
          error: error.message,
          requestId: req.id
        });
        
        res.status(error.statusCode || 500).json({
          error: error.message,
          requestId: req.id,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    // Demo endpoints for testing patterns
    this.app.post('/simulate/failure-rate', (req, res) => {
      const { rate } = req.body;
      this.failureRate = Math.max(0, Math.min(1, rate || 0.5));
      
      this.logger.warn('Payment service failure rate changed', {
        newRate: this.failureRate
      });
      
      res.json({ 
        message: 'Failure rate updated',
        failureRate: this.failureRate 
      });
    });
    
    this.app.post('/simulate/recovery', (req, res) => {
      this.consecutiveFailures = 0;
      this.isHealthy = true;
      this.recovery.reset();
      
      this.logger.info('Payment service recovery simulation triggered');
      res.json({ message: 'Recovery simulation triggered' });
    });
    
    this.app.post('/simulate/catastrophic-failure', (req, res) => {
      this.failureRate = 1.0; // 100% failure rate
      this.isHealthy = false;
      this.consecutiveFailures = this.maxConsecutiveFailures;
      
      this.logger.error('Payment service catastrophic failure simulation started');
      
      // Auto-recover after 2 minutes
      setTimeout(() => {
        this.failureRate = this.config.demo.failureRate;
        this.consecutiveFailures = 0;
        this.isHealthy = true;
        this.logger.info('Payment service catastrophic failure simulation ended');
      }, 120000);
      
      res.json({ message: 'Catastrophic failure simulation started' });
    });
  }
  
  /**
   * Setup auto-recovery patterns
   */
  setupRecoveryPatterns() {
    // Listen to recovery events
    this.recovery.on('stateChanged', (data) => {
      this.logger.recovery('stateChanged', data);
    });
    
    this.recovery.on('recoverySuccess', (data) => {
      this.logger.recovery('recoverySuccess', data);
      this.consecutiveFailures = Math.max(0, this.consecutiveFailures - 1);
    });
    
    this.recovery.on('failure', (data) => {
      this.logger.recovery('failure', data);
      this.consecutiveFailures++;
    });
  }
  
  /**
   * Start failure simulation patterns
   */
  startFailureSimulation() {
    // Periodically cause failures to demonstrate patterns
    setInterval(() => {
      if (this.consecutiveFailures > 0) {
        this.consecutiveFailures = Math.max(0, this.consecutiveFailures - 1);
      }
      
      // Randomly adjust health status
      if (Math.random() < 0.1) { // 10% chance
        this.isHealthy = !this.isHealthy;
        this.logger.info('Payment service health status changed', {
          isHealthy: this.isHealthy
        });
      }
    }, 10000); // Every 10 seconds
  }
  
  /**
   * Execute operation with recovery
   */
  async executeWithRecovery(operation) {
    return await this.recovery.executeWithRecovery(operation);
  }
  
  /**
   * Process payment
   */
  async processPayment(paymentData) {
    await this.simulateProcessingTime();
    this.checkForSimulatedFailures();
    
    // Validate payment data
    this.validatePaymentData(paymentData);
    
    // Simulate payment processing
    const payment = {
      id: uuidv4(),
      amount: paymentData.amount,
      currency: paymentData.currency || 'USD',
      method: paymentData.method,
      merchantId: paymentData.merchantId,
      orderId: paymentData.orderId,
      status: 'processing',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // Simulate different payment outcomes
    const outcome = this.simulatePaymentOutcome();
    
    if (outcome === 'success') {
      payment.status = 'completed';
      payment.transactionId = uuidv4();
      payment.processedAt = new Date().toISOString();
      
      this.consecutiveFailures = Math.max(0, this.consecutiveFailures - 1);
      
    } else if (outcome === 'failure') {
      payment.status = 'failed';
      payment.failureReason = this.getRandomFailureReason();
      
      this.consecutiveFailures++;
      
      const error = new Error(`Payment failed: ${payment.failureReason}`);
      error.statusCode = 402;
      error.retryable = payment.failureReason !== 'insufficient_funds';
      throw error;
      
    } else {
      // Pending state
      payment.status = 'pending';
      
      // Simulate async completion
      setTimeout(() => {
        payment.status = Math.random() < 0.8 ? 'completed' : 'failed';
        payment.updatedAt = new Date().toISOString();
        
        if (payment.status === 'completed') {
          payment.transactionId = uuidv4();
          payment.processedAt = new Date().toISOString();
        } else {
          payment.failureReason = this.getRandomFailureReason();
        }
        
        this.payments.set(payment.id, payment);
        
        this.logger.info('Async payment completed', {
          paymentId: payment.id,
          status: payment.status
        });
      }, Math.random() * 5000 + 1000); // 1-6 seconds
    }
    
    this.payments.set(payment.id, payment);
    
    this.logger.info('Payment processed', {
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      orderId: payment.orderId
    });
    
    return {
      payment: this.sanitizePaymentResponse(payment),
      message: 'Payment processed successfully'
    };
  }
  
  /**
   * Get payment by ID
   */
  async getPayment(paymentId) {
    await this.simulateProcessingTime();
    this.checkForSimulatedFailures();
    
    if (!this.payments.has(paymentId)) {
      const error = new Error(`Payment with ID ${paymentId} not found`);
      error.statusCode = 404;
      throw error;
    }
    
    const payment = this.payments.get(paymentId);
    
    this.logger.info('Payment retrieved', {
      paymentId: payment.id,
      status: payment.status,
      amount: payment.amount
    });
    
    return {
      payment: this.sanitizePaymentResponse(payment),
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Refund payment
   */
  async refundPayment(paymentId, refundData) {
    await this.simulateProcessingTime();
    this.checkForSimulatedFailures();
    
    if (!this.payments.has(paymentId)) {
      const error = new Error(`Payment with ID ${paymentId} not found`);
      error.statusCode = 404;
      throw error;
    }
    
    const payment = this.payments.get(paymentId);
    
    if (payment.status !== 'completed') {
      const error = new Error('Can only refund completed payments');
      error.statusCode = 400;
      throw error;
    }
    
    const refundAmount = refundData.amount || payment.amount;
    
    if (refundAmount > payment.amount) {
      const error = new Error('Refund amount cannot exceed payment amount');
      error.statusCode = 400;
      throw error;
    }
    
    const refund = {
      id: uuidv4(),
      paymentId: payment.id,
      amount: refundAmount,
      currency: payment.currency,
      reason: refundData.reason || 'Customer request',
      status: 'processing',
      createdAt: new Date().toISOString()
    };
    
    // Simulate refund outcome
    if (Math.random() < 0.9) { // 90% success rate for refunds
      refund.status = 'completed';
      refund.processedAt = new Date().toISOString();
      refund.refundTransactionId = uuidv4();
      
      // Update original payment
      payment.refundedAmount = (payment.refundedAmount || 0) + refundAmount;
      payment.updatedAt = new Date().toISOString();
      
      if (payment.refundedAmount >= payment.amount) {
        payment.status = 'refunded';
      }
      
      this.payments.set(paymentId, payment);
      
    } else {
      refund.status = 'failed';
      refund.failureReason = 'Refund processing failed';
      
      const error = new Error('Refund processing failed');
      error.statusCode = 502;
      error.retryable = true;
      throw error;
    }
    
    this.logger.info('Payment refund processed', {
      paymentId: payment.id,
      refundId: refund.id,
      refundAmount: refund.amount,
      refundStatus: refund.status
    });
    
    return {
      refund,
      payment: this.sanitizePaymentResponse(payment),
      message: 'Refund processed successfully'
    };
  }
  
  /**
   * Validate payment data
   */
  validatePaymentData(paymentData) {
    if (!paymentData.amount || paymentData.amount <= 0) {
      const error = new Error('Invalid payment amount');
      error.statusCode = 400;
      throw error;
    }
    
    if (!paymentData.method) {
      const error = new Error('Payment method is required');
      error.statusCode = 400;
      throw error;
    }
    
    if (!paymentData.merchantId) {
      const error = new Error('Merchant ID is required');
      error.statusCode = 400;
      throw error;
    }
    
    const validMethods = ['credit_card', 'debit_card', 'paypal', 'bank_transfer'];
    if (!validMethods.includes(paymentData.method)) {
      const error = new Error('Invalid payment method');
      error.statusCode = 400;
      throw error;
    }
  }
  
  /**
   * Simulate payment outcome
   */
  simulatePaymentOutcome() {
    const rand = Math.random();
    
    if (rand < 0.7) {
      return 'success';
    } else if (rand < 0.9) {
      return 'failure';
    } else {
      return 'pending';
    }
  }
  
  /**
   * Get random failure reason
   */
  getRandomFailureReason() {
    const reasons = [
      'insufficient_funds',
      'card_declined',
      'expired_card',
      'invalid_card',
      'network_error',
      'processing_error',
      'fraud_detected',
      'limit_exceeded'
    ];
    
    return reasons[Math.floor(Math.random() * reasons.length)];
  }
  
  /**
   * Sanitize payment data for logging
   */
  sanitizePaymentData(paymentData) {
    const sanitized = { ...paymentData };
    
    // Remove sensitive information
    if (sanitized.cardNumber) {
      sanitized.cardNumber = '****' + sanitized.cardNumber.slice(-4);
    }
    if (sanitized.cvv) {
      sanitized.cvv = '***';
    }
    if (sanitized.accountNumber) {
      sanitized.accountNumber = '****' + sanitized.accountNumber.slice(-4);
    }
    
    return sanitized;
  }
  
  /**
   * Sanitize payment response
   */
  sanitizePaymentResponse(payment) {
    const sanitized = { ...payment };
    
    // Remove internal fields
    delete sanitized.internalNotes;
    delete sanitized.processingDetails;
    
    return sanitized;
  }
  
  /**
   * Perform health check
   */
  async performHealthCheck() {
    // Simulate health check processing
    await new Promise(resolve => setTimeout(resolve, 200));
    
    if (!this.isHealthy || this.consecutiveFailures >= this.maxConsecutiveFailures) {
      throw new Error('Payment service is currently unhealthy');
    }
    
    return {
      paymentProcessor: 'connected',
      database: 'connected',
      memory: {
        used: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal
      },
      uptime: process.uptime(),
      paymentCount: this.payments.size,
      consecutiveFailures: this.consecutiveFailures,
      failureRate: this.failureRate,
      lastCheck: new Date().toISOString()
    };
  }
  
  /**
   * Perform recovery actions
   */
  async performRecovery(error) {
    this.logger.info('Performing payment service recovery', {
      error: error.message,
      consecutiveFailures: this.consecutiveFailures
    });
    
    // Simulate recovery actions
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Reset failure state
    this.consecutiveFailures = Math.max(0, this.consecutiveFailures - 2);
    this.isHealthy = true;
    
    // Reduce failure rate temporarily
    const originalFailureRate = this.failureRate;
    this.failureRate = Math.max(0.1, this.failureRate * 0.5);
    
    // Restore original failure rate after recovery period
    setTimeout(() => {
      this.failureRate = originalFailureRate;
    }, 60000); // 1 minute
    
    this.logger.info('Payment service recovery completed', {
      newFailureRate: this.failureRate,
      consecutiveFailures: this.consecutiveFailures
    });
  }
  
  /**
   * Simulate processing time
   */
  async simulateProcessingTime() {
    // Simulate variable processing time
    const processingTime = Math.random() * 300 + 100; // 100-400ms
    await new Promise(resolve => setTimeout(resolve, processingTime));
    
    // Occasionally simulate very slow requests
    if (Math.random() < this.config.demo.slowRequestRate) {
      const slowDelay = this.config.demo.slowRequestDelay * 2; // Extra slow for payments
      this.logger.debug('Simulating slow payment request', { delay: slowDelay });
      await new Promise(resolve => setTimeout(resolve, slowDelay));
    }
  }
  
  /**
   * Check for simulated failures
   */
  checkForSimulatedFailures() {
    if (Math.random() < this.failureRate || this.consecutiveFailures >= this.maxConsecutiveFailures) {
      this.consecutiveFailures++;
      throw new Error('Simulated payment service failure');
    }
  }
  
  /**
   * Start the payment service
   */
  start() {
    const port = this.config.port;
    
    this.server = this.app.listen(port, () => {
      this.logger.info('Payment service started', {
        port,
        environment: this.config.env,
        failureRate: this.failureRate,
        recoveryEnabled: true
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
    this.logger.info('Starting payment service shutdown...');
    
    // Stop accepting new connections
    this.server.close(() => {
      this.logger.info('Payment service HTTP server closed');
    });
    
    // Cleanup auto-recovery
    this.recovery.destroy();
    
    this.logger.info('Payment service shutdown completed');
    process.exit(0);
  }
}

// Start the service if this file is run directly
if (require.main === module) {
  const paymentService = new PaymentService();
  paymentService.start();
}

module.exports = PaymentService;
