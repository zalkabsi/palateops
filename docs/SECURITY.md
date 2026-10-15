# Security notes

- Qloo credentials belong in the Site runtime secret store as QLOO_API_KEY. Never commit or enter them in the browser.
- The Worker calls one fixed Qloo origin and only the search and Insights routes.
- Input is limited to three dining names of at most 120 characters each. The live request has a 4 KB body limit, a nine-second timeout and an in-memory limit of ten requests per IP per minute.
- The Worker returns sanitized errors, does not retry rate limits and does not log user input or credentials.
- Static output uses same-origin scripts and styles with a restrictive Content Security Policy.
- User-entered scenario data stays in localStorage on that browser. Use synthetic data for the public demo.
- Qloo results are aggregate signals. Do not use them to infer identity, sensitive traits, health conditions or individual dietary requirements.
- Allergen metadata is a screen for planning and must be confirmed against current recipes, packaging and cross-contact procedures.

The in-memory throttle is per Worker isolate and is not a durable global rate limiter. Configure provider quotas and monitor the service before broader deployment.
