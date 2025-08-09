import { WebSocket, WebSocketServer } from 'ws';
import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

export type ServiceType = 'bot' | 'service' | 'client';

export interface ConnectionInfo {
  id: string;
  serviceName: string;
  serviceType: ServiceType;
  connectedAt: Date;
  lastPing: Date;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

type MessageHandler = (connectionId: string, data: any) => void;

interface ServiceConnection extends ConnectionInfo {
  ws: WebSocket;
  isAlive: boolean;
}

export class WebSocketService {
  private wss: WebSocketServer | null = null;
  private connections: Map<string, ServiceConnection> = new Map();
  private connectionCount = 0;
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private redisClient: RedisClientType | null = null;
  private pubSubClient: RedisClientType | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private static instance: WebSocketService;

  private constructor() {
    // Private constructor to enforce singleton
  }

  /**
   * Broadcast a message to all connected clients
   */
  public broadcastToAll(message: any): void {
    const messageString = typeof message === 'string' ? message : JSON.stringify(message);
    
    this.connections.forEach((connection) => {
      if (connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(messageString);
      }
    });
  }

  /**
   * Broadcast a message to all services of a specific type
   */
  public broadcastToServices(serviceType: ServiceType, message: any): void {
    const messageString = typeof message === 'string' ? message : JSON.stringify(message);
    
    this.connections.forEach((connection) => {
      if (connection.serviceType === serviceType && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(messageString);
      }
    });
  }

  /**
   * Broadcast a message to all clients (non-service connections)
   */
  public broadcastToClients(message: any): void {
    this.broadcastToServices('client', message);
  }

  /**
   * Send a message to specific connections by their IDs
   */
  public broadcastToConnections(connectionIds: string[], message: any): void {
    if (connectionIds.length === 0) return;
    
    const messageString = typeof message === 'string' ? message : JSON.stringify(message);
    
    connectionIds.forEach(connectionId => {
      const connection = this.connections.get(connectionId);
      if (connection?.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(messageString);
      }
    });
  }

  /**
   * Get information about all active connections
   */
  public getConnections(): ConnectionInfo[] {
    const connections: ConnectionInfo[] = [];
    
    this.connections.forEach(connection => {
      const { ws, isAlive, ...info } = connection;
      connections.push({
        ...info,
        lastPing: new Date(connection.lastPing),
        connectedAt: new Date(connection.connectedAt)
      });
    });
    
    return connections;
  }

  /**
   * Get information about connections filtered by service type
   */
  public getConnectionsByType(serviceType: ServiceType): ConnectionInfo[] {
    return this.getConnections().filter(conn => conn.serviceType === serviceType);
  }

  /**
   * Get information about a specific connection
   */
  public getConnection(connectionId: string): ConnectionInfo | undefined {
    const connection = this.connections.get(connectionId);
    if (!connection) return undefined;
    
    const { ws, isAlive, ...info } = connection;
    return {
      ...info,
      lastPing: new Date(connection.lastPing),
      connectedAt: new Date(connection.connectedAt)
    };
  }

  public static getInstance(): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  public async initialize(server: any): Promise<void> {
    if (this.wss) {
      logger.warn('WebSocket server already initialized');
      return;
    }
    
    // Initialize Redis client for pub/sub if not already initialized
    if (!this.redisClient) {
      await this.initializeRedis();
    }
    
    // Initialize WebSocket server
    this.wss = new WebSocketServer({ server });
    
    // Setup WebSocket handlers
    this.setupWebSocketHandlers();
    
    // Register default handlers
    this.registerDefaultHandlers();
    
    // Start heartbeat
    this.startHeartbeat();
    
    logger.info('WebSocket service initialized');
  }

  private async initializeRedis(): Promise<void> {
    try {
      this.redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      
      this.pubSubClient = this.redisClient.duplicate();
      
      await Promise.all([
        this.redisClient.connect(),
        this.pubSubClient.connect()
      ]);
      
      // Subscribe to Redis channels for cross-instance communication
      await this.pubSubClient.subscribe('mcp:broadcast', (message) => {
        this.broadcast(JSON.parse(message), 'system');
      });
      
      logger.info('Redis clients connected and subscribed');
    } catch (error) {
      logger.error('Failed to initialize Redis:', error);
      throw error;
    }
  }

  private setupWebSocketHandlers(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws: WebSocket, req) => {
      this.handleConnection(ws, req);
    });
  }

  private handleConnection(ws: WebSocket, req: any): void {
    const connectionId = this.generateConnectionId();
    const serviceName = req.url?.split('/').pop() || 'unknown';
    const serviceType = this.determineServiceType(serviceName);
    const ipAddress = req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    const connection: ServiceConnection = {
      id: connectionId,
      ws,
      serviceName,
      serviceType,
      connectedAt: new Date(),
      lastPing: Date.now(),
      isAlive: true,
      ipAddress,
      userAgent,
      metadata: {
        // Add any additional metadata from the request
        url: req.url,
        headers: {
          // Filter out sensitive headers
          'user-agent': userAgent,
          'x-forwarded-for': req.headers['x-forwarded-for'],
        },
      },
    };

    this.connections.set(connectionId, connection);
    this.connectionCount++;

    logger.info(`New ${serviceType} connection: ${serviceName} (${connectionId})`);

    // Handle incoming messages
    ws.on('message', (data: string) => {
      try {
        const message = JSON.parse(data);
        this.handleIncomingMessage(connectionId, message);
      } catch (error) {
        logger.error(`Error processing message from ${serviceName}:`, error);
      }
    });

    // Handle connection close
    ws.on('close', () => {
      this.handleClose(connectionId);
    });

    // Handle errors
    ws.on('error', (error) => {
      logger.error(`WebSocket error for ${serviceName}:`, error);
      this.handleClose(connectionId);
    });

    // Send welcome message
    this.send(connectionId, {
      type: 'welcome',
      data: {
        serviceName,
        timestamp: new Date().toISOString(),
        message: 'Connected to MKWW MCP'
      }
    });

    // Broadcast service status
    this.broadcastServiceStatus(serviceName, 'online');
  }

  private handleClose(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      this.connections.delete(connectionId);
      this.connectionCount = Math.max(0, this.connectionCount - 1);
      
      logger.info(`Connection closed: ${connectionId} (${connection.serviceName})`, {
        connectionId,
        serviceName: connection.serviceName,
        serviceType: connection.serviceType,
        duration: Date.now() - connection.connectedAt.getTime(),
        ipAddress: connection.ipAddress,
      });
      
      // Notify about connection closed
      this.broadcastToServices('service', {
        type: 'connection_closed',
        connectionId,
        serviceName: connection.serviceName,
        serviceType: connection.serviceType,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private registerDefaultHandlers(): void {
    // Register default message handlers
    this.onMessage('ping', (connectionId) => this.handlePing(connectionId));
    this.onMessage('service_status', (connectionId, data) => 
      this.updateServiceStatus(connectionId, data)
    );
  }

  public onMessage(messageType: string, handler: MessageHandler): void {
    this.messageHandlers.set(messageType, handler);
  }

  public offMessage(messageType: string): void {
    this.messageHandlers.delete(messageType);
  }

  private handleIncomingMessage(connectionId: string, message: any): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    const { type, data, requestId } = message;
    
    // Check if there's a registered handler for this message type
    const handler = this.messageHandlers.get(type);
    if (handler) {
      try {
        handler(connectionId, data);
      } catch (error) {
        logger.error(`Error in handler for message type '${type}':`, error);
        this.send(connectionId, {
          type: 'error',
          requestId,
          error: 'Internal server error in message handler'
        });
      }
      return;
    }
    
    // Fall back to default message handling
    this.forwardToHandler(connectionId, type, data, requestId);
  }

  private handlePing(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    
    connection.lastPing = Date.now();
    this.send(connectionId, { type: 'pong', timestamp: new Date().toISOString() });
  }

  private updateServiceStatus(connectionId: string, statusData: any): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    
    // Update connection metadata with status
    connection.metadata = { ...connection.metadata, ...statusData };
    
    // Broadcast status update
    this.broadcast({
      type: 'service_status_update',
      data: {
        serviceName: connection.serviceName,
        serviceType: connection.serviceType,
        status: statusData.status || 'online',
        metadata: statusData
      }
    }, [connectionId]);
  }

  private async handleRpc(connectionId: string, rpcData: any, requestId?: string): Promise<void> {
    // TODO: Implement RPC handling
    logger.debug('RPC call received:', { connectionId, rpcData, requestId });
  }

  private async forwardToHandler(connectionId: string, type: string, data: any, requestId?: string): Promise<void> {
    // TODO: Implement message forwarding to appropriate handler
    logger.debug('Message forwarded to handler:', { connectionId, type, data, requestId });
  }

  private startHeartbeat(): void {
    const HEARTBEAT_INTERVAL = 30000; // 30 seconds
    const TIMEOUT = 90000; // 90 seconds

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      
      this.connections.forEach((connection, connectionId) => {
        // Check for stale connections
        if (now - connection.lastPing > TIMEOUT) {
          logger.warn(`Connection timeout for ${connection.serviceName} (${connectionId})`);
          connection.ws.terminate();
          this.connections.delete(connectionId);
          this.broadcastServiceStatus(connection.serviceName, 'offline');
          return;
        }
        
        // Send ping
        this.send(connectionId, { type: 'ping', timestamp: now });
      });
    }, HEARTBEAT_INTERVAL);
  }

  public send(connectionId: string, message: any): void {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
      logger.warn(`Cannot send message to disconnected client: ${connectionId}`);
      return;
    }

    try {
      const messageStr = JSON.stringify(message);
      connection.ws.send(messageStr);
    } catch (error) {
      logger.error(`Error sending message to ${connectionId}:`, error);
    }
  }

  public broadcast(message: any, excludeConnectionIds: string | string[] = []): void {
    const excludeSet = new Set(Array.isArray(excludeConnectionIds) ? excludeConnectionIds : [excludeConnectionIds]);
    const messageStr = JSON.stringify(message);
    
    this.connections.forEach((connection, connectionId) => {
      if (excludeSet.has(connectionId) || connection.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      
      try {
        connection.ws.send(messageStr);
      } catch (error) {
        logger.error(`Error broadcasting to ${connectionId}:`, error);
      }
    });
  }

  private broadcastServiceStatus(serviceName: string, status: string): void {
    this.broadcast({
      type: 'service_status',
      data: {
        serviceName,
        status,
        timestamp: new Date().toISOString()
      }
    });
  }

  public async shutdown(): Promise<void> {
    // Clear heartbeat interval
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all WebSocket connections
    this.connections.forEach((connection) => {
      if (connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.close(1001, 'Server shutdown');
      }
    });
    this.connections.clear();

    // Close WebSocket server
    if (this.wss) {
      return new Promise((resolve) => {
        this.wss?.close(() => {
          this.wss = null;
          resolve();
        });
      });
    }
  }

  private generateConnectionId(serviceName: string): string {
    return `${serviceName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  public getActiveConnections(): Array<{
    connectionId: string;
    serviceName: string;
    serviceType: string;
    lastPing: Date;
    metadata: Record<string, any>;
  }> {
    return Array.from(this.connections.entries()).map(([connectionId, conn]) => ({
      connectionId,
      serviceName: conn.serviceName,
      serviceType: conn.serviceType,
      lastPing: new Date(conn.lastPing),
      metadata: { ...conn.metadata }
    }));
  }
}

export const webSocketService = WebSocketService.getInstance();
