import { Request, Response, NextFunction } from 'express';
import { metrics } from '../utils/metrics.js';

/**
 * Middleware to track HTTP request metrics
 */
export function trackHttpMetrics(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime();
  const originalEnd = res.end;
  
  // Override the end method to capture the response time
  res.end = ((...args: any[]) => {
    // Calculate response time
    const diff = process.hrtime(start);
    const durationMs = diff[0] * 1e3 + diff[1] * 1e-6;
    
    // Get the route path (use the Express route path if available, otherwise use the URL path)
    const routePath = req.route?.path || req.path;
    
    // Track the request
    metrics.trackHttpRequest(
      req.method,
      routePath,
      res.statusCode,
      durationMs
    );
    
    // Call the original end method
    return originalEnd.apply(res, args as any);
  }) as any;
  
  next();
}

/**
 * Middleware to expose Prometheus metrics endpoint
 */
export async function metricsHandler(_req: Request, res: Response) {
  try {
    res.set('Content-Type', metrics.register.contentType);
    const metricsData = await metrics.getMetrics();
    res.send(metricsData);
  } catch (error) {
    console.error('Error generating metrics:', error);
    res.status(500).send('Error generating metrics');
  }
}
