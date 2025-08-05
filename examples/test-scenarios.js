/**
 * Example usage and testing scenarios for the self-healing microservices
 */

const axios = require('axios');
const config = require('./src/config');

const GATEWAY_URL = `http://localhost:${config.server.gateway.port}`;
const MONITOR_URL = `http://localhost:${config.server.services.monitor.port}`;

class TestScenarios {
  constructor() {
    this.logger = console;
  }
  
  /**
   * Test Scenario 1: Circuit Breaker Pattern
   * Demonstrates how circuit breakers prevent cascading failures
   */
  async testCircuitBreaker() {
    this.logger.log('🔌 Testing Circuit Breaker Pattern...');
    
    try {
      // First, make some successful requests
      this.logger.log('Making successful requests...');
      for (let i = 0; i < 3; i++) {
        const response = await axios.get(`${GATEWAY_URL}/api/users/1`);
        this.logger.log(`✅ Request ${i + 1}: ${response.status}`);
        await this.delay(1000);
      }
      
      // Simulate payment service failures
      this.logger.log('\\n🔥 Simulating payment service failures...');
      await axios.post(`${GATEWAY_URL}/api/simulate/payment-failure`);
      
      // Make requests that will trigger failures
      this.logger.log('Making requests to payment service...');
      for (let i = 0; i < 8; i++) {
        try {
          await axios.post(`${GATEWAY_URL}/api/payments`, {
            amount: 100,
            method: 'credit_card',
            merchantId: 'merchant-123',
            orderId: 'order-' + i
          });
          this.logger.log(`✅ Payment request ${i + 1}: Success`);
        } catch (error) {
          this.logger.log(`❌ Payment request ${i + 1}: ${error.response?.status || 'Failed'} - ${error.response?.data?.error || error.message}`);
        }
        await this.delay(500);
      }
      
      // Check circuit breaker status
      this.logger.log('\\n📊 Checking circuit breaker status...');
      const cbStatus = await axios.get(`${GATEWAY_URL}/api/patterns/circuit-breakers`);
      Object.entries(cbStatus.data).forEach(([name, status]) => {
        this.logger.log(`  ${name}: ${status.state} (failures: ${status.failureCount})`);
      });
      
      // Reset patterns for next test
      await axios.post(`${GATEWAY_URL}/api/reset-patterns`);
      
    } catch (error) {
      this.logger.error('Circuit breaker test failed:', error.message);
    }
  }
  
  /**
   * Test Scenario 2: Bulkhead Pattern
   * Demonstrates resource isolation under high load
   */
  async testBulkhead() {
    this.logger.log('\\n🚧 Testing Bulkhead Pattern...');
    
    try {
      // Generate high load
      this.logger.log('Generating high load on order service...');
      
      const promises = [];
      for (let i = 0; i < 30; i++) {
        promises.push(
          axios.get(`${GATEWAY_URL}/api/orders/${i % 5 + 1}`)
            .then(response => ({ id: i, status: 'success', data: response.status }))
            .catch(error => ({ id: i, status: 'failed', error: error.response?.status || error.message }))
        );
      }
      
      const results = await Promise.allSettled(promises);
      
      let successful = 0;
      let failed = 0;
      
      results.forEach(result => {
        if (result.status === 'fulfilled') {
          if (result.value.status === 'success') {
            successful++;
          } else {
            failed++;
          }
        } else {
          failed++;
        }
      });
      
      this.logger.log(`📈 Load test results: ${successful} successful, ${failed} failed`);
      
      // Check bulkhead status
      this.logger.log('\\n📊 Checking bulkhead status...');
      const bhStatus = await axios.get(`${GATEWAY_URL}/api/patterns/bulkheads`);
      Object.entries(bhStatus.data).forEach(([name, status]) => {
        const utilization = ((status.currentConcurrency / status.config.maxConcurrent) * 100).toFixed(1);
        this.logger.log(`  ${name}: ${utilization}% utilized (${status.currentConcurrency}/${status.config.maxConcurrent})`);
      });
      
    } catch (error) {
      this.logger.error('Bulkhead test failed:', error.message);
    }
  }
  
  /**
   * Test Scenario 3: Auto-Recovery Pattern
   * Demonstrates automatic failure detection and recovery
   */
  async testAutoRecovery() {
    this.logger.log('\\n🔄 Testing Auto-Recovery Pattern...');
    
    try {
      // Check initial recovery status
      this.logger.log('Checking initial recovery status...');
      let recoveryStatus = await axios.get(`${GATEWAY_URL}/api/patterns/recovery`);
      Object.entries(recoveryStatus.data).forEach(([name, status]) => {
        this.logger.log(`  ${name}: ${status.state} (failures: ${status.failureCount})`);
      });
      
      // Simulate user service failure
      this.logger.log('\\n🔥 Simulating user service failure...');
      await axios.post(`http://localhost:${config.server.services.user.port}/simulate/failure`);
      
      // Make requests that will trigger recovery
      this.logger.log('Making requests to trigger recovery...');
      for (let i = 0; i < 5; i++) {
        try {
          await axios.get(`${GATEWAY_URL}/api/users/1`);
          this.logger.log(`✅ User request ${i + 1}: Success`);
        } catch (error) {
          this.logger.log(`❌ User request ${i + 1}: ${error.response?.status || 'Failed'}`);
        }
        await this.delay(2000);
      }
      
      // Check recovery status after failures
      this.logger.log('\\n📊 Checking recovery status after failures...');
      recoveryStatus = await axios.get(`${GATEWAY_URL}/api/patterns/recovery`);
      Object.entries(recoveryStatus.data).forEach(([name, status]) => {
        this.logger.log(`  ${name}: ${status.state} (failures: ${status.failureCount}, recoveries: ${status.metrics?.totalRecoveries || 0})`);
      });
      
      // Trigger manual recovery
      this.logger.log('\\n🛠️ Triggering manual recovery...');
      await axios.post(`http://localhost:${config.server.services.user.port}/simulate/recovery`);
      
      // Wait and check if recovery worked
      await this.delay(3000);
      
      this.logger.log('Testing service after recovery...');
      try {
        const response = await axios.get(`${GATEWAY_URL}/api/users/1`);
        this.logger.log(`✅ Post-recovery request: ${response.status} - Service recovered!`);
      } catch (error) {
        this.logger.log(`❌ Post-recovery request failed: ${error.response?.status || error.message}`);
      }
      
    } catch (error) {
      this.logger.error('Auto-recovery test failed:', error.message);
    }
  }
  
  /**
   * Test Scenario 4: End-to-End Workflow
   * Tests a complete user workflow with all patterns active
   */
  async testEndToEndWorkflow() {
    this.logger.log('\\n🎯 Testing End-to-End Workflow...');
    
    try {
      // 1. Create a user
      this.logger.log('Step 1: Creating a new user...');
      const userResponse = await axios.post(`${GATEWAY_URL}/api/users`, {
        name: 'Test User',
        email: 'test@example.com'
      });
      const userId = userResponse.data.user.id;
      this.logger.log(`✅ User created: ${userId}`);
      
      // 2. Create an order
      this.logger.log('Step 2: Creating an order...');
      const orderResponse = await axios.post(`${GATEWAY_URL}/api/orders`, {
        userId: userId,
        items: [
          { productId: 'prod-1', name: 'Test Product', price: 99.99, quantity: 1 }
        ]
      });
      const orderId = orderResponse.data.order.id;
      this.logger.log(`✅ Order created: ${orderId}`);
      
      // 3. Process payment (may fail due to circuit breaker)
      this.logger.log('Step 3: Processing payment...');
      try {
        const paymentResponse = await axios.post(`${GATEWAY_URL}/api/payments`, {
          amount: 99.99,
          method: 'credit_card',
          merchantId: 'merchant-123',
          orderId: orderId
        });
        this.logger.log(`✅ Payment processed: ${paymentResponse.data.payment.id}`);
        
        // 4. Send notification
        this.logger.log('Step 4: Sending notification...');
        const notificationResponse = await axios.post(`${GATEWAY_URL}/api/notifications`, {
          type: 'order_confirmation',
          recipient: 'test@example.com',
          subject: 'Order Confirmation',
          message: `Your order ${orderId} has been confirmed.`,
          channel: 'email'
        });
        this.logger.log(`✅ Notification sent: ${notificationResponse.data.notification.id}`);
        
        this.logger.log('\\n🎉 End-to-end workflow completed successfully!');
        
      } catch (error) {
        this.logger.log(`❌ Payment failed: ${error.response?.data?.error || error.message}`);
        this.logger.log('This demonstrates how circuit breakers prevent cascading failures');
      }
      
    } catch (error) {
      this.logger.error('End-to-end workflow test failed:', error.message);
    }
  }
  
  /**
   * Monitor system health and patterns
   */
  async monitorSystem() {
    this.logger.log('\\n📊 System Health Summary:');
    
    try {
      const overview = await axios.get(`${MONITOR_URL}/api/overview`);
      const data = overview.data;
      
      this.logger.log(`\\n🏥 Service Health:`);
      this.logger.log(`  Healthy: ${data.healthyServices}/${data.totalServices}`);
      this.logger.log(`  Unhealthy: ${data.unhealthyServices}`);
      
      this.logger.log(`\\n🔌 Circuit Breakers:`);
      this.logger.log(`  Total: ${data.circuitBreakers.total}`);
      this.logger.log(`  Open: ${data.circuitBreakers.open}`);
      this.logger.log(`  Half-Open: ${data.circuitBreakers.halfOpen}`);
      this.logger.log(`  Closed: ${data.circuitBreakers.closed}`);
      
      this.logger.log(`\\n🚧 Bulkheads:`);
      this.logger.log(`  Total: ${data.bulkheads.total}`);
      this.logger.log(`  High Utilization: ${data.bulkheads.utilizationHigh}`);
      this.logger.log(`  Queue Full: ${data.bulkheads.queueFull}`);
      
      this.logger.log(`\\n🔄 Auto-Recovery:`);
      this.logger.log(`  Total: ${data.recovery.total}`);
      this.logger.log(`  Healthy: ${data.recovery.healthy}`);
      this.logger.log(`  Recovering: ${data.recovery.recovering}`);
      this.logger.log(`  Failed: ${data.recovery.failed}`);
      
      if (data.alerts && data.alerts.length > 0) {
        this.logger.log(`\\n🚨 Active Alerts (${data.alerts.length}):`);
        data.alerts.slice(0, 5).forEach(alert => {
          this.logger.log(`  [${alert.severity.toUpperCase()}] ${alert.message}`);
        });
      } else {
        this.logger.log(`\\n✅ No active alerts`);
      }
      
    } catch (error) {
      this.logger.error('Failed to get system overview:', error.message);
    }
  }
  
  /**
   * Run all test scenarios
   */
  async runAllTests() {
    this.logger.log('🚀 Starting Self-Healing Microservices Test Suite\\n');
    this.logger.log('=' .repeat(60));
    
    // Wait for services to be ready
    this.logger.log('⏳ Waiting for services to be ready...');
    await this.delay(5000);
    
    try {
      await this.testCircuitBreaker();
      await this.delay(2000);
      
      await this.testBulkhead();
      await this.delay(2000);
      
      await this.testAutoRecovery();
      await this.delay(2000);
      
      await this.testEndToEndWorkflow();
      await this.delay(2000);
      
      await this.monitorSystem();
      
      this.logger.log('\\n' + '='.repeat(60));
      this.logger.log('🎯 Test Suite Completed!');
      this.logger.log('\\n💡 Next Steps:');
      this.logger.log(`   • Visit the monitoring dashboard: http://localhost:${config.server.services.monitor.port}`);
      this.logger.log(`   • Check the API Gateway metrics: ${GATEWAY_URL}/metrics`);
      this.logger.log(`   • Explore the pattern endpoints: ${GATEWAY_URL}/api/patterns/*`);
      
    } catch (error) {
      this.logger.error('Test suite failed:', error.message);
    }
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export for use in other modules
module.exports = TestScenarios;

// Run tests if this file is executed directly
if (require.main === module) {
  const tests = new TestScenarios();
  tests.runAllTests().catch(console.error);
}
