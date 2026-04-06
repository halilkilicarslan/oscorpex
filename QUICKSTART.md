# Quick Start: Production Deployment

Get the VoltAgent application running in Docker in minutes.

## Prerequisites

- Docker and Docker Compose installed
- `.env` file with required API keys (see Configuration below)

## 1. Configuration

Create a `.env` file in the project root:

```bash
# Required: OpenAI API Key
OPENAI_API_KEY=sk-your-api-key-here

# Optional: VoltAgent Cloud (VoltOps) configuration
VOLTAGENT_PUBLIC_KEY=
VOLTAGENT_SECRET_KEY=

# Application environment
NODE_ENV=production
```

## 2. Build Images

```bash
npm run docker:build
```

This will:
- Build the backend (Node.js) image
- Build the console frontend (Nginx) image

## 3. Start Services

```bash
npm run docker:up
```

This will:
- Start the backend API on http://localhost:4242
- Start the console UI on http://localhost:3000
- Create persistent data volume at `./data`

Verify services are healthy:
```bash
docker compose ps
```

You should see all services with status "healthy" or "running".

## 4. Access the Application

- **Console UI**: http://localhost:3000
- **Backend API**: http://localhost:4242

The console automatically proxies API requests to the backend.

## Common Commands

```bash
# View logs
npm run docker:logs                 # All services
npm run docker:logs:backend         # Backend only
npm run docker:logs:console         # Console only

# Stop services
npm run docker:down

# Rebuild and restart
npm run docker:build && npm run docker:up

# Deep dive into containers
docker compose exec backend sh       # Backend shell
docker compose exec console sh       # Console shell
```

## Troubleshooting

### Port 4242 already in use

```bash
# Find what's using the port
lsof -i :4242

# Use different port in docker-compose.yml
# Change "4242:4242" to "4243:4242"
```

### Console not connecting to backend

Check browser console for errors. Common causes:
1. Backend not started - check `npm run docker:logs:backend`
2. CORS issues - backend may need CORS headers
3. Network connectivity - check `docker compose exec console ping backend`

### Data not persisting

Volumes are stored in `./data/`. Check:
```bash
ls -la ./data
docker volume inspect voltagent-app_data
```

## Next Steps

- See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed documentation
- Configure environment-specific settings
- Push images to a Docker registry
- Deploy to Kubernetes, Docker Swarm, or cloud platforms
- Set up CI/CD pipeline for automated builds
