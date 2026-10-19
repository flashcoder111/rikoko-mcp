FROM node:24.14.0-trixie-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg fonts-noto-cjk ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
COPY python ./python
COPY scripts ./scripts
COPY tsconfig.json ./
RUN uv sync --project python --frozen --no-dev --managed-python --python 3.12
RUN pnpm build && mkdir /data && chown node:node /data
ENV MEDIA_PYTHON=/app/python/.venv/bin/python DATA_DIR=/data HOST=0.0.0.0
USER node
EXPOSE 4310
CMD ["pnpm", "dev"]
