# open-brain-wizard: Docker installer image
# Bundles Supabase CLI, openssl, psql, and web installer.
# Build from open-brain-dist: docker build -f docker/Dockerfile .
# Optional: docker build --build-arg VERSION=1.0.0 -f docker/Dockerfile .

FROM node:iron-alpine

ARG VERSION=1.0.0
LABEL org.opencontainers.image.title="open-brain-wizard"
LABEL org.opencontainers.image.version="$VERSION"
LABEL org.opencontainers.image.description="Web installer for open-brain-wizard: Supabase, Slack capture, MCP server. Mount credentials.yaml at /data."
LABEL org.opencontainers.image.source="https://github.com/your-org/open-brain"
LABEL org.opencontainers.image.documentation="https://github.com/your-org/open-brain/blob/main/README.md"

WORKDIR /app

COPY supabase /app/open-brain/supabase
COPY scripts /app/open-brain/scripts
COPY sql /app/open-brain/sql
COPY credentials.yaml.template /app/open-brain/
COPY docker/package.json docker/server.js /app/server/
COPY docker/static /app/server/static
COPY docker/entrypoint.sh /app/
COPY media /app/server/static/media

WORKDIR /app/server
RUN apk add --no-cache openssl bash postgresql-client shadow su-exec \
    && npm install --omit=dev \
    && mkdir -p /data \
    && chmod +x /app/entrypoint.sh

WORKDIR /app/server
ENV OPEN_BRAIN_ROOT=/app/open-brain
ENV DATA_DIR=/data
ENV PORT=8080
ENV PATH="/app/server/node_modules/.bin:${PATH}"

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "server.js"]
