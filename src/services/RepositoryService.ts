import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { webSocketService } from './WebSocketService.js';

const execAsync = promisify(exec);

type RepoStatus = 'cloning' | 'updating' | 'ready' | 'error';

interface Repository {
  name: string;
  url: string;
  localPath: string;
  branch: string;
  status: RepoStatus;
  lastUpdated: Date | null;
  metadata: {
    hasVccManifest: boolean;
    hasUnityProject: boolean;
    hasPackageJson: boolean;
    [key: string]: any;
  };
}

export class RepositoryService {
  private static instance: RepositoryService;
  private repositories: Map<string, Repository> = new Map();
  private baseDir: string;
  private scanInterval: NodeJS.Timeout | null = null;
  private isScanning = false;

  private constructor() {
    this.baseDir = process.env.REPOSITORIES_DIR || join(process.cwd(), 'repos');
    this.ensureBaseDirExists();
  }

  public static getInstance(): RepositoryService {
    if (!RepositoryService.instance) {
      RepositoryService.instance = new RepositoryService();
    }
    return RepositoryService.instance;
  }

  private ensureBaseDirExists(): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
      logger.info(`Created repositories directory at ${this.baseDir}`);
    }
  }

  public async initialize(): Promise<void> {
    try {
      logger.info('Initializing Repository Service');
      
      // Ensure base directory exists
      this.ensureBaseDirExists();
      
      // Start periodic scanning (don't wait for it)
      const scanInterval = Number(process.env.REPO_SCAN_INTERVAL_MS) || 5 * 60 * 1000;
      logger.info(`Starting repository scanner with interval: ${scanInterval}ms`);
      this.startPeriodicScan(scanInterval);
      
      // Initial scan (don't block initialization)
      this.scanAllRepositories().catch(err => {
        logger.error('Initial repository scan failed:', err);
      });
      
      logger.info('Repository Service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Repository Service:', error);
      throw error; // Re-throw to be handled by the caller
    }
  }

  public async addRepository(repoUrl: string, branch = 'main'): Promise<Repository> {
    const repoName = this.extractRepoName(repoUrl);
    const localPath = join(this.baseDir, repoName);
    
    if (this.repositories.has(repoName)) {
      throw new Error(`Repository '${repoName}' already exists`);
    }

    const repo: Repository = {
      name: repoName,
      url: repoUrl,
      localPath,
      branch,
      status: 'cloning',
      lastUpdated: null,
      metadata: {
        hasVccManifest: false,
        hasUnityProject: false,
        hasPackageJson: false
      }
    };

    this.repositories.set(repoName, repo);
    
    try {
      // Clone the repository
      await this.cloneRepository(repo);
      
      // Scan the repository
      await this.scanRepository(repo);
      
      // Notify about the new repository
      this.broadcastRepoUpdate(repo);
      
      return repo;
    } catch (error) {
      repo.status = 'error';
      this.broadcastRepoUpdate(repo);
      throw error;
    }
  }

  private async cloneRepository(repo: Repository): Promise<void> {
    const { url, localPath, branch } = repo;
    
    try {
      logger.info(`Cloning repository: ${url} (${branch})`);
      
      // Clone the repository with a specific branch
      await execAsync(`git clone --branch ${branch} --single-branch ${url} ${localPath}`);
      
      repo.status = 'ready';
      repo.lastUpdated = new Date();
      
      logger.info(`Successfully cloned repository: ${repo.name}`);
    } catch (error) {
      logger.error(`Failed to clone repository ${url}:`, error);
      throw error;
    }
  }

  public async updateRepository(repoName: string): Promise<Repository> {
    const repo = this.repositories.get(repoName);
    if (!repo) {
      throw new Error(`Repository '${repoName}' not found`);
    }

    if (repo.status === 'updating') {
      logger.warn(`Repository '${repoName}' is already being updated`);
      return repo;
    }

    repo.status = 'updating';
    this.broadcastRepoUpdate(repo);

    try {
      logger.info(`Updating repository: ${repo.name}`);
      
      // Fetch and pull the latest changes
      await execAsync('git fetch --all', { cwd: repo.localPath });
      await execAsync(`git checkout ${repo.branch}`, { cwd: repo.localPath });
      await execAsync('git pull', { cwd: repo.localPath });
      
      // Rescan the repository
      await this.scanRepository(repo);
      
      repo.status = 'ready';
      repo.lastUpdated = new Date();
      
      logger.info(`Successfully updated repository: ${repo.name}`);
      this.broadcastRepoUpdate(repo);
      
      return repo;
    } catch (error) {
      repo.status = 'error';
      this.broadcastRepoUpdate(repo);
      logger.error(`Failed to update repository ${repo.name}:`, error);
      throw error;
    }
  }

  private async scanRepository(repo: Repository): Promise<void> {
    try {
      logger.debug(`Scanning repository: ${repo.name}`);
      
      // Check for VCC manifest
      const vccManifestPath = join(repo.localPath, 'vcc_manifest.json');
      repo.metadata.hasVccManifest = existsSync(vccManifestPath);
      
      // Check for Unity project
      const unityProjectPath = join(repo.localPath, 'Assets');
      repo.metadata.hasUnityProject = existsSync(unityProjectPath);
      
      // Check for package.json
      const packageJsonPath = join(repo.localPath, 'package.json');
      repo.metadata.hasPackageJson = existsSync(packageJsonPath);
      
      // Additional metadata can be added here
      
      logger.debug(`Scan completed for repository: ${repo.name}`, repo.metadata);
    } catch (error) {
      logger.error(`Failed to scan repository ${repo.name}:`, error);
      throw error;
    }
  }

  public async scanAllRepositories(): Promise<void> {
    if (this.isScanning) {
      logger.warn('Repository scan already in progress');
      return;
    }

    this.isScanning = true;
    const startTime = Date.now();
    logger.info('Starting repository scan...');

    try {
      // Ensure base directory exists
      if (!existsSync(this.baseDir)) {
        logger.warn(`Repository directory does not exist: ${this.baseDir}`);
        return;
      }

      const repoDirs = await fs.readdir(this.baseDir, { withFileTypes: true });
      logger.debug(`Found ${repoDirs.length} items in repository directory`);
      
      let scannedCount = 0;
      let errorCount = 0;
      
      for (const dirent of repoDirs) {
        if (!dirent.isDirectory()) {
          logger.debug(`Skipping non-directory: ${dirent.name}`);
          continue;
        }
        
        const repoName = dirent.name;
        const repoPath = join(this.baseDir, repoName);
        
        try {
          logger.debug(`Scanning repository: ${repoName}`);
          
          // Get or create repository entry
          let repo = this.repositories.get(repoName);
          if (!repo) {
            repo = {
              name: repoName,
              url: `file://${repoPath}`, // Local path as URL for now
              localPath: repoPath,
              branch: 'main',
              status: 'ready',
              lastUpdated: null,
              metadata: {
                hasVccManifest: false,
                hasUnityProject: false,
                hasPackageJson: false
              }
            };
            this.repositories.set(repoName, repo);
          }
          
          await this.scanRepository(repo);
          scannedCount++;
          
        } catch (error) {
          errorCount++;
          logger.error(`Error scanning repository ${repoName}:`, error);
          // Continue with next repository even if one fails
        }
      }
      
      const duration = Date.now() - startTime;
      logger.info(`Repository scan completed: ${scannedCount} repositories scanned, ${errorCount} errors (${duration}ms)`);
      
    } catch (error) {
      logger.error('Fatal error during repository scan:', error);
      throw error;
      
    } finally {
      this.isScanning = false;
    }
  }

  public async updateAllRepositories(): Promise<void> {
    logger.info('Updating all repositories');
    
    for (const repo of this.repositories.values()) {
      try {
        await this.updateRepository(repo.name);
      } catch (error) {
        logger.error(`Failed to update repository ${repo.name}:`, error);
      }
    }
  }

  public startPeriodicScan(intervalMs: number): void {
    try {
      logger.info(`Configuring repository scanner with interval: ${intervalMs}ms`);
      
      // Clear any existing interval
      if (this.scanInterval) {
        logger.debug('Clearing existing repository scan interval');
        clearInterval(this.scanInterval);
        this.scanInterval = null;
      }
      
      // Set up new interval with error handling
      this.scanInterval = setInterval(async () => {
        if (this.isScanning) {
          logger.debug('Skipping repository scan - previous scan still in progress');
          return;
        }
        
        try {
          logger.debug('Starting scheduled repository scan');
          await this.scanAllRepositories();
          logger.debug('Completed scheduled repository scan');
        } catch (error) {
          logger.error('Error during scheduled repository scan:', error);
        }
      }, intervalMs);
      
      logger.info(`Repository scanner configured with ${intervalMs}ms interval`);
    } catch (error) {
      logger.error('Failed to start repository scanner:', error);
      throw error;
    }
  }

  private extractRepoName(repoUrl: string): string {
    // Extract repository name from URL (handles both SSH and HTTPS URLs)
    const match = repoUrl.match(/([^/]+?)(\.git)?$/);
    if (!match) {
      throw new Error(`Invalid repository URL: ${repoUrl}`);
    }
    return match[1].replace(/\.git$/, '');
  }

  private broadcastRepoUpdate(repo: Repository): void {
    webSocketService.broadcast({
      type: 'repo_update',
      data: {
        name: repo.name,
        status: repo.status,
        lastUpdated: repo.lastUpdated,
        metadata: repo.metadata
      }
    });
  }

  public getRepository(name: string): Repository | undefined {
    return this.repositories.get(name);
  }

  public getAllRepositories(): Repository[] {
    return Array.from(this.repositories.values());
  }

  public async shutdown(): Promise<void> {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.isScanning = false;
    logger.info('Repository Service shutdown');
  }
}

export const repositoryService = RepositoryService.getInstance();
