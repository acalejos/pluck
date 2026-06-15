# pluck

> Turn any website into a type-safe, verified API. Source: https://acalejos.github.io/pluck/ · Repo: https://github.com/acalejos/pluck

Hand pluck a URL and a schema. Get back a typed object where every field has been traced to the page it came from. No selectors. No scraping glue. No silent `any`.

```ts
import { createPluck } from 'pluck'
import { z } from 'zod'

const Recipe = z.object({
  title:       z.string(),
  ingredients: z.array(z.string()),
  minutes:     z.number(),
})

const client = createPluck({ router })

const res = await client.pluck(url, Recipe)
//        ^? ExtractResult<Recipe>

if (res.ok) {
  res.data.minutes   // number — verified ✓
  res.source          // 'jsonld' | 'llm'
}
```

## One call, six stages

`fetch → JSON-LD fast path → reduce → router extract → verify → cache`

- **Fetch** — Plain HTTP, or your self-hosted Firecrawl for JS-heavy pages.
- **JSON-LD (fast path)** — Reads schema.org & embedded data. Zero LLM, zero cost.
- **Reduce** — Strips the chrome. Clean markdown, not raw HTML.
- **Extract** — A router fills your schema. pluck never names the model.
- **Verify** — Traces every field back to the source. Sets a ratio.
- **Cache** — Keyed on content + schema. Unchanged page, no re-work.

## Why

- **Type-safe by contract, not by hope.** The schema is **yours**, and it's decoupled from the page's markup. A site can re-skin its entire layout — your `Recipe` type doesn't move, because pluck reads meaning, not CSS selectors.
- **Verified, not guessed.** An LLM will happily invent a price. pluck won't ship one. Every extracted field is traced back to a span in the page's own text and scored — the result carries a `verifiedRatio`.
- **Cheap on purpose.** The model call is the expensive part, so pluck avoids it whenever it can. Pages that already publish `schema.org` JSON-LD take the fast path — no tokens spent, no hallucination surface.
- **Swap any part. Keep the pipeline.** Fetcher, Router, and Cache are plain interfaces. Start on plain `fetch`; graduate to `firecrawlFetcher` against your own crawl stack. Mock the model with `callbackRouter`; wire real policy with `swooshRouter`.

## More

- Full docs: https://acalejos.github.io/pluck/docs.md
- Everything in one file: https://acalejos.github.io/pluck/llms-full.txt
- Repository: https://github.com/acalejos/pluck
