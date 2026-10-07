FROM node:24-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends chromium ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY prompts ./prompts

ENV NODE_ENV=production
ENV PORT=8080
ENV CHROME_PATH=/usr/bin/chromium
ENV DATA_DIR=/data

EXPOSE 8080

CMD ["npm", "start"]
