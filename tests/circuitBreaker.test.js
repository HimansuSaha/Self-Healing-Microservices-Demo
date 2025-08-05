/**
 * Basic tests for the Circuit Breaker pattern
 */

const { CircuitBreaker, States } = require('../src/patterns/CircuitBreaker');

describe('CircuitBreaker', () => {
  let circuitBreaker;
  
  beforeEach(() => {
    circuitBreaker = new CircuitBreaker({
      name: 'test-circuit-breaker',
      failureThreshold: 3,
      resetTimeout: 1000,
      timeout: 500
    });
  });
  
  afterEach(() => {
    if (circuitBreaker) {
      circuitBreaker.destroy();
    }
  });
  
  test('should start in CLOSED state', () => {
    expect(circuitBreaker.state).toBe(States.CLOSED);
  });
  
  test('should execute successful function', async () => {
    const testFunction = jest.fn().mockResolvedValue('success');
    
    const result = await circuitBreaker.execute(testFunction);
    
    expect(result).toBe('success');
    expect(testFunction).toHaveBeenCalledTimes(1);
    expect(circuitBreaker.state).toBe(States.CLOSED);
  });
  
  test('should open circuit after failure threshold', async () => {
    const testFunction = jest.fn().mockRejectedValue(new Error('Test error'));
    
    // Execute function multiple times to trigger circuit opening
    for (let i = 0; i < 3; i++) {
      try {
        await circuitBreaker.execute(testFunction);
      } catch (error) {
        // Expected to fail
      }
    }
    
    expect(circuitBreaker.state).toBe(States.OPEN);
    expect(testFunction).toHaveBeenCalledTimes(3);
  });
  
  test('should fail fast when circuit is open', async () => {
    const testFunction = jest.fn().mockRejectedValue(new Error('Test error'));
    
    // Open the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await circuitBreaker.execute(testFunction);
      } catch (error) {
        // Expected to fail
      }
    }
    
    expect(circuitBreaker.state).toBe(States.OPEN);
    
    // This should fail fast without calling the function
    const startTime = Date.now();
    try {
      await circuitBreaker.execute(testFunction);
    } catch (error) {
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(100); // Should fail immediately
      expect(error.message).toContain('Circuit breaker');
      expect(error.message).toContain('OPEN');
    }
    
    // Function should not be called when circuit is open
    expect(testFunction).toHaveBeenCalledTimes(3); // Only from the initial failures
  });
  
  test('should transition to HALF_OPEN after reset timeout', async () => {
    const testFunction = jest.fn()
      .mockRejectedValueOnce(new Error('Test error'))
      .mockRejectedValueOnce(new Error('Test error'))
      .mockRejectedValueOnce(new Error('Test error'))
      .mockResolvedValueOnce('success');
    
    // Open the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await circuitBreaker.execute(testFunction);
      } catch (error) {
        // Expected to fail
      }
    }
    
    expect(circuitBreaker.state).toBe(States.OPEN);
    
    // Wait for reset timeout
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    // Next execution should transition to HALF_OPEN and then to CLOSED
    const result = await circuitBreaker.execute(testFunction);
    
    expect(result).toBe('success');
    expect(circuitBreaker.state).toBe(States.CLOSED);
  });
  
  test('should handle timeout errors', async () => {
    const slowFunction = () => new Promise(resolve => setTimeout(resolve, 1000));
    
    const startTime = Date.now();
    try {
      await circuitBreaker.execute(slowFunction);
    } catch (error) {
      const duration = Date.now() - startTime;
      expect(duration).toBeGreaterThan(500);
      expect(duration).toBeLessThan(600);
      expect(error.message).toContain('timeout');
    }
    
    expect(circuitBreaker.failureCount).toBe(1);
  });
  
  test('should provide correct status information', () => {
    const status = circuitBreaker.getStatus();
    
    expect(status).toHaveProperty('name', 'test-circuit-breaker');
    expect(status).toHaveProperty('state', States.CLOSED);
    expect(status).toHaveProperty('failureCount', 0);
    expect(status).toHaveProperty('successCount', 0);
    expect(status).toHaveProperty('metrics');
    expect(status).toHaveProperty('config');
  });
  
  test('should reset circuit breaker state', async () => {
    const testFunction = jest.fn().mockRejectedValue(new Error('Test error'));
    
    // Cause some failures
    for (let i = 0; i < 2; i++) {
      try {
        await circuitBreaker.execute(testFunction);
      } catch (error) {
        // Expected to fail
      }
    }
    
    expect(circuitBreaker.failureCount).toBe(2);
    
    // Reset the circuit breaker
    circuitBreaker.reset();
    
    expect(circuitBreaker.state).toBe(States.CLOSED);
    expect(circuitBreaker.failureCount).toBe(0);
    expect(circuitBreaker.successCount).toBe(0);
  });
});
