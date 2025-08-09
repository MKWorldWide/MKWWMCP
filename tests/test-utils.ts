import { RedisClientType, createClient } from 'redis';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const exec = promisify(execCallback);

export class TestRedis {
  private client: RedisClientType;
  private testKeyPrefix = 'test:';

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
  }

  async connect(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  async clearTestData(): Promise<void> {
    const keys = await this.client.keys(`${this.testKeyPrefix}*`);
    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }

  getClient(): RedisClientType {
    return this.client;
  }
}

export async function setupTestDatabase() {
  // Run database migrations or setup test database
  try {
    // Example: Run Prisma migrations
    // await exec('npx prisma migrate deploy');
  } catch (error) {
    console.error('Failed to setup test database:', error);
    throw error;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function mockWebSocketClient() {
  return {
    send: jest.fn(),
    close: jest.fn(),
    on: jest.fn(),
    readyState: 1, // OPEN
  };
}

export function createMockService(serviceName: string, methods: Record<string, any> = {}) {
  const mockService: Record<string, any> = {};
  
  // Add standard methods with jest mocks
  const standardMethods = ['initialize', 'shutdown', 'isHealthy'];
  standardMethods.forEach(method => {
    mockService[method] = jest.fn().mockResolvedValue(true);
  });
  
  // Add custom methods
  Object.entries(methods).forEach(([method, implementation]) => {
    if (typeof implementation === 'function') {
      mockService[method] = jest.fn(implementation);
    } else {
      mockService[method] = jest.fn().mockResolvedValue(implementation);
    }
  });
  
  return mockService;
}

export function expectToBeRejectedWithError(promise: Promise<any>, errorMessage: string) {
  return expect(promise).rejects.toThrow(errorMessage);
}

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const JWT_ISSUER = 'mkww-test';

// Test user roles
export enum UserRole {
  ADMIN = 'admin',
  OPERATOR = 'operator',
  SERVICE = 'service',
  READONLY = 'readonly'
}

// Test user interface
export interface TestUser {
  id: string;
  username: string;
  role: UserRole;
  permissions: string[];
}

// Default test users
export const TEST_USERS: Record<string, TestUser> = {
  admin: {
    id: 'test-admin-1',
    username: 'admin@test.mkww',
    role: UserRole.ADMIN,
    permissions: ['*']
  },
  operator: {
    id: 'test-operator-1',
    username: 'operator@test.mkww',
    role: UserRole.OPERATOR,
    permissions: ['services:read', 'tasks:read', 'tasks:create', 'tasks:update']
  },
  readonly: {
    id: 'test-readonly-1',
    username: 'readonly@test.mkww',
    role: UserRole.READONLY,
    permissions: ['services:read', 'tasks:read']
  },
  service: {
    id: 'test-service-1',
    username: 'service@test.mkww',
    role: UserRole.SERVICE,
    permissions: ['tasks:update', 'tasks:read:self']
  }
};

/**
 * Generate a JWT token for testing
 * @param user User to generate token for (defaults to admin)
 * @param expiresIn Token expiration time (default: 1h)
 * @returns JWT token
 */
export function generateTestToken(user: Partial<TestUser> = TEST_USERS.admin, expiresIn = '1h'): string {
  const payload = {
    sub: user.id || TEST_USERS.admin.id,
    username: user.username || TEST_USERS.admin.username,
    role: user.role || TEST_USERS.admin.role,
    permissions: user.permissions || TEST_USERS.admin.permissions,
    iat: Math.floor(Date.now() / 1000),
    iss: JWT_ISSUER,
    aud: ['mkww-api']
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

/**
 * Get test headers with authentication
 * @param role User role to get headers for (default: admin)
 * @returns Headers object with Authorization
 */
export function getAuthHeaders(role: UserRole | 'admin' | 'operator' | 'service' | 'readonly' = 'admin'): Record<string, string> {
  const user = TEST_USERS[role] || TEST_USERS.admin;
  const token = generateTestToken(user);
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

export function mockLogger() {
  return {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };
}
