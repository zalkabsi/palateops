/**
 * Optional model layer.
 *
 * The model writes prose only. It receives computed evidence and must return
 * three short strings; it never sees the Qloo credential and never calculates a
 * score. Any failure degrades to the deterministic writer, because a
 * non-essential dependency must not be able to break the product.
 *
 * Works with any OpenAI-compatible endpoint (OpenAI, DeepSeek, Groq, Together,
 * OpenRouter, a local vLLM/Ollama gateway) via LLM_BASE_URL.
 */

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const TIMEOUT_MS = 20_000;

/** Read provider configuration from the environment. */
export function resolveModel(env = process.env) {
  const apiKey = typeof env.LLM_API_KEY === "string" ? env.LLM_API_KEY.trim() : "";
  const model = typeof env.LLM_MODEL === "string" ? env.LLM_MODEL.trim() : "";
  const baseUrl = (typeof env.LLM_BASE_URL === "string" && env.LLM_BASE_URL.trim()) || DEFAULT_BASE_URL;
  return {
    apiKey,
    model,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    provider: model || "model",
    configured: Boolean(apiKey && model),
  };
}

const SYSTEM_PROMPT = `You write the verdict for Duet, an app that finds venues two people will both like.

Rules:
- Use ONLY the evidence provided. Never invent a venue, tag, or number.
- Never mention Qloo, scores, algorithms, or that you are a model.
- Write to the two people directly, in a dry, specific, human voice. No hype.
- "headline": max 8 words. "detail": max 45 words. "advice": max 35 words.
- Return JSON only, with keys headline, detail, advice.`;

export async function requestNarration({ model, evidence, fetchImpl = fetch }) {
  if (!model?.configured) return null;
  const payload = {
    model: model.model,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(compact(evidence)) },
    ],
  };

  try {
    const response = await fetchImpl(`${model.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${model.apiKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    return validate(JSON.parse(content));
  } catch {
    return null;
  }
}

function compact(evidence) {
  return {
    city: evidence.city,
    people: [
      { name: evidence.a.label, signals: evidence.a.signals.map((signal) => signal.name).slice(0, 6) },
      { name: evidence.b.label, signals: evidence.b.signals.map((signal) => signal.name).slice(0, 6) },
    ],
    overlap_share: evidence.summary.overlap,
    places_liked_by_both: evidence.summary.bothCount,
    shared_taste_tags: evidence.taste.shared.map((entry) => entry.tag).slice(0, 5),
    only_first: evidence.taste.onlyA.map((entry) => entry.tag).slice(0, 3),
    only_second: evidence.taste.onlyB.map((entry) => entry.tag).slice(0, 3),
    top_shared_places: evidence.venues
      .filter((venue) => venue.bucket === "both" || venue.bucket === "trade")
      .slice(0, 4)
      .map((venue) => ({ name: venue.name, first: venue.affinityA, second: venue.affinityB })),
  };
}

function validate(value) {
  if (!value || typeof value !== "object") return null;
  const headline = text(value.headline, 90);
  const detail = text(value.detail, 320);
  const advice = text(value.advice, 240);
  if (!headline || !detail || !advice) return null;
  if (/\bqloo\b|\baffinity\b|\balgorithm\b/i.test(`${headline} ${detail} ${advice}`)) return null;
  return { headline, detail, advice };
}

function text(value, max) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}
