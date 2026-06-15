import { describe, it, expect, vi, afterEach } from 'vitest';
import { plainFetcher, firecrawlFetcher, tieredFetcher } from '../src/fetch/index.js';
import type { Fetcher, FetchResult } from '../src/types.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A minimal duck-typed `fetch` Response, controllable per test.
function res(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  url?: string;
  text?: string;
  json?: unknown;
}) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? 'OK',
    url: opts.url ?? '',
    text: async () => opts.text ?? '',
    json: async () => opts.json ?? {},
  };
}

describe('plainFetcher', () => {
  it('returns html, status, and the post-redirect finalUrl', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res({ status: 200, url: 'https://ex.com/final', text: '<h1>hi</h1>' })),
    );
    const out = await plainFetcher.fetch('https://ex.com/start');
    expect(out).toMatchObject({
      url: 'https://ex.com/start',
      finalUrl: 'https://ex.com/final',
      status: 200,
      html: '<h1>hi</h1>',
    });
  });

  it('passes an AbortSignal so a timeout can fire', async () => {
    const spy = vi.fn(async (_url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return res({ text: 'ok' });
    });
    vi.stubGlobal('fetch', spy);
    await plainFetcher.fetch('https://ex.com', { timeoutMs: 1000 });
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe('firecrawlFetcher', () => {
  it('throws when no baseUrl is configured', () => {
    const saved = process.env.PLUCK_FIRECRAWL_URL;
    delete process.env.PLUCK_FIRECRAWL_URL;
    expect(() => firecrawlFetcher({})).toThrow(/baseUrl is required/);
    if (saved !== undefined) process.env.PLUCK_FIRECRAWL_URL = saved;
  });

  it('POSTs to <baseUrl>/v1/scrape (trailing slash stripped) and maps the response', async () => {
    const spy = vi.fn(async (url, init) => {
      expect(url).toBe('https://fc.local/v1/scrape');
      expect(init?.method).toBe('POST');
      expect(init?.headers?.authorization).toBe('Bearer k');
      expect(JSON.parse(init?.body)).toMatchObject({
        url: 'https://site.com/p',
        formats: ['html', 'markdown'],
      });
      return res({
        json: {
          success: true,
          data: {
            html: '<p>x</p>',
            markdown: '# x',
            metadata: { sourceURL: 'https://site.com/p', statusCode: 200 },
          },
        },
      });
    });
    vi.stubGlobal('fetch', spy);
    const f = firecrawlFetcher({ baseUrl: 'https://fc.local/', apiKey: 'k' });
    const out = await f.fetch('https://site.com/p');
    expect(out).toMatchObject({
      url: 'https://site.com/p',
      finalUrl: 'https://site.com/p',
      status: 200,
      html: '<p>x</p>',
      markdown: '# x',
    });
  });

  it('throws on a non-2xx response, surfacing the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res({ ok: false, status: 502, statusText: 'Bad Gateway', text: 'upstream boom' })),
    );
    const f = firecrawlFetcher({ baseUrl: 'https://fc.local' });
    await expect(f.fetch('https://site.com')).rejects.toThrow(/502 Bad Gateway — upstream boom/);
  });

  it('throws when the scrape reports success:false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res({ json: { success: false, error: 'blocked' } })),
    );
    const f = firecrawlFetcher({ baseUrl: 'https://fc.local' });
    await expect(f.fetch('https://site.com')).rejects.toThrow(/scrape failed.*blocked/);
  });
});

describe('tieredFetcher', () => {
  const big = `<html>${'x'.repeat(800)}</html>`;
  const make = (result: Partial<FetchResult>): Fetcher => ({
    fetch: vi.fn(async (url: string) => ({ url, status: 200, html: '', ...result })),
  });

  it('uses plain and does not escalate when the plain result is adequate', async () => {
    const plain = make({ html: big });
    const rendered = make({ html: 'RENDERED' });
    const out = await tieredFetcher({ plain, rendered }).fetch('https://ex.com');
    expect(out.html).toBe(big);
    expect(rendered.fetch).not.toHaveBeenCalled();
  });

  it('escalates to rendered when the plain result looks empty', async () => {
    const plain = make({ html: '<html></html>' }); // < 500 chars
    const rendered = make({ html: 'RENDERED' });
    const out = await tieredFetcher({ plain, rendered }).fetch('https://ex.com');
    expect(out.html).toBe('RENDERED');
  });

  it('escalates on an explicit render request even when plain is adequate', async () => {
    const plain = make({ html: big });
    const rendered = make({ html: 'RENDERED' });
    const out = await tieredFetcher({ plain, rendered }).fetch('https://ex.com', { render: true });
    expect(out.html).toBe('RENDERED');
  });

  it('goes straight to rendered when no plain tier is given', async () => {
    const rendered = make({ html: 'RENDERED' });
    const out = await tieredFetcher({ rendered }).fetch('https://ex.com');
    expect(out.html).toBe('RENDERED');
  });

  it('throws when neither plain nor rendered is provided', async () => {
    await expect(tieredFetcher({}).fetch('https://ex.com')).rejects.toThrow(/at least one of/);
  });
});
