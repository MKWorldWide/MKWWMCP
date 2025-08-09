import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
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
    logger.info('Initializing Repository Service');
    
    // Start periodic scanning
    this.startPeriodicScan(Number(process.env.REPO_SCAN_INTERVAL_MS) || 5 * 60 * 1000);
    
    // Initial scan
    await this.scanAllRepositories();
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
      logger.warn('Scan already in progress');
      return;
    }

    this.isScanning = true;
    logger.info('Starting scan of all repositories');

    try {
      for (const repo of this.repositories.values()) {
        try {
          await this.scanRepository(repo);
          this.broadcastRepoUpdate(repo);
        } catch (error) {
          logger.error(`Error scanning repository ${repo.name}:`, error);
        }
      }
    } finally {
      this.isScanning = false;
      logger.info('Completed scan of all repositories');
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

  private startPeriodicScan(intervalMs: number): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
    }

    this.scanInterval = setInterval(async () => {
      try {
        await this.updateAllRepositories();
        await this.scanAllRepositories();
      } catch (error) {
        logger.error('Error during periodic repository scan:', error);
      }
    }, intervalMs);

    logger.info(`Started periodic repository scan every ${intervalMs / 1000} seconds`);
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
