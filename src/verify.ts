import type { Provenance, FieldProvenance } from './types.js';

/**
 * Source-trace verification.
 *
 * This is the function that turns "the LLM guessed" into "verified": an
 * extractor (LLM or JSON-LD) hands us a structured object, and we have no a
 * priori reason to trust it. Here we walk every leaf scalar the model emitted
 * and check it against the *actual* source content it claims to have read. A
 * field that doesn't appear in the source is, by definition, unsupported —
 * a hallucination or an inference we can't back. `verifiedRatio` then gives a
 * single number for "how much of this extraction is grounded in the source."
 */

const SNIPPET_RADIUS = 30;

/**
 * Normalize text for comparison: lowercase, collapse all whitespace runs to a
 * single space, and lightly strip punctuation. We keep alphanumerics, spaces,
 * and a few in-token characters (., -, %, /) so numbers and units survive
 * ("1.5", "350-degree", "9/13"). Everything else (quotes, commas, parens,
 * etc.) becomes a space so it doesn't block a substring match.
 */
function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9.\-%/\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A scalar is anything we can render to a single token of text. */
function isScalar(v: unknown): v is string | number | boolean {
  return (
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean'
  );
}

/** Tokenize normalized text into word-ish tokens for fuzzy overlap. */
function tokenize(s: string): string[] {
  return s.split(' ').filter((t) => t.length > 0);
}

/**
 * Extract a short snippet of the (original) source surrounding a normalized
 * match. We search the normalized source for the index, then map back onto a
 * window of the original content so the snippet is human-readable.
 */
function snippetAround(
  original: string,
  normalizedSource: string,
  normalizedNeedle: string
): string | undefined {
  const idx = normalizedSource.indexOf(normalizedNeedle);
  if (idx < 0) return undefined;
  // Normalization is roughly length-preserving in index terms because we
  // replace each stripped char with a space (1:1) and only collapse runs.
  // The collapse can shift indices, so we clamp generously and trust the
  // window to still contain the value.
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(
    original.length,
    idx + normalizedNeedle.length + SNIPPET_RADIUS
  );
  const slice = original.slice(start, end).replace(/\s+/g, ' ').trim();
  const prefix = start > 0 ? '…' : '';
  const suffix = end < original.length ? '…' : '';
  return `${prefix}${slice}${suffix}`;
}

/**
 * Verify a single leaf value against the source.
 *
 * Confidence rubric:
 *   1.0  exact match — the normalized value (or, for numbers, the numeric
 *        token) appears verbatim as a substring of the normalized source.
 *   ~0.5 fuzzy match — not a verbatim substring, but a majority of the
 *        value's tokens (>= 60%, multi-token only) are individually present
 *        in the source. Scaled by the actual overlap fraction so a barely-
 *        passing match lands near 0.5 and a near-miss-of-exact lands higher.
 *   0.0  absent — no substring and insufficient token overlap.
 */
function verifyLeaf(
  value: unknown,
  normalizedSource: string,
  originalSource: string
): FieldProvenance {
  const raw = String(value);

  // Numbers: match on the numeric token specifically. We normalize the
  // number's own string form (handles ints and decimals) and look for it
  // as a standalone-ish token in the source.
  if (typeof value === 'number') {
    const numStr = normalize(String(value));
    if (numStr.length > 0) {
      // Word-boundary-ish check so "5" doesn't match inside "section 350"
      // or as part of a decimal like "4.5". A trailing sentence period is
      // fine ("serves 4."), so the lookahead only rejects a dot that is
      // itself followed by a digit (i.e. part of a larger number).
      const re = new RegExp(
        `(?<![0-9])(?<!\\.[0-9])${escapeRegex(numStr)}(?![0-9])(?!\\.[0-9])`
      );
      if (re.test(normalizedSource)) {
        return {
          value,
          found: true,
          confidence: 1,
          sourceSpan: snippetAround(originalSource, normalizedSource, numStr),
        };
      }
    }
    return { value, found: false, confidence: 0 };
  }

  const needle = normalize(raw);

  // Empty / whitespace-only values can't be meaningfully traced; treat as
  // unverifiable rather than spuriously "found" against an empty match.
  if (needle.length === 0) {
    return { value, found: false, confidence: 0 };
  }

  // Exact substring match → confidence 1.
  if (normalizedSource.includes(needle)) {
    return {
      value,
      found: true,
      confidence: 1,
      sourceSpan: snippetAround(originalSource, normalizedSource, needle),
    };
  }

  // Fuzzy / token-overlap match → confidence ~0.5 (multi-token values only).
  const tokens = tokenize(needle);
  if (tokens.length > 1) {
    const sourceTokens = new Set(tokenize(normalizedSource));
    const hits = tokens.filter((t) => sourceTokens.has(t)).length;
    const overlap = hits / tokens.length;
    if (overlap >= 0.6) {
      // Center confidence around 0.5, nudged by how complete the overlap is.
      const confidence = Math.round((0.5 + (overlap - 0.6) * 0.5) * 100) / 100;
      // Anchor the snippet on the longest present token for context.
      const anchor =
        tokens
          .filter((t) => sourceTokens.has(t))
          .sort((a, b) => b.length - a.length)[0] ?? tokens[0];
      return {
        value,
        found: true,
        confidence,
        sourceSpan: snippetAround(originalSource, normalizedSource, anchor),
      };
    }
  }

  // Absent.
  return { value, found: false, confidence: 0 };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Recursively walk `data`, invoking `onLeaf` for every scalar leaf with its
 * dotted/bracketed key path (e.g. "ingredients[0].item"). Objects and arrays
 * are descended into; null/undefined are ignored (nothing to verify).
 */
function walk(
  node: unknown,
  path: string,
  onLeaf: (path: string, value: unknown) => void
): void {
  if (node === null || node === undefined) return;

  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, `${path}[${i}]`, onLeaf));
    return;
  }

  if (isScalar(node)) {
    onLeaf(path, node);
    return;
  }

  if (typeof node === 'object') {
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      walk(val, childPath, onLeaf);
    }
    return;
  }

  // Functions, symbols, bigint, etc. — not part of extracted JSON; skip.
}

/**
 * Verify a structured extraction against its source content, producing a
 * per-field provenance record and an overall verified ratio.
 *
 * Pure function: no I/O, no mutation of inputs, deterministic for given args.
 */
export function verify(data: unknown, sourceContent: string): Provenance {
  const normalizedSource = normalize(sourceContent);
  const fields: Record<string, FieldProvenance> = {};

  let total = 0;
  let found = 0;

  walk(data, '', (path, value) => {
    total += 1;
    const fp = verifyLeaf(value, normalizedSource, sourceContent);
    if (fp.found) found += 1;
    fields[path] = fp;
  });

  // No leaves means there is nothing to contradict the source — vacuously
  // verified (ratio 1) rather than a divide-by-zero NaN.
  const verifiedRatio = total === 0 ? 1 : found / total;

  return { fields, verifiedRatio };
}
