# pluck

[![CI](https://github.com/acalejos/pluck/actions/workflows/ci.yml/badge.svg)](https://github.com/acalejos/pluck/actions/workflows/ci.yml) · [Docs](https://acalejos.github.io/pluck/docs.html) · [llms.txt](https://acalejos.github.io/pluck/llms.txt) · MIT

Turn any website into a type-safe, verified API. Give pluck a URL and a Zod
schema; it returns data shaped like that schema and tells you how much of it
traced back to the page. Nothing is taken on faith — every extracted field is
checked against the source content before it reaches you.

## Install

```bash
npm install pluck zod
```

> **Pre-release (0.1.0).** The library core is complete and tested; the package
> is not yet published to npm, and the networked edges (Firecrawl, swoosh) are
> not yet covered by automated tests.

## Pipeline

```
            ┌──────────────────────────────────────────────────────┐
  URL ─────▶│  fetch                                                │
            │    │                                                  │
            │    ▼                                                  │
            │  JSON-LD fast path ──(satisfies schema)──┐            │
            │    │                                      │            │
            │    │ (no usable structured data)          │            │
            │    ▼                                      │            │
            │  reduce (HTML → markdown)                 │            │
            │    │                                      │            │
            │    ▼                                      │            │
            │  router extract (the LLM call)            │            │
            │    │                                      │            │
            │    ▼                                      ▼            │
            │  verify (trace each field to the source) ◀────────────│
            │    │                                                  │
            │    ▼                                                  │
            │  cache                                                │
            └────┬─────────────────────────────────────────────────┘
                 ▼
            ExtractResult<T>
```

The JSON-LD fast path tries to satisfy your schema directly from a page's
structured data (`ld+json`, `__NEXT_DATA__`, OpenGraph). When it succeeds and
the data clears verification, no model is called at all. Otherwise pluck reduces
the page to markdown and hands it to the router. Either way, the result is
verified against the page's own text and cached by (content hash, schema hash).

## Quickstart

```ts
import { z } from 'zod';
import { createPluck } from 'pluck';

const Recipe = z.object({
  title: z.string(),
  ingredients: z.array(z.string()),
  steps: z.array(z.string()),
});

const client = createPluck();

const result = await client.pluck('https://example.com/some-recipe', Recipe);

if (result.ok) {
  console.log(result.source);                 // "jsonld" or "llm"
  console.log(result.provenance.verifiedRatio); // 0..1, how much traced back
  console.log(result.data.title);             // typed as string
} else {
  console.error(result.reason);               // never throws; failures are values
}
```

`pluck` never throws — it resolves to a discriminated union, either
`{ ok: true, data, provenance, cached, source }` or `{ ok: false, reason, partial? }`.
Use `define(schema)` to bind a schema once and reuse the extractor across URLs.

The default client uses the plain fetcher with no router or cache. That's enough
for the JSON-LD fast path; to handle pages that need a model, pass a router (see
below).

## The seams: Fetcher, Router, Cache

pluck is built around three injectable interfaces. You can replace any of them
without touching the rest of the pipeline.

- **Fetcher** — `fetch(url, opts) → { html, markdown?, status, finalUrl? }`. How
  pages come in. `plainFetcher` does a bare HTTP GET; `firecrawlFetcher` talks to
  a self-hosted Firecrawl instance for JS-rendered pages; `tieredFetcher`
  escalates from one to the next. A mock fetcher returning canned HTML makes the
  whole pipeline runnable offline (see `examples/01` and `examples/02`).

- **Router** — `extract(req) → unknown`. The model call, and the only place a
  model is named. `callbackRouter(fn)` is the dependency-free adapter: hand it a
  function that takes a `RouterRequest` (page content + JSON Schema + requested
  features) and returns the parsed object. Bring any provider, or a fixture.

- **Cache** — `get(key)` / `set(key, value)`. Keyed by content hash + schema
  hash, so an unchanged page and schema is a guaranteed hit. `MemoryCache` is
  built in; implement the interface for Redis, SQLite, or anything else.

```ts
import { createPluck, callbackRouter, firecrawlFetcher, MemoryCache } from 'pluck';

const client = createPluck({
  fetcher: firecrawlFetcher({ baseUrl: process.env.PLUCK_FIRECRAWL_URL }),
  router: callbackRouter(async (req) => yourModelCall(req)),
  cache: new MemoryCache(),
  verify: { minRatio: 0.6 },
});
```

## Composing with swoosh

pluck draws a clean line: **pluck owns crawl, reduce, verify, and cache; swoosh
owns model policy** — which model runs, under what cost and capability rules.
pluck never names a model. It declares the capabilities a request needs (always
`structured_output`, plus anything you add) and lets the router decide.

`swooshRouter(instance)` adapts a `swoosh-router` instance into pluck's `Router`
interface:

```ts
import { createPluck, swooshRouter } from 'pluck';

const router = await swooshRouter(yourSwooshInstance);
const client = createPluck({ router });
```

`swoosh-router` is an optional peer dependency — pluck builds and runs without it
installed. See `examples/03-swoosh.ts` for the full production wiring (swoosh router
plus a self-hosted Firecrawl fetcher).

## Examples

- `examples/01-jsonld-recipe.ts` — offline, the zero-LLM JSON-LD fast path.
- `examples/02-mock-extract.ts` — offline, the router path with provenance.
- `examples/03-swoosh.ts` — the real-world swoosh + Firecrawl wiring.

Run the offline ones with `npx tsx examples/01-jsonld-recipe.ts`.

## Docs

- [Landing](https://acalejos.github.io/pluck/) · [Documentation](https://acalejos.github.io/pluck/docs.html)
- Agent-readable: [llms.txt](https://acalejos.github.io/pluck/llms.txt) · [llms-full.txt](https://acalejos.github.io/pluck/llms-full.txt) (every page also has a `.md` twin, e.g. [docs.md](https://acalejos.github.io/pluck/docs.md))

The site's Markdown/llms files are generated from the HTML by `npm run docs`.

## Status

0.1.0 scaffold. The API shape is settling; expect changes. Not yet published to npm.
