import { describe, it, expect, vi } from 'vitest';
import { callbackRouter, swooshRouter } from '../src/router/index.js';
import type { RouterRequest } from '../src/types.js';

const req = (over: Partial<RouterRequest> = {}): RouterRequest => ({
  content: 'the page text',
  jsonSchema: { type: 'object' },
  requiresFeatures: [],
  ...over,
});

describe('callbackRouter', () => {
  it('delegates extract() to the provided function', async () => {
    const fn = vi.fn(async () => ({ title: 'ok' }));
    const out = await callbackRouter(fn).extract(req());
    expect(out).toEqual({ title: 'ok' });
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe('swooshRouter', () => {
  it('rejects when given a non-object instance', async () => {
    await expect(swooshRouter(null)).rejects.toThrow(/expected a swoosh-router instance/);
  });

  it('adapts run() and always requires structured_output (deduped with caller features)', async () => {
    const run = vi.fn(async () => ({ title: 'hi' }));
    const r = await swooshRouter({ run });
    const out = await r.extract(req({ requiresFeatures: ['web_search', 'structured_output'] }));
    expect(out).toEqual({ title: 'hi' });

    const sent = run.mock.calls[0][0];
    expect(sent.content).toBe('the page text');
    expect(sent.requiresFeatures).toEqual(expect.arrayContaining(['structured_output', 'web_search']));
    expect(sent.requiresFeatures.filter((f: string) => f === 'structured_output')).toHaveLength(1);
  });

  it('parses a JSON-string return and unwraps a { data } envelope', async () => {
    const r1 = await swooshRouter({ run: async () => JSON.stringify({ a: 1 }) });
    expect(await r1.extract(req())).toEqual({ a: 1 });

    const r2 = await swooshRouter({ run: async () => ({ data: { b: 2 } }) });
    expect(await r2.extract(req())).toEqual({ b: 2 });
  });

  it('prefers run() over runText()', async () => {
    const run = vi.fn(async () => ({ via: 'run' }));
    const runText = vi.fn(async () => ({ via: 'runText' }));
    const r = await swooshRouter({ run, runText });
    expect(await r.extract(req())).toEqual({ via: 'run' });
    expect(runText).not.toHaveBeenCalled();
  });

  it('falls back to runText() when run() is absent', async () => {
    const r = await swooshRouter({ runText: async () => ({ via: 'runText' }) });
    expect(await r.extract(req())).toEqual({ via: 'runText' });
  });

  it('rejects with an actionable message when the instance has neither run nor runText', async () => {
    // swoosh-router is an (uninstalled) optional peer, so the dynamic import
    // also fails — the adapter reports that the instance was unusable.
    await expect(swooshRouter({})).rejects.toThrow(/run\(\)\/runText\(\)|swoosh-router is not installed/);
  });
});
