// 02-mock-extract.ts
//
// Offline. The LLM extraction path, with a mock router.
//
// When a page has no usable structured data, pluck reduces the HTML to
// markdown and hands it to a Router. The Router owns the model call; pluck owns
// everything around it (reduce, verify, cache). `callbackRouter` is the
// dependency-free adapter: you give it a function that takes a RouterRequest
// and returns the parsed object. Here that function is a fixture — no real
// model, no API key — so the example runs with `npx tsx`.
//
//   npx tsx examples/02-mock-extract.ts

import { z } from 'zod';
import { createPluck, callbackRouter } from '../src/index.js';
import type { Fetcher, FetchResult, RouterRequest } from '../src/index.js';

// A plain product page. No JSON-LD, no __NEXT_DATA__, no OG tags — so the
// JSON-LD fast path finds nothing and pluck falls through to the router.
const PRODUCT_HTML = `<!doctype html>
<html>
  <body>
    <h1>Aeron Chair</h1>
    <p class="price">$1,395</p>
    <p>An ergonomic office chair with adjustable lumbar support.</p>
  </body>
</html>`;

const mockFetcher: Fetcher = {
  async fetch(url: string): Promise<FetchResult> {
    return { url, status: 200, html: PRODUCT_HTML };
  },
};

const Product = z.object({
  title: z.string(),
  price: z.string(),
  description: z.string(),
});

// The router mock. In production this body would call a model with
// `req.content` (the page markdown) and `req.jsonSchema` (the JSON Schema
// derived from your zod schema) and return the model's structured output.
//
// We return values that ARE present in the page text on purpose: verification
// traces each leaf back to the source markdown, so grounded values pass and
// the result is `ok`. Change "$1,395" to "$999" below to watch verification
// reject the hallucinated field and return `{ ok: false }` with a partial.
const fixtureRouter = callbackRouter(async (req: RouterRequest) => {
  console.log('router received', req.content.length, 'chars of markdown');
  console.log('router asked for features:', req.requiresFeatures ?? '(none)');
  return {
    title: 'Aeron Chair',
    price: '$1,395',
    description: 'An ergonomic office chair with adjustable lumbar support.',
  };
});

async function main() {
  const client = createPluck({
    fetcher: mockFetcher,
    router: fixtureRouter,
  });

  const result = await client.pluck('https://example.com/aeron', Product, {
    instruction: 'Pull the product name, price, and a one-line description.',
  });

  if (!result.ok) {
    console.error('extraction failed:', result.reason);
    if (result.partial) console.error('partial:', result.partial);
    process.exitCode = 1;
    return;
  }

  console.log('source:', result.source); // -> "llm"
  console.log('data:', result.data);

  // Provenance: per-field, where did each value come from and was it grounded?
  console.log('\nprovenance (verifiedRatio =', result.provenance.verifiedRatio, ')');
  for (const [field, p] of Object.entries(result.provenance.fields)) {
    console.log(
      `  ${field}: found=${p.found} confidence=${p.confidence}` +
        (p.sourceSpan ? ` span="${p.sourceSpan}"` : ''),
    );
  }
}

main();
