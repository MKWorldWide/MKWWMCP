# Troubleshooting Guide

This guide provides solutions to common issues you might encounter when working with the MKWW MCP Server.

## Table of Contents

1. [Startup Issues](#startup-issues)
2. [Database Problems](#database-problems)
3. [WebSocket Connection Issues](#websocket-connection-issues)
4. [Authentication Problems](#authentication-problems)
5. [Performance Issues](#performance-issues)
6. [Integration Issues](#integration-issues)
7. [Logging and Debugging](#logging-and-debugging)
8. [Getting Help](#getting-help)

## Startup Issues

### Server Fails to Start

**Symptoms**:
- Server exits immediately after starting
- Error messages in the console
- Port already in use

**Solutions**:

1. **Port Already in Use**:
   ```bash
   # Find and kill the process using the port
   lsof -i :3000  # For HTTP port
   kill -9 <PID>  # Replace <PID> with the process ID
   ```

2. **Missing Environment Variables**:
   - Verify all required environment variables are set in your `.env` file
   - Ensure no trailing spaces in variable values
   - Restart the server after making changes

3. **Dependency Issues**:
   ```bash
   # Clear npm cache and reinstall dependencies
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install
   ```

## Database Problems

### Connection Refused

**Symptoms**:
- "Connection refused" errors in logs
- Database operations fail
- Service fails to start

**Solutions**:

1. **Check Database Service**:
   ```bash
   # For Docker
   docker ps  # Check if the database container is running
   docker logs <container_id>  # Check database logs
   ```

2. **Verify Connection String**:
   - Check `POSTGRES_URL` in your `.env` file
   - Format: `postgresql://user:password@host:port/database`
   - Test connection with `psql` or database client

3. **Database Permissions**:
   ```sql
   -- Connect to PostgreSQL and check user permissions
   \du  -- List users and roles
   \l    -- List databases
   ```

### Migration Issues

**Symptoms**:
- Database schema out of sync
- Migration errors on startup
- Missing tables or columns

**Solutions**:

1. **Run Migrations Manually**:
   ```bash
   npx prisma migrate status  # Check migration status
   npx prisma migrate deploy  # Apply pending migrations
   npx prisma generate       # Regenerate Prisma Client
   ```

2. **Reset Database (Development Only)**:
   ```bash
   npx prisma migrate reset --force
   ```

## WebSocket Connection Issues

### Connection Drops

**Symptoms**:
- Intermittent disconnections
- "Connection closed" messages
- Failed reconnection attempts

**Solutions**:

1. **Check Network Stability**:
   - Verify network connectivity
   - Check for firewall rules blocking WebSocket traffic (ports 80/443 for WSS, 3001 for WS)

2. **Configure Keep-Alive**:
   ```typescript
   // In your client code
   const ws = new WebSocket('ws://localhost:3001', {
     pingInterval: 25000,  // 25 seconds
     pingTimeout: 60000,   // 60 seconds
   });
   ```

3. **Handle Reconnection**:
   ```javascript
   function connect() {
     const ws = new WebSocket('ws://localhost:3001');
     
     ws.onclose = () => {
       console.log('Disconnected. Reconnecting...');
       setTimeout(connect, 5000);  // Reconnect after 5 seconds
     };
     
     ws.onerror = (error) => {
       console.error('WebSocket error:', error);
       ws.close();
     };
   }
   
   connect();
   ```

## Authentication Problems

### Invalid or Expired Tokens

**Symptoms**:
- 401 Unauthorized errors
- Token expiration issues
- Authentication failures

**Solutions**:

1. **Check Token Expiration**:
   - Verify token expiration time in JWT payload (use [jwt.io](https://jwt.io/))
   - Ensure system time is synchronized (NTP)

2. **Refresh Token Flow**:
   ```javascript
   // Example refresh token implementation
   async function refreshToken() {
     const response = await fetch('/api/auth/refresh', {
       method: 'POST',
       credentials: 'include',
     });
     
     if (!response.ok) {
       // Redirect to login if refresh fails
       window.location.href = '/login';
       return null;
     }
     
     const { accessToken } = await response.json();
     return accessToken;
   }
   ```

3. **Verify JWT Secret**:
   - Ensure `JWT_SECRET` is consistent across services
   - Rotate secrets if compromised

## Performance Issues

### High CPU/Memory Usage

**Symptoms**:
- Slow response times
- System becoming unresponsive
- OOM (Out of Memory) errors

**Solutions**:

1. **Monitor Resources**:
   ```bash
   # Monitor CPU and memory usage
   top
   htop
   
   # For Docker containers
   docker stats
   ```

2. **Node.js Memory Limit**:
   ```bash
   # Increase memory limit
   NODE_OPTIONS="--max-old-space-size=4096" npm start
   ```

3. **Enable Garbage Collection Logging**:
   ```bash
   NODE_OPTIONS="--trace-gc --max-old-space-size=4096" npm start
   ```

### Slow Database Queries

**Symptoms**:
- High database CPU usage
- Slow API responses
- Timeout errors

**Solutions**:

1. **Identify Slow Queries**:
   ```sql
   -- Enable slow query logging in postgresql.conf
   log_min_duration_statement = 1000  # Log queries slower than 1 second
   ```

2. **Add Indexes**:
   ```sql
   -- Example: Add index for frequently queried columns
   CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
   ```

3. **Use Query Caching**:
   ```typescript
   // Example with Redis caching
   async function getCachedData(key: string, ttl: number, fetchFn: () => Promise<any>) {
     const cached = await redis.get(key);
     if (cached) return JSON.parse(cached);
     
     const data = await fetchFn();
     await redis.setex(key, ttl, JSON.stringify(data));
     return data;
   }
   ```

## Integration Issues

### Discord Integration

**Symptoms**:
- Bot not responding
- Permission errors
- Webhook delivery failures

**Solutions**:

1. **Verify Bot Permissions**:
   - Ensure bot has required permissions in Discord Developer Portal
   - Check server channel permissions

2. **Check Rate Limits**:
   - Respect Discord's rate limits (5-10 events per second)
   - Implement exponential backoff for retries

### VRChat Integration

**Symptoms**:
- Authentication failures
- API rate limiting
- Missing data

**Solutions**:

1. **Verify Credentials**:
   - Check `VRC_USERNAME` and `VRC_PASSWORD` in `.env`
   - Ensure 2FA is disabled or handled

2. **Handle Rate Limits**:
   - Implement proper rate limiting (1-2 requests per second)
   - Cache responses when possible

## Logging and Debugging

### Enable Debug Logging

```bash
# Set debug log level
export LOG_LEVEL=debug
npm start
```

### View Logs

```bash
# View application logs
docker-compose logs -f app

# View database logs
docker-compose logs -f postgres

# View Redis logs
docker-compose logs -f redis
```

### Debug Memory Leaks

1. **Generate Heap Snapshot**:
   ```bash
   # Start Node.js with heap dump
   NODE_OPTIONS="--inspect" npm start
   ```
   
   - Open Chrome DevTools
   - Go to `chrome://inspect`
   - Click on "Open dedicated DevTools for Node"
   - Take heap snapshot and analyze

2. **Monitor Event Loop Lag**:
   ```javascript
   // Add to your application
   let lastLoop = Date.now();
   setInterval(() => {
     const now = Date.now();
     const lag = now - lastLoop - 1000; // Should be close to 0
     if (lag > 100) console.warn(`Event loop lag: ${lag}ms`);
     lastLoop = now;
   }, 1000);
   ```

## Getting Help

If you're unable to resolve an issue:

1. **Check the Logs**:
   ```bash
   docker-compose logs --tail=100 -f
   ```

2. **Search Issues**:
   - Check the [GitHub Issues](https://github.com/mkworldwide/mcp-server/issues)
   - Search for similar problems

3. **Create a New Issue**:
   - Include error messages and logs
   - Describe steps to reproduce
   - Provide environment details

4. **Contact Support**:
   - Email: support@mkww.io
   - Discord: [MKWW Support Server](https://discord.gg/mkww)

## Common Error Messages

### "ECONNREFUSED"
- Service is not running
- Wrong host/port in configuration
- Firewall blocking connection

### "ETIMEDOUT"
- Network connectivity issues
- Service not responding
- DNS resolution problems

### "JWT Expired"
- Token has expired
- System time out of sync
- Refresh token needed

### "Too Many Requests"
- Rate limit exceeded
- Implement exponential backoff
- Check for infinite loops in client code

### "Relation does not exist"
- Missing database migrations
- Incorrect table name in query
- Database user lacks permissions
