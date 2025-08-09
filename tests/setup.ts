import { vi, beforeAll, afterAll, afterEach } from 'vitest';

// Mock logger to prevent console output during tests
vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Global test setup
const setup = async () => {
  // Set up any global test environment here
  return {
    // Global test context can be returned here
  };
};

// Global teardown
const teardown = async () => {
  // Clean up any global test environment here
};

// Setup and teardown hooks
beforeAll(async () => {
  await setup();
});

afterAll(async () => {
  await teardown();
});

// Reset mocks between tests
afterEach(() => {
  vi.clearAllMocks();
});
