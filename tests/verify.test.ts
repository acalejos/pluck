import { describe, it, expect } from 'vitest';
import { verify } from '../src/verify.js';

const SOURCE = `Grandma's Apple Pie

A classic double-crust apple pie made with fresh apples.

Ingredients:
- 6 apples
- 1 cup sugar
- 2 tbsp flour

Bake at 425 degrees for 45 minutes.`;

describe('verify', () => {
  it('marks fields that appear in the source as present (high ratio)', () => {
    const data = {
      title: "Grandma's Apple Pie",
      ingredients: ['6 apples', '1 cup sugar', '2 tbsp flour'],
      bakeMinutes: 45,
    };

    const prov = verify(data, SOURCE);

    expect(prov.verifiedRatio).toBeGreaterThanOrEqual(0.9);
    expect(prov.fields['title'].found).toBe(true);
    expect(prov.fields['ingredients[0]'].found).toBe(true);
    expect(prov.fields['bakeMinutes'].found).toBe(true);
  });

  it('flags a fabricated value as not found, dropping the ratio', () => {
    const fabricated = {
      title: "Grandma's Apple Pie",
      ingredients: ['6 apples', '1 cup sugar', '2 tbsp flour'],
      secretIngredient: 'powdered unicorn horn',
      caloriesPerServing: 99999,
    };

    const prov = verify(fabricated, SOURCE);

    expect(prov.fields['secretIngredient'].found).toBe(false);
    expect(prov.fields['secretIngredient'].confidence).toBe(0);
    expect(prov.fields['caloriesPerServing'].found).toBe(false);

    // Grounded fields still verify, but the two fabricated ones drag the ratio
    // below a perfect score relative to an all-grounded extraction.
    const grounded = verify(
      {
        title: "Grandma's Apple Pie",
        ingredients: ['6 apples', '1 cup sugar', '2 tbsp flour'],
      },
      SOURCE,
    );
    expect(prov.verifiedRatio).toBeLessThan(grounded.verifiedRatio);
  });
});
