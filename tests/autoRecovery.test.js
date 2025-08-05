/**
 * Basic tests for the Auto-Recovery pattern
 */

const { AutoRecovery, States } = require('../src/patterns/AutoRecovery');

describe('AutoRecovery', () => {
  let autoRecovery;
  
  beforeEach(() => {
    autoRecovery = new AutoRecovery({
      name: 'test-auto-recovery',
      maxRetries: 3,
      baseDelay: 100,
      maxDelay: 1000,
      backoffMultiplier: 2
    });
  });
  
  afterEach(() => {
    if (autoRecovery) {
      autoRecovery.stopMonitoring();
    }
  });
  
  test('should start in HEALTHY state', () => {
    expect(autoRecovery.state).toBe(States.HEALTHY);
  });
  
  test('should execute successful function without retry', async () => {
    const testFunction = jest.fn().mockResolvedValue('success');
    
    const result = await autoRecovery.executeWithRetry(testFunction);
    
    expect(result).toBe('success');
    expect(testFunction).toHaveBeenCalledTimes(1);
    expect(autoRecovery.state).toBe(States.HEALTHY);
  });
  
  test('should retry failed function up to maxRetries', async () => {
    const testFunction = jest.fn()
      .mockRejectedValueOnce(new Error('Test error 1'))
      .mockRejectedValueOnce(new Error('Test error 2'))
      .mockResolvedValueOnce('success');
    
    const result = await autoRecovery.executeWithRetry(testFunction);
    
    expect(result).toBe('success');
    expect(testFunction).toHaveBeenCalledTimes(3);
    expect(autoRecovery.state).toBe(States.HEALTHY);
  });
  
  test('should fail after maxRetries exhausted', async () => {
    const testFunction = jest.fn().mockRejectedValue(new Error('Persistent error'));
    
    try {
      await autoRecovery.executeWithRetry(testFunction);
      fail('Expected function to fail after retries');
    } catch (error) {
      expect(error.message).toBe('Persistent error');
    }
    
    expect(testFunction).toHaveBeenCalledTimes(4); // Initial attempt + 3 retries
    expect(autoRecovery.state).toBe(States.RECOVERING);
  });
  
  test('should implement exponential backoff', async () => {
    const testFunction = jest.fn()
      .mockRejectedValueOnce(new Error('Error 1'))
      .mockRejectedValueOnce(new Error('Error 2'))
      .mockResolvedValueOnce('success');
    
    const startTime = Date.now();
    const result = await autoRecovery.executeWithRetry(testFunction);
    const duration = Date.now() - startTime;
    
    expect(result).toBe('success');
    expect(testFunction).toHaveBeenCalledTimes(3);
    
    // Should have waited at least 100ms + 200ms = 300ms for backoff
    expect(duration).toBeGreaterThan(300);
  });
  
  test('should start health monitoring', (done) => {
    const healthCheck = jest.fn().mockResolvedValue(true);
    
    autoRecovery.startMonitoring(healthCheck, 100);
    
    setTimeout(() => {
      expect(healthCheck).toHaveBeenCalled();
      autoRecovery.stopMonitoring();
      done();
    }, 250);
  });
  
  test('should transition to FAILED state on persistent health check failures', (done) => {
    const healthCheck = jest.fn().mockResolvedValue(false);
    
    autoRecovery.startMonitoring(healthCheck, 50);
    
    setTimeout(() => {
      expect(autoRecovery.state).toBe(States.FAILED);
      autoRecovery.stopMonitoring();
      done();
    }, 200);
  });
  
  test('should recover from FAILED state when health check passes', (done) => {
    const healthCheck = jest.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    
    autoRecovery.startMonitoring(healthCheck, 50);
    
    setTimeout(() => {
      expect(autoRecovery.state).toBe(States.HEALTHY);
      autoRecovery.stopMonitoring();
      done();
    }, 300);
  });
  
  test('should provide correct status information', () => {
    const status = autoRecovery.getStatus();
    
    expect(status).toHaveProperty('name', 'test-auto-recovery');
    expect(status).toHaveProperty('state', States.HEALTHY);
    expect(status).toHaveProperty('metrics');
    expect(status).toHaveProperty('config');
    expect(status).toHaveProperty('lastHealthCheck');
  });
  
  test('should reset auto-recovery state', async () => {
    const testFunction = jest.fn().mockRejectedValue(new Error('Test error'));
    
    // Cause some failures
    try {
      await autoRecovery.executeWithRetry(testFunction);
    } catch (error) {
      // Expected to fail
    }
    
    expect(autoRecovery.state).toBe(States.RECOVERING);
    
    autoRecovery.reset();
    
    expect(autoRecovery.state).toBe(States.HEALTHY);
    
    const status = autoRecovery.getStatus();
    expect(status.metrics.totalAttempts).toBe(0);
    expect(status.metrics.totalSuccesses).toBe(0);
    expect(status.metrics.totalFailures).toBe(0);
  });
  
  test('should handle health check errors gracefully', (done) => {
    const healthCheck = jest.fn().mockRejectedValue(new Error('Health check error'));
    
    autoRecovery.startMonitoring(healthCheck, 50);
    
    setTimeout(() => {
      // Should not crash, should treat as unhealthy
      expect(autoRecovery.state).toBe(States.FAILED);
      autoRecovery.stopMonitoring();
      done();
    }, 200);
  });
  
  test('should apply custom recovery strategy', async () => {
    const customRecovery = new AutoRecovery({
      name: 'custom-recovery',
      maxRetries: 2,
      baseDelay: 50,
      recoveryStrategies: [
        {
          name: 'cache-clear',
          execute: jest.fn().mockResolvedValue(true)
        },
        {
          name: 'reconnect',
          execute: jest.fn().mockResolvedValue(true)
        }
      ]
    });
    
    const testFunction = jest.fn().mockRejectedValue(new Error('Test error'));
    
    try {
      await customRecovery.executeWithRetry(testFunction);
    } catch (error) {
      // Expected to fail
    }
    
    expect(customRecovery.recoveryStrategies[0].execute).toHaveBeenCalled();
    expect(customRecovery.recoveryStrategies[1].execute).toHaveBeenCalled();
    
    customRecovery.stopMonitoring();
  });
});
