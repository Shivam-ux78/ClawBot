FROM node:20-slim

# System Chromium + the shared libs Puppeteer's Chrome needs to actually run
# headless in a container (this is the part plain Node buildpacks don't give you).
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnss3 \
      libxshmfence1 \
      libxss1 \
      libx11-xcb1 \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Skip Puppeteer's own Chrome download — point it at the apt-installed binary instead.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

# Render's worker service overrides this via `dockerCommand` in render.yaml.
CMD ["node", "src/index.js"]
