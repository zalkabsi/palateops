# The Qloo Harness requires Node 22.19+ and a real container: the kit states
# serverless function runtimes are not a supported deployment target.
FROM node:22.19-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --chown=node:node server ./server
COPY --chown=node:node public ./public

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
