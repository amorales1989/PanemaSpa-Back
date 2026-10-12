FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

# curl: lo usa el health check de Coolify
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts

# Carpeta de fotos (montar un volumen persistente en /app/uploads)
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:3000/salud || exit 1

# Aplica migraciones pendientes y arranca. Si una migración falla, el contenedor
# no levanta y Coolify mantiene la versión anterior funcionando.
CMD ["sh", "-c", "node scripts/migrar.js && exec node src/index.js"]
