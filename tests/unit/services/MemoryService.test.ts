import { MemoryService } from '../../../src/services/MemoryService.js';
import { TestRedis, mockWebSocketClient } from '../test-utils.js';

describe('MemoryService', () => {
  let memoryService: MemoryService;
  let testRedis: TestRedis;
  let mockWebSocket: any;

  beforeAll(async () => {
    testRedis = new TestRedis();
    await testRedis.connect();
    
    // Mock WebSocket service
    mockWebSocket = {
      broadcast: jest.fn(),
      onMessage: jest.fn(),
      sendToClient: jest.fn(),
    };
    
    // Mock WebSocketService.getInstance
    jest.mock('../../../src/services/WebSocketService.js', () => ({
      WebSocketService: {
        getInstance: () => mockWebSocket,
      },
    }));
    
    // Import after setting up mocks
    const { memoryService: ms } = await import('../../../src/services/MemoryService.js');
    memoryService = ms;
  });

  afterAll(async () => {
    await testRedis.disconnect();
    jest.clearAllMocks();
    jest.resetModules();
  });

  beforeEach(async () => {
    await testRedis.clearTestData();
    await memoryService.initialize();
  });

  afterEach(async () => {
    await memoryService.shutdown();
    jest.clearAllMocks();
  });

  describe('Conversation Management', () => {
    it('should create a new conversation', async () => {
      const conversation = await memoryService.createConversation('Test Conversation');
      
      expect(conversation).toHaveProperty('id');
      expect(conversation.title).toBe('Test Conversation');
      expect(conversation.messageCount).toBe(0);
      expect(conversation.isArchived).toBe(false);
    });

    it('should retrieve a conversation by ID', async () => {
      const newConversation = await memoryService.createConversation('Test Conversation');
      const conversation = await memoryService.getConversation(newConversation.id);
      
      expect(conversation).not.toBeNull();
      expect(conversation?.id).toBe(newConversation.id);
      expect(conversation?.title).toBe('Test Conversation');
    });

    it('should update a conversation', async () => {
      const conversation = await memoryService.createConversation('Old Title');
      const updated = await memoryService.updateConversation(conversation.id, { 
        title: 'New Title',
        metadata: { key: 'value' },
      });
      
      expect(updated).not.toBeNull();
      expect(updated?.title).toBe('New Title');
      expect(updated?.metadata).toEqual({ key: 'value' });
    });

    it('should archive a conversation', async () => {
      const conversation = await memoryService.createConversation('To Archive');
      const result = await memoryService.archiveConversation(conversation.id);
      
      expect(result).toBe(true);
      
      const archived = await memoryService.getConversation(conversation.id);
      expect(archived?.isArchived).toBe(true);
    });
  });

  describe('Message Management', () => {
    let conversationId: string;

    beforeEach(async () => {
      const conversation = await memoryService.createConversation('Test Messages');
      conversationId = conversation.id;
    });

    it('should add a message to a conversation', async () => {
      const message = await memoryService.addMessage({
        conversationId,
        role: 'user',
        content: 'Hello, world!',
      });
      
      expect(message).toHaveProperty('id');
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello, world!');
      expect(message.conversationId).toBe(conversationId);
      
      // Verify the conversation's message count was incremented
      const conversation = await memoryService.getConversation(conversationId);
      expect(conversation?.messageCount).toBe(1);
    });

    it('should retrieve messages from a conversation', async () => {
      // Add multiple messages
      await memoryService.addMessage({
        conversationId,
        role: 'user',
        content: 'First message',
      });
      
      await memoryService.addMessage({
        conversationId,
        role: 'assistant',
        content: 'Second message',
      });
      
      const messages = await memoryService.getMessages(conversationId);
      
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('First message');
      expect(messages[1].content).toBe('Second message');
    });

    it('should limit the number of messages returned', async () => {
      // Add more messages than the limit
      for (let i = 0; i < 15; i++) {
        await memoryService.addMessage({
          conversationId,
          role: 'user',
          content: `Message ${i}`,
        });
      }
      
      const limitedMessages = await memoryService.getMessages(conversationId, 5);
      expect(limitedMessages).toHaveLength(5);
    });
  });

  describe('Context Management', () => {
    let conversationId: string;

    beforeEach(async () => {
      const conversation = await memoryService.createConversation('Test Context');
      conversationId = conversation.id;
      
      // Add some messages
      await memoryService.addMessage({
        conversationId,
        role: 'user',
        content: 'Hello',
      });
      
      await memoryService.addMessage({
        conversationId,
        role: 'assistant',
        content: 'Hi there! How can I help you?',
      });
    });

    it('should generate conversation context', async () => {
      const context = await memoryService.getConversationContext(conversationId);
      
      expect(context).toContain('User: Hello');
      expect(context).toContain('Assistant: Hi there! How can I help you?');
    });

    it('should limit context by number of messages', async () => {
      // Add more messages
      for (let i = 0; i < 5; i++) {
        await memoryService.addMessage({
          conversationId,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
        });
      }
      
      const limitedContext = await memoryService.getConversationContext(conversationId, 3);
      const lineCount = limitedContext.split('\n').filter(Boolean).length;
      
      // 3 messages * 2 lines each (role + content)
      expect(lineCount).toBe(6);
    });
  });

  describe('Search', () => {
    let conversationId: string;

    beforeEach(async () => {
      const conversation = await memoryService.createConversation('Test Search');
      conversationId = conversation.id;
      
      // Add some test messages
      const messages = [
        { role: 'user' as const, content: 'How do I reset my password?' },
        { role: 'assistant' as const, content: 'You can reset it by clicking the forgot password link.' },
        { role: 'user' as const, content: 'Where can I find the settings?' },
        { role: 'assistant' as const, content: 'Settings are in the top-right menu under your profile.' },
      ];
      
      for (const msg of messages) {
        await memoryService.addMessage({
          conversationId,
          ...msg,
        });
      }
    });

    it('should search messages within a conversation', async () => {
      const results = await memoryService.searchMessages('password', conversationId);
      
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('password');
    });

    it('should search across all conversations', async () => {
      // Create another conversation
      const otherConversation = await memoryService.createConversation('Other Conversation');
      await memoryService.addMessage({
        conversationId: otherConversation.id,
        role: 'user',
        content: 'I need help with my password',
      });
      
      const results = await memoryService.searchMessages('password');
      
      // Should find messages from both conversations
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Cleanup', () => {
    it('should archive old conversations', async () => {
      // Create a conversation that should be archived
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60); // 60 days old
      
      const oldConversation = await memoryService.createConversation('Old Conversation');
      await memoryService.updateConversation(oldConversation.id, {
        updatedAt: oldDate,
      });
      
      // Create a recent conversation
      const recentConversation = await memoryService.createConversation('Recent Conversation');
      
      // Run cleanup (default is 30 days)
      const archivedCount = await memoryService.cleanupOldConversations();
      
      expect(archivedCount).toBe(1);
      
      // Verify the old conversation was archived
      const archived = await memoryService.getConversation(oldConversation.id);
      expect(archived?.isArchived).toBe(true);
      
      // Verify the recent conversation is still active
      const recent = await memoryService.getConversation(recentConversation.id);
      expect(recent?.isArchived).toBe(false);
    });
  });
});
