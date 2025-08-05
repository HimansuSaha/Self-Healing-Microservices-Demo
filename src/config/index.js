/**
 * Configuration management for the self-healing microservices project
 * 
 * This module manages configuration for all services and patterns,
 * with environment-specific overrides and validation.
 */

require('dotenv').config();
const Joi = require('joi');

/**
 * Configuration schema for validation
 */
const configSchema = Joi.object({
  // Environment
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  
  // Service configuration
  SERVICE_NAME: Joi.string().default('microservice'),
  SERVICE_VERSION: Joi.string().default('1.0.0'),
  
  // API Gateway
  GATEWAY_PORT: Joi.number().port().default(3000),
  GATEWAY_HOST: Joi.string().default('localhost'),
  
  // Services ports
  USER_SERVICE_PORT: Joi.number().port().default(3001),
  ORDER_SERVICE_PORT: Joi.number().port().default(3002),
  PAYMENT_SERVICE_PORT: Joi.number().port().default(3003),
  NOTIFICATION_SERVICE_PORT: Joi.number().port().default(3004),
  MONITOR_SERVICE_PORT: Joi.number().port().default(3005),
  
  // Circuit Breaker configuration
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: Joi.number().min(1).default(5),
  CIRCUIT_BREAKER_RESET_TIMEOUT: Joi.number().min(1000).default(60000),
  CIRCUIT_BREAKER_TIMEOUT: Joi.number().min(100).default(10000),
  CIRCUIT_BREAKER_MONITORING_PERIOD: Joi.number().min(1000).default(10000),
  
  // Bulkhead configuration
  BULKHEAD_MAX_CONCURRENT: Joi.number().min(1).default(10),
  BULKHEAD_MAX_QUEUE_SIZE: Joi.number().min(1).default(100),
  BULKHEAD_TIMEOUT: Joi.number().min(1000).default(30000),
  BULKHEAD_QUEUE_TIMEOUT: Joi.number().min(1000).default(60000),
  
  // Auto-Recovery configuration
  RECOVERY_MAX_RETRIES: Joi.number().min(0).default(3),
  RECOVERY_INITIAL_DELAY: Joi.number().min(100).default(1000),
  RECOVERY_MAX_DELAY: Joi.number().min(1000).default(30000),
  RECOVERY_BACKOFF_MULTIPLIER: Joi.number().min(1).default(2),
  RECOVERY_HEALTH_CHECK_INTERVAL: Joi.number().min(1000).default(5000),
  RECOVERY_FAILURE_THRESHOLD: Joi.number().min(1).default(3),
  RECOVERY_RECOVERY_THRESHOLD: Joi.number().min(1).default(2),
  
  // Database configuration (if needed)
  DATABASE_URL: Joi.string().default(''),
  DATABASE_POOL_SIZE: Joi.number().min(1).default(10),
  
  // Redis configuration (for caching)
  REDIS_URL: Joi.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  
  // Monitoring
  METRICS_ENABLED: Joi.boolean().default(true),
  METRICS_INTERVAL: Joi.number().min(1000).default(10000),
  HEALTH_CHECK_ENABLED: Joi.boolean().default(true),
  
  // Demo configuration
  DEMO_FAILURE_RATE: Joi.number().min(0).max(1).default(0.3), // 30% failure rate
  DEMO_SLOW_REQUEST_RATE: Joi.number().min(0).max(1).default(0.2), // 20% slow requests
  DEMO_SLOW_REQUEST_DELAY: Joi.number().min(100).default(5000),
  
  // Security
  CORS_ORIGIN: Joi.string().default('*'),
  RATE_LIMIT_WINDOW_MS: Joi.number().min(1000).default(900000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: Joi.number().min(1).default(100)
});

/**
 * Validate and parse environment variables
 */
const { error, value: envVars } = configSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

/**
 * Configuration object
 */
const config = {
  // Environment
  env: envVars.NODE_ENV,
  logLevel: envVars.LOG_LEVEL,
  isDevelopment: envVars.NODE_ENV === 'development',
  isProduction: envVars.NODE_ENV === 'production',
  isTest: envVars.NODE_ENV === 'test',
  
  // Service info
  service: {
    name: envVars.SERVICE_NAME,
    version: envVars.SERVICE_VERSION
  },
  
  // Server configuration
  server: {
    gateway: {
      port: envVars.GATEWAY_PORT,
      host: envVars.GATEWAY_HOST
    },
    services: {
      user: {
        port: envVars.USER_SERVICE_PORT,
        url: `http://localhost:${envVars.USER_SERVICE_PORT}`
      },
      order: {
        port: envVars.ORDER_SERVICE_PORT,
        url: `http://localhost:${envVars.ORDER_SERVICE_PORT}`
      },
      payment: {
        port: envVars.PAYMENT_SERVICE_PORT,
        url: `http://localhost:${envVars.PAYMENT_SERVICE_PORT}`
      },
      notification: {
        port: envVars.NOTIFICATION_SERVICE_PORT,
        url: `http://localhost:${envVars.NOTIFICATION_SERVICE_PORT}`
      },
      monitor: {
        port: envVars.MONITOR_SERVICE_PORT,
        url: `http://localhost:${envVars.MONITOR_SERVICE_PORT}`
      }
    }
  },
  
  // Circuit Breaker configuration
  circuitBreaker: {
    failureThreshold: envVars.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    resetTimeout: envVars.CIRCUIT_BREAKER_RESET_TIMEOUT,
    timeout: envVars.CIRCUIT_BREAKER_TIMEOUT,
    monitoringPeriod: envVars.CIRCUIT_BREAKER_MONITORING_PERIOD
  },
  
  // Bulkhead configuration
  bulkhead: {
    maxConcurrent: envVars.BULKHEAD_MAX_CONCURRENT,
    maxQueueSize: envVars.BULKHEAD_MAX_QUEUE_SIZE,
    timeout: envVars.BULKHEAD_TIMEOUT,
    queueTimeout: envVars.BULKHEAD_QUEUE_TIMEOUT
  },
  
  // Auto-Recovery configuration
  autoRecovery: {
    maxRetries: envVars.RECOVERY_MAX_RETRIES,
    initialDelay: envVars.RECOVERY_INITIAL_DELAY,
    maxDelay: envVars.RECOVERY_MAX_DELAY,
    backoffMultiplier: envVars.RECOVERY_BACKOFF_MULTIPLIER,
    healthCheckInterval: envVars.RECOVERY_HEALTH_CHECK_INTERVAL,
    failureThreshold: envVars.RECOVERY_FAILURE_THRESHOLD,
    recoveryThreshold: envVars.RECOVERY_RECOVERY_THRESHOLD
  },
  
  // Database configuration
  database: {
    url: envVars.DATABASE_URL,
    poolSize: envVars.DATABASE_POOL_SIZE
  },
  
  // Redis configuration
  redis: {
    url: envVars.REDIS_URL,
    password: envVars.REDIS_PASSWORD
  },
  
  // Monitoring configuration
  monitoring: {
    enabled: envVars.METRICS_ENABLED,
    interval: envVars.METRICS_INTERVAL,
    healthCheckEnabled: envVars.HEALTH_CHECK_ENABLED
  },
  
  // Demo configuration
  demo: {
    failureRate: envVars.DEMO_FAILURE_RATE,
    slowRequestRate: envVars.DEMO_SLOW_REQUEST_RATE,
    slowRequestDelay: envVars.DEMO_SLOW_REQUEST_DELAY
  },
  
  // Security configuration
  security: {
    corsOrigin: envVars.CORS_ORIGIN,
    rateLimit: {
      windowMs: envVars.RATE_LIMIT_WINDOW_MS,
      maxRequests: envVars.RATE_LIMIT_MAX_REQUESTS
    }
  }
};

/**
 * Get configuration for a specific service
 * @param {string} serviceName - Name of the service
 * @returns {Object} Service-specific configuration
 */
config.getServiceConfig = function(serviceName) {
  const baseConfig = {
    service: config.service,
    env: config.env,
    logLevel: config.logLevel,
    monitoring: config.monitoring,
    security: config.security
  };
  
  switch (serviceName) {
    case 'gateway':
      return {
        ...baseConfig,
        port: config.server.gateway.port,
        host: config.server.gateway.host,
        services: config.server.services,
        circuitBreaker: config.circuitBreaker,
        bulkhead: config.bulkhead,
        demo: config.demo
      };
      
    case 'user':
    case 'order':
    case 'payment':
    case 'notification':
      return {
        ...baseConfig,
        port: config.server.services[serviceName].port,
        autoRecovery: config.autoRecovery,
        demo: config.demo,
        database: config.database
      };
      
    case 'monitor':
      return {
        ...baseConfig,
        port: config.server.services.monitor.port,
        services: config.server.services,
        monitoring: config.monitoring
      };
      
    default:
      return baseConfig;
  }
};

/**
 * Get environment-specific overrides
 * @returns {Object} Environment overrides
 */
config.getEnvironmentOverrides = function() {
  const overrides = {};
  
  if (config.isDevelopment) {
    overrides.logLevel = 'debug';
    overrides.demo = {
      ...config.demo,
      failureRate: 0.5, // Higher failure rate for demo
      slowRequestRate: 0.3
    };
  }
  
  if (config.isProduction) {
    overrides.logLevel = 'warn';
    overrides.demo = {
      ...config.demo,
      failureRate: 0.1, // Lower failure rate in production
      slowRequestRate: 0.05
    };
  }
  
  if (config.isTest) {
    overrides.logLevel = 'error';
    overrides.monitoring = {
      ...config.monitoring,
      interval: 1000 // Faster monitoring for tests
    };
  }
  
  return overrides;
};

/**
 * Validate service dependencies
 * @param {Array} requiredServices - List of required services
 * @returns {boolean} True if all dependencies are available
 */
config.validateDependencies = function(requiredServices) {
  // In a real implementation, this would check if services are reachable
  // For demo purposes, we assume all services are available
  return true;
};

module.exports = config;
