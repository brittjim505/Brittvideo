# BrittVideo 3.0 — one image for test and live. Build:  docker build -t brittvideo .
# ---- build stage ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY server server
COPY web web
RUN npm run build && npm prune --omit=dev --no-audit --no-fund && mkdir -p server/node_modules

# ---- runtime stage ----
# Based on the official PostgreSQL 16 image so pg_dump / pg_restore / psql (used by backups and restore)
# exactly match the database version. The database itself runs in its own container, not in this one.
FROM postgres:16-bookworm
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/web/dist ./web/dist
RUN useradd --system --create-home --uid 10001 brittvideo && mkdir -p /data/storage /data/backups && chown -R brittvideo /data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 STORAGE_DIR=/data/storage BACKUP_DIR=/data/backups \
    PG_BIN_DIR=/usr/lib/postgresql/16/bin
USER brittvideo
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Database upgrades (with a verified backup first) run automatically at start.
ENTRYPOINT []
CMD ["node", "server/dist/index.js"]
