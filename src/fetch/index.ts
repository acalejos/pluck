// Fetcher tier: plain network fetch, self-hosted Firecrawl rendering,
// and a tiered composition that escalates from one to the other.
export { plainFetcher } from './plain.js';
export { firecrawlFetcher } from './firecrawl.js';
export { tieredFetcher } from './tiered.js';
