FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install common dev tools
RUN npm install -g typescript tsx pnpm

# Configure git for container usage
RUN git config --global user.email "agent@ai-dev-studio.local" && \
    git config --global user.name "AI Agent" && \
    git config --global init.defaultBranch main

# Create workspace and worker directories
RUN mkdir -p /workspace /worker && chown -R node:node /workspace /worker

# Copy agent worker
COPY agent-worker.ts /worker/agent-worker.ts
COPY tsconfig.json /worker/tsconfig.json

# Default environment
ENV WORKER_PORT=9900
ENV WORKSPACE=/workspace

EXPOSE 9900

USER node
WORKDIR /workspace

# Run the agent worker HTTP server
CMD ["tsx", "/worker/agent-worker.ts"]

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
  CMD curl -f http://localhost:9900/health || exit 1
