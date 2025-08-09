import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { logger } from '../utils/logger.js';

// Default rate limit configuration
const defaultRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req: Request, res: Response) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      method: req.method,
      path: req.path,
      timestamp: new Date().toISOString()
    });
    
    res.status(429).json({
      success: false,
      error: 'Too many requests, please try again later.'
    });
  }
});

// More restrictive rate limit for authentication endpoints
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for successful logins to avoid blocking legitimate users
    return req.path === '/auth/login' && req.method === 'POST' && req.body?.username;
  }
});

// More permissive rate limit for read operations
const readRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // limit each IP to 300 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false
});

// Strict rate limit for sensitive operations
const strictRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests to this endpoint, please try again in an hour.'
  }
});

// Rate limit based on user ID for authenticated users
const userRateLimit = (max: number = 100) => {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max,
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise fall back to IP
      return (req.user?.userId || req.ip) as string;
    },
    standardHeaders: true,
    legacyHeaders: false
  });
};

export {
  defaultRateLimit,
  authRateLimit,
  readRateLimit,
  strictRateLimit,
  userRateLimit
};

// Apply appropriate rate limiting based on route
// Example usage in your routes:
// router.get('/sensitive', strictRateLimit, controller.sensitiveAction);
// router.post('/auth/login', authRateLimit, authController.login);
// router.get('/public-data', readRateLimit, controller.getPublicData);
// router.use(defaultRateLimit); // Apply default rate limit to all other routes
