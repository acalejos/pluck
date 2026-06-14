import type { Fetcher, FetchOptions, FetchResult } from '../types.js';

/** Default request timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * The baseline fetcher: a single `fetch` over the network with no JS rendering.
 *
 * Returns the raw HTML response. Honors `opts.timeoutMs` via an `AbortController`
 * (defaults to 15s) so a slow or hung server can't stall the pipeline.
 */
export const plainFetcher: Fetcher = {
  async fetch(url: string, opts?: FetchOptions): Promise<FetchResult> {
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Abort the in-flight request once the timeout elapses.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });
      const html = await res.text();

      return {
        url,
        // `res.url` reflects the post-redirect location.
        finalUrl: res.url,
        status: res.status,
        html,
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
