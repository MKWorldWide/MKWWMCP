import { logger } from '../utils/logger.js';
import { WebSocketService } from './WebSocketService.js';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { v4 as uuidv4 } from 'uuid';

type MessageRole = 'user' | 'assistant' | 'system' | 'function';

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  conversationId: string;
  parentMessageId?: string;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
  messageCount: number;
  isArchived: boolean;
}

interface MemoryConfig {
  maxConversationAgeDays?: number;
  maxMessagesPerConversation?: number;
  redisUrl?: string;
  redisPrefix?: string;
}

export class MemoryService {
  private static instance: MemoryService;
  private webSocketService: WebSocketService;
  private redisClient: RedisClientType;
  private config: Required<MemoryConfig>;
  private isInitialized: boolean = false;
  
  // In-memory cache for active conversations
  private activeConversations: Map<string, Conversation> = new Map();
  
  // Subscriptions for conversation updates
  private subscriptions: Map<string, Set<string>> = new Map();

  private constructor() {
    this.webSocketService = WebSocketService.getInstance();
    
    // Default configuration
    this.config = {
      maxConversationAgeDays: 30,
      maxMessagesPerConversation: 1000,
      redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
      redisPrefix: 'mkwmcp:memory:',
    };
    
    // Initialize Redis client
    this.redisClient = createClient({
      url: this.config.redisUrl,
    });
    
    // Set up Redis error handling
    this.redisClient.on('error', (err) => {
      logger.error('Redis client error:', err);
    });
    
    // Set up WebSocket message handlers
    this.setupWebSocketHandlers();
  }

  public static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService();
    }
    return MemoryService.instance;
  }

  public async initialize(config: Partial<MemoryConfig> = {}): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    
    // Update config with provided values
    this.config = { ...this.config, ...config };
    
    // Connect to Redis
    try {
      await this.redisClient.connect();
      logger.info('Connected to Redis for memory service');
      
      // Load active conversations
      await this.loadActiveConversations();
      
      this.isInitialized = true;
      logger.info('Memory Service initialized');
    } catch (error) {
      logger.error('Failed to initialize Memory Service:', error);
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }
    
    try {
      // Save active conversations
      await this.saveActiveConversations();
      
      // Disconnect from Redis
      await this.redisClient.quit();
      
      this.isInitialized = false;
      logger.info('Memory Service shutdown complete');
    } catch (error) {
      logger.error('Error during Memory Service shutdown:', error);
      throw error;
    }
  }
  private async loadActiveConversations(): Promise<void> {
    try {
      const keys = await this.redisClient.keys(`${this.config.redisPrefix}conversation:*`);
      
      for (const key of keys) {
        const conversationId = key.split(':').pop();
        if (conversationId) {
          const conversation = await this.getConversation(conversationId);
          if (conversation && !conversation.isArchived) {
            this.activeConversations.set(conversationId, conversation);
          }
        }
      }
      
      logger.info(`Loaded ${this.activeConversations.size} active conversations`);
    } catch (error) {
      logger.error('Failed to load active conversations:', error);
      throw error;
    }
  }

  private async saveActiveConversations(): Promise<void> {
    // This is a placeholder - in a real implementation, you would save the in-memory
    // conversations to Redis or another persistent store
    logger.debug('Saving active conversations');
  }

  private setupWebSocketHandlers(): void {
    // Handle new message events
    this.webSocketService.onMessage('conversation:message:new', async (data: any) => {
      try {
        const { conversationId, role, content, parentMessageId, metadata } = data;
        
        if (!conversationId || !role || !content) {
          logger.error('Missing required fields for new message');
          return;
        }
        
        const message = await this.addMessage({
          conversationId,
          role,
          content,
          parentMessageId,
          metadata
        });
        
        // Broadcast the new message to subscribers
        this.webSocketService.broadcast(`conversation:${conversationId}:message`, message);
      } catch (error) {
        logger.error('Error handling new message:', error);
      }
    });
    
    // Handle conversation subscription
    this.webSocketService.onMessage('conversation:subscribe', (data: any, clientId: string) => {
      const { conversationId } = data;
      if (!conversationId) return;
      
      if (!this.subscriptions.has(conversationId)) {
        this.subscriptions.set(conversationId, new Set());
      }
      this.subscriptions.get(conversationId)?.add(clientId);
      
      logger.debug(`Client ${clientId} subscribed to conversation ${conversationId}`);
    });
    
    // Handle conversation unsubscription
    this.webSocketService.onMessage('conversation:unsubscribe', (data: any, clientId: string) => {
      const { conversationId } = data;
      if (!conversationId || !this.subscriptions.has(conversationId)) return;
      
      this.subscriptions.get(conversationId)?.delete(clientId);
      
      // Clean up empty subscription sets
      if (this.subscriptions.get(conversationId)?.size === 0) {
        this.subscriptions.delete(conversationId);
      }
      
      logger.debug(`Client ${clientId} unsubscribed from conversation ${conversationId}`);
    });
  }

  // Conversation Management
  public async createConversation(title: string, metadata?: Record<string, any>): Promise<Conversation> {
    const conversation: Conversation = {
      id: `conv_${uuidv4()}`,
      title,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata,
      messageCount: 0,
      isArchived: false
    };
    
    // Save to Redis
    await this.redisClient.set(
      `${this.config.redisPrefix}conversation:${conversation.id}`,
      JSON.stringify(conversation)
    );
    
    // Add to active conversations
    this.activeConversations.set(conversation.id, conversation);
    
    logger.info(`Created new conversation: ${conversation.id}`);
    return conversation;
  }

  public async getConversation(conversationId: string): Promise<Conversation | null> {
    try {
      const data = await this.redisClient.get(`${this.config.redisPrefix}conversation:${conversationId}`);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error(`Failed to get conversation ${conversationId}:`, error);
      return null;
    }
  }

  public async updateConversation(
    conversationId: string,
    updates: Partial<Omit<Conversation, 'id' | 'createdAt'>>
  ): Promise<Conversation | null> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) return null;
    
    const updatedConversation: Conversation = {
      ...conversation,
      ...updates,
      updatedAt: new Date()
    };
    
    // Save to Redis
    await this.redisClient.set(
      `${this.config.redisPrefix}conversation:${conversationId}`,
      JSON.stringify(updatedConversation)
    );
    
    // Update in active conversations if needed
    if (this.activeConversations.has(conversationId)) {
      this.activeConversations.set(conversationId, updatedConversation);
    }
    
    return updatedConversation;
  }

  public async archiveConversation(conversationId: string): Promise<boolean> {
    const updated = await this.updateConversation(conversationId, { isArchived: true });
    if (updated) {
      this.activeConversations.delete(conversationId);
      return true;
    }
    return false;
  }

  // Message Management
  public async addMessage(message: Omit<Message, 'id' | 'timestamp'>): Promise<Message> {
    const conversation = await this.getConversation(message.conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${message.conversationId} not found`);
    }
    
    const newMessage: Message = {
      ...message,
      id: `msg_${uuidv4()}`,
      timestamp: new Date()
    };
    
    // Save message to Redis (using a list for conversation messages)
    await this.redisClient.rPush(
      `${this.config.redisPrefix}conversation:${message.conversationId}:messages`,
      JSON.stringify(newMessage)
    );
    
    // Trim old messages if needed
    if (conversation.messageCount >= this.config.maxMessagesPerConversation) {
      await this.redisClient.lTrim(
        `${this.config.redisPrefix}conversation:${message.conversationId}:messages`,
        -this.config.maxMessagesPerConversation,
        -1
      );
    } else {
      // Update conversation message count
      await this.updateConversation(message.conversationId, {
        messageCount: conversation.messageCount + 1,
        updatedAt: new Date()
      });
    }
    
    return newMessage;
  }

  public async getMessages(
    conversationId: string,
    limit: number = 100,
    before?: Date
  ): Promise<Message[]> {
    try {
      // Get all messages for the conversation
      const messages = await this.redisClient.lRange(
        `${this.config.redisPrefix}conversation:${conversationId}:messages`,
        0,
        -1
      );
      
      // Parse messages and filter by date if needed
      let parsedMessages = messages
        .map(msg => JSON.parse(msg) as Message)
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      if (before) {
        parsedMessages = parsedMessages.filter(msg => new Date(msg.timestamp) < before);
      }
      
      // Apply limit
      return parsedMessages.slice(-limit);
    } catch (error) {
      logger.error(`Failed to get messages for conversation ${conversationId}:`, error);
      return [];
    }
  }

  public async getMessage(conversationId: string, messageId: string): Promise<Message | null> {
    try {
      const messages = await this.redisClient.lRange(
        `${this.config.redisPrefix}conversation:${conversationId}:messages`,
        0,
        -1
      );
      
      for (const msg of messages) {
        const message = JSON.parse(msg) as Message;
        if (message.id === messageId) {
          return message;
        }
      }
      
      return null;
    } catch (error) {
      logger.error(`Failed to get message ${messageId} from conversation ${conversationId}:`, error);
      return null;
    }
  }

  // Context Management
  public async getConversationContext(conversationId: string, limit: number = 10): Promise<string> {
    const messages = await this.getMessages(conversationId, limit);
    
    // Format messages as a context string
    return messages
      .map(msg => {
        const role = msg.role === 'assistant' ? 'Assistant' : 'User';
        return `${role}: ${msg.content}`;
      })
      .join('\n\n');
  }

  // Search and Retrieval
  public async searchMessages(
    query: string,
    conversationId?: string,
    limit: number = 10
  ): Promise<Message[]> {
    // This is a simplified implementation
    // In a real application, you would use a proper search engine like Elasticsearch
    // or Redis Search for better performance and relevance
    
    let allMessages: Message[] = [];
    
    if (conversationId) {
      // Search within a specific conversation
      allMessages = await this.getMessages(conversationId, 1000); // Get up to 1000 messages
    } else {
      // Search across all conversations (simplified - in practice, this would be paginated)
      for (const convId of this.activeConversations.keys()) {
        const messages = await this.getMessages(convId, 100);
        allMessages = [...allMessages, ...messages];
      }
    }
    
    // Simple keyword matching (case-insensitive)
    const queryTerms = query.toLowerCase().split(/\s+/);
    
    return allMessages
      .filter(message => 
        queryTerms.every(term => 
          message.content.toLowerCase().includes(term)
        )
      )
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  // Cleanup and Maintenance
  public async cleanupOldConversations(days: number = this.config.maxConversationAgeDays): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    let archivedCount = 0;
    
    // Get all conversations
    const keys = await this.redisClient.keys(`${this.config.redisPrefix}conversation:*`);
    
    for (const key of keys) {
      const data = await this.redisClient.get(key);
      if (!data) continue;
      
      const conversation = JSON.parse(data) as Conversation;
      
      // Skip already archived conversations
      if (conversation.isArchived) continue;
      
      // Check if conversation is older than cutoff date
      if (new Date(conversation.updatedAt) < cutoffDate) {
        await this.archiveConversation(conversation.id);
        archivedCount++;
      }
    }
    
    logger.info(`Archived ${archivedCount} old conversations`);
    return archivedCount;
  }
}

export const memoryService = MemoryService.getInstance();
