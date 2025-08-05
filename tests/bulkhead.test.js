/**
 * Basic tests for the Bulkhead pattern
 */

const { Bulkhead } = require('../src/patterns/Bulkhead');

describe('Bulkhead', () => {
  let bulkhead;
  
  beforeEach(() => {
    bulkhead = new Bulkhead({
      name: 'test-bulkhead',
      maxConcurrency: 2,
      queueSize: 5,
      timeout: 1000
    });
  });
  
  afterEach(() => {
    if (bulkhead) {
      bulkhead.destroy();
    }
  });
  
  test('should execute function within concurrency limit', async () => {
    const testFunction = jest.fn().mockResolvedValue('success');
    
    const result = await bulkhead.execute(testFunction);
    
    expect(result).toBe('success');
    expect(testFunction).toHaveBeenCalledTimes(1);
  });
  
  test('should queue tasks when at concurrency limit', async () => {
    const testFunction = jest.fn((delay) => 
      new Promise(resolve => setTimeout(() => resolve(`success-${delay}`), delay))
    );
    
    // Start multiple tasks that will exceed concurrency limit
    const promises = [
      bulkhead.execute(() => testFunction(100)),
      bulkhead.execute(() => testFunction(200)),
      bulkhead.execute(() => testFunction(50)), // This should be queued
    ];
    
    const results = await Promise.all(promises);
    
    expect(results).toHaveLength(3);
    expect(results).toContain('success-100');
    expect(results).toContain('success-200');
    expect(results).toContain('success-50');
    expect(testFunction).toHaveBeenCalledTimes(3);
  });
  
  test('should reject tasks when queue is full', async () => {
    const testFunction = jest.fn(() => 
      new Promise(resolve => setTimeout(() => resolve('success'), 1000))
    );
    
    // Fill up the bulkhead and queue
    const promises = [];
    
    // Fill concurrency slots
    for (let i = 0; i < 2; i++) {
      promises.push(bulkhead.execute(testFunction));
    }
    
    // Fill queue
    for (let i = 0; i < 5; i++) {
      promises.push(bulkhead.execute(testFunction));
    }
    
    // This should be rejected
    try {
      await bulkhead.execute(testFunction);
      fail('Expected bulkhead to reject task');
    } catch (error) {
      expect(error.message).toContain('Bulkhead queue is full');
    }
    
    // Clean up
    await Promise.allSettled(promises);
  });
  
  test('should handle task timeout', async () => {
    const slowFunction = () => new Promise(resolve => setTimeout(resolve, 2000));
    
    const startTime = Date.now();
    try {
      await bulkhead.execute(slowFunction);
      fail('Expected task to timeout');
    } catch (error) {
      const duration = Date.now() - startTime;
      expect(duration).toBeGreaterThan(1000);
      expect(duration).toBeLessThan(1200);
      expect(error.message).toContain('timeout');
    }
  });
  
  test('should provide correct status information', async () => {
    const testFunction = jest.fn(() => 
      new Promise(resolve => setTimeout(() => resolve('success'), 100))
    );
    
    // Start a task
    const promise = bulkhead.execute(testFunction);
    
    const status = bulkhead.getStatus();
    
    expect(status).toHaveProperty('name', 'test-bulkhead');
    expect(status).toHaveProperty('activeJobs');
    expect(status).toHaveProperty('queuedJobs');
    expect(status).toHaveProperty('metrics');
    expect(status).toHaveProperty('config');
    
    await promise;
  });
  
  test('should track resource utilization', async () => {
    const testFunction = jest.fn(() => 
      new Promise(resolve => setTimeout(() => resolve('success'), 100))
    );
    
    await bulkhead.execute(testFunction);
    
    const status = bulkhead.getStatus();
    expect(status.metrics.totalExecuted).toBe(1);
    expect(status.metrics.totalSucceeded).toBe(1);
    expect(status.metrics.totalFailed).toBe(0);
  });
  
  test('should handle function errors', async () => {
    const testFunction = jest.fn().mockRejectedValue(new Error('Test error'));
    
    try {
      await bulkhead.execute(testFunction);
      fail('Expected function to throw error');
    } catch (error) {
      expect(error.message).toBe('Test error');
    }
    
    const status = bulkhead.getStatus();
    expect(status.metrics.totalExecuted).toBe(1);
    expect(status.metrics.totalSucceeded).toBe(0);
    expect(status.metrics.totalFailed).toBe(1);
  });
  
  test('should reset bulkhead state', async () => {
    const testFunction = jest.fn().mockResolvedValue('success');
    
    await bulkhead.execute(testFunction);
    
    let status = bulkhead.getStatus();
    expect(status.metrics.totalExecuted).toBe(1);
    
    bulkhead.reset();
    
    status = bulkhead.getStatus();
    expect(status.metrics.totalExecuted).toBe(0);
    expect(status.metrics.totalSucceeded).toBe(0);
    expect(status.metrics.totalFailed).toBe(0);
  });
  
  test('should handle multiple bulkheads independently', async () => {
    const bulkhead2 = new Bulkhead({
      name: 'test-bulkhead-2',
      maxConcurrency: 1,
      queueSize: 2
    });
    
    const testFunction1 = jest.fn().mockResolvedValue('bulkhead1');
    const testFunction2 = jest.fn().mockResolvedValue('bulkhead2');
    
    const result1 = await bulkhead.execute(testFunction1);
    const result2 = await bulkhead2.execute(testFunction2);
    
    expect(result1).toBe('bulkhead1');
    expect(result2).toBe('bulkhead2');
    
    const status1 = bulkhead.getStatus();
    const status2 = bulkhead2.getStatus();
    
    expect(status1.name).toBe('test-bulkhead');
    expect(status2.name).toBe('test-bulkhead-2');
    expect(status1.config.maxConcurrency).toBe(2);
    expect(status2.config.maxConcurrency).toBe(1);
    
    bulkhead2.destroy();
  });
});
