// pluck — turn any website into a type-safe, verified API.
//
// Public entry point: the orchestrator factory, the shared types, the fetcher
// tier, the cache, the routers, and a zero-config default client for the quick
// path (`import { pluck } from 'pluck'`).

// --- orchestrator ----------------------------------------------------------
export { createPluck } from './pluck.js';
export type { PluckClient } from './pluck.js';

// --- public types ----------------------------------------------------------
export type {
  Fetcher,
  FetchOptions,
  FetchResult,
  Router,
  RouterRequest,
  Cache,
  CachedExtraction,
  Provenance,
  FieldProvenance,
  ExtractSource,
  ExtractResult,
  ExtractOptions,
  VerifyConfig,
  PluckConfig,
} from './types.js';

// --- fetcher tier ----------------------------------------------------------
export { plainFetcher, firecrawlFetcher, tieredFetcher } from './fetch/index.js';

// --- cache -----------------------------------------------------------------
export { MemoryCache, hashContent, hashSchema, cacheKey } from './cache.js';

// --- routers ---------------------------------------------------------------
export { callbackRouter, swooshRouter } from './router/index.js';

// --- lower-level building blocks (advanced use) ----------------------------
export { extractFromStructuredData } from './jsonld.js';
export { htmlToMarkdown, cleanHtml } from './reduce.js';
export { extractWithRouter } from './extract.js';
export { verify } from './verify.js';

// --- default client convenience -------------------------------------------
import { createPluck } from './pluck.js';

/** A zero-config default client (plain fetcher, no router/cache). */
const _default = createPluck();

/** Pluck typed data from a URL using the zero-config default client. */
export const pluck = _default.pluck;
