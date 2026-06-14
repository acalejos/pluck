import type { Fetcher, FetchOptions, FetchResult } from '../types.js';

/**
 * Default escalation heuristic.
 *
 * A plain fetch likely missed client-rendered content when either:
 *  - the returned HTML is suspiciously short (< 500 chars), or
 *  - the page ships a Next.js `__NEXT_DATA__` payload but almost no visible
 *    text — a strong signal the real content is hydrated client-side.
 */
function defaultNeedsRender(r: FetchResult): boolean {
  const html = r.html ?? '';

  if (html.length < 500) return true;

  if (html.includes('__NEXT_DATA__')) {
    // Crude "visible text" estimate: drop tags and whitespace.
    const textLen = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim().length;
    if (textLen < 500) return true;
  }

  return false;
}

/**
 * Composes a cheap `plain` fetcher with an expensive `rendered` fetcher.
 *
 * Strategy: always try `plain` first. Escalate to `rendered` when the caller
 * explicitly requests rendering (`opts.render`) OR when `needsRender(result)`
 * decides the plain result is inadequate (default heuristic in
 * {@link defaultNeedsRender}).
 *
 * If no `rendered` fetcher is supplied, the plain result is returned as-is
 * even when escalation is requested.
 *
 * @param opts.plain       Primary fetcher (defaults to a lazy import is *not*
 *   done here — supply one explicitly; omitting it disables the plain tier).
 * @param opts.rendered    Fetcher used for the JS-rendered escalation.
 * @param opts.needsRender Override the default escalation heuristic.
 */
export function tieredFetcher(opts: {
  plain?: Fetcher;
  rendered?: Fetcher;
  needsRender?: (r: FetchResult) => boolean;
}): Fetcher {
  const { plain, rendered } = opts;
  const needsRender = opts.needsRender ?? defaultNeedsRender;

  return {
    async fetch(url: string, fetchOpts?: FetchOptions): Promise<FetchResult> {
      // If there is no plain tier, go straight to rendered (if available).
      if (!plain) {
        if (!rendered) {
          throw new Error(
            'tieredFetcher: at least one of { plain, rendered } must be provided.',
          );
        }
        return rendered.fetch(url, fetchOpts);
      }

      const result = await plain.fetch(url, fetchOpts);

      // Escalate on explicit request or heuristic verdict, if we can.
      const shouldEscalate = fetchOpts?.render === true || needsRender(result);
      if (shouldEscalate && rendered) {
        return rendered.fetch(url, fetchOpts);
      }

      return result;
    },
  };
}
