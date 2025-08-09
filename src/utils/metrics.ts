import { collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';
import { logger } from './logger.js';

class MetricsCollector {
  private register: Registry;
  private metrics: {
    [key: string]: Gauge<string> | Histogram<string>;
  };

  constructor() {
    this.register = new Registry();
    this.metrics = {};
    
    // Enable default Node.js metrics
    collectDefaultMetrics({
      register: this.register,
      prefix: 'node_',
      gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
    });
    
    // Initialize custom metrics
    this.initializeCustomMetrics();
  }

  private initializeCustomMetrics() {
    // WebSocket metrics
    this.metrics.websocket_connections = new Gauge({
      name: 'mcp_websocket_connections',
      help: 'Number of active WebSocket connections',
      labelNames: ['status'],
    });

    // Request metrics
    this.metrics.http_request_duration_milliseconds = new Histogram({
      name: 'mcp_http_request_duration_milliseconds',
      help: 'Duration of HTTP requests in milliseconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    });

    // Task metrics
    this.metrics.tasks_total = new Gauge({
      name: 'mcp_tasks_total',
      help: 'Total number of tasks by status',
      labelNames: ['status'],
    });

    // Memory usage
    this.metrics.memory_usage_bytes = new Gauge({
      name: 'mcp_memory_usage_bytes',
      help: 'Memory usage in bytes',
      labelNames: ['type'],
    });

    // Database metrics
    this.metrics.database_query_duration_seconds = new Histogram({
      name: 'mcp_database_query_duration_seconds',
      help: 'Database query duration in seconds',
      labelNames: ['operation', 'table'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    });

    // Register all metrics
    Object.values(this.metrics).forEach(metric => {
      this.register.registerMetric(metric as any);
    });
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics() {
    try {
      return await this.register.metrics();
    } catch (error) {
      logger.error('Failed to collect metrics:', error);
      return '';
    }
  }

  /**
   * Update WebSocket connection metrics
   */
  updateWebSocketConnections(active: number, total: number) {
    (this.metrics.websocket_connections as Gauge).set({ status: 'active' }, active);
    (this.metrics.websocket_connections as Gauge).set({ status: 'total' }, total);
  }

  /**
   * Track HTTP request duration
   */
  trackHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationMs: number
  ) {
    (this.metrics.http_request_duration_milliseconds as Histogram)
      .labels(method, route, statusCode.toString())
      .observe(durationMs);
  }

  /**
   * Update task metrics
   */
  updateTaskMetrics(statusCounts: { [status: string]: number }) {
    Object.entries(statusCounts).forEach(([status, count]) => {
      (this.metrics.tasks_total as Gauge).set({ status }, count);
    });
  }

  /**
   * Track database query duration
   */
  trackDatabaseQuery(operation: string, table: string, durationSeconds: number) {
    (this.metrics.database_query_duration_seconds as Histogram)
      .labels(operation, table)
      .observe(durationSeconds);
  }

  /**
   * Update memory usage metrics
   */
  updateMemoryUsage() {
    const memoryUsage = process.memoryUsage();
    
    Object.entries(memoryUsage).forEach(([type, bytes]) => {
      if (typeof bytes === 'number') {
        (this.metrics.memory_usage_bytes as Gauge).set({ type }, bytes);
      }
    });
  }
}

export const metrics = new MetricsCollector();

// Periodically update memory usage
setInterval(() => {
  metrics.updateMemoryUsage();
}, 10000).unref();
