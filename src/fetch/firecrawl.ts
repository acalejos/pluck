import type { Fetcher, FetchOptions, FetchResult } from '../types.js';

/** Default request timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Shape of the relevant slice of a Firecrawl `/v1/scrape` response. */
interface FirecrawlScrapeResponse {
  success?: boolean;
  error?: string;
  data?: {
    html?: string;
    markdown?: string;
    metadata?: {
      sourceURL?: string;
      url?: string;
      statusCode?: number;
    };
  };
}

/**
 * A fetcher backed by a **self-hosted** Firecrawl-compatible instance.
 *
 * Firecrawl renders JS and returns clean HTML + markdown, so this is the
 * natural "rendered" tier. Because we target a self-hosted deployment, a
 * `baseUrl` is required — there is no sensible public default.
 *
 * @param config.baseUrl Base URL of the Firecrawl instance (no trailing
 *   `/v1/scrape`). Defaults to `PLUCK_FIRECRAWL_URL`.
 * @param config.apiKey  Optional bearer token. Defaults to `PLUCK_FIRECRAWL_KEY`.
 */
export function firecrawlFetcher(config?: {
  baseUrl?: string;
  apiKey?: string;
}): Fetcher {
  const baseUrl = config?.baseUrl ?? process.env.PLUCK_FIRECRAWL_URL;
  const apiKey = config?.apiKey ?? process.env.PLUCK_FIRECRAWL_KEY;

  if (!baseUrl) {
    throw new Error(
      'firecrawlFetcher: a baseUrl is required for self-hosted Firecrawl. ' +
        'Pass { baseUrl } or set PLUCK_FIRECRAWL_URL.',
    );
  }

  // Normalize: strip trailing slashes so we can append the endpoint cleanly.
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/scrape`;

  return {
    async fetch(url: string, opts?: FetchOptions): Promise<FetchResult> {
      const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ url, formats: ['html', 'markdown'] }),
          signal: controller.signal,
        });

        if (!res.ok) {
          // Surface the body to make self-hosted misconfigurations debuggable.
          const body = await res.text().catch(() => '');
          throw new Error(
            `firecrawlFetcher: ${endpoint} returned ${res.status} ${res.statusText}` +
              (body ? ` — ${body.slice(0, 500)}` : ''),
          );
        }

        const json = (await res.json()) as FirecrawlScrapeResponse;

        if (json.success === false || !json.data) {
          throw new Error(
            `firecrawlFetcher: scrape failed for ${url}` +
              (json.error ? ` — ${json.error}` : ''),
          );
        }

        const meta = json.data.metadata;

        return {
          url,
          finalUrl: meta?.sourceURL ?? meta?.url ?? url,
          // Prefer Firecrawl's reported upstream status; fall back to 200.
          status: meta?.statusCode ?? 200,
          html: json.data.html ?? '',
          markdown: json.data.markdown,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
