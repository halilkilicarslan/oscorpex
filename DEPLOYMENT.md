# Production Build and Deployment Guide

This guide covers production build and deployment setup for the VoltAgent application with a React console frontend.

## Architecture Overview

The application consists of two components:

1. **Backend (VoltAgent)**: Node.js/TypeScript server running on port 4242
   - Hono.js REST API server
   - LibSQL-based persistence
   - Tool execution and agent management

2. **Console (React Frontend)**: Static web application served via Nginx on port 3000 (mapped from 80)
   - Vite-based React application
   - Proxies API requests to backend
   - SPA with client-side routing

## Docker Setup

### Files Added

- **Dockerfile**: Backend multi-stage build (existing, updated port to 4242)
- **console/Dockerfile**: Console frontend multi-stage build with Nginx
- **console/nginx.conf**: Nginx configuration with SPA routing and API proxying
- **console/.dockerignore**: Build context exclusions for console
- **docker-compose.yml**: Multi-service orchestration

### Build Configuration

#### Backend (Dockerfile)

Multi-stage build process:
1. **Builder stage** (node:22-alpine)
   - Installs dependencies (auto-detects npm/yarn/pnpm)
   - Compiles TypeScript to JavaScript

2. **Runtime stage** (node:22-alpine)
   - Installs production dependencies only
   - Creates non-root user (nodejs:1001)
   - Copies compiled application
   - Uses dumb-init for proper signal handling
   - Exposes port 4242

#### Console (console/Dockerfile)

Multi-stage build process:
1. **Builder stage** (node:22-alpine)
   - Installs dependencies
   - Builds React application with Vite
   - Outputs to /app/dist

2. **Production stage** (nginx:alpine)
   - Copies built static files to Nginx document root
   - Uses custom nginx.conf for routing
   - Exposes port 80

### Nginx Configuration (console/nginx.conf)

**Features:**
- SPA routing: Routes all unmatched paths to index.html for React Router
- Gzip compression: Compresses text, CSS, JavaScript responses
- Smart caching:
  - Static files (1h cache)
  - Hashed assets (1 year cache with immutable flag)
- API proxying:
  - `/agents` → backend:4242
  - `/workflows` → backend:4242
  - `/tools` → backend:4242
  - `/api/*` → backend:4242
- WebSocket support: Upgrade headers configured for real-time connections

### Docker Compose Setup

**Services:**

1. **backend**
   - Builds from root Dockerfile
   - Port: 4242
   - Volumes: `./data:/app/.voltagent` (persistent storage)
   - Environment: Loads from `.env` file
   - Health check: HTTP endpoint validation
   - Restart: unless-stopped

2. **console**
   - Builds from console/Dockerfile
   - Port: 3000 (maps to 80 inside container)
   - Depends on: backend (waits for health check)
   - Health check: HTTP request validation
   - Restart: unless-stopped

3. **volumes**
   - `data`: Persistent volume for SQLite databases

## Usage

### Build Images

```bash
npm run docker:build
# or
docker compose build
```

### Start Services

```bash
npm run docker:up
# or
docker compose up -d
```

Services will be available at:
- Backend API: http://localhost:4242
- Console UI: http://localhost:3000

### View Logs

```bash
# All services
npm run docker:logs

# Backend only
npm run docker:logs:backend

# Console only
npm run docker:logs:console
```

### Stop Services

```bash
npm run docker:down
# or
docker compose down
```

## Environment Configuration

Create a `.env` file in the project root for backend configuration:

```bash
# OpenAI API
OPENAI_API_KEY=sk-...

# VoltAgent (optional)
VOLTAGENT_PUBLIC_KEY=your-public-key
VOLTAGENT_SECRET_KEY=your-secret-key

# Node environment
NODE_ENV=production
```

The `.env` file is loaded by the backend container at runtime. Do not bake secrets into Docker images.

## Production Deployment Patterns

### Local Development with Docker

```bash
# Build and start
npm run docker:build
npm run docker:up

# View logs
npm run docker:logs

# Make changes and rebuild
npm run docker:build
npm run docker:up
```

### Kubernetes Deployment

Images can be deployed to Kubernetes:

1. Build and push images to registry:
   ```bash
   docker build -t myregistry/voltagent-backend:latest .
   docker build -t myregistry/voltagent-console:latest ./console
   docker push myregistry/voltagent-backend:latest
   docker push myregistry/voltagent-console:latest
   ```

2. Create Kubernetes resources with proper:
   - Resource limits and requests
   - Liveness and readiness probes
   - ConfigMaps for configuration
   - Secrets for sensitive data
   - PersistentVolumes for data

### Docker Registry Hosting

Deploy pre-built images to production environments:

```bash
# Build with version tag
docker build -t myregistry/voltagent-backend:v1.0.0 .
docker build -t myregistry/voltagent-console:v1.0.0 ./console

# Push to registry
docker push myregistry/voltagent-backend:v1.0.0
docker push myregistry/voltagent-console:v1.0.0

# Run in production
docker run -d \
  --name backend \
  --env-file .env.prod \
  -v ./data:/app/.voltagent \
  -p 4242:4242 \
  myregistry/voltagent-backend:v1.0.0

docker run -d \
  --name console \
  -p 3000:80 \
  --link backend:backend \
  myregistry/voltagent-console:v1.0.0
```

## Performance Optimization

### Caching Strategy

- **HTML**: Expires in 1 hour (allows SPA updates without cache busting)
- **Hashed assets** (JS/CSS with hash in filename): Cache forever (1 year)
- **Backend**: Response caching via appropriate HTTP headers
- **Nginx**: Gzip compression for text content

### Build Optimization

- **Node.js build**: Alpine images (smaller size)
- **Multi-stage builds**: Reduces final image size by excluding build tools
- **Layer caching**: Separate dependency installation from source copy
- **Production dependencies**: Only production packages in runtime

### Security

- **Non-root user**: Backend runs as `nodejs:1001`
- **Signal handling**: dumb-init for graceful shutdown
- **No secrets in images**: All secrets loaded at runtime
- **Minimal base images**: Alpine-based images reduce attack surface

## Troubleshooting

### Backend not responding

```bash
# Check backend logs
npm run docker:logs:backend

# Verify port is listening
lsof -i :4242

# Test connectivity
curl http://localhost:4242/health
```

### Console not loading

```bash
# Check console logs
npm run docker:logs:console

# Verify port is listening
lsof -i :3000

# Test nginx configuration
docker compose exec console nginx -t
```

### Data persistence issues

```bash
# Check volume permissions
ls -la ./data

# Verify volume is mounted
docker volume inspect voltagent-app_data

# Clear data and restart
docker compose down -v
npm run docker:up
```

### API proxying issues

Check nginx.conf and verify:
- Backend service is running: `npm run docker:logs:backend`
- Network connectivity: `docker compose exec console ping backend`
- Cors headers if needed: Adjust nginx.conf

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build and Push

on:
  push:
    tags:
      - 'v*'

jobs:
  push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: docker/setup-buildx-action@v2
      - uses: docker/login-action@v2
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v4
        with:
          context: .
          push: true
          tags: ghcr.io/${{ github.repository }}/backend:${{ github.ref_name }}
      - uses: docker/build-push-action@v4
        with:
          context: ./console
          push: true
          tags: ghcr.io/${{ github.repository }}/console:${{ github.ref_name }}
```

## Next Steps

1. Configure environment variables in `.env`
2. Test locally: `npm run docker:up`
3. Build production images with version tags
4. Push to registry (Docker Hub, GitHub Container Registry, ECR, etc.)
5. Deploy to production infrastructure (Docker Compose, Kubernetes, Fargate, etc.)
6. Monitor application health and logs
7. Set up automated deployments via CI/CD pipeline

## Related Documentation

- [VoltAgent Documentation](https://github.com/voltrun/voltagent)
- [Hono.js Documentation](https://hono.dev/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [React Documentation](https://react.dev/)
