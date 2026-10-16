FROM node:22.19.0-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8788
WORKDIR /app

RUN npm install --global --no-audit --no-fund @qloo/qloo-harness@0.1.26
COPY --chown=node:node server.mjs ./server.mjs
USER node

EXPOSE 8788
CMD ["node", "server.mjs"]
