// 03-swoosh.ts
//
// The real-world setup: a swoosh-router for model policy + a self-hosted
// Firecrawl fetcher for JS-rendered pages.
//
// This file documents the production wiring. It is NOT meant to run without
// configuration — it needs a swoosh-router instance and a reachable Firecrawl
// deployment. The `if (...)` guard below makes it a no-op (with a printed hint)
// when the environment isn't set up, so you can still `npx tsx` it safely.
//
//   PLUCK_FIRECRAWL_URL=http://localhost:3002 \
//   PLUCK_FIRECRAWL_KEY=... \
//   npx tsx examples/03-swoosh.ts

import { z } from 'zod';
import {
  createPluck,
  swooshRouter,
  firecrawlFetcher,
  MemoryCache,
} from '../src/index.js';

const Article = z.object({
  title: z.string(),
  author: z.string(),
  body: z.string(),
});

async function main() {
  // pluck never names a model. It declares the capabilities a request needs
  // ("structured_output") and hands the request to the router, which does
  // capability filtering + model selection on its side. You construct the swoosh
  // instance however your deployment dictates — the line below is illustrative:
  //
  //   import { createRouter } from 'swoosh-router';
  //   const swoosh = createRouter({
  //     providers: { anthropic: { apiKey: process.env.ANTHROPIC_API_KEY } },
  //     policy: { /* your cost / latency / capability policy */ },
  //   });
  //
  //   const router = await swooshRouter(swoosh);
  //
  // `swooshRouter` adapts a swoosh instance (its run()/runText() method) into
  // pluck's Router interface. It is an optional peer dependency: pluck builds
  // and runs without swoosh-router installed.

  // The fetcher seam. firecrawlFetcher targets a SELF-HOSTED, Firecrawl-
  // compatible instance — there is no public default, so a baseUrl is required
  // (here read from PLUCK_FIRECRAWL_URL). Firecrawl renders JS and returns
  // clean HTML + markdown, which is what you want for SPA / client-rendered
  // pages that the plain fetcher can't see.
  if (!process.env.PLUCK_FIRECRAWL_URL) {
    console.log(
      'Set PLUCK_FIRECRAWL_URL (and optionally PLUCK_FIRECRAWL_KEY) and wire a\n' +
        'swoosh-router instance to run this example. See the comments above.',
    );
    return;
  }

  const fetcher = firecrawlFetcher({
    baseUrl: process.env.PLUCK_FIRECRAWL_URL,
    apiKey: process.env.PLUCK_FIRECRAWL_KEY,
  });

  // --- wire your swoosh instance here ---------------------------------------
  // const { createRouter } = await import('swoosh-router');
  // const swoosh = createRouter({ /* providers + policy */ });
  // const router = await swooshRouter(swoosh);
  //
  // For the purposes of this scaffold we stop short of constructing a real
  // router; uncomment the lines above once your swoosh deployment is ready.
  void swooshRouter;

  const client = createPluck({
    fetcher,
    // router,                 // <- the swoosh-backed router from above
    cache: new MemoryCache(), // re-extraction is free when content is unchanged
    verify: { minRatio: 0.6 }, // require 60% of fields to trace to the source
  });

  // The JSON-LD fast path still runs first even with a router configured — the
  // router is only reached when structured data doesn't satisfy the schema.
  const result = await client.pluck('https://example.com/some-article', Article, {
    render: true, // ask the fetcher to render JS for this call
    instruction: 'Extract the article title, author, and body text.',
  });

  console.log(result.ok ? result.data : `failed: ${result.reason}`);
}

main();
