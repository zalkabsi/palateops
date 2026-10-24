# PalateOps Qloo backend

This service runs the official Qloo Harness CLI on Node.js 22.19 or newer. It is a separate container service because the hackathon kit does not support running the Qloo harness from serverless functions.

## Runtime configuration

Set these values in the container host's secret manager:

- `QLOO_API_KEY`: event-issued credential. Never put it in the Site Worker or browser.
- `QLOO_BACKEND_TOKEN`: shared bearer token used only between this service and the Site Worker.
- `PORT`: optional listener port; defaults to `8788`.
- `PALATEOPS_AGENT_ENABLED`: set to `true` to enable the optional model planner.
- `OPENAI_API_KEY` and `OPENAI_MODEL`: model secret and explicit compatible model ID, required only for the AI method. See [the agent guide](../docs/AGENT.md).

Generate a token locally with `openssl rand -hex 32`; configure the same value as `QLOO_BACKEND_TOKEN` in the container and the Site runtime. The service rejects tokens shorter than 32 characters. Do not commit it.

Build from the repository root so shared planner modules are included:

```sh
docker build -f qloo-backend/Dockerfile -t palateops-backend .
```

For a managed environment with a session proxy CA, add `--secret id=proxy_ca,src="$CODEX_PROXY_CERT"` to the build command. The optional secret mount extends npm trust only during installation and is not copied into the image. Preserve the environment's proxy settings and TLS verification.

Supply secrets through the host. The service exposes `/healthz`, `/api/qloo/resolve`, `/api/qloo/signals`, and `/api/agent/plan`. The resolution route returns exact matches or candidate suggestions without querying Insights. The signals route runs `qloo api insights` only after the browser has shown the resolved names and the user confirms them. The agent route calls model-selected tools over server-owned planning state; Sample mode can use the AI method without a Qloo key.

The service does not enable browser CORS. The Site Worker authenticates with the bearer token and proxies requests. The backend limits request size, model runs and command duration/output, passes only the Qloo key to the `qloo` child process, preserves proxy and CA settings, and sanitizes provider errors. The model key is never inherited by the Qloo process.

## Local development

Install the official CLI and set secrets in the local shell, then run:

```sh
npm install --global @qloo/qloo-harness@0.1.26
QLOO_API_KEY=... QLOO_BACKEND_TOKEN=... npm start
```

The Qloo API key is required only for live requests. `GET /healthz` does not return either secret.
