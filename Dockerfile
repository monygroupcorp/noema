# syntax=docker/dockerfile:1.2

# Stage 1: Build the new React app (served when STAGING_FRONTEND=1)
FROM node:22-slim AS app-builder
# The workdir MIRRORS the repo layout rather than flattening the app to /webapp. The
# app's Muse screen imports the pure muse engine from `src/crystal/muse` by relative
# path — there is exactly one copy of that logic in the tree and it is deliberately not
# vendored into the app. A flattened workdir made that import unresolvable in this stage
# only (the app's own tsc/vite and the `verify`/`web-tests` jobs all run against the full
# tree, so they resolved it fine and only `docker-build` ever saw the break).
WORKDIR /build/src/platforms/web/app
COPY src/platforms/web/app/package*.json ./
RUN npm ci
COPY src/platforms/web/app/ ./
# Self-contained: every import inside src/crystal/muse resolves within that directory
# (checked, not assumed), so this is the whole dependency, not the head of a chain.
COPY src/crystal/muse/ /build/src/crystal/muse/
RUN npm run build

# Stage 2: Compile TypeScript
FROM node:22-slim AS ts-builder
WORKDIR /build
COPY package*.json .npmrc ./
RUN npm ci
COPY . .
RUN npx tsc
# Copy non-TS assets (JSON, plain JS modules, circuit artifacts) into dist alongside compiled output.
# Skip any .js file that has a .ts counterpart — tsc output takes precedence.
RUN find src \( -name '*.json' -o -name '*.js' -o -name '*.wasm' -o -name '*.zkey' \) ! -name 'package*.json' ! -path '*/frontend/*' ! -path '*/web/app/*' | while read f; do \
  ts_equiv="${f%.js}.ts"; \
  [ -f "${ts_equiv}" ] && continue; \
  target="dist/${f#src/}"; \
  mkdir -p "$(dirname "$target")"; \
  cp "$f" "$target"; \
done

# Stage 3: Production
FROM node:22-slim
WORKDIR /usr/src/app

# Install system dependencies (slim needs them explicitly)
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ffmpeg ca-certificates openssh-client \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies first. .npmrc travels with them: it carries the
# peer-resolver setting the lockfile was generated under, and npm ci reads it from the workdir.
COPY package*.json .npmrc ./

# Install only production dependencies, from the lockfile — a lockfile that has drifted from
# package.json fails the build here instead of resolving to some other tree at image-build time.
ENV NODE_ENV=production
RUN npm ci --omit=dev

# Copy the rest of the application code (JS workers, scripts, etc.)
COPY . .

# Overlay compiled TypeScript output
COPY --from=ts-builder /build/dist ./dist

# Copy the new React app build (served when STAGING_FRONTEND=1)
COPY --from=app-builder /build/src/platforms/web/app/dist ./src/platforms/web/app/dist

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
