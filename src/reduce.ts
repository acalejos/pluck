// reduce.ts — HTML → clean-markdown reduction.
//
// Goal: take raw, noisy page HTML (scripts, nav chrome, cookie banners, ad
// slots, SVG icon soup, etc.) and reduce it to compact markdown that preserves
// the semantic content an LLM actually needs to extract from — while throwing
// away the bulk of the tokens. This is a pure utility: it imports nothing from
// the project's types and has no side effects.

import { load, type CheerioAPI } from 'cheerio';
import TurndownService from 'turndown';

// Elements that are pure chrome/noise and never carry primary content. We drop
// them wholesale before doing anything else.
const STRIP_SELECTORS = [
  'script',
  'style',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  '[aria-hidden]',
  'svg',
  'iframe',
  'noscript',
].join(',');

// Class/id substrings that strongly signal boilerplate (navigation, cookie
// notices, ad slots, sidebars, newsletter prompts, etc.). Matched
// case-insensitively against both `class` and `id` attributes.
const NOISE_PATTERN = /nav|menu|cookie|banner|advert|ad-|sidebar|footer|subscribe|newsletter/i;

// Candidate containers for the page's primary content, in priority order. If
// one is present we keep only its subtree and discard the surrounding shell.
const MAIN_SELECTORS = ['main', 'article', '[role=main]'];

/**
 * Strip noise from raw HTML and return the cleaned HTML of the primary content
 * region. The result is still HTML (not markdown) — useful when a caller wants
 * the trimmed DOM rather than markdown.
 */
export function cleanHtml(html: string): string {
  const $ = load(html);

  // 1. Remove obvious non-content elements wholesale.
  $(STRIP_SELECTORS).remove();

  // 2. Remove anything whose class or id looks like boilerplate. We snapshot
  //    matches first because mutating the DOM while iterating is fragile.
  removeNoisyByClassOrId($);

  // 3. Prefer a dedicated main-content container if the page provides one.
  //    Falling back to <body>, then the whole document, keeps this robust on
  //    fragments and malformed input.
  const root = pickContentRoot($);

  return root.trim();
}

/**
 * Convert raw HTML to clean, compact markdown. Strips noise (via cleanHtml),
 * converts to markdown with turndown, and normalizes excessive blank lines.
 */
export function htmlToMarkdown(html: string): string {
  const cleaned = cleanHtml(html);

  const turndown = new TurndownService({
    headingStyle: 'atx', // "# Heading" rather than underlined — fewer chars, LLM-friendly.
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced', // ``` fences instead of indented blocks.
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined', // keep links inline so anchor text + href stay together.
  });

  // Drop any residual non-content nodes turndown might otherwise serialize.
  turndown.remove(['script', 'style', 'noscript', 'iframe']);

  const markdown = turndown.turndown(cleaned);

  return normalizeWhitespace(markdown);
}

// --- internal helpers -------------------------------------------------------

/**
 * Remove elements whose class or id matches the boilerplate pattern. Collected
 * up front so we don't mutate the set we're iterating over.
 */
function removeNoisyByClassOrId($: CheerioAPI): void {
  const noisy = $('[class], [id]')
    .filter((_, el) => {
      // `el` is an Element here; attribs is the raw attribute map.
      const attribs = (el as { attribs?: Record<string, string> }).attribs ?? {};
      const cls = attribs.class ?? '';
      const id = attribs.id ?? '';
      return NOISE_PATTERN.test(cls) || NOISE_PATTERN.test(id);
    })
    .toArray();

  for (const el of noisy) {
    $(el).remove();
  }
}

/**
 * Return the HTML of the best content root: the first present main-content
 * container, else <body>, else the whole document.
 */
function pickContentRoot($: CheerioAPI): string {
  for (const selector of MAIN_SELECTORS) {
    const match = $(selector).first();
    if (match.length > 0) {
      const inner = match.html();
      if (inner && inner.trim()) return inner;
    }
  }

  const body = $('body').first();
  if (body.length > 0) {
    const inner = body.html();
    if (inner && inner.trim()) return inner;
  }

  // Fragment / no <body>: fall back to whatever the root holds.
  return $.root().html() ?? '';
}

/**
 * Trim trailing per-line whitespace and collapse runs of 3+ blank lines down
 * to a single blank line (i.e. at most two consecutive newlines).
 */
function normalizeWhitespace(markdown: string): string {
  return markdown
    .replace(/[ \t]+$/gm, '') // strip trailing spaces/tabs per line
    .replace(/\n{3,}/g, '\n\n') // collapse 3+ newlines to a blank-line gap
    .trim();
}
