// gen-docs.mjs — regenerate the agent-facing Markdown from the hand-written HTML
// so the two never drift. Run: `npm run docs` (after editing site/*.html).
//
// Outputs (in site/):
//   docs.md        <- docs.html  (full API docs)
//   index.md       <- index.html (landing summary)
//   llms.txt       <- the curated index below (links derive from BASE/REPO)
//   llms-full.txt  <- index.md + docs.md, concatenated
//
// The HTML is the single source of truth; these files are generated artifacts.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { load } from 'cheerio';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const BASE = 'https://acalejos.github.io/pluck';
const REPO = 'https://github.com/acalejos/pluck';

const td = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
  strongDelimiter: '**',
  linkStyle: 'inlined',
});
td.use(gfm);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const norm = (md) => md.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
const inline = (html) => td.turndown(html || '').replace(/\s+/g, ' ').trim();

// ---- docs.md (full API reference, from docs.html) --------------------------
function genDocsMd() {
  const $ = load(readFileSync(join(SITE, 'docs.html'), 'utf8'));
  const main = $('main.doc-main');

  main.find('.md-actions, .code-bar, .eyebrow').remove();
  main.find('h1').first().remove();
  main.find('p').filter((_, el) => $(el).text().includes('back to home')).remove();

  // Code panels use a bare <pre> with syntax <span>s (no <code>), which turndown
  // won't fence. Re-wrap the text in <pre><code> so it becomes a fenced block.
  main.find('.code').each((_, el) => {
    $(el).replaceWith(`<pre><code>${esc($(el).find('pre').text())}</code></pre>`);
  });

  // Signature boxes -> fenced ts blocks (so types read as code, not prose).
  main.find('.sig').each((_, el) => {
    $(el).replaceWith(`<pre><code>${esc($(el).text().trim())}</code></pre>`);
  });
  // Callouts -> blockquote with a bold label.
  main.find('.callout').each((_, el) => {
    const lbl = $(el).find('.lbl').text().trim();
    $(el).find('.lbl').remove();
    const body = $(el).text().replace(/\s+/g, ' ').trim();
    $(el).replaceWith(`<blockquote><strong>${esc(lbl)}</strong> ${esc(body)}</blockquote>`);
  });

  // A lone "|" in a table cell (e.g. the verify type) breaks the GFM table.
  main.find('table td, table th').each((_, el) => {
    const h = $(el).html();
    if (h && h.includes('|')) $(el).html(h.replace(/\s*\|\s*/g, ' or '));
  });

  const body = norm(td.turndown(main.html() || ''));
  return `# pluck — documentation\n\n> Source: ${BASE}/docs.html · Repo: ${REPO}\n\n${body}\n`;
}

// ---- index.md (landing summary, from index.html) ---------------------------
function genIndexMd() {
  const $ = load(readFileSync(join(SITE, 'index.html'), 'utf8'));
  const lede = inline($('.hero .lede').html());
  const heroCode = $('.hero .code pre').text().trim();

  const steps = $('.pipe-step')
    .map((_, el) => {
      const t = $(el).find('.t').text().trim();
      const d = $(el).find('.d').text().trim();
      const fast = $(el).hasClass('fast') ? ' (fast path)' : '';
      return `- **${t}${fast}** — ${d}`;
    })
    .get()
    .join('\n');

  const why = $('.feature')
    .map((_, el) => {
      const h = $(el).find('h2').text().trim().replace(/\.$/, '');
      const p = inline($(el).find('.body p').first().html());
      return `- **${h}.** ${p}`;
    })
    .get()
    .join('\n');

  return [
    '# pluck',
    '',
    `> Turn any website into a type-safe, verified API. Source: ${BASE}/ · Repo: ${REPO}`,
    '',
    lede,
    '',
    '```ts',
    heroCode,
    '```',
    '',
    '## One call, six stages',
    '',
    '`fetch → JSON-LD fast path → reduce → router extract → verify → cache`',
    '',
    steps,
    '',
    '## Why',
    '',
    why,
    '',
    '## More',
    '',
    `- Full docs: ${BASE}/docs.md`,
    `- Everything in one file: ${BASE}/llms-full.txt`,
    `- Repository: ${REPO}`,
    '',
  ].join('\n');
}

// ---- llms.txt (curated index; links derive from BASE/REPO) -----------------
function genLlmsTxt() {
  const examples = [
    ['01-jsonld-recipe', 'The zero-LLM JSON-LD fast path — extract a typed recipe from schema.org data with no model call.'],
    ['02-mock-extract', 'The LLM path with a mock callbackRouter, showing the typed result and per-field provenance.'],
    ['03-swoosh', 'Real-world wiring — a swoosh-router for model policy plus a self-hosted Firecrawl fetcher.'],
  ];
  return [
    '# pluck',
    '',
    '> Turn any website into a type-safe, verified API. You bring a Zod schema; pluck fetches the page, fills the schema, traces every field back to the source it came from, and caches the result. pluck owns the crawl, verify, and cache — the model call is pluggable.',
    '',
    'pluck is an ESM, TypeScript-first library. A single `pluck(url, schema)` call runs a six-stage pipeline — fetch → JSON-LD fast path → reduce → router extract → verify → cache — and resolves to a discriminated `ExtractResult<T>` (never an untyped blob, never a thrown error). Pages that publish `schema.org` JSON-LD skip the model entirely. The model call is delegated to a pluggable `Router`; [swoosh-router](https://github.com/acalejos/swoosh) is the recommended policy layer.',
    '',
    '## Docs',
    `- [Landing](${BASE}/index.md): What pluck is, the six-stage pipeline, and why (type-safe by contract, verified not guessed, cheap by default, swappable seams).`,
    `- [Documentation](${BASE}/docs.md): Install, quickstart, concepts (pipeline, ExtractResult, verification, JSON-LD fast path, caching), the full API (createPluck, pluck & define, default client, PluckConfig), the Fetcher/Router/Cache seams, and the types reference.`,
    '',
    '## Examples',
    ...examples.map(([f, d]) => `- [${f}](${REPO}/blob/main/examples/${f}.ts): ${d}`),
    '',
    '## Optional',
    `- [llms-full.txt](${BASE}/llms-full.txt): the entire documentation — landing and full docs — in a single file.`,
    `- [GitHub repository](${REPO})`,
    '',
  ].join('\n');
}

// ---- write everything ------------------------------------------------------
const docsMd = genDocsMd();
const indexMd = genIndexMd();
const llmsTxt = genLlmsTxt();
const llmsFull = `# pluck — full documentation\n\n> Generated from the pluck site (landing + docs) as a single file for LLMs. Source: ${BASE}/ · Repo: ${REPO}\n\n---\n\n${indexMd}\n---\n\n${docsMd}`;

writeFileSync(join(SITE, 'docs.md'), docsMd);
writeFileSync(join(SITE, 'index.md'), indexMd);
writeFileSync(join(SITE, 'llms.txt'), llmsTxt);
writeFileSync(join(SITE, 'llms-full.txt'), llmsFull);

console.log('Generated: docs.md, index.md, llms.txt, llms-full.txt');
