# viola-lab — a static SolidJS SPA served by a small Bun file server.
#
# Build:  flyctl deploy --remote-only
# Logs:   flyctl logs -a viola-lab
# URL:    https://viola-lab.fly.dev

# ---- stage 1: build the SPA ----
FROM oven/bun:1-slim AS build
WORKDIR /app

# Copy manifests first so the install layer caches independently of source.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build          # -> /app/dist

# ---- stage 2: runtime ----
FROM oven/bun:1-slim AS app
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY server.ts ./

ENV NODE_ENV=production \
    PORT=8080

# Non-root.
RUN useradd --create-home appuser && chown -R appuser /app
USER appuser

EXPOSE 8080
CMD ["bun", "server.ts"]
