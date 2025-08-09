import { ResilienceService } from '../../../src/services/ResilienceService.js';
import { WebSocketService } from '../../../src/services/WebSocketService.js';
import { TaskOrchestrator } from '../../../src/services/TaskOrchestrator.js';
import { HeartbeatService } from '../../../src/services/HeartbeatService.js';
import { mockLogger } from '../test-utils.js';

// Mock dependencies
jest.mock('../../../src/services/WebSocketService.js');
jest.mock('../../../src/services/TaskOrchestrator.js');
jest.mock('../../../src/services/HeartbeatService.js');

describe('ResilienceService', () => {
  let resilienceService: ResilienceService;
  let mockWebSocketService: jest.Mocked<WebSocketService>;
  let mockTaskOrchestrator: jest.Mocked<TaskOrchestrator>;
  let mockHeartbeatService: jest.Mocked<HeartbeatService>;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Create mock instances
    mockWebSocketService = new WebSocketService() as jest.Mocked<WebSocketService>;
    mockTaskOrchestrator = new TaskOrchestrator() as jest.Mocked<TaskOrchestrator>;
    mockHeartbeatService = new HeartbeatService() as jest.Mocked<HeartbeatService>;
    
    // Setup default mock implementations
    mockWebSocketService.isConnected = jest.fn().mockReturnValue(true);
    mockWebSocketService.broadcast = jest.fn();
    mockWebSocketService.sendToClient = jest.fn();
    mockWebSocketService.onMessage = jest.fn((event, handler) => {
      // Store the handler for later invocation in tests
      (mockWebSocketService as any)[`_${event}Handler`] = handler;
    });
    
    // Mock getInstance methods
    WebSocketService.getInstance = jest.fn().mockReturnValue(mockWebSocketService);
    TaskOrchestrator.getInstance = jest.fn().mockReturnValue(mockTaskOrchestrator);
    HeartbeatService.getInstance = jest.fn().mockReturnValue(mockHeartbeatService);
    
    // Create a new instance for each test
    const { resilienceService: rs } = require('../../../src/services/ResilienceService.js');
    resilienceService = rs;
  });

  afterEach(async () => {
    // Clean up any intervals or timeouts
    await resilienceService.shutdown();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', async () => {
      await resilienceService.initialize();
      
      expect(mockWebSocketService.onMessage).toHaveBeenCalledWith(
        'health:check',
        expect.any(Function)
      );
      
      expect(mockWebSocketService.onMessage).toHaveBeenCalledWith(
        'service:restart',
        expect.any(Function)
      );
      
      // Should start monitoring
      expect(setInterval).toHaveBeenCalled();
    });

    it('should register WebSocket message handlers', async () => {
      await resilienceService.initialize();
      
      // Get the registered handlers
      const healthCheckHandler = (mockWebSocketService as any)['_health:check'];
      const serviceRestartHandler = (mockWebSocketService as any)['_service:restart'];
      
      expect(healthCheckHandler).toBeDefined();
      expect(serviceRestartHandler).toBeDefined();
      
      // Test health check handler
      const mockClientId = 'test-client';
      const mockSend = jest.fn();
      mockWebSocketService.sendToClient = mockSend;
      
      healthCheckHandler({}, mockClientId);
      
      expect(mockSend).toHaveBeenCalledWith(
        mockClientId,
        'health:status',
        expect.any(Object)
      );
    });
  });

  describe('Service Monitoring', () => {
    beforeEach(async () => {
      // Mock Date for consistent testing
      jest.useFakeTimers();
      await resilienceService.initialize();
    });

    it('should check service health', async () => {
      // Mock service checks
      mockWebSocketService.isConnected.mockResolvedValue(true);
      
      // Trigger a check
      await (resilienceService as any).checkServices();
      
      // Should have checked all services
      expect(mockWebSocketService.isConnected).toHaveBeenCalled();
      
      // Should broadcast status
      expect(mockWebSocketService.broadcast).toHaveBeenCalledWith(
        'system:status',
        expect.objectContaining({
          isSystemHealthy: true,
          unhealthyServices: expect.any(Array),
        })
      );
    });

    it('should detect unhealthy services', async () => {
      // Mock a failing service
      mockWebSocketService.isConnected.mockResolvedValue(false);
      
      // Trigger a check
      await (resilienceService as any).checkServices();
      
      // Should report the service as unhealthy
      expect(mockWebSocketService.broadcast).toHaveBeenCalledWith(
        'system:status',
        expect.objectContaining({
          isSystemHealthy: false,
          unhealthyServices: expect.arrayContaining(['websocket']),
        })
      );
    });
  });

  describe('Circuit Breaker', () => {
    beforeEach(async () => {
      jest.useFakeTimers();
      await resilienceService.initialize();
    });

    it('should open circuit after threshold failures', async () => {
      // Mock repeated failures
      mockWebSocketService.isConnected.mockResolvedValue(false);
      
      // Trigger multiple failures (exceeding threshold)
      for (let i = 0; i < 5; i++) {
        await (resilienceService as any).checkServices();
      }
      
      // Should have opened the circuit
      const status = (resilienceService as any).getSystemStatus();
      expect(status.circuitBreakers.websocket.isOpen).toBe(true);
    });

    it('should close circuit after cooldown', async () => {
      // First, open the circuit
      mockWebSocketService.isConnected.mockResolvedValue(false);
      for (let i = 0; i < 5; i++) {
        await (resilienceService as any).checkServices();
      }
      
      // Fast-forward time past cooldown
      jest.advanceTimersByTime(6 * 60 * 1000); // 6 minutes
      
      // Next check should be successful
      mockWebSocketService.isConnected.mockResolvedValue(true);
      await (resilienceService as any).checkServices();
      
      // Circuit should be closed
      const status = (resilienceService as any).getSystemStatus();
      expect(status.circuitBreakers.websocket.isOpen).toBe(false);
    });
  });

  describe('Recovery Actions', () => {
    let serviceRestartHandler: any;
    
    beforeEach(async () => {
      await resilienceService.initialize();
      serviceRestartHandler = (mockWebSocketService as any)['_service:restart'];
    });

    it('should execute recovery actions for unhealthy services', async () => {
      // Mock a failing service
      mockWebSocketService.isConnected.mockResolvedValue(false);
      
      // Mock the restart action
      const mockRestart = jest.fn().mockResolvedValue(true);
      (resilienceService as any).recoveryActions = [{
        type: 'restart',
        target: 'websocket',
        priority: 1,
        condition: () => true,
        action: mockRestart,
        cooldownMs: 0,
      }];
      
      // Trigger a check
      await (resilienceService as any).checkServices();
      
      // Should have executed the recovery action
      expect(mockRestart).toHaveBeenCalled();
    });

    it('should handle manual service restart', async () => {
      // Mock the restart action
      const mockRestart = jest.fn().mockResolvedValue(true);
      (resilienceService as any).recoveryActions = [{
        type: 'restart',
        target: 'websocket',
        priority: 1,
        condition: () => true,
        action: mockRestart,
        cooldownMs: 0,
      }];
      
      // Trigger manual restart
      await serviceRestartHandler({ service: 'websocket' });
      
      // Should have executed the restart action
      expect(mockRestart).toHaveBeenCalled();
      
      // Should broadcast success
      expect(mockWebSocketService.broadcast).toHaveBeenCalledWith(
        'service:restarted',
        { service: 'websocket', success: true }
      );
    });

    it('should handle failed recovery actions', async () => {
      // Mock a failing recovery action
      const mockRestart = jest.fn().mockRejectedValue(new Error('Restart failed'));
      (resilienceService as any).recoveryActions = [{
        type: 'restart',
        target: 'websocket',
        priority: 1,
        condition: () => true,
        action: mockRestart,
        cooldownMs: 0,
      }];
      
      // Trigger a check
      await (resilienceService as any).checkServices();
      
      // Should have executed the recovery action
      expect(mockRestart).toHaveBeenCalled();
      
      // Should log the error
      expect(mockLogger().error).toHaveBeenCalledWith(
        'Error executing restart for websocket:',
        expect.any(Error)
      );
    });
  });

  describe('Shutdown', () => {
    it('should clean up resources on shutdown', async () => {
      await resilienceService.initialize();
      
      // Spy on clearInterval
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      
      // Shutdown
      await resilienceService.shutdown();
      
      // Should clear the monitoring interval
      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });

  describe('Health Status', () => {
    it('should return current system status', async () => {
      await resilienceService.initialize();
      
      const status = (resilienceService as any).getSystemStatus();
      
      expect(status).toHaveProperty('timestamp');
      expect(status).toHaveProperty('isSystemHealthy');
      expect(status).toHaveProperty('unhealthyServices');
      expect(status).toHaveProperty('services');
      expect(status).toHaveProperty('circuitBreakers');
      
      // Should include all services
      expect(Object.keys(status.services)).toContain('websocket');
      expect(Object.keys(status.services)).toContain('taskOrchestrator');
      expect(Object.keys(status.services)).toContain('routing');
      expect(Object.keys(status.services)).toContain('heartbeat');
      expect(Object.keys(status.services)).toContain('memory');
      expect(Object.keys(status.services)).toContain('vcc');
      expect(Object.keys(status.services)).toContain('integration');
    });
  });
});
