# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY . .
RUN npm run build --workspace @waba/dashboard

FROM node:22-alpine AS runner
WORKDIR /workspace/apps/dashboard
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=builder /workspace/node_modules /workspace/node_modules
COPY --from=builder /workspace/apps/dashboard ./
EXPOSE 3000
CMD ["npm", "start", "--", "-p", "3000"]
