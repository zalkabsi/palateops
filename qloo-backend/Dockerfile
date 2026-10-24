# syntax=docker/dockerfile:1
FROM node:22.19.0-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8788
WORKDIR /app

RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm install --global --no-audit --no-fund --strict-ssl=true @qloo/qloo-harness@0.1.26
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node qloo-backend/server.mjs qloo-backend/agent.mjs ./qloo-backend/
COPY --chown=node:node src/planner.js src/recipes.js src/qloo.js ./src/
USER node

EXPOSE 8788
CMD ["node", "qloo-backend/server.mjs"]
