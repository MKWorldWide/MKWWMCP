import { logger } from '../utils/logger.js';
import { WebSocketService } from './WebSocketService.js';
import { TaskOrchestrator } from './TaskOrchestrator.js';
import type { Request, Response } from 'express';
import { Router } from 'express';

type IntegrationType = 'discord' | 'vrchat' | 'vcc';

interface IntegrationConfig {
  enabled: boolean;
  config: Record<string, any>;
  lastSync?: Date;
  status: 'connected' | 'disconnected' | 'error' | 'syncing';
  error?: string;
}

export class IntegrationService {
  private static instance: IntegrationService;
  private webSocketService: WebSocketService;
  private taskOrchestrator: TaskOrchestrator;
  private integrations: Map<string, IntegrationConfig> = new Map();
  private router: Router;
  private discordClient: any = null;
  private vrcClient: any = null;
  private vccClient: any = null;

  private constructor() {
    this.webSocketService = WebSocketService.getInstance();
    this.taskOrchestrator = TaskOrchestrator.getInstance();
    this.router = Router();
    this.setupRoutes();
  }

  public static getInstance(): IntegrationService {
    if (!IntegrationService.instance) {
      IntegrationService.instance = new IntegrationService();
    }
    return IntegrationService.instance;
  }

  public getRouter(): Router {
    return this.router;
  }

  public async initialize(): Promise<void> {
    logger.info('Initializing Integration Service');
    
    // Load integration configurations from environment or config
    await this.loadConfigurations();
    
    // Initialize enabled integrations
    await this.initializeIntegrations();
    
    logger.info('Integration Service initialized');
  }

  private async loadConfigurations(): Promise<void> {
    // Load from environment variables or config file
    const discordToken = process.env.DISCORD_TOKEN;
    const vrcUsername = process.env.VRC_USERNAME;
    const vrcPassword = process.env.VRC_PASSWORD;
    const vccApiKey = process.env.VCC_API_KEY;

    // Initialize Discord integration
    if (discordToken) {
      this.integrations.set('discord', {
        enabled: true,
        config: { token: discordToken },
        status: 'disconnected'
      });
    }

    // Initialize VRChat integration
    if (vrcUsername && vrcPassword) {
      this.integrations.set('vrchat', {
        enabled: true,
        config: { username: vrcUsername, password: vrcPassword },
        status: 'disconnected'
      });
    }

    // Initialize VCC integration
    if (vccApiKey) {
      this.integrations.set('vcc', {
        enabled: true,
        config: { apiKey: vccApiKey },
        status: 'disconnected'
      });
    }
  }

  private async initializeIntegrations(): Promise<void> {
    for (const [type, config] of this.integrations.entries()) {
      if (config.enabled) {
        try {
          await this.initializeIntegration(type as IntegrationType, config);
          config.status = 'connected';
          logger.info(`Successfully initialized ${type} integration`);
        } catch (error) {
          config.status = 'error';
          config.error = error instanceof Error ? error.message : 'Unknown error';
          logger.error(`Failed to initialize ${type} integration:`, error);
        }
      }
    }
  }

  private async initializeIntegration(type: IntegrationType, config: IntegrationConfig): Promise<void> {
    switch (type) {
      case 'discord':
        await this.initializeDiscord(config);
        break;
      case 'vrchat':
        await this.initializeVRChat(config);
        break;
      case 'vcc':
        await this.initializeVCC(config);
        break;
      default:
        throw new Error(`Unsupported integration type: ${type}`);
    }
  }

  private async initializeDiscord(config: IntegrationConfig): Promise<void> {
    try {
      // Initialize Discord client
      const { Client, GatewayIntentBits } = await import('discord.js');
      
      this.discordClient = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.GuildMembers
        ]
      });

      // Set up event handlers
      this.discordClient.on('ready', () => {
        logger.info(`Discord client logged in as ${this.discordClient?.user?.tag}`);
        config.status = 'connected';
      });

      this.discordClient.on('messageCreate', async (message: any) => {
        if (message.author.bot) return;
        
        // Forward message to task orchestrator
        await this.taskOrchestrator.createTask('communication', {
          platform: 'discord',
          channelId: message.channelId,
          guildId: message.guildId,
          author: {
            id: message.author.id,
            username: message.author.username,
            discriminator: message.author.discriminator
          },
          content: message.content,
          messageId: message.id
        }, {
          priority: 5,
          requiredCapabilities: ['discord_communication']
        });
      });

      // Login to Discord
      if (typeof config.config.token === 'string') {
        await this.discordClient.login(config.config.token);
      } else {
        throw new Error('Discord token is not a string');
      }
    } catch (error) {
      logger.error('Failed to initialize Discord client:', error);
      throw error;
    }
  }

  private async initializeVRChat(config: IntegrationConfig): Promise<void> {
    try {
      // Initialize VRChat client
      // Note: The VRChat API client would be imported here
      // This is a placeholder implementation
      logger.info('Initializing VRChat client...');
      
      // Simulate VRChat client initialization
      this.vrcClient = {
        username: config.config.username,
        login: async () => {
          logger.info('Simulated VRChat login');
          return Promise.resolve();
        },
        logout: async () => {
          logger.info('Simulated VRChat logout');
          return Promise.resolve();
        }
      };

      // Login to VRChat
      await this.vrcClient.login();
      config.status = 'connected';
      logger.info('Successfully logged in to VRChat');
      
      // Set up event listeners
      this.setupVRChatEvents();
    } catch (error) {
      config.status = 'error';
      config.error = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`VRChat initialization failed: ${config.error}`);
    }
  }

  private setupVRChatEvents(): void {
    // Set up VRChat event listeners
    // This is a placeholder - actual implementation would depend on the VRChat API client
    this.vrcClient?.on('friendOnline', (friend: any) => {
      logger.info(`Friend online: ${friend.displayName}`);
      
      // Forward to task orchestrator
      this.taskOrchestrator.createTask('vrchat_integration', {
        event: 'friendOnline',
        friend: {
          id: friend.id,
          displayName: friend.displayName,
          status: friend.status
        },
        timestamp: new Date()
      }, {
        priority: 3,
        requiredCapabilities: ['vrchat_integration']
      }).catch(error => {
        logger.error('Failed to create task for VRChat friend online event:', error);
      });
    });
    
    // Add more event listeners as needed
  }

  private async initializeVCC(config: IntegrationConfig): Promise<void> {
    // Initialize VCC client
    // This is a placeholder - replace with actual VCC API client initialization
    this.vccClient = {
      apiKey: config.config.apiKey,
      // Add VCC API client methods here
    };
    
    config.status = 'connected';
    logger.info('VCC integration initialized');
  }

  private setupRoutes(): void {
    // Get integration status
    this.router.get('/status', (req: Request, res: Response) => {
      const status = Array.from(this.integrations.entries()).map(([type, config]) => ({
        type,
        enabled: config.enabled,
        status: config.status,
        lastSync: config.lastSync,
        error: config.error
      }));
      
      res.json({ integrations: status });
    });

    // Trigger manual sync for an integration
    this.router.post('/:type/sync', async (req: Request, res: Response) => {
      const { type } = req.params;
      const integration = this.integrations.get(type);
      
      if (!integration || !integration.enabled) {
        return res.status(404).json({ error: 'Integration not found or disabled' });
      }
      
      try {
        integration.status = 'syncing';
        await this.syncIntegration(type as IntegrationType);
        integration.status = 'connected';
        integration.lastSync = new Date();
        res.json({ status: 'success', message: 'Sync completed successfully' });
      } catch (error) {
        integration.status = 'error';
        integration.error = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: `Sync failed: ${integration.error}` });
      }
    });
  }

  private async syncIntegration(type: IntegrationType): Promise<void> {
    // Implement integration-specific sync logic
    switch (type) {
      case 'discord':
        await this.syncDiscord();
        break;
      case 'vrchat':
        await this.syncVRChat();
        break;
      case 'vcc':
        await this.syncVCC();
        break;
      default:
        throw new Error(`Unsupported integration type: ${type}`);
    }
  }

  private async syncDiscord(): Promise<void> {
    // Sync Discord data (servers, channels, etc.)
    // This is a placeholder - implement actual sync logic
    logger.info('Syncing Discord data...');
    // Implementation would go here
  }

  private async syncVRChat(): Promise<void> {
    // Sync VRChat data (friends, world info, etc.)
    // This is a placeholder - implement actual sync logic
    logger.info('Syncing VRChat data...');
    // Implementation would go here
  }

  private async syncVCC(): Promise<void> {
    // Sync VCC data (projects, packages, etc.)
    // This is a placeholder - implement actual sync logic
    logger.info('Syncing VCC data...');
    // Implementation would go here
  }

  public async sendDiscordMessage(channelId: string, message: string): Promise<void> {
    if (!this.discordClient) {
      throw new Error('Discord client not initialized');
    }
    
    const channel = await this.discordClient.channels.fetch(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }
    
    await channel.send(message);
  }

  public async getVRChatUser(userId: string): Promise<any> {
    if (!this.vrcClient) {
      throw new Error('VRChat client not initialized');
    }
    
    // This is a placeholder - implement actual VRChat API call
    return this.vrcClient.getUser(userId);
  }

  public async getVCCProjects(): Promise<any[]> {
    if (!this.vccClient) {
      throw new Error('VCC client not initialized');
    }
    
    // This is a placeholder - implement actual VCC API call
    return [];
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down Integration Service...');
    
    // Disconnect Discord client if connected
    if (this.discordClient) {
      this.discordClient.destroy();
    }
    
    // Logout from VRChat if connected
    if (this.vrcClient) {
      try {
        await this.vrcClient.logout();
      } catch (error) {
        logger.error('Error during VRChat logout:', error);
      }
    }
    
    // Clean up VCC client if needed
    this.vccClient = null;
    
    logger.info('Integration Service shutdown complete');
  }
}

export const integrationService = IntegrationService.getInstance();
