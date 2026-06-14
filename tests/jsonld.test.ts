import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { extractFromStructuredData } from '../src/jsonld.js';

const RECIPE_HTML = `<!doctype html>
<html>
  <head>
    <title>Grandma's Apple Pie</title>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Recipe",
      "name": "Grandma's Apple Pie",
      "description": "A classic double-crust apple pie.",
      "recipeIngredient": [
        "6 apples",
        "1 cup sugar",
        "2 tbsp flour"
      ],
      "recipeInstructions": [
        { "@type": "HowToStep", "text": "Peel and slice the apples." },
        { "@type": "HowToStep", "text": "Mix with sugar and flour." },
        { "@type": "HowToStep", "text": "Bake at 425F for 45 minutes." }
      ]
    }
    </script>
  </head>
  <body>
    <h1>Grandma's Apple Pie</h1>
  </body>
</html>`;

const recipeSchema = z.object({
  title: z.string(),
  ingredients: z.array(z.string()),
  steps: z.array(z.string()),
});

describe('extractFromStructuredData', () => {
  it('parses a schema.org Recipe JSON-LD block into the zod schema', () => {
    const result = extractFromStructuredData(RECIPE_HTML, recipeSchema);

    expect(result).not.toBeNull();
    const data = recipeSchema.parse(result!.data);

    expect(data.title).toBe("Grandma's Apple Pie");
    expect(data.ingredients).toEqual(['6 apples', '1 cup sugar', '2 tbsp flour']);
    expect(data.steps).toEqual([
      'Peel and slice the apples.',
      'Mix with sugar and flour.',
      'Bake at 425F for 45 minutes.',
    ]);
  });

  it('returns null when the page has no structured data', () => {
    const result = extractFromStructuredData('<html><body><p>no jsonld here</p></body></html>', recipeSchema);
    expect(result).toBeNull();
  });
});
