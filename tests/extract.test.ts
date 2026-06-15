import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { extractWithRouter } from '../src/extract.js';
import { callbackRouter } from '../src/router/index.js';

const schema = z.object({ title: z.string(), n: z.number() });

describe('extractWithRouter', () => {
  it('hands the router a JSON schema + structured_output and returns validated data', async () => {
    const fn = vi.fn(async () => ({ title: 'x', n: 3 }));
    const out = await extractWithRouter('content', schema, callbackRouter(fn));
    expect(out.data).toEqual({ title: 'x', n: 3 });

    const r = fn.mock.calls[0][0];
    expect(r.requiresFeatures).toEqual(['structured_output']);
    expect(r.jsonSchema).toBeTypeOf('object');
    expect(r.instruction).toMatch(/Extract the data/);
  });

  it('throws schema-validation errors when the router returns the wrong shape', async () => {
    const fn = async () => ({ title: 'x' }); // missing `n`
    await expect(extractWithRouter('content', schema, callbackRouter(fn))).rejects.toThrow(
      /schema validation/,
    );
  });

  it('forwards a custom instruction', async () => {
    const fn = vi.fn(async () => ({ title: 'x', n: 1 }));
    await extractWithRouter('content', schema, callbackRouter(fn), { instruction: 'CUSTOM' });
    expect(fn.mock.calls[0][0].instruction).toBe('CUSTOM');
  });
});
