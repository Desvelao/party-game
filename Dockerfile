# syntax=docker/dockerfile:1
# Production image: client bundle + server bundle + game packs (dist/games) + plugins (dist/plugins) + runtime dependencies (ws, yaml, optional better-sqlite3).
# Multi-arch (amd64 / arm64 / arm/v7 / arm/v6): the build stage runs on the build machine's own platform
# (its output is architecture-independent JavaScript); the dependency and runtime stages are per target platform.

FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
# GAMES=all|none|id,id: which games under src/games/ are packed into dist/games (none = a blank server, see docs/manual/installing-games.md)
ARG GAMES=all
# BUILD_PLUGINS=all|none|id,id: which plugins under src/plugins/ are packed into dist/plugins (which of them load is the PLUGINS setting)
ARG BUILD_PLUGINS=all
RUN npm run typecheck && GAMES=$GAMES BUILD_PLUGINS=$BUILD_PLUGINS npm run build

# Production dependencies are installed for the TARGET platform: better-sqlite3 is a native module. It is an
# optional dependency: where no prebuilt binary exists (arm/v6) npm falls back to compiling it, and if that fails
# the install still succeeds and the server runs with the `json` profile driver (see README).
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine AS runtime
# openssl creates the self-signed certificate when TLS_SELF_SIGNED=1 (see docker/tls-selfsigned.sh)
RUN apk add --no-cache openssl
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    STATIC_DIR=dist/client \
    DATA_DIR=/app/data \
    SQLITE_PATH=/app/data/profiles.db
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node docker/entrypoint.sh docker/tls-selfsigned.sh docker/healthcheck.js ./docker/
# player profiles / stats live here: mount a volume to keep them across container replacements
RUN mkdir -p /app/data /app/certs && chown node:node /app/data /app/certs
VOLUME /app/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "docker/healthcheck.js"]
ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
CMD ["node", "dist/server.js"]
