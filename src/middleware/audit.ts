import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export const auditLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const { method, originalUrl, ip, user } = req;
  
  // Log request details
  logger.info('API Request', {
    method,
    path: originalUrl,
    ip,
    userId: user?.userId || 'anonymous',
    userRole: user?.role || 'guest',
    timestamp: new Date().toISOString()
  });

  // Capture response details when the response is finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;
    
    // Log response details
    logger.info('API Response', {
      method,
      path: originalUrl,
      statusCode,
      duration: `${duration}ms`,
      userId: user?.userId || 'anonymous',
      userRole: user?.role || 'guest',
      timestamp: new Date().toISOString()
    });
  });

  next();
};

export const auditAction = (action: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { user, method, originalUrl, body } = req;
    
    // Log the specific action
    logger.info('Action Performed', {
      action,
      method,
      path: originalUrl,
      userId: user?.userId || 'system',
      userRole: user?.role || 'system',
      details: {
        params: req.params,
        query: req.query,
        // Don't log sensitive information like passwords
        body: filterSensitiveData(body)
      },
      timestamp: new Date().toISOString()
    });
    
    next();
  };
};

// Helper function to filter out sensitive data from logs
function filterSensitiveData(obj: Record<string, any>): Record<string, any> {
  if (!obj || typeof obj !== 'object') return obj;
  
  const sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'authorization'];
  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
      result[key] = '***REDACTED***';
    } else if (Array.isArray(value)) {
      result[key] = value.map(item => 
        typeof item === 'object' ? filterSensitiveData(item) : item
      );
    } else if (value && typeof value === 'object') {
      result[key] = filterSensitiveData(value);
    } else {
      result[key] = value;
    }
  }
  
  return result;
}
