# Application Architecture

Production architecture for VoltAgent with React Console.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Internet/Users                          │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
        ┌────────────────┐
        │   Docker Host  │
        │   Port 3000    │
        └────────┬───────┘
                 │
    ┌────────────┴────────────┐
    │  Docker Compose Network │
    │  (bridge network)       │
    ▼                         ▼
┌───────────────────┐  ┌──────────────────┐
│     CONSOLE       │  │     BACKEND      │
│   (Nginx, Port 80)├─▶│  (Node, Port 4242)
│   React SPA       │  │  Hono.js Server  │
├───────────────────┤  ├──────────────────┤
│ - Static files    │  │ - REST API       │
│ - SPA routing     │  │ - VoltAgent Core │
│ - API proxy       │  │ - LibSQL DB      │
│ - Asset caching   │  │ - Memory store   │
│ - Compression     │  │ - Tools exec     │
└────────┬──────────┘  └────────┬─────────┘
         │                      │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │   Data Volume        │
         │  ./data/             │
         │  *.db files          │
         └──────────────────────┘
```

## Request Flow

### Frontend to Backend Communication

```
User Browser (http://localhost:3000)
            │
            ▼
    ┌───────────────┐
    │  Nginx Server │
    │  (Port: 80)   │
    └───────┬───────┘
            │
    ┌───────┴──────────────────────┐
    │                              │
    ▼ Static Assets                ▼ API Requests
┌────────────────┐         ┌──────────────────┐
│  /index.html   │         │  /agents         │
│  /app.css      │         │  /workflows      │
│  /app.js       │         │  /tools          │
│  /assets/...   │         │  /api/*          │
└────────────────┘         └────────┬─────────┘
                                    │
                           (Proxy: http://backend:4242)
                                    │
                                    ▼
                         ┌──────────────────┐
                         │  Node.js Backend │
                         │  (Port: 4242)    │
                         │  Hono.js Server  │
                         └──────────────────┘
```

## Data Persistence

```
┌─────────────────────────────────────────────────┐
│            Backend Container                    │
├─────────────────────────────────────────────────┤
│                                                 │
│  /app/.voltagent/                              │
│  ├── memory.db (LibSQL)                        │
│  │   └─ Agent memory, conversations            │
│  └── observability.db (LibSQL)                 │
│      └─ Execution logs, metrics                │
│                                                 │
└──────────────────┬──────────────────────────────┘
                   │
                   │ Volume Mount
                   ▼
    ┌────────────────────────────┐
    │  Host Volume: ./data/      │
    │  (Persists across restarts)│
    │                            │
    │  Contains:                 │
    │  - *.db files              │
    │  - Agent state             │
    │  - Conversation history    │
    │  - Observability data      │
    └────────────────────────────┘
```

## Service Dependencies

```
Docker Compose Startup Sequence:

1. Create Docker network (bridge)
   └─ Name: voltagent-app_default

2. Create volume
   └─ Name: voltagent-app_data

3. Start Backend Service
   ├─ Build image from ./Dockerfile
   ├─ Create container: voltagent-backend
   ├─ Mount volume at /app/.voltagent
   ├─ Expose port 4242
   └─ Wait for health check (max 40s)

4. Start Console Service (depends_on: backend healthy)
   ├─ Build image from ./console/Dockerfile
   ├─ Create container: voltagent-console
   ├─ Expose port 3000 (maps to 80 inside)
   ├─ Wait for health check (max 10s)
   └─ Network: backend accessible as hostname "backend"
```

## Container Networking

```
┌─────────────────────────────────────────────┐
│   Docker Bridge Network                     │
│   (voltagent-app_default)                   │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────────────┐   ┌─────────────┐    │
│  │  voltagent-      │   │  voltagent- │    │
│  │  backend         │   │  console    │    │
│  │  (172.x.x.x)     │◀─▶│  (172.x.x.y)│    │
│  │                  │   │             │    │
│  │  Hostname:       │   │  Hostname:  │    │
│  │  "backend"       │   │  "console"  │    │
│  └──────────────────┘   └─────────────┘    │
│                                             │
└─────────────────────────────────────────────┘
     │                        │
     │                        │
     ▼                        ▼
┌─────────────┐        ┌──────────────┐
│  Port 4242  │        │   Port 80    │
│  (Host)     │        │   (Host)     │
│  Maps to    │        │   Maps to    │
│  :4242      │        │   :3000      │
└─────────────┘        └──────────────┘
```

## Health Check Strategy

### Backend Health Check

```
Every 30 seconds:
  1. Try HTTP GET http://localhost:4242/health
  2. If response != 200, increment failure counter
  3. On 3 consecutive failures → container unhealthy
  4. Initial startup grace period: 40 seconds
```

### Console Health Check

```
Every 30 seconds:
  1. Try wget http://localhost:80/
  2. If not successful, increment failure counter
  3. On 3 consecutive failures → container unhealthy
  4. Initial startup grace period: 10 seconds
  5. Depends on: backend must be healthy first
```

## Build Pipeline

### Backend Image Build

```
Dockerfile (Multi-stage)
    │
    ├─ Stage 1: Builder
    │   ├─ FROM node:22-alpine
    │   ├─ npm install (all deps)
    │   └─ npm run build (TypeScript → JavaScript)
    │
    └─ Stage 2: Runtime
        ├─ FROM node:22-alpine
        ├─ npm install --production
        ├─ Copy /dist from builder
        ├─ Create non-root user
        ├─ Install dumb-init
        ├─ EXPOSE 4242
        └─ CMD ["dumb-init", "node", "dist/index.js"]

Image size: ~150-200MB (Alpine optimized)
```

### Console Image Build

```
console/Dockerfile (Multi-stage)
    │
    ├─ Stage 1: Builder
    │   ├─ FROM node:22-alpine
    │   ├─ npm install
    │   └─ npm run build (React → /dist)
    │
    └─ Stage 2: Production
        ├─ FROM nginx:alpine
        ├─ Copy /dist from builder
        ├─ Copy nginx.conf
        ├─ EXPOSE 80
        └─ CMD ["nginx", "-g", "daemon off;"]

Image size: ~30-50MB (Nginx optimized)
```

## Environment & Configuration

### Runtime Environment Variables

```
Backend Container:
├─ NODE_ENV=production
├─ OPENAI_API_KEY (from .env)
├─ VOLTAGENT_PUBLIC_KEY (optional, from .env)
├─ VOLTAGENT_SECRET_KEY (optional, from .env)
└─ (All other NODE_OPTIONS, etc.)

Console Container:
└─ (No environment variables needed)
    └─ Static build, configuration in runtime
    └─ API endpoints discovered via browser location
```

### Volume Mounting

```
Backend:
  Host: ./data
  Container: /app/.voltagent
  Permissions: Read-Write
  Persistence: Across restarts

Console:
  No volumes (stateless)
```

## Port Mapping

```
External (Host)          Internal (Container)
─────────────────────────────────────────────
3000                 →   80 (nginx)
4242                 →   4242 (node)
```

## Performance Characteristics

### Build Times

- **Backend**: ~30-60s (depends on deps, TypeScript compilation)
- **Console**: ~20-40s (depends on deps, React build)
- **Total**: ~1-2 minutes for full rebuild

### Runtime

- **Backend startup**: 5-15s (includes health checks)
- **Console startup**: 2-5s
- **Time to healthy**: ~40s (backend health check period)
- **Memory usage**:
  - Backend: 150-300MB (varies with workload)
  - Console: 20-30MB
- **Disk usage**:
  - Backend image: ~150-200MB
  - Console image: ~30-50MB
  - Data volume: 10-100MB (database files)

## Scaling Considerations

### Current Setup (Single Instance)

```
┌─────────────────────────┐
│  Single Docker Host     │
├─────────────────────────┤
│  - 1x Backend           │
│  - 1x Console           │
│  - Shared Data Volume   │
└─────────────────────────┘
```

### Multi-Instance (Kubernetes Pattern)

```
┌──────────────────────────┐
│  Kubernetes Cluster      │
├──────────────────────────┤
│  Pod 1         Pod 2     │
│  ├─ Backend    ├─ Backend│
│  └─ Console    └─ Console│
│  ▼              ▼        │
│  ┌────────────────┐      │
│  │  PersistentVol │      │
│  │  (Shared Data) │      │
│  └────────────────┘      │
└──────────────────────────┘
```

### Load Balancing (Future Enhancement)

```
┌────────────────┐
│   Load Balancer│
│   (Port 80/443)│
└────────┬───────┘
         │
    ┌────┼────┬─────┐
    ▼    ▼    ▼     ▼
   Pod1 Pod2 Pod3 Pod4
   Backend instances
   (Stateless via external DB)
```

## Security Architecture

### Network Isolation

```
┌─────────────────────────────┐
│  Private Docker Network     │
│                             │
│  - Services can reach each  │
│    other by hostname        │
│  - Isolated from host       │
│  - Only exposed ports       │
│    visible externally       │
└─────────────────────────────┘
```

### Data Protection

```
Secrets Management:
  ├─ .env file (Host machine)
  │  └─ Never committed to git
  │  └─ Passed at runtime
  │
  ├─ Container runtime
  │  └─ Memory-only secrets
  │  └─ Not in images
  │
  └─ Volume encryption
     └─ Host-level (optional)
     └─ LUKS or BitLocker
```

### User Privileges

```
Backend:
  - Non-root: nodejs (uid: 1001, gid: 1001)
  - Files: /app owned by nodejs
  - No privilege escalation

Console:
  - Nginx runs as unprivileged user
  - Read-only for static files
  - No write permissions
```
