# syntax=docker/dockerfile:1.7
# The API image (also the WhatsApp worker: same image, `node dist/worker.js`).
# Why it exists: the build happens here, from the committed lockfile, so the host never holds a
# stale dist/ or node_modules. Build from the repo root (the image needs data/):
#   docker build -f backend/Dockerfile -t vaari-api .
ARG NODE_VERSION=22.15.1

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/app/data
WORKDIR /app/backend
COPY --from=build /app/backend/package.json ./
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY backend/policies ./policies
COPY data /app/data
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
