# PalateOps Qloo backend

This service runs the official Qloo Harness CLI on Node.js 22.19 or newer. It is a separate container service because the hackathon kit does not support running the Qloo harness from serverless functions.

## Runtime configuration

Set these values in the container host's secret manager:

- `QLOO_API_KEY`: event-issued credential. Never put it in the Site Worker or browser.
- `QLOO_BACKEND_TOKEN`: shared bearer token used only between this service and the Site Worker.
- `PORT`: optional listener port; defaults to `8788`.

Generate a token locally with `openssl rand -hex 32`; configure the same value as `QLOO_BACKEND_TOKEN` in the container and the Site runtime. The service rejects tokens shorter than 32 characters. Do not commit it.

Build and run the container with both secrets supplied by the host. The service exposes `/healthz`, `/api/qloo/resolve`, and `/api/qloo/signals`. The resolution route returns exact matches or candidate suggestions without querying Insights. The signals route runs `qloo api insights` only after the browser has shown the resolved names and the user confirms them.

The service does not enable browser CORS. The Site Worker authenticates with the bearer token and proxies the two routes. The backend limits requests and command duration/output, passes the API key only to the `qloo` child process, and sanitizes command errors.

## Local development

Install the official CLI and set secrets in the local shell, then run:

```sh
npm install --global @qloo/qloo-harness@0.1.26
QLOO_API_KEY=... QLOO_BACKEND_TOKEN=... npm start
```

The Qloo API key is required only for live requests. `GET /healthz` does not return either secret.
