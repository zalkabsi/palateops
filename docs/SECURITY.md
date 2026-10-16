# Security notes

- `QLOO_API_KEY` belongs only in the Node backend host's secret store. Never commit it or enter it in the browser or Site Worker.
- The Site Worker forwards requests to the configured HTTPS backend origin using a random `QLOO_BACKEND_TOKEN` of at least 32 characters. The backend runs the Qloo Harness CLI with `shell: false` and passes the API key only to that child process.
- Input is limited to three restaurant names of at most 120 characters each and a 4 KB JSON body. The backend limits each Harness command to 12 seconds and 512 KB of stdout; the Worker has a 25-second backend timeout.
- The Worker and backend have in-memory limits of ten requests per IP per minute. These are isolate/process-local safeguards, not durable global quotas.
- The backend returns sanitized errors and does not retry Qloo rate limits. Neither service logs request names or credentials.
- The browser asks the user to confirm exact place matches before requesting Insights. Missing and ambiguous matches return suggestions without an Insights call.
- Static output uses same-origin scripts and styles with a restrictive Content Security Policy.
- User-entered scenario data stays in localStorage on that browser. Use synthetic data for the public demo.
- Qloo results are aggregate signals. Do not use them to infer identity, sensitive traits, health conditions or individual dietary requirements.
- Allergen metadata is a screen for planning and must be confirmed against current recipes, packaging and cross-contact procedures.

Configure provider quotas and monitor the service before broader deployment. Do not submit diner names, emails, device IDs, or other personal data. Qloo signals are aggregate context and must not be used to infer sensitive or individual traits.
