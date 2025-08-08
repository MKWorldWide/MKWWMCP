import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Simple JWT guard used across the API. In a full system we'd attach user/role claims.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.split(' ')[1];
  if (!token) return res.status(401).json({ ok: false, error: 'Missing token' });
  try {
    // verify signature only; payload can carry user info later.
    jwt.verify(token, process.env.JWT_SECRET || '');
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: 'Invalid token' });
  }
}
