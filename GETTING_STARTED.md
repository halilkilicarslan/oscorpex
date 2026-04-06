# Getting Started with VoltAgent Production Deployment

Welcome to the VoltAgent application with React console. This guide will walk you through deploying the application in production using Docker.

## What You Have

This project includes:
- **Backend**: VoltAgent API server (Node.js/TypeScript) running on port 4242
- **Console**: React web interface served via Nginx on port 3000
- **Data Storage**: SQLite databases for agent memory and observability

## Prerequisites

1. Docker and Docker Compose installed
2. API keys for OpenAI (or other LLM provider configured in your code)
3. Basic familiarity with command line

## 5-Minute Setup

### Step 1: Create Environment Configuration

```bash
cd /Users/iamhk/development/personal/my-voltagent-app
cat > .env << 'EOF'
# Your OpenAI API key
OPENAI_API_KEY=sk-your-actual-key-here

# Optional: VoltAgent cloud integration
VOLTAGENT_PUBLIC_KEY=
VOLTAGENT_SECRET_KEY=

# Application environment
NODE_ENV=production
EOF
```

Replace `sk-your-actual-key-here` with your actual OpenAI API key.

### Step 2: Build Docker Images

```bash
npm run docker:build
```

This will:
- Build the backend image (~150-200MB)
- Build the console image (~30-50MB)
- Cache layers for faster rebuilds

### Step 3: Start Services

```bash
npm run docker:up
```

Wait for services to become healthy (30-40 seconds). You'll see:
```
✓ voltagent-backend (healthy)
✓ voltagent-console (healthy)
```

### Step 4: Access the Application

Open your browser and navigate to:
- **Console UI**: http://localhost:3000
- **API Documentation**: http://localhost:4242

### Step 5: Monitor the Application

```bash
# View real-time logs
npm run docker:logs

# View only backend logs
npm run docker:logs:backend

# View only console logs
npm run docker:logs:console
```

## Common Tasks

### Stopping the Application

```bash
npm run docker:down
```

This stops containers but preserves data in the `./data` volume.

### Restarting After Changes

```bash
# Full rebuild
npm run docker:build
npm run docker:up

# Or quick restart without rebuild
npm run docker:down
npm run docker:up
```

### Checking Service Health

```bash
# View container status
docker compose ps

# Test backend API
curl http://localhost:4242/health

# Test console
curl http://localhost:3000
```

### Viewing Persistent Data

```bash
# See what's stored
ls -lah ./data/

# This contains:
# - memory.db: Agent conversations and memory
# - observability.db: Execution logs and metrics
```

## Deployment to Production

### Option 1: Using Docker Registry (Recommended)

1. **Build with version tags**:
   ```bash
   docker build -t myregistry/voltagent-backend:v1.0.0 .
   docker build -t myregistry/voltagent-console:v1.0.0 ./console
   ```

2. **Push to registry**:
   ```bash
   docker push myregistry/voltagent-backend:v1.0.0
   docker push myregistry/voltagent-console:v1.0.0
   ```

3. **Deploy to production**:
   Update docker-compose.yml to use the pushed images:
   ```yaml
   services:
     backend:
       image: myregistry/voltagent-backend:v1.0.0
     console:
       image: myregistry/voltagent-console:v1.0.0
   ```

### Option 2: Kubernetes Deployment

See `DEPLOYMENT.md` for Kubernetes configuration examples.

### Option 3: Cloud Platforms

- **AWS ECS/Fargate**: Push images to ECR, create ECS task definition
- **Google Cloud Run**: Push to Artifact Registry, deploy as Cloud Run service
- **Azure**: Push to ACR, deploy to Container Instances
- **DigitalOcean**: Push to DOCR, deploy to App Platform

## Architecture Overview

```
Internet User
    │
    ▼
Port 3000 (Console)
    │
    ├─ Static Assets (HTML, CSS, JS)
    │
    └─ API Requests
       │
       ▼
Port 4242 (Backend API)
    │
    ├─ Agent Management
    ├─ Tool Execution
    ├─ Workflow Orchestration
    │
    └─ LibSQL Databases
       ├─ memory.db
       └─ observability.db
```

## Troubleshooting

### Container won't start

```bash
# Check logs
npm run docker:logs

# Verify .env has correct API key
cat .env

# Rebuild from scratch
docker compose down -v
npm run docker:build
npm run docker:up
```

### Can't connect to backend from console

This is likely a networking issue:

```bash
# Check if backend is running
docker compose ps

# Test network connectivity
docker compose exec console ping backend

# Check nginx configuration
docker compose exec console nginx -t

# View nginx error logs
npm run docker:logs:console | grep error
```

### Port already in use

```bash
# Find what's using the port
lsof -i :3000
lsof -i :4242

# Option 1: Stop other services
sudo kill -9 <PID>

# Option 2: Use different ports in docker-compose.yml
# Change ports: ["3000:80"] to ["8080:80"]
```

### Data not persisting

```bash
# Check volume exists
docker volume ls | grep voltagent

# Check data directory
ls -la ./data/

# Recreate volume if needed
docker compose down -v
npm run docker:up
```

## Performance Tuning

### Faster Builds

```bash
# Docker builds images in layers. To speed up:
# 1. Keep dependencies stable (fewer changes to package.json)
# 2. Use .dockerignore to exclude unnecessary files
# 3. Multi-stage builds already optimize image size
```

### Memory Optimization

```bash
# Set Node.js memory limits in docker-compose.yml
environment:
  - NODE_OPTIONS=--max-old-space-size=1024
```

### Caching Strategy

- Static assets: Cached for 1 hour
- Hashed assets (with version in filename): Cached for 1 year
- API responses: Configure in backend code

## Environment Configuration

### Available Variables

All variables from `.env` are available to the backend:

```bash
# API Keys
OPENAI_API_KEY=sk-...

# VoltAgent Integration (optional)
VOLTAGENT_PUBLIC_KEY=...
VOLTAGENT_SECRET_KEY=...

# Application
NODE_ENV=production|development

# Custom Configuration
# Add your own variables here
```

### Secrets Management Best Practices

1. Never commit `.env` to git (add to `.gitignore`)
2. Store secrets in CI/CD platform, not in images
3. Rotate API keys regularly
4. Use environment-specific .env files:
   - `.env.production`
   - `.env.staging`
   - `.env.development`

## Monitoring & Logging

### Health Checks

Both services have built-in health checks:
- Backend: HTTP GET /health (every 30 seconds)
- Console: HTTP GET / (every 30 seconds)

If health checks fail 3 times in a row, container is marked unhealthy.

### Viewing Logs

```bash
# Real-time logs
npm run docker:logs

# Last 100 lines
docker compose logs --tail=100

# Follow specific service
npm run docker:logs:backend --tail=50
```

### Metrics & Monitoring

For production monitoring, integrate with:
- Prometheus for metrics collection
- Grafana for visualization
- ELK stack for log aggregation
- Datadog for APM

See `DEPLOYMENT.md` for examples.

## Next Steps

1. **Test locally**: Verify console works at http://localhost:3000
2. **Configure for your environment**: Update .env with your settings
3. **Build production images**: Tag with version numbers
4. **Deploy to production**: Use your preferred deployment method
5. **Monitor**: Set up logging and alerting
6. **Scale**: Use Kubernetes or cloud auto-scaling as needed

## Documentation

- **QUICKSTART.md**: Fast reference for common commands
- **DEPLOYMENT.md**: Comprehensive deployment guide (400+ lines)
- **ARCHITECTURE.md**: System architecture and design
- **SETUP_SUMMARY.md**: Overview of all setup changes

## Support

### Health Check Endpoints

Test services are healthy:
```bash
# Backend
curl http://localhost:4242/health

# Console
curl http://localhost:3000/
```

### Debug Container

Open shell inside running container:
```bash
# Backend shell
docker compose exec backend sh

# Console shell
docker compose exec console sh
```

### View Environment

Check what environment is set inside container:
```bash
docker compose exec backend env | sort
```

## Key Files Reference

Important files for deployment:

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Service orchestration |
| `Dockerfile` | Backend image build |
| `console/Dockerfile` | Frontend image build |
| `console/nginx.conf` | Frontend routing and caching |
| `.env` | Runtime configuration |
| `./data/` | Persistent storage volume |

## Commands Quick Reference

```bash
# Build
npm run docker:build

# Start
npm run docker:up

# Stop
npm run docker:down

# Logs
npm run docker:logs
npm run docker:logs:backend
npm run docker:logs:console

# Status
docker compose ps

# Shell access
docker compose exec backend sh
docker compose exec console sh

# Health check
curl http://localhost:4242/health
curl http://localhost:3000
```

## Troubleshooting Checklist

- [ ] Docker and Docker Compose installed
- [ ] `.env` file created with API keys
- [ ] `npm run docker:build` completed successfully
- [ ] `npm run docker:up` shows healthy services
- [ ] Console loads at http://localhost:3000
- [ ] Backend responds at http://localhost:4242
- [ ] Data persists in `./data` directory
- [ ] Logs visible with `npm run docker:logs`

## Getting Help

1. Check logs: `npm run docker:logs`
2. Review documentation: `DEPLOYMENT.md` or `ARCHITECTURE.md`
3. Test connectivity: `curl http://localhost:4242/health`
4. Verify configuration: `cat .env`
5. Inspect containers: `docker compose ps`

Good luck with your VoltAgent deployment!
