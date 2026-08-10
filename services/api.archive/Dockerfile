# syntax=docker/dockerfile:1

# ---- Build stage: install workspaces, compile TypeScript ----
FROM node:22-alpine AS build

WORKDIR /app

# Copy manifests first for layer caching. The lockfile is workspaces-aware;
# only @waba/api (services/api) has npm dependencies, so the sparse layout is enough.
COPY package.json package-lock.json turbo.json ./
COPY services/api/package.json services/api/package.json
RUN npm ci

# Copy the API sources and compile (tsc -> services/api/dist).
COPY services/api/tsconfig.json services/api/tsconfig.json
COPY services/api/src services/api/src
RUN npm run build --workspace @waba/api

# ---- Runtime stage: production dependencies only ----
FROM node:22-alpine AS runtime

WORKDIR /app

# Keep the same monorepo layout so ESM "type": "module" resolution works.
COPY package.json package-lock.json ./
COPY services/api/package.json services/api/package.json
RUN npm ci --omit=dev

# Copy the compiled output from the build stage.
COPY --from=build /app/services/api/dist services/api/dist

CMD ["node", "services/api/dist/index.js"]
