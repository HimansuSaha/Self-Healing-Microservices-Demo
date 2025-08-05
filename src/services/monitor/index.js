/**
 * Monitoring Dashboard Service
 * 
 * Provides a web-based dashboard to visualize the health and metrics
 * of all microservices and their self-healing patterns.
 */

const express = require('express');
const path = require('path');
const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');

class MonitoringService {
  constructor() {
    this.app = express();
    this.config = config.getServiceConfig('monitor');
    this.logger = logger.createChild({ service: 'monitoring-service' });
    
    // Service endpoints
    this.services = {
      gateway: `http://localhost:${config.server.gateway.port}`,
      user: config.server.services.user.url,
      order: config.server.services.order.url,
      payment: config.server.services.payment.url,
      notification: config.server.services.notification.url
    };
    
    // Cached metrics
    this.metricsCache = {
      lastUpdated: null,
      data: {}
    };
    
    this.setupMiddleware();
    this.setupRoutes();
    this.startMetricsCollection();
  }
  
  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));
    
    // CORS for dashboard
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    });
  }
  
  setupRoutes() {
    // Dashboard home page
    this.app.get('/', (req, res) => {
      res.send(this.generateDashboardHTML());
    });
    
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'monitoring-service',
        timestamp: new Date().toISOString(),
        monitoredServices: Object.keys(this.services),
        lastMetricsUpdate: this.metricsCache.lastUpdated
      });
    });
    
    // Get all service metrics
    this.app.get('/api/metrics', async (req, res) => {
      try {
        const metrics = await this.collectAllMetrics();
        res.json({
          timestamp: new Date().toISOString(),
          services: metrics
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to collect metrics',
          message: error.message
        });
      }
    });
    
    // Get specific service metrics
    this.app.get('/api/metrics/:service', async (req, res) => {
      const serviceName = req.params.service;
      
      if (!this.services[serviceName]) {
        return res.status(404).json({
          error: 'Service not found',
          availableServices: Object.keys(this.services)
        });
      }
      
      try {
        const metrics = await this.collectServiceMetrics(serviceName);
        res.json({
          service: serviceName,
          timestamp: new Date().toISOString(),
          ...metrics
        });
      } catch (error) {
        res.status(500).json({
          error: `Failed to collect metrics for ${serviceName}`,
          message: error.message
        });
      }
    });
    
    // Get circuit breaker status
    this.app.get('/api/circuit-breakers', async (req, res) => {
      try {
        const circuitBreakers = await this.getCircuitBreakerStatus();
        res.json({
          timestamp: new Date().toISOString(),
          circuitBreakers
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to get circuit breaker status',
          message: error.message
        });
      }
    });
    
    // Get bulkhead status
    this.app.get('/api/bulkheads', async (req, res) => {
      try {
        const bulkheads = await this.getBulkheadStatus();
        res.json({
          timestamp: new Date().toISOString(),
          bulkheads
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to get bulkhead status',
          message: error.message
        });
      }
    });
    
    // Get recovery status
    this.app.get('/api/recovery', async (req, res) => {
      try {
        const recovery = await this.getRecoveryStatus();
        res.json({
          timestamp: new Date().toISOString(),
          recovery
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to get recovery status',
          message: error.message
        });
      }
    });
    
    // Get system overview
    this.app.get('/api/overview', async (req, res) => {
      try {
        const overview = await this.getSystemOverview();
        res.json({
          timestamp: new Date().toISOString(),
          ...overview
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to get system overview',
          message: error.message
        });
      }
    });
    
    // WebSocket endpoint for real-time updates (simplified)
    this.app.get('/api/stream', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      
      const sendUpdate = async () => {
        try {
          const overview = await this.getSystemOverview();
          res.write(`data: ${JSON.stringify(overview)}\\n\\n`);
        } catch (error) {
          res.write(`data: ${JSON.stringify({ error: error.message })}\\n\\n`);
        }
      };
      
      // Send initial data
      sendUpdate();
      
      // Send updates every 5 seconds
      const interval = setInterval(sendUpdate, 5000);
      
      req.on('close', () => {
        clearInterval(interval);
      });
    });
  }
  
  async collectAllMetrics() {
    const metrics = {};
    
    for (const [serviceName, serviceUrl] of Object.entries(this.services)) {
      try {
        metrics[serviceName] = await this.collectServiceMetrics(serviceName);
      } catch (error) {
        this.logger.warn(`Failed to collect metrics for ${serviceName}`, {
          error: error.message
        });
        
        metrics[serviceName] = {
          status: 'unreachable',
          error: error.message,
          lastSeen: this.metricsCache.data[serviceName]?.lastSeen || null
        };
      }
    }
    
    // Cache the results
    this.metricsCache.data = metrics;
    this.metricsCache.lastUpdated = new Date().toISOString();
    
    return metrics;
  }
  
  async collectServiceMetrics(serviceName) {
    const serviceUrl = this.services[serviceName];
    const timeout = 5000; // 5 second timeout
    
    try {
      // Get health status
      const healthResponse = await axios.get(`${serviceUrl}/health`, { timeout });
      
      let metricsData = null;
      let patternsData = null;
      
      // Try to get metrics if available
      try {
        if (serviceName === 'gateway') {
          const metricsResponse = await axios.get(`${serviceUrl}/metrics`, { timeout });
          metricsData = metricsResponse.data;
          
          // Get pattern-specific data
          const circuitBreakersResponse = await axios.get(`${serviceUrl}/api/patterns/circuit-breakers`, { timeout });
          const bulkheadsResponse = await axios.get(`${serviceUrl}/api/patterns/bulkheads`, { timeout });
          const recoveryResponse = await axios.get(`${serviceUrl}/api/patterns/recovery`, { timeout });
          
          patternsData = {
            circuitBreakers: circuitBreakersResponse.data,
            bulkheads: bulkheadsResponse.data,
            recovery: recoveryResponse.data
          };
        }
      } catch (error) {
        // Metrics endpoint may not be available for all services
        this.logger.debug(`Metrics not available for ${serviceName}`, {
          error: error.message
        });
      }
      
      return {
        status: 'healthy',
        health: healthResponse.data,
        metrics: metricsData,
        patterns: patternsData,
        lastSeen: new Date().toISOString(),
        responseTime: Date.now() - Date.now() // This would be calculated properly in real implementation
      };
      
    } catch (error) {
      throw new Error(`Service ${serviceName} unreachable: ${error.message}`);
    }
  }
  
  async getCircuitBreakerStatus() {
    try {
      const response = await axios.get(`${this.services.gateway}/api/patterns/circuit-breakers`, {
        timeout: 5000
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get circuit breaker status: ${error.message}`);
    }
  }
  
  async getBulkheadStatus() {
    const bulkheadData = {};
    
    // Get bulkheads from gateway
    try {
      const gatewayResponse = await axios.get(`${this.services.gateway}/api/patterns/bulkheads`, {
        timeout: 5000
      });
      bulkheadData.gateway = gatewayResponse.data;
    } catch (error) {
      this.logger.warn('Failed to get gateway bulkhead status', { error: error.message });
    }
    
    // Get bulkheads from order service (if available)
    try {
      const orderHealth = await axios.get(`${this.services.order}/health`, { timeout: 5000 });
      if (orderHealth.data.bulkheads) {
        bulkheadData.order = orderHealth.data.bulkheads;
      }
    } catch (error) {
      this.logger.warn('Failed to get order service bulkhead status', { error: error.message });
    }
    
    return bulkheadData;
  }
  
  async getRecoveryStatus() {
    try {
      const response = await axios.get(`${this.services.gateway}/api/patterns/recovery`, {
        timeout: 5000
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get recovery status: ${error.message}`);
    }
  }
  
  async getSystemOverview() {
    const overview = {
      totalServices: Object.keys(this.services).length,
      healthyServices: 0,
      unhealthyServices: 0,
      circuitBreakers: {
        total: 0,
        open: 0,
        halfOpen: 0,
        closed: 0
      },
      bulkheads: {
        total: 0,
        utilizationHigh: 0,
        queueFull: 0
      },
      recovery: {
        total: 0,
        recovering: 0,
        failed: 0,
        healthy: 0
      },
      alerts: []
    };
    
    // Get current metrics from cache or collect fresh
    let metrics = this.metricsCache.data;
    if (!metrics || !this.metricsCache.lastUpdated || 
        Date.now() - new Date(this.metricsCache.lastUpdated).getTime() > 30000) {
      try {
        metrics = await this.collectAllMetrics();
      } catch (error) {
        metrics = this.metricsCache.data || {};
      }
    }
    
    // Analyze service health
    Object.entries(metrics).forEach(([serviceName, serviceData]) => {
      if (serviceData.status === 'healthy') {
        overview.healthyServices++;
      } else {
        overview.unhealthyServices++;
        overview.alerts.push({
          type: 'service_unhealthy',
          service: serviceName,
          message: `${serviceName} service is unhealthy`,
          severity: 'high',
          timestamp: new Date().toISOString()
        });
      }
    });
    
    // Analyze circuit breakers
    try {
      const circuitBreakers = await this.getCircuitBreakerStatus();
      Object.values(circuitBreakers).forEach(cb => {
        overview.circuitBreakers.total++;
        overview.circuitBreakers[cb.state.toLowerCase()]++;
        
        if (cb.state === 'OPEN') {
          overview.alerts.push({
            type: 'circuit_breaker_open',
            service: cb.name,
            message: `Circuit breaker ${cb.name} is OPEN`,
            severity: 'medium',
            timestamp: new Date().toISOString()
          });
        }
      });
    } catch (error) {
      // Circuit breaker data not available
    }
    
    // Analyze bulkheads
    try {
      const bulkheads = await this.getBulkheadStatus();
      Object.values(bulkheads).forEach(serviceData => {
        Object.values(serviceData).forEach(bulkhead => {
          overview.bulkheads.total++;
          
          const utilization = (bulkhead.currentConcurrency / bulkhead.config.maxConcurrent) * 100;
          const queueUtilization = (bulkhead.queueSize / bulkhead.config.maxQueueSize) * 100;
          
          if (utilization > 80) {
            overview.bulkheads.utilizationHigh++;
            overview.alerts.push({
              type: 'bulkhead_high_utilization',
              service: bulkhead.name,
              message: `Bulkhead ${bulkhead.name} utilization is ${utilization.toFixed(1)}%`,
              severity: 'medium',
              timestamp: new Date().toISOString()
            });
          }
          
          if (queueUtilization > 90) {
            overview.bulkheads.queueFull++;
            overview.alerts.push({
              type: 'bulkhead_queue_full',
              service: bulkhead.name,
              message: `Bulkhead ${bulkhead.name} queue is ${queueUtilization.toFixed(1)}% full`,
              severity: 'high',
              timestamp: new Date().toISOString()
            });
          }
        });
      });
    } catch (error) {
      // Bulkhead data not available
    }
    
    // Analyze recovery status
    try {
      const recovery = await this.getRecoveryStatus();
      Object.values(recovery).forEach(rm => {
        overview.recovery.total++;
        overview.recovery[rm.state.toLowerCase()]++;
        
        if (rm.state === 'FAILED') {
          overview.alerts.push({
            type: 'recovery_failed',
            service: rm.name,
            message: `Recovery manager ${rm.name} is in FAILED state`,
            severity: 'high',
            timestamp: new Date().toISOString()
          });
        } else if (rm.state === 'RECOVERING') {
          overview.alerts.push({
            type: 'recovery_in_progress',
            service: rm.name,
            message: `Recovery manager ${rm.name} is recovering`,
            severity: 'low',
            timestamp: new Date().toISOString()
          });
        }
      });
    } catch (error) {
      // Recovery data not available
    }
    
    // Sort alerts by severity
    const severityOrder = { high: 3, medium: 2, low: 1 };
    overview.alerts.sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);
    
    return overview;
  }
  
  startMetricsCollection() {
    // Collect metrics every 30 seconds
    setInterval(async () => {
      try {
        await this.collectAllMetrics();
        this.logger.debug('Metrics collection completed');
      } catch (error) {
        this.logger.error('Metrics collection failed', {
          error: error.message
        });
      }
    }, 30000);
    
    // Initial collection
    setTimeout(() => this.collectAllMetrics(), 5000);
  }
  
  generateDashboardHTML() {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Self-Healing Microservices Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #333;
            min-height: 100vh;
        }
        
        .header {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            padding: 1rem 2rem;
            border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .header h1 {
            color: white;
            font-size: 2rem;
            font-weight: 300;
        }
        
        .header p {
            color: rgba(255, 255, 255, 0.8);
            margin-top: 0.5rem;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .stat-card {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 10px;
            padding: 1.5rem;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .stat-card h3 {
            color: #333;
            margin-bottom: 1rem;
            font-size: 1.1rem;
        }
        
        .stat-value {
            font-size: 2.5rem;
            font-weight: bold;
            color: #667eea;
            margin-bottom: 0.5rem;
        }
        
        .stat-label {
            color: #666;
            font-size: 0.9rem;
        }
        
        .dashboard-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2rem;
            margin-bottom: 2rem;
        }
        
        .panel {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 10px;
            padding: 1.5rem;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .panel h2 {
            color: #333;
            margin-bottom: 1rem;
            font-size: 1.3rem;
        }
        
        .service-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.75rem;
            margin: 0.5rem 0;
            background: rgba(255, 255, 255, 0.5);
            border-radius: 5px;
            border-left: 4px solid #667eea;
        }
        
        .service-name {
            font-weight: 500;
        }
        
        .status {
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
        }
        
        .status.healthy {
            background: #d4edda;
            color: #155724;
        }
        
        .status.unhealthy {
            background: #f8d7da;
            color: #721c24;
        }
        
        .status.open {
            background: #f8d7da;
            color: #721c24;
        }
        
        .status.closed {
            background: #d4edda;
            color: #155724;
        }
        
        .status.half-open {
            background: #fff3cd;
            color: #856404;
        }
        
        .alert {
            padding: 1rem;
            margin: 0.5rem 0;
            border-radius: 5px;
            border-left: 4px solid;
        }
        
        .alert.high {
            background: #f8d7da;
            border-color: #dc3545;
            color: #721c24;
        }
        
        .alert.medium {
            background: #fff3cd;
            border-color: #ffc107;
            color: #856404;
        }
        
        .alert.low {
            background: #d1ecf1;
            border-color: #17a2b8;
            color: #0c5460;
        }
        
        .loading {
            text-align: center;
            padding: 2rem;
            color: #666;
        }
        
        .refresh-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 0.5rem 1rem;
            border-radius: 5px;
            cursor: pointer;
            margin-bottom: 1rem;
        }
        
        .refresh-btn:hover {
            background: #5a67d8;
        }
        
        @media (max-width: 768px) {
            .dashboard-grid {
                grid-template-columns: 1fr;
            }
            
            .container {
                padding: 1rem;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🛡️ Self-Healing Microservices Dashboard</h1>
        <p>Real-time monitoring of Circuit Breakers, Bulkheads, and Auto-Recovery patterns</p>
    </div>
    
    <div class="container">
        <div class="stats-grid" id="statsGrid">
            <div class="loading">Loading system overview...</div>
        </div>
        
        <div class="dashboard-grid">
            <div class="panel">
                <h2>🔌 Service Health</h2>
                <button class="refresh-btn" onclick="refreshData()">Refresh</button>
                <div id="serviceHealth">
                    <div class="loading">Loading service health...</div>
                </div>
            </div>
            
            <div class="panel">
                <h2>⚡ Circuit Breakers</h2>
                <div id="circuitBreakers">
                    <div class="loading">Loading circuit breakers...</div>
                </div>
            </div>
        </div>
        
        <div class="dashboard-grid">
            <div class="panel">
                <h2>🚧 Bulkheads</h2>
                <div id="bulkheads">
                    <div class="loading">Loading bulkheads...</div>
                </div>
            </div>
            
            <div class="panel">
                <h2>🔄 Auto-Recovery</h2>
                <div id="recovery">
                    <div class="loading">Loading recovery status...</div>
                </div>
            </div>
        </div>
        
        <div class="panel">
            <h2>🚨 System Alerts</h2>
            <div id="alerts">
                <div class="loading">Loading alerts...</div>
            </div>
        </div>
    </div>

    <script>
        let refreshInterval;
        
        async function fetchData(endpoint) {
            try {
                const response = await fetch(endpoint);
                return await response.json();
            } catch (error) {
                console.error('Failed to fetch data:', error);
                return null;
            }
        }
        
        function updateStatsGrid(overview) {
            const statsGrid = document.getElementById('statsGrid');
            statsGrid.innerHTML = \`
                <div class="stat-card">
                    <h3>Services</h3>
                    <div class="stat-value">\${overview.healthyServices}/\${overview.totalServices}</div>
                    <div class="stat-label">Healthy Services</div>
                </div>
                <div class="stat-card">
                    <h3>Circuit Breakers</h3>
                    <div class="stat-value">\${overview.circuitBreakers.open}</div>
                    <div class="stat-label">Open Circuits</div>
                </div>
                <div class="stat-card">
                    <h3>Bulkheads</h3>
                    <div class="stat-value">\${overview.bulkheads.utilizationHigh}</div>
                    <div class="stat-label">High Utilization</div>
                </div>
                <div class="stat-card">
                    <h3>Recovery</h3>
                    <div class="stat-value">\${overview.recovery.recovering}</div>
                    <div class="stat-label">Recovering</div>
                </div>
            \`;
        }
        
        function updateServiceHealth(metrics) {
            const serviceHealth = document.getElementById('serviceHealth');
            let html = '';
            
            Object.entries(metrics.services || {}).forEach(([name, data]) => {
                const status = data.status === 'healthy' ? 'healthy' : 'unhealthy';
                html += \`
                    <div class="service-item">
                        <span class="service-name">\${name.toUpperCase()}</span>
                        <span class="status \${status}">\${status.toUpperCase()}</span>
                    </div>
                \`;
            });
            
            serviceHealth.innerHTML = html || '<p>No service data available</p>';
        }
        
        function updateCircuitBreakers(data) {
            const circuitBreakers = document.getElementById('circuitBreakers');
            let html = '';
            
            Object.entries(data.circuitBreakers || {}).forEach(([name, cb]) => {
                const state = cb.state.toLowerCase();
                html += \`
                    <div class="service-item">
                        <span class="service-name">\${name}</span>
                        <span class="status \${state}">\${cb.state}</span>
                    </div>
                \`;
            });
            
            circuitBreakers.innerHTML = html || '<p>No circuit breaker data available</p>';
        }
        
        function updateBulkheads(data) {
            const bulkheads = document.getElementById('bulkheads');
            let html = '';
            
            Object.entries(data.bulkheads || {}).forEach(([serviceName, serviceData]) => {
                Object.entries(serviceData).forEach(([name, bulkhead]) => {
                    const utilization = ((bulkhead.currentConcurrency || 0) / (bulkhead.config?.maxConcurrent || 1) * 100).toFixed(1);
                    html += \`
                        <div class="service-item">
                            <span class="service-name">\${name}</span>
                            <span class="stat-label">\${utilization}% utilized</span>
                        </div>
                    \`;
                });
            });
            
            bulkheads.innerHTML = html || '<p>No bulkhead data available</p>';
        }
        
        function updateRecovery(data) {
            const recovery = document.getElementById('recovery');
            let html = '';
            
            Object.entries(data.recovery || {}).forEach(([name, rm]) => {
                const state = rm.state.toLowerCase();
                html += \`
                    <div class="service-item">
                        <span class="service-name">\${name}</span>
                        <span class="status \${state}">\${rm.state}</span>
                    </div>
                \`;
            });
            
            recovery.innerHTML = html || '<p>No recovery data available</p>';
        }
        
        function updateAlerts(overview) {
            const alerts = document.getElementById('alerts');
            let html = '';
            
            (overview.alerts || []).forEach(alert => {
                html += \`
                    <div class="alert \${alert.severity}">
                        <strong>\${alert.type.replace(/_/g, ' ').toUpperCase()}:</strong>
                        \${alert.message}
                        <small style="float: right;">\${new Date(alert.timestamp).toLocaleTimeString()}</small>
                    </div>
                \`;
            });
            
            alerts.innerHTML = html || '<p>No alerts at this time 🎉</p>';
        }
        
        async function refreshData() {
            const overview = await fetchData('/api/overview');
            const metrics = await fetchData('/api/metrics');
            const circuitBreakers = await fetchData('/api/circuit-breakers');
            const bulkheads = await fetchData('/api/bulkheads');
            const recovery = await fetchData('/api/recovery');
            
            if (overview) {
                updateStatsGrid(overview);
                updateAlerts(overview);
            }
            
            if (metrics) {
                updateServiceHealth(metrics);
            }
            
            if (circuitBreakers) {
                updateCircuitBreakers(circuitBreakers);
            }
            
            if (bulkheads) {
                updateBulkheads(bulkheads);
            }
            
            if (recovery) {
                updateRecovery(recovery);
            }
        }
        
        // Initial load
        refreshData();
        
        // Auto-refresh every 10 seconds
        refreshInterval = setInterval(refreshData, 10000);
        
        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            if (refreshInterval) {
                clearInterval(refreshInterval);
            }
        });
    </script>
</body>
</html>
    `;
  }
  
  start() {
    const port = this.config.port;
    
    this.server = this.app.listen(port, () => {
      this.logger.info('Monitoring service started', {
        port,
        environment: this.config.env,
        dashboardUrl: `http://localhost:${port}`,
        monitoredServices: Object.keys(this.services)
      });
    });
    
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }
  
  async shutdown() {
    this.logger.info('Starting monitoring service shutdown...');
    
    this.server.close(() => {
      this.logger.info('Monitoring service HTTP server closed');
    });
    
    this.logger.info('Monitoring service shutdown completed');
    process.exit(0);
  }
}

if (require.main === module) {
  const monitoringService = new MonitoringService();
  monitoringService.start();
}

module.exports = MonitoringService;
