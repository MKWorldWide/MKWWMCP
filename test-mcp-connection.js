const axios = require('axios');
const config = require('./mcp_config.json');

const mcpServer = config.mcpServers[config.defaultMcpServer];
const healthUrl = `${mcpServer.serverUrl}${mcpServer.endpoints.health}`;

async function testMcpConnection() {
  try {
    console.log(`🌐 Testing connection to MCP server at: ${healthUrl}`);
    
    const response = await axios.get(healthUrl, {
      headers: mcpServer.headers,
      timeout: mcpServer.timeout,
      httpsAgent: new (require('https').Agent)({ 
        rejectUnauthorized: false 
      })
    });
    
    console.log('✅ MCP Server Response:', response.data);
    return true;
  } catch (error) {
    console.error('❌ MCP Connection Error:', {
      message: error.message,
      code: error.code,
      response: error.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      } : 'No response',
      config: {
        url: error.config?.url,
        method: error.config?.method,
        headers: error.config?.headers
      }
    });
    return false;
  }
}

testMcpConnection().then(success => {
  process.exit(success ? 0 : 1);
});
