# Optional container build (any Docker host). Data lives in the /app/data volume.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4100 DB_FILE=/app/data/dealdesk.db UPLOAD_DIR=/app/data/uploads
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN rm -rf .env secrets data logs screenshots-review tests && mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 4100
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:4100/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
