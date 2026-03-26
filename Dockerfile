# syntax=docker/dockerfile:1.2

# Stage 1: Build frontend
FROM node:20-slim AS frontend-builder
WORKDIR /frontend
COPY src/platforms/web/frontend/package*.json ./
RUN npm ci
COPY src/platforms/web/frontend/ ./
RUN npm run build

# Stage 2: Production
FROM node:20-slim
WORKDIR /usr/src/app

# Install system dependencies (slim needs them explicitly)
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ffmpeg ca-certificates openssh-client \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies first
COPY package*.json ./

# Install only production dependencies
ENV NODE_ENV=production
RUN npm install --omit=dev --legacy-peer-deps

# Copy the rest of the application code
COPY . .

# Copy built frontend from stage 1
COPY --from=frontend-builder /frontend/dist ./src/platforms/web/frontend/dist

# Create necessary directories and set permissions before switching user
RUN mkdir -p tmp output storage/media logs \
    && chown -R node:node tmp output storage logs

# Set user after all root-level operations are done
USER node

ARG BUILD_VERSION=dev
ARG COMMIT_SHA=unknown
ARG COMMIT_MSG=unknown
ENV BUILD_VERSION=$BUILD_VERSION
ENV COMMIT_SHA=$COMMIT_SHA
ENV COMMIT_MSG=$COMMIT_MSG
ENV WEB_PORT=4000
EXPOSE 4000

# Run directly — Docker handles restarts via --restart policy
CMD ["node", "--max-old-space-size=768", "app.js"]
