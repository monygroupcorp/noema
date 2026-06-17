# syntax=docker/dockerfile:1.2

# Stage 1: Build frontend (legacy microact web app)
FROM node:20-slim AS frontend-builder
WORKDIR /frontend
COPY src/platforms/web/frontend/package*.json ./
RUN npm ci
COPY src/platforms/web/frontend/ ./
RUN npm run build

# Stage 1b: Build the new React app (served when STAGING_FRONTEND=1)
FROM node:20-slim AS app-builder
WORKDIR /webapp
COPY src/platforms/web/app/package*.json ./
RUN npm ci
COPY src/platforms/web/app/ ./
RUN npm run build

# Stage 2: Compile TypeScript
FROM node:20-slim AS ts-builder
WORKDIR /build
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npx tsc
# Copy non-TS assets (JSON, plain JS modules) into dist alongside compiled output.
# Skip any .js file that has a .ts counterpart — tsc output takes precedence.
RUN find src \( -name '*.json' -o -name '*.js' -o -name '*.wasm' \) ! -name 'package*.json' ! -path '*/frontend/*' ! -path '*/web/app/*' | while read f; do \
  ts_equiv="${f%.js}.ts"; \
  [ -f "${ts_equiv}" ] && continue; \
  target="dist/${f#src/}"; \
  mkdir -p "$(dirname "$target")"; \
  cp "$f" "$target"; \
done

# Stage 3: Production
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

# Copy the rest of the application code (JS workers, scripts, etc.)
COPY . .

# Overlay compiled TypeScript output
COPY --from=ts-builder /build/dist ./dist

# Copy built frontend from stage 1
COPY --from=frontend-builder /frontend/dist ./src/platforms/web/frontend/dist

# Copy the new React app build (served when STAGING_FRONTEND=1)
COPY --from=app-builder /webapp/dist ./src/platforms/web/app/dist

# Copy ESM builds needed by the widget iframe (served via /widget/lib/*)
COPY --from=frontend-builder /frontend/node_modules/@monygroupcorp/microact/dist/microact.esm.js ./src/platforms/web/frontend/node_modules/@monygroupcorp/microact/dist/microact.esm.js
COPY --from=frontend-builder /frontend/node_modules/@monygroupcorp/micro-web3/dist/micro-web3.esm.js ./src/platforms/web/frontend/node_modules/@monygroupcorp/micro-web3/dist/micro-web3.esm.js

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
ENV PORT=4000
EXPOSE 4000

# Crystal entry point — compiled TypeScript
CMD ["node", "--max-old-space-size=768", "dist/index.js"]
