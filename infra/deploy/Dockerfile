FROM node:22.22.0-bookworm-slim
WORKDIR /app
RUN sed -i 's|http://deb.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g; s|http://deb.debian.org/debian|http://mirrors.aliyun.com/debian|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::http::Timeout=30 -o Acquire::Retries=2 update \
    && apt-get -o Acquire::http::Timeout=30 -o Acquire::Retries=2 install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run db:generate && npm run build
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100
USER node
CMD ["node", "dist/apps/api/main.js"]
