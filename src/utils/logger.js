/**
 * Logger utility for the self-healing microservices project
 * 
 * This logger provides structured logging with different levels
 * and can be easily configured for different environments.
 */

const winston = require('winston');

// Define custom log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// Define colors for console output
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue'
};

winston.addColors(colors);

// Create logger with custom format
const logger = winston.createLogger({
  levels,
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.prettyPrint()
  ),
  defaultMeta: {
    service: process.env.SERVICE_NAME || 'microservice',
    version: process.env.SERVICE_VERSION || '1.0.0'
  },
  transports: [
    // Write all logs with level 'error' and below to error.log
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    
    // Write all logs to combined.log
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ]
});

// If not in production, also log to console with colorized format
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      winston.format.timestamp({
        format: 'HH:mm:ss'
      }),
      winston.format.printf(info => {
        const { timestamp, level, message, service, ...extra } = info;
        let log = `${timestamp} [${service}] ${level}: ${message}`;
        
        // Add extra fields if they exist
        if (Object.keys(extra).length > 0) {
          log += ` ${JSON.stringify(extra, null, 2)}`;
        }
        
        return log;
      })
    )
  }));
}

/**
 * Create a child logger with additional context
 * @param {Object} context - Additional context to include in logs
 * @returns {winston.Logger} Child logger
 */
logger.createChild = function(context) {
  return logger.child(context);
};

/**
 * Log performance metrics
 * @param {string} operation - Operation name
 * @param {number} duration - Duration in milliseconds
 * @param {Object} metadata - Additional metadata
 */
logger.performance = function(operation, duration, metadata = {}) {
  logger.info('Performance metric', {
    type: 'performance',
    operation,
    duration,
    ...metadata
  });
};

/**
 * Log circuit breaker events
 * @param {string} event - Event type
 * @param {Object} data - Event data
 */
logger.circuitBreaker = function(event, data) {
  logger.info('Circuit breaker event', {
    type: 'circuit-breaker',
    event,
    ...data
  });
};

/**
 * Log bulkhead events
 * @param {string} event - Event type
 * @param {Object} data - Event data
 */
logger.bulkhead = function(event, data) {
  logger.info('Bulkhead event', {
    type: 'bulkhead',
    event,
    ...data
  });
};

/**
 * Log auto-recovery events
 * @param {string} event - Event type
 * @param {Object} data - Event data
 */
logger.recovery = function(event, data) {
  logger.info('Auto-recovery event', {
    type: 'auto-recovery',
    event,
    ...data
  });
};

/**
 * Log health check results
 * @param {string} service - Service name
 * @param {boolean} healthy - Health status
 * @param {Object} details - Health check details
 */
logger.health = function(service, healthy, details = {}) {
  const level = healthy ? 'info' : 'warn';
  logger[level]('Health check', {
    type: 'health-check',
    service,
    healthy,
    ...details
  });
};

/**
 * Log request/response
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {number} duration - Request duration in ms
 */
logger.request = function(req, res, duration) {
  logger.info('HTTP Request', {
    type: 'http-request',
    method: req.method,
    url: req.url,
    statusCode: res.statusCode,
    duration,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress
  });
};

module.exports = logger;
