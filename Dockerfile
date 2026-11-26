FROM node:24-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends chromium ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

RUN node -e "const fs=require('fs'); const p='node_modules/whatsapp-web.js/src/authStrategies/RemoteAuth.js'; let s=fs.readFileSync(p,'utf8'); const old='        var self = this;\\n        this.backupSync = setInterval'; const replacement='        clearInterval(this.backupSync);\\n        var self = this;\\n        this.backupSync = setInterval'; if(!s.includes(old)) throw new Error('RemoteAuth patch target not found'); s=s.replace(old,replacement); fs.writeFileSync(p,s);"

COPY src ./src
COPY prompts ./prompts

ENV NODE_ENV=production
ENV PORT=8080
ENV CHROME_PATH=/usr/bin/chromium
ENV DATA_DIR=/data

EXPOSE 8080

CMD ["npm", "start"]
