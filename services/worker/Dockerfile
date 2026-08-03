# syntax=docker/dockerfile:1

# ---- Build stage: compile static, CGO-free binaries ----
FROM golang:1.26-alpine AS build

WORKDIR /src

# Cache module downloads: copy go.mod/go.sum first and download before source copy.
COPY services/worker/go.mod services/worker/go.sum ./
RUN go mod download

# Copy the worker source and the shared migrations (module path lives at repo root).
COPY services/worker/ ./
COPY shared/db/migrations/ ./shared/db/migrations/

# Build both static Linux binaries with CGO disabled.
RUN mkdir -p /app \
    && CGO_ENABLED=0 GOOS=linux go build -o /app/worker ./cmd \
    && CGO_ENABLED=0 GOOS=linux go build -o /app/migrate ./cmd/migrate

# ---- Runtime stage: minimal Alpine with CA certificates ----
FROM alpine:3.20

RUN apk add --no-cache ca-certificates

WORKDIR /app

# Copy the compiled binaries from the build stage.
COPY --from=build /app/worker /app/worker
COPY --from=build /app/migrate /app/migrate

# Copy migrations so MIGRATIONS_DIR=/app/migrations works out of the box.
COPY --from=build /src/shared/db/migrations /app/migrations

ENTRYPOINT ["/app/worker"]
