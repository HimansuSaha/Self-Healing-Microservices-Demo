/**
 * Notification Service
 * 
 * A microservice that handles notifications with retry mechanisms
 * and demonstrates auto-recovery patterns.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { AutoRecovery } = require('../../patterns/AutoRecovery');
const config = require('../../config');
const logger = require('../../utils/logger');

class NotificationService {
  constructor() {
    this.app = express();
    this.config = config.getServiceConfig('notification');
    this.logger = logger.createChild({ service: 'notification-service' });
    
    // Notification storage and queues
    this.notifications = new Map();
    this.notificationQueue = [];
    this.isHealthy = true;
    this.isProcessingQueue = false;
    
    // Auto-recovery setup
    this.recovery = new AutoRecovery({
      name: 'notification-service-recovery',
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
    this.startQueueProcessor();
  }
  
  setupMiddleware() {
    this.app.use(express.json());
    
    this.app.use((req, res, next) => {
      req.id = req.get('X-Request-ID') || uuidv4();
      req.startTime = Date.now();
      
      this.logger.info('Notification service request', {
        requestId: req.id,
        method: req.method,
        url: req.url
      });
      
      next();
    });
  }
  
  setupRoutes() {
    // Health check
    this.app.get('/health', async (req, res) => {
      try {
        const healthStatus = await this.performHealthCheck();
        res.json({
          status: 'healthy',
          service: 'notification-service',
          timestamp: new Date().toISOString(),
          details: healthStatus,
          recovery: this.recovery.getStatus(),
          queueSize: this.notificationQueue.length
        });
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          service: 'notification-service',
          error: error.message,
          recovery: this.recovery.getStatus(),
          queueSize: this.notificationQueue.length
        });
      }
    });
    
    // Send notification
    this.app.post('/notifications', async (req, res) => {
      try {
        const result = await this.recovery.executeWithRecovery(async () => {
          return await this.sendNotification(req.body);
        });
        
        res.status(201).json(result);
      } catch (error) {
        res.status(error.statusCode || 500).json({
          error: error.message,
          requestId: req.id
        });
      }
    });
    
    // Get notification status
    this.app.get('/notifications/:id', async (req, res) => {
      try {
        const result = await this.recovery.executeWithRecovery(async () => {
          return await this.getNotification(req.params.id);
        });
        
        res.json(result);
      } catch (error) {
        res.status(error.statusCode || 500).json({
          error: error.message,
          requestId: req.id
        });
      }
    });
    
    // List notifications
    this.app.get('/notifications', async (req, res) => {
      try {
        const result = await this.recovery.executeWithRecovery(async () => {
          return await this.listNotifications(req.query);
        });
        
        res.json(result);
      } catch (error) {
        res.status(error.statusCode || 500).json({
          error: error.message,
          requestId: req.id
        });
      }
    });
    
    // Retry failed notification
    this.app.post('/notifications/:id/retry', async (req, res) => {
      try {
        const result = await this.recovery.executeWithRecovery(async () => {
          return await this.retryNotification(req.params.id);
        });
        
        res.json(result);
      } catch (error) {
        res.status(error.statusCode || 500).json({
          error: error.message,
          requestId: req.id
        });
      }
    });
    
    // Get queue status
    this.app.get('/queue/status', (req, res) => {
      res.json({
        queueSize: this.notificationQueue.length,
        isProcessing: this.isProcessingQueue,
        pendingNotifications: this.notificationQueue.map(n => ({
          id: n.id,
          type: n.type,
          attempts: n.attempts,
          scheduledFor: n.scheduledFor
        }))
      });
    });
  }
  
  async sendNotification(notificationData) {
    await this.simulateProcessingTime();
    this.checkForSimulatedFailures();
    
    // Validate notification data
    this.validateNotificationData(notificationData);
    
    const notification = {
      id: uuidv4(),
      type: notificationData.type,
      recipient: notificationData.recipient,
      subject: notificationData.subject,
      message: notificationData.message,
      channel: notificationData.channel || 'email',
      priority: notificationData.priority || 'normal',
      status: 'pending',
      attempts: 0,
      maxAttempts: notificationData.maxAttempts || 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scheduledFor: notificationData.scheduledFor || new Date().toISOString()
    };
    
    this.notifications.set(notification.id, notification);
    
    // Add to queue for processing
    this.addToQueue(notification);
    
    this.logger.info('Notification queued', {
      notificationId: notification.id,
      type: notification.type,
      recipient: this.sanitizeRecipient(notification.recipient),
      channel: notification.channel,
      priority: notification.priority
    });
    
    return {
      notification: this.sanitizeNotificationResponse(notification),
      message: 'Notification queued for delivery'
    };
  }
  
  async getNotification(notificationId) {
    await this.simulateProcessingTime(50, 100);
    this.checkForSimulatedFailures();
    
    if (!this.notifications.has(notificationId)) {
      const error = new Error(`Notification with ID ${notificationId} not found`);
      error.statusCode = 404;
      throw error;
    }
    
    const notification = this.notifications.get(notificationId);
    
    return {
      notification: this.sanitizeNotificationResponse(notification),
      timestamp: new Date().toISOString()
    };
  }
  
  async listNotifications(query = {}) {
    await this.simulateProcessingTime(100, 200);
    this.checkForSimulatedFailures();
    
    let notifications = Array.from(this.notifications.values());
    
    // Apply filters
    if (query.status) {
      notifications = notifications.filter(n => n.status === query.status);
    }
    
    if (query.type) {
      notifications = notifications.filter(n => n.type === query.type);
    }
    
    if (query.channel) {
      notifications = notifications.filter(n => n.channel === query.channel);
    }
    
    if (query.recipient) {
      notifications = notifications.filter(n => 
        n.recipient.toLowerCase().includes(query.recipient.toLowerCase())
      );
    }
    
    // Sort by creation date (newest first)
    notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    // Apply pagination
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 20;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    const paginatedNotifications = notifications.slice(startIndex, endIndex);
    
    return {
      notifications: paginatedNotifications.map(n => this.sanitizeNotificationResponse(n)),
      pagination: {
        page,
        limit,
        total: notifications.length,
        pages: Math.ceil(notifications.length / limit)
      },
      timestamp: new Date().toISOString()
    };
  }
  
  async retryNotification(notificationId) {
    await this.simulateProcessingTime();
    this.checkForSimulatedFailures();
    
    if (!this.notifications.has(notificationId)) {
      const error = new Error(`Notification with ID ${notificationId} not found`);
      error.statusCode = 404;
      throw error;
    }
    
    const notification = this.notifications.get(notificationId);
    
    if (notification.status === 'delivered') {
      const error = new Error('Cannot retry already delivered notification');
      error.statusCode = 400;
      throw error;
    }
    
    if (notification.attempts >= notification.maxAttempts) {
      const error = new Error('Maximum retry attempts exceeded');
      error.statusCode = 400;
      throw error;
    }
    
    // Reset status and add back to queue
    notification.status = 'pending';
    notification.updatedAt = new Date().toISOString();
    notification.scheduledFor = new Date().toISOString();
    
    this.notifications.set(notificationId, notification);
    this.addToQueue(notification);
    
    this.logger.info('Notification retry requested', {
      notificationId: notification.id,
      attempts: notification.attempts,
      maxAttempts: notification.maxAttempts
    });
    
    return {
      notification: this.sanitizeNotificationResponse(notification),
      message: 'Notification queued for retry'
    };
  }
  
  addToQueue(notification) {
    // Remove if already in queue
    this.notificationQueue = this.notificationQueue.filter(n => n.id !== notification.id);
    
    // Add to queue based on priority and scheduled time
    this.notificationQueue.push(notification);
    
    // Sort queue by priority and scheduled time
    this.notificationQueue.sort((a, b) => {
      // Priority order: high > normal > low
      const priorityOrder = { high: 3, normal: 2, low: 1 };
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      
      // If same priority, sort by scheduled time
      return new Date(a.scheduledFor) - new Date(b.scheduledFor);
    });
  }
  
  startQueueProcessor() {
    // Process queue every 2 seconds
    setInterval(async () => {
      if (!this.isProcessingQueue && this.notificationQueue.length > 0) {
        await this.processNotificationQueue();
      }
    }, 2000);
  }
  
  async processNotificationQueue() {
    if (this.isProcessingQueue || this.notificationQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    try {
      const now = new Date();
      const readyNotifications = this.notificationQueue.filter(n => 
        new Date(n.scheduledFor) <= now
      );
      
      if (readyNotifications.length === 0) {
        return;
      }
      
      // Process up to 5 notifications at a time
      const batch = readyNotifications.slice(0, 5);
      
      const promises = batch.map(notification => 
        this.processNotification(notification).catch(error => {
          this.logger.error('Failed to process notification', {
            notificationId: notification.id,
            error: error.message
          });
        })
      );
      
      await Promise.allSettled(promises);
      
      // Remove processed notifications from queue
      batch.forEach(notification => {
        this.notificationQueue = this.notificationQueue.filter(n => n.id !== notification.id);
      });
      
    } catch (error) {
      this.logger.error('Queue processing error', {
        error: error.message,
        queueSize: this.notificationQueue.length
      });
    } finally {
      this.isProcessingQueue = false;
    }
  }
  
  async processNotification(notification) {
    notification.attempts++;
    notification.updatedAt = new Date().toISOString();
    notification.status = 'processing';
    
    this.logger.info('Processing notification', {
      notificationId: notification.id,
      attempt: notification.attempts,
      type: notification.type,
      channel: notification.channel
    });
    
    try {
      await this.recovery.executeWithRecovery(async () => {
        await this.deliverNotification(notification);
      });
      
      notification.status = 'delivered';
      notification.deliveredAt = new Date().toISOString();
      
      this.logger.info('Notification delivered successfully', {
        notificationId: notification.id,
        attempts: notification.attempts,
        deliveryTime: new Date(notification.deliveredAt) - new Date(notification.createdAt)
      });
      
    } catch (error) {
      this.logger.warn('Notification delivery failed', {
        notificationId: notification.id,
        attempt: notification.attempts,
        error: error.message
      });
      
      if (notification.attempts >= notification.maxAttempts) {
        notification.status = 'failed';
        notification.failureReason = error.message;
        
        this.logger.error('Notification permanently failed', {
          notificationId: notification.id,
          totalAttempts: notification.attempts,
          error: error.message
        });
      } else {
        // Schedule retry with exponential backoff
        const delay = Math.min(
          this.config.autoRecovery.initialDelay * Math.pow(2, notification.attempts - 1),
          this.config.autoRecovery.maxDelay
        );
        
        notification.status = 'pending';
        notification.scheduledFor = new Date(Date.now() + delay).toISOString();
        
        // Add back to queue for retry
        this.addToQueue(notification);
        
        this.logger.info('Notification scheduled for retry', {
          notificationId: notification.id,
          retryAt: notification.scheduledFor,
          delay
        });
      }
    }
    
    this.notifications.set(notification.id, notification);
    return notification;
  }
  
  async deliverNotification(notification) {
    // Simulate notification delivery
    await this.simulateDeliveryTime(notification.channel);
    
    // Simulate delivery failures
    if (Math.random() < this.config.demo.failureRate) {
      throw new Error(`${notification.channel} delivery failed`);
    }
    
    // Simulate channel-specific delivery logic
    switch (notification.channel) {
      case 'email':
        await this.deliverEmail(notification);
        break;
      case 'sms':
        await this.deliverSMS(notification);
        break;
      case 'push':
        await this.deliverPushNotification(notification);
        break;
      case 'webhook':
        await this.deliverWebhook(notification);
        break;
      default:
        throw new Error(`Unsupported notification channel: ${notification.channel}`);
    }
  }
  
  async deliverEmail(notification) {
    // Simulate email delivery
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
    
    this.logger.debug('Email delivered', {
      notificationId: notification.id,
      recipient: this.sanitizeRecipient(notification.recipient),
      subject: notification.subject
    });
  }
  
  async deliverSMS(notification) {
    // Simulate SMS delivery
    await new Promise(resolve => setTimeout(resolve, Math.random() * 800 + 300));
    
    this.logger.debug('SMS delivered', {
      notificationId: notification.id,
      recipient: this.sanitizeRecipient(notification.recipient)
    });
  }
  
  async deliverPushNotification(notification) {
    // Simulate push notification delivery
    await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 200));
    
    this.logger.debug('Push notification delivered', {
      notificationId: notification.id,
      recipient: this.sanitizeRecipient(notification.recipient)
    });
  }
  
  async deliverWebhook(notification) {
    // Simulate webhook delivery
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
    
    this.logger.debug('Webhook delivered', {
      notificationId: notification.id,
      recipient: notification.recipient
    });
  }
  
  validateNotificationData(data) {
    if (!data.type) {
      const error = new Error('Notification type is required');
      error.statusCode = 400;
      throw error;
    }
    
    if (!data.recipient) {
      const error = new Error('Recipient is required');
      error.statusCode = 400;
      throw error;
    }
    
    if (!data.message) {
      const error = new Error('Message is required');
      error.statusCode = 400;
      throw error;
    }
    
    const validChannels = ['email', 'sms', 'push', 'webhook'];
    if (data.channel && !validChannels.includes(data.channel)) {
      const error = new Error('Invalid notification channel');
      error.statusCode = 400;
      throw error;
    }
    
    const validPriorities = ['low', 'normal', 'high'];
    if (data.priority && !validPriorities.includes(data.priority)) {
      const error = new Error('Invalid priority level');
      error.statusCode = 400;
      throw error;
    }
  }
  
  sanitizeRecipient(recipient) {
    if (recipient.includes('@')) {
      // Email - hide middle part
      const [local, domain] = recipient.split('@');
      return `${local.charAt(0)}***${local.slice(-1)}@${domain}`;
    } else if (recipient.match(/^\+?\d+$/)) {
      // Phone number - hide middle digits
      return recipient.replace(/(\d{3})\d*(\d{4})/, '$1****$2');
    }
    return recipient.charAt(0) + '***' + recipient.slice(-1);
  }
  
  sanitizeNotificationResponse(notification) {
    return {
      ...notification,
      recipient: this.sanitizeRecipient(notification.recipient)
    };
  }
  
  async simulateProcessingTime(min = 100, max = 300) {
    const processingTime = Math.random() * (max - min) + min;
    await new Promise(resolve => setTimeout(resolve, processingTime));
  }
  
  async simulateDeliveryTime(channel) {
    const deliveryTimes = {
      email: { min: 500, max: 2000 },
      sms: { min: 300, max: 1500 },
      push: { min: 100, max: 800 },
      webhook: { min: 1000, max: 3000 }
    };
    
    const times = deliveryTimes[channel] || { min: 300, max: 1000 };
    const deliveryTime = Math.random() * (times.max - times.min) + times.min;
    
    await new Promise(resolve => setTimeout(resolve, deliveryTime));
  }
  
  checkForSimulatedFailures() {
    if (Math.random() < this.config.demo.failureRate) {
      throw new Error('Simulated notification service failure');
    }
  }
  
  async performHealthCheck() {
    await new Promise(resolve => setTimeout(resolve, 150));
    
    if (!this.isHealthy) {
      throw new Error('Notification service is currently unhealthy');
    }
    
    return {
      notificationChannels: ['email', 'sms', 'push', 'webhook'],
      queueProcessor: this.isProcessingQueue ? 'running' : 'idle',
      memory: {
        used: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal
      },
      uptime: process.uptime(),
      notificationCount: this.notifications.size,
      queueSize: this.notificationQueue.length,
      lastCheck: new Date().toISOString()
    };
  }
  
  async performRecovery(error) {
    this.logger.info('Performing notification service recovery', {
      error: error.message
    });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    this.isHealthy = true;
    
    // Restart queue processing if it was stopped
    if (!this.isProcessingQueue && this.notificationQueue.length > 0) {
      this.logger.info('Restarting notification queue processing');
      setTimeout(() => this.processNotificationQueue(), 1000);
    }
    
    this.logger.info('Notification service recovery completed');
  }
  
  start() {
    const port = this.config.port;
    
    this.server = this.app.listen(port, () => {
      this.logger.info('Notification service started', {
        port,
        environment: this.config.env,
        queueProcessorEnabled: true,
        supportedChannels: ['email', 'sms', 'push', 'webhook']
      });
    });
    
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }
  
  async shutdown() {
    this.logger.info('Starting notification service shutdown...');
    
    this.server.close(() => {
      this.logger.info('Notification service HTTP server closed');
    });
    
    // Process remaining notifications in queue
    if (this.notificationQueue.length > 0) {
      this.logger.info('Processing remaining notifications in queue');
      await this.processNotificationQueue();
    }
    
    this.recovery.destroy();
    
    this.logger.info('Notification service shutdown completed');
    process.exit(0);
  }
}

if (require.main === module) {
  const notificationService = new NotificationService();
  notificationService.start();
}

module.exports = NotificationService;
