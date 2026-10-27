/**
 * Small TTL + LRU cache.
 *
 * The hackathon kit asks for the smallest request that answers the product
 * question and for caching only what the project needs. A duet session costs
 * two Qloo calls; repeat visits with the same signals should cost zero.
 */

export function createCache({ ttlMs = 30 * 60 * 1000, maxEntries = 200, now = () => Date.now() } = {}) {
  const store = new Map();

  function get(key) {
    const hit = store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= now()) {
      store.delete(key);
      return undefined;
    }
    // Refresh recency so the LRU eviction reflects actual use.
    store.delete(key);
    store.set(key, hit);
    return hit.value;
  }

  function set(key, value) {
    if (store.size >= maxEntries) {
      const oldest = store.keys().next();
      if (!oldest.done) store.delete(oldest.value);
    }
    store.set(key, { value, expiresAt: now() + ttlMs });
    return value;
  }

  /** Return a cached value, otherwise compute and store it. */
  async function wrap(key, compute) {
    const cached = get(key);
    if (cached !== undefined) return { value: cached, hit: true };
    const value = await compute();
    set(key, value);
    return { value, hit: false };
  }

  return { get, set, wrap, clear: () => store.clear(), size: () => store.size };
}

export const cacheKey = (...parts) => parts.map((part) => JSON.stringify(part ?? null)).join("|");
