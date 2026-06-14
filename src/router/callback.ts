import type { Router, RouterRequest } from '../types.js';

/**
 * The seam: pluck owns crawl/verify/cache; the Router owns the model call.
 *
 * `callbackRouter` is the trivial, dependency-free adapter. You hand it a
 * function that takes a RouterRequest (content + jsonSchema + features) and
 * returns the parsed structured object. That's it — bring your own LLM call.
 *
 * Tests and examples use this as a mock; users use it to wire any provider
 * (OpenAI, Anthropic, a local model, a fixture) without pulling in swoosh-router.
 */
export function callbackRouter(fn: (req: RouterRequest) => Promise<unknown>): Router {
  return {
    extract(req: RouterRequest): Promise<unknown> {
      return fn(req);
    },
  };
}
