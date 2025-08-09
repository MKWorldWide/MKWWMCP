// Authentication configuration
export const config = {
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
  jwtExpiration: process.env.JWT_EXPIRATION || '1h',
  refreshTokenExpiration: '7d',
  passwordSaltRounds: 10,
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
  },
  roles: {
    admin: ['admin'],
    operator: ['admin', 'operator'],
    service: ['admin', 'operator', 'service'],
  },
};
