# MCP Server Deployment Guide

This guide provides instructions for deploying the MKWW MCP Server in different environments.

## Prerequisites

- Node.js 18+ and npm 8+
- Docker 20.10+ and Docker Compose (for containerized deployment)
- Redis 6.2+
- PostgreSQL 14+
- (Optional) PM2 for process management

## Local Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/mkworldwide/mcp-server.git
cd mcp-server
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Environment Variables

Create a `.env` file in the project root:

```env
# Server Configuration
NODE_ENV=development
PORT=3000
WS_PORT=3001

# Database
POSTGRES_URL=postgresql://user:password@localhost:5432/mcp
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=1d

# External Services
DISCORD_TOKEN=your-discord-token
VRC_USERNAME=your-vrchat-username
VRC_PASSWORD=your-vrchat-password
VCC_API_KEY=your-vcc-api-key
VCC_PATH=/path/to/vcc
VCC_AUTO_DEPLOY=true
```

### 4. Start Dependencies with Docker Compose

```bash
docker-compose -f docker-compose.dev.yml up -d
```

### 5. Run Database Migrations

```bash
npx prisma migrate deploy
```

### 6. Start the Development Server

```bash
npm run dev
```

The server will be available at `http://localhost:3000` with WebSocket at `ws://localhost:3001`.

## Production Deployment

### Option 1: Docker Compose (Recommended)

1. Create a `docker-compose.prod.yml` file:

```yaml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: production
    restart: unless-stopped
    ports:
      - "3000:3000"
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - WS_PORT=3001
      - POSTGRES_URL=postgresql://user:password@postgres:5432/mcp
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET}
      # Add other environment variables as needed
    depends_on:
      - postgres
      - redis
    networks:
      - mcp-network

  postgres:
    image: postgres:14-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: mcp
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - mcp-network

  redis:
    image: redis:6.2-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data
    networks:
      - mcp-network

volumes:
  postgres_data:
  redis_data:

networks:
  mcp-network:
    driver: bridge
```

2. Build and start the services:

```bash
docker-compose -f docker-compose.prod.yml up -d --build
```

### Option 2: Kubernetes

1. Create a Kubernetes cluster and configure `kubectl`

2. Create a namespace:

```bash
kubectl create namespace mcp
```

3. Create a secret for environment variables:

```bash
kubectl create secret generic mcp-secrets \
  --from-literal=JWT_SECRET=your-secret-key \
  --from-literal=DISCORD_TOKEN=your-discord-token \
  --from-literal=VRC_USERNAME=your-vrchat-username \
  --from-literal=VRC_PASSWORD=your-vrchat-password \
  --namespace=mcp
```

4. Apply the Kubernetes manifests:

```bash
kubectl apply -f k8s/
```

## Configuration Reference

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Runtime environment (`development`, `production`, `test`) |
| `PORT` | No | `3000` | HTTP server port |
| `WS_PORT` | No | `3001` | WebSocket server port |
| `POSTGRES_URL` | Yes | - | PostgreSQL connection string |
| `REDIS_URL` | Yes | - | Redis connection string |
| `JWT_SECRET` | Yes | - | Secret key for JWT signing |
| `JWT_EXPIRES_IN` | No | `1d` | JWT expiration time |
| `DISCORD_TOKEN` | No | - | Discord bot token |
| `VRC_USERNAME` | No | - | VRChat username |
| `VRC_PASSWORD` | No | - | VRChat password |
| `VCC_API_KEY` | No | - | VCC API key |
| `VCC_PATH` | No | - | Path to VCC executable |
| `VCC_AUTO_DEPLOY` | No | `false` | Automatically deploy after build |
| `LOG_LEVEL` | No | `info` | Logging level (`error`, `warn`, `info`, `debug`, `trace`) |

## Monitoring and Maintenance

### Logs

View container logs:

```bash
docker-compose logs -f
```

Or for Kubernetes:

```bash
kubectl logs -n mcp deployment/mcp -f
```

### Health Checks

The server exposes health check endpoints:

- `GET /health` - Basic health status
- `GET /metrics` - Prometheus metrics (if enabled)

### Backup and Restore

#### PostgreSQL Backup

```bash
# Create backup
docker exec -t mcp-postgres-1 pg_dump -U user mcp > backup_$(date +%Y%m%d).sql

# Restore from backup
cat backup_20230801.sql | docker exec -i mcp-postgres-1 psql -U user mcp
```

#### Redis Backup

```bash
# Create backup
docker exec -t mcp-redis-1 redis-cli save

# Backup RDB file
docker cp mcp-redis-1:/data/dump.rdb ./redis_backup_$(date +%Y%m%d).rdb
```

## Upgrading

1. Pull the latest changes:

```bash
git pull origin main
```

2. Rebuild and restart the services:

```bash
docker-compose -f docker-compose.prod.yml up -d --build
```

3. Run any new migrations:

```bash
docker-compose -f docker-compose.prod.yml exec app npx prisma migrate deploy
```

## Troubleshooting

### Common Issues

#### Database Connection Issues
- Verify the database URL is correct
- Check if the database is running and accessible
- Ensure the database user has proper permissions

#### WebSocket Connection Issues
- Verify the WebSocket port is open and accessible
- Check for CORS issues in the browser console
- Ensure the WebSocket URL is using `ws://` or `wss://`

#### High Memory Usage
- Check for memory leaks in long-running processes
- Adjust the Node.js memory limit with `NODE_OPTIONS="--max-old-space-size=4096"`
- Monitor with `docker stats` or Kubernetes metrics

### Getting Help

For additional help, please contact:
- Email: support@mkww.io
- Discord: [MKWW Support Server](https://discord.gg/mkww)
