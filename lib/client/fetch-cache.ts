/**
 * Bounded in-memory cache for client-side GET fetches. Survives Next.js client
 * navigations (module scope) so returning to a page can render instantly. Call
 * `invalidateFetchCache` after mutations or on full page refresh the cache
 * is naturally empty.
 */

const MAX_ENTRIES = 50;

interface CacheEntry {
  data: unknown;
  status: number;
}

/** LRU-ish store: delete oldest entry when at capacity. */
const store = new Map<string, CacheEntry>();

function cacheKey(url: string, method: string): string {
  return `${method}:${url}`;
}

function trimStore(): void {
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** Drop cached GET responses whose key contains `prefix` (e.g. `/api/leads`). */
export function invalidateFetchCache(prefix?: string): void {
  if (prefix === undefined) {
    store.clear();
    return;
  }
  for (const key of [...store.keys()]) {
    if (key.includes(prefix)) store.delete(key);
  }
}

/** Read a cached JSON body synchronously (GET + 2xx only). */
export function peekFetchCache<T>(url: string): T | null {
  const key = cacheKey(url, "GET");
  const hit = store.get(key);
  if (!hit || hit.status < 200 || hit.status >= 300) return null;
  return hit.data as T;
}

export interface CachedJsonResult<T> {
  data: T;
  ok: boolean;
  status: number;
  fromCache: boolean;
}

/** GET JSON with cache; non-GET always hits the network and skips the cache. */
export async function cachedJsonFetch<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<CachedJsonResult<T>> {
  const method = (init?.method ?? "GET").toUpperCase();
  const key = cacheKey(url, method);

  if (method === "GET") {
    const hit = store.get(key);
    if (hit && hit.status >= 200 && hit.status < 300) {
      return {
        data: hit.data as T,
        ok: true,
        status: hit.status,
        fromCache: true,
      };
    }
  }

  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T;

  if (method === "GET" && res.ok) {
    trimStore();
    store.set(key, { data, status: res.status });
  }

  return {
    data,
    ok: res.ok,
    status: res.status,
    fromCache: false,
  };
}
