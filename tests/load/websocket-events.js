const { v4: uuidv4 } = require('uuid');

// Generate a random user ID for the test
const userId = `test-user-${Math.floor(Math.random() * 10000)}`;
let conversationId = null;

module.exports = {
  // Connect to WebSocket server
  connect: (context, events, done) => {
    context.vars.ws = context.ws();
    return done();
  },

  // Send authentication message
  sendAuth: (context, events, done) => {
    context.vars.ws.on('message', (data) => {
      const message = JSON.parse(data);
      if (message.type === 'auth:success') {
        context.vars.authenticated = true;
        return done();
      }
    });

    context.vars.ws.send(JSON.stringify({
      type: 'auth',
      userId,
      token: 'test-token'
    }));
  },

  // Subscribe to a conversation
  subscribeToConversation: (context, events, done) => {
    conversationId = `test-conversation-${Math.floor(Math.random() * 1000)}`;
    
    context.vars.ws.on('message', (data) => {
      const message = JSON.parse(data);
      if (message.type === 'conversation:subscribed') {
        return done();
      }
    });

    context.vars.ws.send(JSON.stringify({
      type: 'conversation:subscribe',
      conversationId
    }));
  },

  // Send a message
  sendMessage: (context, events, done) => {
    if (!conversationId) {
      return done(new Error('No conversation ID'));
    }

    const messageId = uuidv4();
    const message = {
      type: 'conversation:message',
      messageId,
      conversationId,
      content: `Test message ${messageId}`,
      timestamp: new Date().toISOString()
    };

    context.vars.ws.on('message', (data) => {
      const response = JSON.parse(data);
      if (response.type === 'conversation:message:ack' && response.messageId === messageId) {
        events.emit('counter', 'message.ack', 1);
        return done();
      }
    });

    context.vars.ws.send(JSON.stringify(message));
  },

  // Close the connection
  close: (context, events, done) => {
    context.vars.ws.close();
    return done();
  }
};
