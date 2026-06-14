// 01-jsonld-recipe.ts
//
// Offline. The zero-LLM JSON-LD fast path.
//
// Many pages already embed structured data in a
// <script type="application/ld+json"> block. When that data satisfies your
// schema and traces back to the page's visible text, pluck returns it directly
// — no router, no model call, no API key. This example feeds canned HTML
// through a mock fetcher so the whole thing runs with `npx tsx`.
//
//   npx tsx examples/01-jsonld-recipe.ts

import { z } from 'zod';
import { createPluck } from '../src/index.js';
import type { Fetcher, FetchResult } from '../src/index.js';

// A canned page carrying a schema.org Recipe in JSON-LD, plus visible text
// that matches it (the visible text is what verification traces against).
const RECIPE_HTML = `<!doctype html>
<html>
  <head>
    <title>Olive Oil Cake</title>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Recipe",
      "name": "Olive Oil Cake",
      "description": "A moist, citrus-scented olive oil cake.",
      "recipeIngredient": [
        "1 cup olive oil",
        "1.5 cups sugar",
        "3 eggs",
        "2 cups flour"
      ],
      "recipeInstructions": [
        { "@type": "HowToStep", "text": "Heat the oven to 350 degrees." },
        { "@type": "HowToStep", "text": "Whisk the oil, sugar, and eggs." },
        { "@type": "HowToStep", "text": "Fold in the flour and bake for 45 minutes." }
      ]
    }
    </script>
  </head>
  <body>
    <h1>Olive Oil Cake</h1>
    <p>A moist, citrus-scented olive oil cake.</p>
    <h2>Ingredients</h2>
    <ul>
      <li>1 cup olive oil</li>
      <li>1.5 cups sugar</li>
      <li>3 eggs</li>
      <li>2 cups flour</li>
    </ul>
    <h2>Steps</h2>
    <ol>
      <li>Heat the oven to 350 degrees.</li>
      <li>Whisk the oil, sugar, and eggs.</li>
      <li>Fold in the flour and bake for 45 minutes.</li>
    </ol>
  </body>
</html>`;

// A Fetcher is the only network seam. Here it ignores the URL and returns the
// canned page, so nothing leaves the machine.
const mockFetcher: Fetcher = {
  async fetch(url: string): Promise<FetchResult> {
    return { url, status: 200, html: RECIPE_HTML };
  },
};

// The schema you want back. Note the keys: schema.org `recipeIngredient` and
// `recipeInstructions` are aliased onto `ingredients` / `steps` for you.
const Recipe = z.object({
  title: z.string(),
  description: z.string(),
  ingredients: z.array(z.string()),
  steps: z.array(z.string()),
});

async function main() {
  const client = createPluck({ fetcher: mockFetcher });

  const result = await client.pluck('https://example.com/olive-oil-cake', Recipe);

  if (!result.ok) {
    console.error('extraction failed:', result.reason);
    process.exitCode = 1;
    return;
  }

  // `result.data` is typed as z.infer<typeof Recipe>.
  console.log('source:', result.source); // -> "jsonld" (no LLM was used)
  console.log('cached:', result.cached); // -> false (first call)
  console.log('verifiedRatio:', result.provenance.verifiedRatio);
  console.log('title:', result.data.title);
  console.log('ingredients:', result.data.ingredients.length, 'items');
  console.log(JSON.stringify(result.data, null, 2));
}

main();
