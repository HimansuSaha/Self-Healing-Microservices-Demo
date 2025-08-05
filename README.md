# Self-Healing Microservices Demo

A comprehensive demonstration project for building self-healing microservices using Circuit Breakers, Bulkheads, and Auto-Recovery patterns in Node.js.

## 🎯 Project Overview

This project demonstrates advanced resilience patterns in microservices architecture, designed to be educational for both beginners and experienced professionals. It showcases:

- **Circuit Breaker Pattern**: Prevents cascading failures by monitoring service health
- **Bulkhead Pattern**: Isolates resources to contain failures 
- **Auto-Recovery Pattern**: Automatically detects and recovers from failures

## 🏗️ Architecture

The project consists of multiple microservices that simulate real-world scenarios:

- **API Gateway** - Entry point with circuit breakers for downstream services
- **User Service** - Handles user operations with auto-recovery mechanisms
- **Order Service** - Processes orders with bulkhead isolation
- **Payment Service** - Processes payments (designed to fail for demo purposes)
- **Notification Service** - Sends notifications with retry mechanisms
- **Monitoring Dashboard** - Visualizes health metrics and pattern states

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ installed
- Basic understanding of microservices architecture

### Installation & Setup

```bash
# Install dependencies
npm install

# Start all services
npm run start:all

# Start individual services (in separate terminals)
npm run start:gateway     # API Gateway (Port 3000)
npm run start:user        # User Service (Port 3001)
npm run start:order       # Order Service (Port 3002)
npm run start:payment     # Payment Service (Port 3003)
npm run start:notification # Notification Service (Port 3004)
npm run start:monitor     # Monitoring Dashboard (Port 3005)
```

### Testing the Patterns

```bash
# Run integration tests
npm test

# Test circuit breaker
curl http://localhost:3000/api/users/1

# Simulate failures
curl -X POST http://localhost:3000/api/simulate/payment-failure

# Check circuit breaker status
curl http://localhost:3000/api/health/circuit-breakers
```

## 📚 Pattern Explanations

### Circuit Breaker Pattern

**What it is:** A design pattern that monitors calls to external services and prevents calls when the service is likely to fail.

**How it works:**
- **Closed State**: Normal operation, requests pass through
- **Open State**: Service is failing, circuit is "open", requests fail fast
- **Half-Open State**: Testing if service has recovered

**Benefits:**
- Prevents cascading failures
- Reduces resource waste on failed requests
- Provides graceful degradation

### Bulkhead Pattern

**What it is:** Isolates critical resources to prevent failures in one area from affecting others.

**How it works:**
- Separate connection pools for different operations
- Resource quotas and limits
- Isolated execution contexts

**Benefits:**
- Prevents resource exhaustion
- Isolates failures
- Maintains service availability

### Auto-Recovery Pattern

**What it is:** Automatically detects and attempts to recover from failures without human intervention.

**How it works:**
- Health checks and monitoring
- Exponential backoff retry mechanisms
- Automatic service restart
- Graceful degradation

**Benefits:**
- Reduces manual intervention
- Faster recovery times
- Improved system resilience

## 🔧 Configuration

Each pattern can be configured through environment variables or config files:

```javascript
// Circuit Breaker Configuration
const circuitBreakerConfig = {
  failureThreshold: 5,        // Open circuit after 5 failures
  timeout: 60000,             // Stay open for 60 seconds
  resetTimeout: 30000,        // Test recovery after 30 seconds
  monitoringPeriod: 10000     // Monitor every 10 seconds
};

// Bulkhead Configuration
const bulkheadConfig = {
  maxConcurrent: 10,          // Max 10 concurrent operations
  maxQueue: 50,               // Max 50 queued operations
  timeout: 5000               // 5 second operation timeout
};

// Auto-Recovery Configuration
const recoveryConfig = {
  maxRetries: 3,              // Retry up to 3 times
  backoffMultiplier: 2,       // Exponential backoff
  initialDelay: 1000,         // Start with 1 second delay
  maxDelay: 30000,            // Max 30 second delay
  healthCheckInterval: 5000   // Health check every 5 seconds
};
```

## 📊 Monitoring and Observability

The project includes a comprehensive monitoring dashboard that shows:

- Circuit breaker states and metrics
- Bulkhead resource utilization
- Auto-recovery attempt history
- Service health indicators
- Real-time failure and recovery events

Access the dashboard at: `http://localhost:3005`

## 🧪 Testing Scenarios

### Scenario 1: Circuit Breaker in Action
1. Make multiple requests to payment service
2. Payment service starts failing (simulated)
3. Circuit breaker opens after threshold reached
4. Requests fail fast without hitting the service
5. Circuit breaker tests recovery and closes when service is healthy

### Scenario 2: Bulkhead Isolation
1. High load on order processing
2. User operations remain unaffected due to resource isolation
3. Different connection pools prevent resource starvation

### Scenario 3: Auto-Recovery
1. Service goes down (simulated)
2. Health checks detect failure
3. Auto-recovery mechanism kicks in
4. Service restarts and resumes normal operation

## 📁 Project Structure

```
├── src/
│   ├── patterns/           # Core pattern implementations
│   │   ├── CircuitBreaker.js
│   │   ├── Bulkhead.js
│   │   └── AutoRecovery.js
│   ├── services/          # Microservices
│   │   ├── gateway/       # API Gateway
│   │   ├── user/          # User Service
│   │   ├── order/         # Order Service
│   │   ├── payment/       # Payment Service
│   │   ├── notification/  # Notification Service
│   │   └── monitor/       # Monitoring Dashboard
│   ├── utils/             # Shared utilities
│   └── config/            # Configuration files
├── tests/                 # Test files
├── docs/                  # Additional documentation
└── examples/              # Usage examples
```

## 🤝 Contributing

This is an educational project. Feel free to:
- Add more pattern examples
- Improve the monitoring dashboard
- Add more comprehensive tests
- Enhance documentation

## 📖 Further Reading

- [Microservices Patterns by Chris Richardson](https://microservices.io/patterns/)
- [Release It! by Michael Nygard](https://pragprog.com/titles/mnee2/release-it-second-edition/)
- [Building Microservices by Sam Newman](https://samnewman.io/books/building_microservices/)

## 📄 License

This project is for educational purposes. Feel free to use and modify as needed.
