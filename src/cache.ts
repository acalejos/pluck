import { createHash } from 'node:crypto';
import type { Cache, CachedExtraction } from './types.js';

/**
 * The whole economic point of this package is skipping re-extraction when
 * (content, schema) are unchanged. Extraction is the expensive step — an LLM
 * call (or a careful JSON-LD parse) — and re-running it for byte-identical
 * input against an identical schema is pure waste. The cache keys on the
 * content hash and schema hash so an unchanged pair is a guaranteed hit and we
 * return the prior result instead of paying for extraction again.
 */

/** sha256 hex of arbitrary string content. */
export function hashContent(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * sha256 hex of a JSON schema. Hashed from a stable JSON.stringify so that
 * semantically identical schemas with differently-ordered keys collapse to the
 * same hash (and therefore the same cache key).
 */
export function hashSchema(jsonSchema: unknown): string {
  return createHash('sha256').update(stableStringify(jsonSchema), 'utf8').digest('hex');
}

/** Cache key for a (content, schema) pair. */
export function cacheKey(contentHash: string, schemaHash: string): string {
  return `${contentHash}:${schemaHash}`;
}

/**
 * In-memory, Map-backed cache. Fine for a single process / single run.
 *
 * This `Cache` interface is the seam where a shared backend plugs in later: a
 * Redis or Postgres implementation of the same get/set contract lets multiple
 * processes (or runs across time) share extraction results, which is where the
 * cost savings really compound. Swap MemoryCache for that implementation via
 * PluckConfig.cache — nothing else has to change.
 */
export class MemoryCache implements Cache {
  private store = new Map<string, CachedExtraction>();

  async get(key: string): Promise<CachedExtraction | undefined> {
    return this.store.get(key);
  }

  async set(key: string, value: CachedExtraction): Promise<void> {
    this.store.set(key, value);
  }
}

/** Deterministic JSON serialization: object keys sorted recursively. */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
