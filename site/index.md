# pluck

> Turn any website into a type-safe, verified API. Source: https://acalejos.github.io/pluck/ · Repo: https://github.com/acalejos/pluck

Hand pluck a URL and a schema. Get back a typed object where every field has been traced to the page it came from. No selectors, no scraping glue, no silent `any`.

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
//    ^? ExtractResult<Recipe>

if (res.ok) {
  res.data.minutes   // number — verified ✓
  res.source         // 'jsonld' | 'llm'
}
```

## One call, six stages

`fetch → JSON-LD fast path → reduce → router extract → verify → cache`

- **Fetch** — plain HTTP, or your self-hosted Firecrawl for JS-heavy pages.
- **JSON-LD (fast path)** — reads schema.org & embedded data. Zero LLM, zero cost. Most recipe, product, and article pages take this path.
- **Reduce** — strips the chrome; clean markdown, not raw HTML.
- **Extract** — a router fills your schema. pluck never names the model.
- **Verify** — traces every field back to the source and sets a ratio.
- **Cache** — keyed on content + schema. Unchanged page, no re-work.

## Why

- **Type-safe by contract.** The schema is yours and decoupled from the page's markup. Every call resolves to a discriminated `ExtractResult<T>` — never an untyped blob.
- **Verified, not guessed.** Every extracted field is traced to a span in the page's own text and scored. Fall below the threshold and you get `{ ok: false }` with the partial, not a confident fabrication.
- **Cheap on purpose.** JSON-LD fast path spends no tokens; LLM results are cached on a content + schema hash.
- **Swap any part.** `Fetcher`, `Router`, and `Cache` are plain interfaces. swoosh ([swoosh-router](https://github.com/acalejos/swoosh)) owns model policy; pluck owns crawl, verify, and cache.

## More

- Full docs: https://acalejos.github.io/pluck/docs.md
- Everything in one file: https://acalejos.github.io/pluck/llms-full.txt
- Repository: https://github.com/acalejos/pluck
