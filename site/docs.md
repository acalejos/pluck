# pluck — documentation

> Source: https://acalejos.github.io/pluck/docs.html · Repo: https://github.com/acalejos/pluck

Turn any website into a type-safe, source-verified API. You bring a Zod schema; pluck fetches the page, fills the schema, traces every field back to the source, and caches the result. pluck owns the crawl, verify, and cache — the model call is yours to plug in.

## Install

pluck is an ESM, TypeScript-first package. It needs `zod` as a peer for schemas.

```
npm install pluck zod
```

Two optional add-ons, only if you want them:

```
# policy-driven model routing (the swooshRouter adapter)
npm install swoosh-router
```

> **Pre-release** pluck is at v0.1.0 — the library core is complete and tested, but the package is not yet published and the network-facing edges (Firecrawl, swoosh) are not yet covered by automated tests. The API below is real and current.

## Quickstart

Define what you want as a Zod schema, then call `pluck`. The result is a discriminated union — check `res.ok` before reading data.

```
import { createPluck, callbackRouter } from 'pluck'
import { z } from 'zod'

const Article = z.object({
  headline: z.string(),
  author:   z.string().nullable(),
  words:    z.number(),
})

const client = createPluck({
  router: callbackRouter(async (req) => callYourLLM(req)),
})

const res = await client.pluck('https://example.com/post', Article)

if (res.ok) {
  console.log(res.data.headline)        // string
  console.log(res.source)               // 'jsonld' | 'llm'
  console.log(res.provenance.verifiedRatio) // 0..1
} else {
  console.warn(res.reason)              // why it failed
}
```

## The pipeline

A single `pluck` call runs up to six stages. The model is only touched when it has to be.

-   **Fetch** — the configured `Fetcher` retrieves the page (plain HTTP by default).
-   **Cache lookup** — keyed on content hash + schema hash. A hit returns immediately.
-   **JSON-LD fast path** — if the page publishes structured data that satisfies your schema (and clears verification), pluck uses it and skips the model. `source: 'jsonld'`.
-   **Reduce + extract** — otherwise the HTML is reduced to clean markdown and handed to the `Router`, which fills the schema. `source: 'llm'`.
-   **Verify** — every leaf field is traced back to the source content and scored.
-   **Cache write** — successful results are persisted for next time.

## ExtractResult

Every public method resolves to an `ExtractResult<T>`. It never throws — even network errors and verification failures come back as `{ ok: false }`.

```
type ExtractResult<T> =
  | { ok: true;  data: T; provenance: Provenance; cached: boolean; source: ExtractSource }
  | { ok: false; reason: string; partial?: Partial<T> }
```

Because it's a discriminated union, TypeScript narrows `res.data` to `T` the moment you check `res.ok`. There is no untyped escape hatch.

## Verification

Type-safe is not the same as correct — a model can return a perfectly-typed but invented value. pluck treats verification as a separate job: it walks every leaf field in the result, looks for the value in the page's own text, and records a `FieldProvenance` (found, source span, confidence) per field. The aggregate is `provenance.verifiedRatio`.

If verification is on (the default) and the ratio falls below `minRatio` (default `0.5`), the call returns `{ ok: false }` with the unverified data attached as `partial`. This applies to the JSON-LD path too — structured data can drift or lie, so it must clear the same bar.

```
// tighten the bar, or turn it off entirely
createPluck({ verify: { minRatio: 0.8 } })
createPluck({ verify: false })   // trust the model / json-ld outright
```

## JSON-LD fast path

Most recipe, product, and article pages embed `schema.org` data in a `<script type="application/ld+json">` block (pluck also reads `__NEXT_DATA__` and OpenGraph as fallbacks). When that data satisfies your schema, pluck returns it with **no model call at all** — faster, free, and impossible to hallucinate. You can disable it with `jsonLdFirst: false`.

## Caching

Pass a `Cache` and pluck keys each extraction on `hash(content) + hash(schema)`. An unchanged page with the same schema is a guaranteed hit — you don't pay the model twice. The bundled `MemoryCache` is per-process; the `Cache` interface is the seam where a shared Redis/Postgres store drops in when you graduate the library into a service.

## createPluck

```
createPluck(config?: PluckConfig): PluckClient
```

Creates a client bound to a configuration. With no arguments you get a zero-config client (plain fetcher, no router, no cache) — enough for the JSON-LD fast path, but LLM extraction needs a router.

```
const client = createPluck({
  fetcher: firecrawlFetcher(),       // default: plainFetcher
  router:  swooshRouter(swoosh),       // required for LLM extraction
  cache:   new MemoryCache(),          // default: none
  verify:  { minRatio: 0.6 },        // default: true (0.5)
  jsonLdFirst: true,                 // default: true
})
```

## pluck & define

```
client.pluck<T>(url: string, schema: ZodType<T>, opts?: ExtractOptions): Promise<ExtractResult<T>>
```

Extract from a URL against a schema. `opts.render` forces a JS render (if the fetcher supports it); `opts.instruction` adds a hint passed to the router.

```
client.define<T>(schema: ZodType<T>, opts?: ExtractOptions): { extract(url: string): Promise<ExtractResult<T>> }
```

Bind a schema up front and reuse it — a small "typed API for one shape" you can pass around.

```
const recipes = client.define(Recipe)
const a = await recipes.extract(url1)
const b = await recipes.extract(url2)
```

## Default client

For the quick path, pluck exports a zero-config client's `pluck` method directly, so you can call `pluck(url, schema)` without constructing a client. No router is wired, so this only resolves the JSON-LD fast path; configure your own client for LLM extraction.

```
import { pluck } from 'pluck'

const res = await pluck(url, Recipe)   // json-ld path only
```

## PluckConfig

| Field | Type | Default & meaning |
| --- | --- | --- |
| fetcher | Fetcher | `plainFetcher` — how pages are retrieved. |
| router | Router | none — required for the LLM path; the model call. |
| cache | Cache | none — pass one to dedupe by content+schema. |
| verify | boolean or { minRatio } | `true` (0.5) — source-trace gate. |
| jsonLdFirst | boolean | `true` — try structured data before the model. |

## Fetchers

A `Fetcher` turns a URL into HTML. pluck ships three.

### plainFetcher

Global `fetch`, honoring `timeoutMs`. The default — fine for static and server-rendered pages.

### firecrawlFetcher({ baseUrl?, apiKey? })

Talks to a Firecrawl-compatible `/v1/scrape` endpoint for JS rendering and anti-bot handling. Points at a **self-hosted** instance — `baseUrl` is required (falls back to `PLUCK_FIRECRAWL_URL`; key from `PLUCK_FIRECRAWL_KEY`).

### tieredFetcher({ plain?, rendered?, needsRender? })

Tries the cheap fetcher first and escalates to the rendered one only when needed (low HTML length, or an explicit `render` request). Cost control by default.

```
import { tieredFetcher, plainFetcher, firecrawlFetcher } from 'pluck'

const fetcher = tieredFetcher({
  plain:    plainFetcher,
  rendered: firecrawlFetcher({ baseUrl: process.env.PLUCK_FIRECRAWL_URL }),
})
```

## Routers

A `Router` owns the model call. pluck declares what it needs — structured output for a JSON schema — and the router decides which model answers. pluck never names a model itself.

### callbackRouter(fn)

Wraps any async function `(req: RouterRequest) => Promise<unknown>`. This is your bring-your-own-LLM hook, and what tests use as a mock.

### swooshRouter(instance)

Adapts a [swoosh-router](https://github.com/acalejos/swoosh) instance into pluck's `Router`, so model selection, budgets, and fallback live in your policy layer. `swoosh-router` is an optional peer dependency — pluck builds and runs without it.

```
// bring your own model
callbackRouter(async ({ content, jsonSchema, instruction }) => {
  return await myLLM.structured({ content, schema: jsonSchema })
})

// or delegate model policy to swoosh
const router = await swooshRouter(swoosh)
```

> **The seam** pluck owns crawl, reduce, verify, and cache. swoosh owns which model, under what policy. pluck asks for "a model that does structured output"; swoosh picks one and prices it. Neither reaches into the other's job.

## Cache

Implement `get(key)` / `set(key, value)` and pluck will use it. The bundled `MemoryCache` is a Map; `hashContent`, `hashSchema`, and `cacheKey` are exported if you build your own store.

## Types reference

| Export | Shape |
| --- | --- |
| Fetcher | fetch(url, opts?) → Promise<FetchResult> |
| FetchResult | { url, finalUrl?, status, html, markdown? } |
| Router | extract(req: RouterRequest) → Promise<unknown> |
| RouterRequest | { content, jsonSchema, instruction?, requiresFeatures? } |
| Cache | get(key) / set(key, value) |
| Provenance | { fields: Record<string, FieldProvenance>, verifiedRatio } |
| FieldProvenance | { value, found, sourceSpan?, confidence } |
| ExtractSource | 'jsonld' or 'llm' |
| ExtractOptions | { instruction?, render? } |

Lower-level building blocks are exported too, for advanced use: `extractFromStructuredData`, `htmlToMarkdown`, `cleanHtml`, `extractWithRouter`, and `verify`.

## Status

**v0.1.0 — scaffold.** The library core is complete: `tsc` is clean and the offline pipeline (JSON-LD, reduce, verify, cache, and the orchestrator) is covered by tests. Not yet covered: the live Firecrawl fetcher and the swoosh adapter, both of which need external resources. The package is unscoped (`pluck`) pending a final org/scope decision, and is not yet published to npm.
