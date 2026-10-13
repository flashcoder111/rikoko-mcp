FROM node:24.14.0-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg fonts-noto-cjk espeak-ng ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
COPY python ./python
COPY scripts ./scripts
COPY tsconfig.json ./
RUN python3 -m venv /opt/media && /opt/media/bin/pip install --no-cache-dir pillow==11.3.0 jsonschema==4.25.1
RUN pnpm build && mkdir /data && chown node:node /data
ENV MEDIA_PYTHON=/opt/media/bin/python DATA_DIR=/data HOST=0.0.0.0
USER node
EXPOSE 4310
CMD ["pnpm", "dev"]
