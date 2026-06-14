import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createPluck } from '../src/pluck.js';
import { callbackRouter } from '../src/router/callback.js';
import { MemoryCache } from '../src/cache.js';
import type { Fetcher, FetchResult } from '../src/types.js';

// --- canned fixtures -------------------------------------------------------

const recipeSchema = z.object({
  title: z.string(),
  ingredients: z.array(z.string()),
});

// Plain HTML: visible body text the router's canned answer can be traced to.
const PLAIN_HTML = `<!doctype html>
<html><body><main>
  <h1>Skillet Cornbread</h1>
  <p>A cast-iron classic.</p>
  <ul>
    <li>1 cup cornmeal</li>
    <li>1 cup buttermilk</li>
  </ul>
</main></body></html>`;

// JSON-LD HTML: structured data the fast path can satisfy without the router.
const JSONLD_HTML = `<!doctype html>
<html><head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Recipe",
    "name": "Skillet Cornbread",
    "recipeIngredient": ["1 cup cornmeal", "1 cup buttermilk"]
  }
  </script>
</head><body><main><h1>Skillet Cornbread</h1>
  <p>A cast-iron classic.</p>
  <ul><li>1 cup cornmeal</li><li>1 cup buttermilk</li></ul>
</main></body></html>`;

const CANNED_OBJECT = {
  title: 'Skillet Cornbread',
  ingredients: ['1 cup cornmeal', '1 cup buttermilk'],
};

function mockFetcher(html: string): { fetcher: Fetcher; calls: () => number } {
  let n = 0;
  const fetcher: Fetcher = {
    async fetch(url: string): Promise<FetchResult> {
      n += 1;
      return { url, finalUrl: url, status: 200, html };
    },
  };
  return { fetcher, calls: () => n };
}

describe('createPluck (offline integration)', () => {
  it('pluck() returns ok:true with a typed object via the LLM router on plain HTML', async () => {
    const { fetcher } = mockFetcher(PLAIN_HTML);
    const routerFn = vi.fn(async () => CANNED_OBJECT);
    const client = createPluck({
      fetcher,
      router: callbackRouter(routerFn),
      cache: new MemoryCache(),
    });

    const res = await client.pluck('https://example.test/cornbread', recipeSchema);

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.reason);
    expect(res.source).toBe('llm');
    expect(res.cached).toBe(false);
    expect(res.data.title).toBe('Skillet Cornbread');
    expect(res.data.ingredients).toEqual(['1 cup cornmeal', '1 cup buttermilk']);
    expect(routerFn).toHaveBeenCalledTimes(1);
  });

  it('a second call hits the cache (cached:true) and does not re-invoke the router', async () => {
    const { fetcher } = mockFetcher(PLAIN_HTML);
    const routerFn = vi.fn(async () => CANNED_OBJECT);
    const client = createPluck({
      fetcher,
      router: callbackRouter(routerFn),
      cache: new MemoryCache(),
    });

    const first = await client.pluck('https://example.test/cornbread', recipeSchema);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.cached).toBe(false);

    const second = await client.pluck('https://example.test/cornbread', recipeSchema);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.reason);
    expect(second.cached).toBe(true);
    expect(second.data.title).toBe('Skillet Cornbread');
    // Router only ran for the first (uncached) extraction.
    expect(routerFn).toHaveBeenCalledTimes(1);
  });

  it("uses source:'jsonld' for JSON-LD HTML and source:'llm' for plain HTML", async () => {
    const routerFn = vi.fn(async () => CANNED_OBJECT);

    const jsonldPluck = createPluck({
      fetcher: mockFetcher(JSONLD_HTML).fetcher,
      router: callbackRouter(routerFn),
      cache: new MemoryCache(),
    });
    const jsonldRes = await jsonldPluck.pluck('https://example.test/jsonld', recipeSchema);
    expect(jsonldRes.ok).toBe(true);
    if (!jsonldRes.ok) throw new Error(jsonldRes.reason);
    expect(jsonldRes.source).toBe('jsonld');
    // JSON-LD fast path must not call the router at all.
    expect(routerFn).not.toHaveBeenCalled();

    const plainPluck = createPluck({
      fetcher: mockFetcher(PLAIN_HTML).fetcher,
      router: callbackRouter(routerFn),
      cache: new MemoryCache(),
    });
    const plainRes = await plainPluck.pluck('https://example.test/plain', recipeSchema);
    expect(plainRes.ok).toBe(true);
    if (!plainRes.ok) throw new Error(plainRes.reason);
    expect(plainRes.source).toBe('llm');
    expect(routerFn).toHaveBeenCalledTimes(1);
  });
});
