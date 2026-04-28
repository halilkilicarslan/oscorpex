# Build stage — requires monorepo root context
FROM node:22-alpine AS build

WORKDIR /app

# Copy monorepo workspace files
COPY package*.json ./
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./

# Copy package manifests for workspace resolution
COPY apps/console/package.json ./apps/console/
COPY packages ./packages

# Install dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build workspace packages first (control-plane etc. are deps of console)
RUN pnpm -r --filter './packages/*' build

# Build the console application
RUN pnpm --filter @oscorpex/console build

# Production stage
FROM nginx:alpine

# Copy built console from builder stage
COPY --from=build /app/apps/console/dist /usr/share/nginx/html

# Copy nginx configuration
COPY apps/console/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
