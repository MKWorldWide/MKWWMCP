import jwt from 'jsonwebtoken';
import { config } from '../config/auth.js';

type UserRole = 'admin' | 'operator' | 'service';

export interface JwtPayload {
  userId: string;
  role: UserRole;
  exp?: number;
}

export const generateToken = (userId: string, role: UserRole): string => {
  return jwt.sign(
    { userId, role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiration }
  );
};

export const verifyToken = (token: string): JwtPayload => {
  try {
    return jwt.verify(token, config.jwtSecret) as JwtPayload;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
};

export const decodeToken = (token: string): JwtPayload | null => {
  try {
    return jwt.decode(token) as JwtPayload;
  } catch (error) {
    return null;
  }
};
