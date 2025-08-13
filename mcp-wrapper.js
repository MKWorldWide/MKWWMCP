import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const DOCKER_IMAGE = 'ghcr.io/github/github-mcp-server:latest';
const OUT_DIR = path.join(__dirname, 'out');

// Ensure output directory exists
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

// Simple MCP client
class MCPClient {
  constructor() {
    this.process = null;
  }

  start() {
    return new Promise((resolve) => {
      console.log('Starting MCP server...');
      this.process = spawn('docker', [
        'run', '-i', '--rm',
        '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN',
        DOCKER_IMAGE
      ], {
        env: {
          ...process.env,
          GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN || process.env.GITHUB_TOKEN
        }
      });

      this.process.stdout.on('data', (data) => {
        const output = data.toString().trim();
        if (output.includes('GitHub MCP Server running')) {
          console.log('MCP Server is ready');
          resolve();
        }
        console.log('MCP:', output);
      });

      this.process.stderr.on('data', (data) => {
        console.error('MCP Error:', data.toString().trim());
      });
    });
  }

  async listTools() {
    return this._call('list_tools');
  }

  async listRepos(org) {
    return this._call('search_repositories', { query: `org:${org}`, per_page: 100 });
  }

  _call(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.process) {
        return reject(new Error('MCP process not started'));
      }

      const id = Date.now().toString();
      const request = {
        jsonrpc: '2.0',
        method,
        params,
        id
      };

      this.process.stdin.write(JSON.stringify(request) + '\n');

      const onData = (data) => {
        try {
          const response = JSON.parse(data.toString().trim());
          if (response.id === id) {
            this.process.stdout.off('data', onData);
            if (response.error) {
              reject(new Error(response.error.message || 'MCP error'));
            } else {
              resolve(response.result);
            }
          }
        } catch (e) {
          // Ignore parse errors from other messages
        }
      };

      this.process.stdout.on('data', onData);
      
      // Set a timeout
      setTimeout(() => {
        this.process.stdout.off('data', onData);
        reject(new Error('Request timeout'));
      }, 30000);
    });
  }
}

// Main function
async function main() {
  const client = new MCPClient();
  
  try {
    // Start the MCP server
    await client.start();
    
    // List available tools
    console.log('Fetching available tools...');
    const tools = await client.listTools();
    console.log('Available tools:', tools);
    
    // List repositories for MKWorldWide
    console.log('Fetching repositories for MKWorldWide...');
    const repos = await client.listRepos('MKWorldWide');
    
    // Save results
    const outputPath = path.join(OUT_DIR, 'mkww-repos.json');
    fs.writeFileSync(outputPath, JSON.stringify(repos, null, 2));
    console.log(`Repository list saved to ${outputPath}`);
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    if (client.process) {
      client.process.kill();
    }
  }
}

// Run the main function
main().catch(console.error);
