/**
 * User Service
 * 
 * A microservice that handles user operations and demonstrates
 * auto-recovery patterns with health checks and failure simulation.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { AutoRecovery } = require('../../patterns/AutoRecovery');
const config = require('../../config');
const logger = require('../../utils/logger');

class UserService {
  constructor() {
    this.app = express();
    this.config = config.getServiceConfig('user');
    this.logger = logger.createChild({ service: 'user-service' });
    
    // In-memory user storage (for demo purposes)
    this.users = new Map();
    this.isHealthy = true;
    this.simulateFailures = false;
    
    // Auto-recovery setup
    this.recovery = new AutoRecovery({
      name: 'user-service-recovery',
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
    
    // Initialize with sample data
    this.initializeSampleData();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupRecoveryPatterns();
  }
  
  /**
   * Initialize sample user data
   */
  initializeSampleData() {
    const sampleUsers = [
      { id: '1', name: 'John Doe', email: 'john@example.com', status: 'active' },
      { id: '2', name: 'Jane Smith', email: 'jane@example.com', status: 'active' },
      { id: '3', name: 'Bob Johnson', email: 'bob@example.com', status: 'inactive' },
      { id: '4', name: 'Alice Brown', email: 'alice@example.com', status: 'active' },
      { id: '5', name: 'Charlie Wilson', email: 'charlie@example.com', status: 'pending' }
    ];
    
    sampleUsers.forEach(user => {
      this.users.set(user.id, user);
    });
    
    this.logger.info('Sample user data initialized', {
      userCount: this.users.size
    });
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
      
      this.logger.info('User service request', {
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
          service: 'user-service',
          timestamp: new Date().toISOString(),
          details: healthStatus,
          recovery: this.recovery.getStatus()
        });
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          service: 'user-service',
          timestamp: new Date().toISOString(),
          error: error.message,
          recovery: this.recovery.getStatus()
        });
      }
    });
    
    // Get user by ID
    this.app.get('/users/:id', async (req, res) => {
      try {
        const result = await this.executeWithRecovery(async () => {
          return await this.getUser(req.params.id);
        });
        
        res.json(result);
        
      } catch (error) {
        this.logger.error('Failed to get user', {
          userId: req.params.id,
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
    
    // Create new user
    this.app.post('/users', async (req, res) => {
      try {
        const result = await this.executeWithRecovery(async () => {
          return await this.createUser(req.body);
        });
        
        res.status(201).json(result);
        
      } catch (error) {
        this.logger.error('Failed to create user', {
          userData: req.body,
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
    
    // Update user
    this.app.put('/users/:id', async (req, res) => {
      try {
        const result = await this.executeWithRecovery(async () => {
          return await this.updateUser(req.params.id, req.body);
        });
        
        res.json(result);
        
      } catch (error) {
        this.logger.error('Failed to update user', {
          userId: req.params.id,
          userData: req.body,
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
    
    // Delete user
    this.app.delete('/users/:id', async (req, res) => {
      try {
        const result = await this.executeWithRecovery(async () => {
          return await this.deleteUser(req.params.id);
        });
        
        res.json(result);
        
      } catch (error) {
        this.logger.error('Failed to delete user', {
          userId: req.params.id,
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
    
    // List all users
    this.app.get('/users', async (req, res) => {
      try {
        const result = await this.executeWithRecovery(async () => {
          return await this.listUsers(req.query);
        });
        
        res.json(result);
        
      } catch (error) {
        this.logger.error('Failed to list users', {
          query: req.query,
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
    this.app.post('/simulate/failure', (req, res) => {
      this.simulateFailures = true;
      this.isHealthy = false;
      
      this.logger.warn('User service failure simulation started');
      
      // Auto-recover after 30 seconds
      setTimeout(() => {
        this.simulateFailures = false;
        this.isHealthy = true;
        this.logger.info('User service failure simulation ended');
      }, 30000);
      
      res.json({ message: 'Failure simulation started' });
    });
    
    this.app.post('/simulate/recovery', (req, res) => {
      this.simulateFailures = false;
      this.isHealthy = true;
      this.recovery.reset();
      
      this.logger.info('User service recovery simulation triggered');
      res.json({ message: 'Recovery simulation triggered' });
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
      this.isHealthy = true;
    });
    
    this.recovery.on('failure', (data) => {
      this.logger.recovery('failure', data);
      // Could trigger additional recovery actions here
    });
  }
  
  /**
   * Execute operation with recovery
   */
  async executeWithRecovery(operation) {
    return await this.recovery.executeWithRecovery(operation);
  }
  
  /**
   * Get user by ID
   */
  async getUser(userId) {
    await this.simulateProcessingTime();
    this.checkForSimulatedFailures();
    
    if (!this.users.has(userId)) {
      const error = new Error(`User with ID ${userId} not found`);
      error.statusCode = 404;
      throw error;
    }
    
    const user = this.users.get(userId);
    
    this.logger.info('User retrieved', {
      userId: user.id,
      userName: user.name
    });
    
    return {
      user,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Create new user
   */
  async createUser(userData) {
    await this.simulateProcessingTime();
    this.checkForSimulatedFailures();
    
    // Validate required fields
    if (!userData.name || !userData.email) {
      const error = new Error('Name and email are required');
      error.statusCode = 400;
      throw error;
    }
    
    // Check if email already exists
    const existingUser = Array.from(this.users.values())
      .find(user => user.email === userData.email);
    
    if (existingUser) {
      const error = new Error('User with this email already exists');
      error.statusCode = 409;
      throw error;
    }
    
    const user = {
      id: uuidv4(),
      name: userData.name,
      email: userData.email,
      status: userData.status || 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    this.users.set(user.id, user);
    
    this.logger.info('User created', {
      userId: user.id,
      userName: user.name,
      userEmail: user.email
    });
    
    return {
      user,
      message: 'User created successfully'
    };
  }
  
  /**
   * Update user
   */
  async updateUser(userId, updateData) {
    await this.simulateProcessingTime();
    this.checkForSimulatedFailures();
    
    if (!this.users.has(userId)) {
      const error = new Error(`User with ID ${userId} not found`);
      error.statusCode = 404;
      throw error;
    }
    
    const user = { ...this.users.get(userId) };
    
    // Update fields
    if (updateData.name) user.name = updateData.name;
    if (updateData.email) user.email = updateData.email;
    if (updateData.status) user.status = updateData.status;
    user.updatedAt = new Date().toISOString();
    
    this.users.set(userId, user);
    
    this.logger.info('User updated', {
      userId: user.id,
      userName: user.name,
      changes: updateData
    });
    
    return {
      user,
      message: 'User updated successfully'
    };
  }
  
  /**
   * Delete user
   */
  async deleteUser(userId) {
    await this.simulateProcessingTime();
    this.checkForSimulatedFailures();
    
    if (!this.users.has(userId)) {
      const error = new Error(`User with ID ${userId} not found`);
      error.statusCode = 404;
      throw error;
    }
    
    const user = this.users.get(userId);
    this.users.delete(userId);
    
    this.logger.info('User deleted', {
      userId: user.id,
      userName: user.name
    });
    
    return {
      message: 'User deleted successfully',
      deletedUser: user
    };
  }
  
  /**
   * List users with optional filtering
   */
  async listUsers(query = {}) {
    await this.simulateProcessingTime();
    this.checkForSimulatedFailures();
    
    let users = Array.from(this.users.values());
    
    // Apply filters
    if (query.status) {
      users = users.filter(user => user.status === query.status);
    }
    
    if (query.search) {
      const searchTerm = query.search.toLowerCase();
      users = users.filter(user => 
        user.name.toLowerCase().includes(searchTerm) ||
        user.email.toLowerCase().includes(searchTerm)
      );
    }
    
    // Apply pagination
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    const paginatedUsers = users.slice(startIndex, endIndex);
    
    this.logger.info('Users listed', {
      totalUsers: users.length,
      returnedUsers: paginatedUsers.length,
      page,
      limit,
      filters: query
    });
    
    return {
      users: paginatedUsers,
      pagination: {
        page,
        limit,
        total: users.length,
        pages: Math.ceil(users.length / limit)
      },
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Perform health check
   */
  async performHealthCheck() {
    // Simulate health check processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (!this.isHealthy) {
      throw new Error('User service is currently unhealthy');
    }
    
    return {
      database: 'connected',
      memory: {
        used: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal
      },
      uptime: process.uptime(),
      userCount: this.users.size,
      lastCheck: new Date().toISOString()
    };
  }
  
  /**
   * Perform recovery actions
   */
  async performRecovery(error) {
    this.logger.info('Performing user service recovery', {
      error: error.message
    });
    
    // Simulate recovery actions
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Reset service state
    this.isHealthy = true;
    this.simulateFailures = false;
    
    this.logger.info('User service recovery completed');
  }
  
  /**
   * Simulate processing time
   */
  async simulateProcessingTime() {
    // Simulate variable processing time
    const processingTime = Math.random() * 100 + 50; // 50-150ms
    await new Promise(resolve => setTimeout(resolve, processingTime));
    
    // Occasionally simulate slow requests
    if (Math.random() < this.config.demo.slowRequestRate) {
      const slowDelay = this.config.demo.slowRequestDelay;
      this.logger.debug('Simulating slow request', { delay: slowDelay });
      await new Promise(resolve => setTimeout(resolve, slowDelay));
    }
  }
  
  /**
   * Check for simulated failures
   */
  checkForSimulatedFailures() {
    if (this.simulateFailures || Math.random() < this.config.demo.failureRate) {
      throw new Error('Simulated user service failure');
    }
  }
  
  /**
   * Start the user service
   */
  start() {
    const port = this.config.port;
    
    this.server = this.app.listen(port, () => {
      this.logger.info('User service started', {
        port,
        environment: this.config.env,
        userCount: this.users.size,
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
    this.logger.info('Starting user service shutdown...');
    
    // Stop accepting new connections
    this.server.close(() => {
      this.logger.info('User service HTTP server closed');
    });
    
    // Cleanup auto-recovery
    this.recovery.destroy();
    
    this.logger.info('User service shutdown completed');
    process.exit(0);
  }
}

// Start the service if this file is run directly
if (require.main === module) {
  const userService = new UserService();
  userService.start();
}

module.exports = UserService;
