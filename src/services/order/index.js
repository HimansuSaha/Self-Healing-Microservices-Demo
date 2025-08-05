/**
 * Order Service
 * 
 * A microservice that handles order operations and demonstrates
 * bulkhead patterns for resource isolation.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { Bulkhead } = require('../../patterns/Bulkhead');
const { AutoRecovery } = require('../../patterns/AutoRecovery');
const config = require('../../config');
const logger = require('../../utils/logger');

class OrderService {
  constructor() {
    this.app = express();
    this.config = config.getServiceConfig('order');
    this.logger = logger.createChild({ service: 'order-service' });
    
    // Order storage
    this.orders = new Map();
    this.isHealthy = true;
    
    // Bulkhead for different operations
    this.bulkheads = {
      read: new Bulkhead({
        name: 'order-read-bulkhead',
        maxConcurrent: 20,
        maxQueueSize: 100,
        timeout: 10000
      }),
      write: new Bulkhead({
        name: 'order-write-bulkhead', 
        maxConcurrent: 10,
        maxQueueSize: 50,
        timeout: 30000
      }),
      complex: new Bulkhead({
        name: 'order-complex-bulkhead',
        maxConcurrent: 5,
        maxQueueSize: 20,
        timeout: 60000
      })
    };
    
    // Auto-recovery
    this.recovery = new AutoRecovery({
      name: 'order-service-recovery',
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
    
    this.initializeSampleData();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupBulkheadListeners();
  }
  
  initializeSampleData() {
    const sampleOrders = [
      {
        id: '1',
        userId: '1',
        items: [
          { productId: 'prod-1', name: 'Laptop', price: 999.99, quantity: 1 },
          { productId: 'prod-2', name: 'Mouse', price: 29.99, quantity: 2 }
        ],
        total: 1059.97,
        status: 'completed',
        createdAt: new Date(Date.now() - 86400000).toISOString() // 1 day ago
      },
      {
        id: '2',
        userId: '2',
        items: [
          { productId: 'prod-3', name: 'Keyboard', price: 79.99, quantity: 1 }
        ],
        total: 79.99,
        status: 'processing',
        createdAt: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
      }
    ];
    
    sampleOrders.forEach(order => {
      this.orders.set(order.id, order);
    });
    
    this.logger.info('Sample order data initialized', {
      orderCount: this.orders.size
    });
  }
  
  setupMiddleware() {
    this.app.use(express.json());
    
    this.app.use((req, res, next) => {
      req.id = req.get('X-Request-ID') || uuidv4();
      req.startTime = Date.now();
      
      this.logger.info('Order service request', {
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
          service: 'order-service',
          timestamp: new Date().toISOString(),
          details: healthStatus,
          bulkheads: this.getBulkheadStatus()
        });
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          service: 'order-service',
          error: error.message,
          bulkheads: this.getBulkheadStatus()
        });
      }
    });
    
    // Get order (read operation)
    this.app.get('/orders/:id', async (req, res) => {
      try {
        const result = await this.bulkheads.read.execute(async () => {
          return await this.recovery.executeWithRecovery(async () => {
            return await this.getOrder(req.params.id);
          });
        });
        
        res.json(result);
      } catch (error) {
        res.status(error.statusCode || 500).json({
          error: error.message,
          requestId: req.id
        });
      }
    });
    
    // Create order (write operation)
    this.app.post('/orders', async (req, res) => {
      try {
        const result = await this.bulkheads.write.execute(async () => {
          return await this.recovery.executeWithRecovery(async () => {
            return await this.createOrder(req.body);
          });
        });
        
        res.status(201).json(result);
      } catch (error) {
        res.status(error.statusCode || 500).json({
          error: error.message,
          requestId: req.id
        });
      }
    });
    
    // Update order (write operation)
    this.app.put('/orders/:id', async (req, res) => {
      try {
        const result = await this.bulkheads.write.execute(async () => {
          return await this.recovery.executeWithRecovery(async () => {
            return await this.updateOrder(req.params.id, req.body);
          });
        });
        
        res.json(result);
      } catch (error) {
        res.status(error.statusCode || 500).json({
          error: error.message,
          requestId: req.id
        });
      }
    });
    
    // Generate order report (complex operation)
    this.app.get('/orders/:id/report', async (req, res) => {
      try {
        const result = await this.bulkheads.complex.execute(async () => {
          return await this.recovery.executeWithRecovery(async () => {
            return await this.generateOrderReport(req.params.id);
          });
        });
        
        res.json(result);
      } catch (error) {
        res.status(error.statusCode || 500).json({
          error: error.message,
          requestId: req.id
        });
      }
    });
    
    // List orders (read operation)
    this.app.get('/orders', async (req, res) => {
      try {
        const result = await this.bulkheads.read.execute(async () => {
          return await this.recovery.executeWithRecovery(async () => {
            return await this.listOrders(req.query);
          });
        });
        
        res.json(result);
      } catch (error) {
        res.status(error.statusCode || 500).json({
          error: error.message,
          requestId: req.id
        });
      }
    });
  }
  
  setupBulkheadListeners() {
    Object.entries(this.bulkheads).forEach(([name, bulkhead]) => {
      bulkhead.on('taskQueued', (data) => {
        this.logger.bulkhead('taskQueued', { bulkheadType: name, ...data });
      });
      
      bulkhead.on('taskCompleted', (data) => {
        this.logger.bulkhead('taskCompleted', { bulkheadType: name, ...data });
      });
      
      bulkhead.on('taskFailed', (data) => {
        this.logger.bulkhead('taskFailed', { bulkheadType: name, ...data });
      });
    });
  }
  
  async getOrder(orderId) {
    await this.simulateProcessingTime(100, 300);
    this.checkForSimulatedFailures();
    
    if (!this.orders.has(orderId)) {
      const error = new Error(`Order with ID ${orderId} not found`);
      error.statusCode = 404;
      throw error;
    }
    
    const order = this.orders.get(orderId);
    
    this.logger.info('Order retrieved', {
      orderId: order.id,
      userId: order.userId,
      status: order.status,
      total: order.total
    });
    
    return {
      order,
      timestamp: new Date().toISOString()
    };
  }
  
  async createOrder(orderData) {
    await this.simulateProcessingTime(200, 500);
    this.checkForSimulatedFailures();
    
    // Validate order data
    if (!orderData.userId || !orderData.items || !Array.isArray(orderData.items)) {
      const error = new Error('Invalid order data');
      error.statusCode = 400;
      throw error;
    }
    
    if (orderData.items.length === 0) {
      const error = new Error('Order must contain at least one item');
      error.statusCode = 400;
      throw error;
    }
    
    // Calculate total
    const total = orderData.items.reduce((sum, item) => {
      return sum + (item.price * item.quantity);
    }, 0);
    
    const order = {
      id: uuidv4(),
      userId: orderData.userId,
      items: orderData.items,
      total: total,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    this.orders.set(order.id, order);
    
    // Simulate order processing
    setTimeout(() => {
      order.status = 'processing';
      order.updatedAt = new Date().toISOString();
      this.orders.set(order.id, order);
      
      this.logger.info('Order processing started', {
        orderId: order.id
      });
    }, Math.random() * 2000 + 1000);
    
    this.logger.info('Order created', {
      orderId: order.id,
      userId: order.userId,
      itemCount: order.items.length,
      total: order.total
    });
    
    return {
      order,
      message: 'Order created successfully'
    };
  }
  
  async updateOrder(orderId, updateData) {
    await this.simulateProcessingTime(150, 400);
    this.checkForSimulatedFailures();
    
    if (!this.orders.has(orderId)) {
      const error = new Error(`Order with ID ${orderId} not found`);
      error.statusCode = 404;
      throw error;
    }
    
    const order = { ...this.orders.get(orderId) };
    
    // Update allowed fields
    if (updateData.status) {
      const validStatuses = ['pending', 'processing', 'completed', 'cancelled'];
      if (!validStatuses.includes(updateData.status)) {
        const error = new Error('Invalid order status');
        error.statusCode = 400;
        throw error;
      }
      order.status = updateData.status;
    }
    
    if (updateData.items && Array.isArray(updateData.items)) {
      order.items = updateData.items;
      order.total = updateData.items.reduce((sum, item) => {
        return sum + (item.price * item.quantity);
      }, 0);
    }
    
    order.updatedAt = new Date().toISOString();
    this.orders.set(orderId, order);
    
    this.logger.info('Order updated', {
      orderId: order.id,
      status: order.status,
      changes: updateData
    });
    
    return {
      order,
      message: 'Order updated successfully'
    };
  }
  
  async generateOrderReport(orderId) {
    // This is a complex operation that takes more time
    await this.simulateProcessingTime(2000, 5000);
    this.checkForSimulatedFailures();
    
    if (!this.orders.has(orderId)) {
      const error = new Error(`Order with ID ${orderId} not found`);
      error.statusCode = 404;
      throw error;
    }
    
    const order = this.orders.get(orderId);
    
    // Simulate complex report generation
    const report = {
      orderId: order.id,
      userId: order.userId,
      summary: {
        itemCount: order.items.length,
        totalAmount: order.total,
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      },
      items: order.items.map(item => ({
        ...item,
        subtotal: item.price * item.quantity
      })),
      analytics: {
        averageItemPrice: order.total / order.items.reduce((sum, item) => sum + item.quantity, 0),
        mostExpensiveItem: order.items.reduce((max, item) => 
          item.price > max.price ? item : max, order.items[0]),
        categoryBreakdown: this.generateCategoryBreakdown(order.items)
      },
      timestamps: {
        reportGeneratedAt: new Date().toISOString(),
        processingTime: Math.random() * 3000 + 2000 // Simulated processing time
      }
    };
    
    this.logger.info('Order report generated', {
      orderId: order.id,
      reportSize: JSON.stringify(report).length
    });
    
    return report;
  }
  
  async listOrders(query = {}) {
    await this.simulateProcessingTime(50, 200);
    this.checkForSimulatedFailures();
    
    let orders = Array.from(this.orders.values());
    
    // Apply filters
    if (query.userId) {
      orders = orders.filter(order => order.userId === query.userId);
    }
    
    if (query.status) {
      orders = orders.filter(order => order.status === query.status);
    }
    
    // Apply sorting
    if (query.sortBy) {
      const sortField = query.sortBy;
      const sortOrder = query.sortOrder === 'desc' ? -1 : 1;
      
      orders.sort((a, b) => {
        if (a[sortField] < b[sortField]) return -1 * sortOrder;
        if (a[sortField] > b[sortField]) return 1 * sortOrder;
        return 0;
      });
    }
    
    // Apply pagination
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    const paginatedOrders = orders.slice(startIndex, endIndex);
    
    return {
      orders: paginatedOrders,
      pagination: {
        page,
        limit,
        total: orders.length,
        pages: Math.ceil(orders.length / limit)
      },
      timestamp: new Date().toISOString()
    };
  }
  
  generateCategoryBreakdown(items) {
    // Simple category classification based on product name
    const categories = {};
    
    items.forEach(item => {
      let category = 'Other';
      
      if (item.name.toLowerCase().includes('laptop') || 
          item.name.toLowerCase().includes('computer')) {
        category = 'Electronics';
      } else if (item.name.toLowerCase().includes('mouse') || 
                 item.name.toLowerCase().includes('keyboard')) {
        category = 'Accessories';
      } else if (item.name.toLowerCase().includes('book')) {
        category = 'Books';
      }
      
      if (!categories[category]) {
        categories[category] = {
          count: 0,
          total: 0
        };
      }
      
      categories[category].count += item.quantity;
      categories[category].total += item.price * item.quantity;
    });
    
    return categories;
  }
  
  async performHealthCheck() {
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (!this.isHealthy) {
      throw new Error('Order service is currently unhealthy');
    }
    
    return {
      database: 'connected',
      memory: {
        used: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal
      },
      uptime: process.uptime(),
      orderCount: this.orders.size,
      bulkheadUtilization: this.getBulkheadUtilization(),
      lastCheck: new Date().toISOString()
    };
  }
  
  async performRecovery(error) {
    this.logger.info('Performing order service recovery', {
      error: error.message
    });
    
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    this.isHealthy = true;
    
    // Clear bulkhead queues if needed
    Object.values(this.bulkheads).forEach(bulkhead => {
      const utilization = bulkhead.getUtilization();
      if (utilization.queueUtilization > 80) {
        this.logger.warn(`Clearing overloaded bulkhead queue: ${bulkhead.name}`);
        // In a real scenario, you might not want to clear all queues
        // This is for demonstration purposes
      }
    });
    
    this.logger.info('Order service recovery completed');
  }
  
  getBulkheadStatus() {
    const status = {};
    Object.entries(this.bulkheads).forEach(([name, bulkhead]) => {
      status[name] = bulkhead.getStatus();
    });
    return status;
  }
  
  getBulkheadUtilization() {
    const utilization = {};
    Object.entries(this.bulkheads).forEach(([name, bulkhead]) => {
      utilization[name] = bulkhead.getUtilization();
    });
    return utilization;
  }
  
  async simulateProcessingTime(min = 100, max = 300) {
    const processingTime = Math.random() * (max - min) + min;
    await new Promise(resolve => setTimeout(resolve, processingTime));
    
    if (Math.random() < this.config.demo.slowRequestRate) {
      const slowDelay = this.config.demo.slowRequestDelay;
      this.logger.debug('Simulating slow order request', { delay: slowDelay });
      await new Promise(resolve => setTimeout(resolve, slowDelay));
    }
  }
  
  checkForSimulatedFailures() {
    if (Math.random() < this.config.demo.failureRate) {
      throw new Error('Simulated order service failure');
    }
  }
  
  start() {
    const port = this.config.port;
    
    this.server = this.app.listen(port, () => {
      this.logger.info('Order service started', {
        port,
        environment: this.config.env,
        orderCount: this.orders.size,
        bulkheads: Object.keys(this.bulkheads).length
      });
    });
    
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }
  
  async shutdown() {
    this.logger.info('Starting order service shutdown...');
    
    this.server.close(() => {
      this.logger.info('Order service HTTP server closed');
    });
    
    // Cleanup patterns
    Object.values(this.bulkheads).forEach(bulkhead => bulkhead.destroy());
    this.recovery.destroy();
    
    this.logger.info('Order service shutdown completed');
    process.exit(0);
  }
}

if (require.main === module) {
  const orderService = new OrderService();
  orderService.start();
}

module.exports = OrderService;
