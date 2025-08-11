import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import type { JwtPayload } from '../utils/jwt.js';
import { config } from '../config/auth.js';

type UserRole = 'admin' | 'operator' | 'service';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ 
      success: false, 
      error: 'Authentication required' 
    });
  }

  const tokenParts = authHeader.split(' ');
  if (tokenParts.length !== 2) {
    return res.status(401).json({
      success: false,
      error: 'Invalid token format. Use: Bearer <token>'
    });
  }

  const token = tokenParts[1];
  
  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ 
      success: false, 
      error: 'Invalid or expired token' 
    });
  }
};

export const requireRole = (allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required' 
      });
    }

    const userRole = req.user.role;
    
    // Check if user's role is included in the allowed roles
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        success: false, 
        error: 'Insufficient permissions' 
      });
    }

    next();
  };
};

// Helper middleware for common role checks
export const requireAdmin = requireRole(['admin']);
export const requireOperator = requireRole(['admin', 'operator']);
export const requireService = requireRole(['admin', 'operator', 'service']);
