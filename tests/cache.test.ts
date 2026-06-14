import { describe, it, expect } from 'vitest';
import { MemoryCache, hashContent, hashSchema, cacheKey } from '../src/cache.js';
import type { CachedExtraction } from '../src/types.js';

function sampleEntry(): CachedExtraction {
  return {
    data: { title: 'hello' },
    provenance: { fields: {}, verifiedRatio: 1 },
    contentHash: 'c',
    schemaHash: 's',
    source: 'llm',
    at: new Date(0).toISOString(),
  };
}

describe('MemoryCache', () => {
  it('roundtrips get/set', async () => {
    const cache = new MemoryCache();
    const key = cacheKey('content', 'schema');
    const entry = sampleEntry();

    expect(await cache.get(key)).toBeUndefined();
    await cache.set(key, entry);

    const hit = await cache.get(key);
    expect(hit).toEqual(entry);
    expect(hit?.data).toEqual({ title: 'hello' });
  });
});

describe('hashContent', () => {
  it('is stable for identical input', () => {
    expect(hashContent('the same bytes')).toBe(hashContent('the same bytes'));
  });

  it('differs on changed input', () => {
    expect(hashContent('input a')).not.toBe(hashContent('input b'));
  });
});

describe('hashSchema', () => {
  it('is order-independent (stable stringify)', () => {
    expect(hashSchema({ a: 1, b: 2 })).toBe(hashSchema({ b: 2, a: 1 }));
  });

  it('differs when the schema changes', () => {
    expect(hashSchema({ a: 1 })).not.toBe(hashSchema({ a: 2 }));
  });
});
