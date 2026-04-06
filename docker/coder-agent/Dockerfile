FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Install common dev tools
RUN npm install -g typescript tsx pnpm

# Create workspace directory
RUN mkdir -p /workspace && chown node:node /workspace

USER node
WORKDIR /workspace

# Entry point: keep container running, accept commands via exec
CMD ["tail", "-f", "/dev/null"]
