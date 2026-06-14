import * as cheerio from 'cheerio';
// The package's shared types live in './types'. This module's public contract
// is the zod schema, whose type (`ZodType`, re-typed below) comes from zod —
// matching the exported signature `import('zod').ZodType`. We only ever call
// `.safeParse` on it, so ZodType is sufficient.
import type { ZodType } from 'zod';

type Schema = ZodType;

/**
 * Schema.org -> common field aliases. Maps *candidate* keys (as they appear in
 * structured data) onto the *schema* keys a user is likely to define. Applied
 * case-insensitively. Keep this list small and high-signal.
 */
const SCHEMA_ORG_ALIASES: Record<string, string> = {
  name: 'title',
  headline: 'title',
  recipeingredient: 'ingredients',
  ingredients: 'ingredients',
  recipeinstructions: 'steps',
  instructions: 'steps',
  articlebody: 'body',
  description: 'description',
};

/** Lowercase a key for case-insensitive matching. */
function norm(key: string): string {
  return key.toLowerCase();
}

/**
 * Pull the displayable string out of a schema.org instruction/step node, which
 * may be a plain string, an object with `.text`/`.name`, or a list of those.
 */
function normalizeInstructions(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeInstructions).flat();
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // HowToSection wraps nested HowToStep items.
    if (Array.isArray(obj.itemListElement)) {
      return normalizeInstructions(obj.itemListElement);
    }
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.name === 'string') return obj.name;
  }
  return value;
}

/**
 * Flatten/normalize a single schema.org object so its fields line up with the
 * loose shapes users tend to define (arrays of strings, plain text, etc.).
 */
function normalizeSchemaOrg(node: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...node };

  // recipeInstructions / instructions can be rich step objects.
  if ('recipeInstructions' in out) out.recipeInstructions = normalizeInstructions(out.recipeInstructions);
  if ('instructions' in out) out.instructions = normalizeInstructions(out.instructions);

  // `image` is often an object or array of objects with a `url`.
  if (out.image && typeof out.image === 'object') {
    const img = Array.isArray(out.image) ? out.image[0] : out.image;
    if (img && typeof img === 'object' && 'url' in (img as object)) {
      out.image = (img as Record<string, unknown>).url;
    }
  }

  // Product price often lives under `offers`.
  if (out.offers && typeof out.offers === 'object') {
    const offer = Array.isArray(out.offers) ? out.offers[0] : out.offers;
    if (offer && typeof offer === 'object') {
      const o = offer as Record<string, unknown>;
      if (o.price != null && out.price == null) out.price = o.price;
      if (o.priceCurrency != null && out.priceCurrency == null) out.priceCurrency = o.priceCurrency;
    }
  }

  return out;
}

/**
 * Recursively walk an arbitrary JSON value, emitting every plain object that
 * looks like a structured-data record (has keys). Unwraps `@graph` containers
 * and arrays. This catches Recipe/Product/Article nodes wherever they are
 * nested (LD+JSON @graph, Next.js page props, etc.).
 */
function collectObjects(value: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (depth > 8 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, out, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj['@graph'])) {
      collectObjects(obj['@graph'], out, depth + 1);
    }
    // Record this object as a candidate.
    out.push(obj);
    // Descend into nested values to surface buried nodes (e.g. Next.js props).
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') collectObjects(v, out, depth + 1);
    }
  }
}

/** Safe JSON.parse that returns undefined instead of throwing. */
function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Gather candidate structured-data objects from the document, in priority
 * order: (a) ld+json blocks, (b) Next.js __NEXT_DATA__, (c) OG/twitter meta.
 */
function gatherCandidates($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];

  // (a) <script type="application/ld+json"> — tolerate arrays and @graph.
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    const parsed = tryParse(raw);
    if (parsed !== undefined) collectObjects(parsed, candidates);
  });

  // (b) Next.js __NEXT_DATA__ — descend into page props.
  const nextRaw = $('script#__NEXT_DATA__').contents().text();
  if (nextRaw.trim()) {
    const parsed = tryParse(nextRaw);
    if (parsed !== undefined) collectObjects(parsed, candidates);
  }

  // (c) OpenGraph / twitter meta tags as a flat fallback object.
  const meta: Record<string, unknown> = {};
  $('meta[property], meta[name]').each((_, el) => {
    const key = $(el).attr('property') ?? $(el).attr('name');
    const content = $(el).attr('content');
    if (!key || content == null) return;
    if (key.startsWith('og:') || key.startsWith('twitter:') || key.startsWith('article:')) {
      // Strip the namespace prefix so `og:title` -> `title`.
      const short = key.replace(/^(og:|twitter:|article:)/, '');
      if (meta[short] == null) meta[short] = content;
    }
  });
  if (Object.keys(meta).length > 0) candidates.push(meta);

  return candidates;
}

/**
 * Build a candidate object keyed to the schema's expected keys by matching
 * candidate keys case-insensitively, then applying schema.org aliases.
 *
 * Alias logic:
 *  1. Direct case-insensitive match: schema key `Title` matches candidate `title`.
 *  2. Aliased match: candidate key `name` (alias -> `title`) fills schema key `title`.
 * Direct matches win over aliased ones.
 */
function coerceToSchema(
  candidate: Record<string, unknown>,
  schemaKeys: string[],
): Record<string, unknown> {
  // Index the candidate by normalized key for O(1) lookups.
  const byNorm = new Map<string, unknown>();
  for (const [k, v] of Object.entries(candidate)) byNorm.set(norm(k), v);

  // Index alias-target -> candidate value (e.g. `title` -> value of `name`).
  const byAliasTarget = new Map<string, unknown>();
  for (const [k, v] of Object.entries(candidate)) {
    const target = SCHEMA_ORG_ALIASES[norm(k)];
    if (target && !byAliasTarget.has(norm(target))) byAliasTarget.set(norm(target), v);
  }

  const assembled: Record<string, unknown> = {};
  for (const schemaKey of schemaKeys) {
    const nk = norm(schemaKey);
    if (byNorm.has(nk)) {
      assembled[schemaKey] = byNorm.get(nk); // (1) direct match wins
    } else if (byAliasTarget.has(nk)) {
      assembled[schemaKey] = byAliasTarget.get(nk); // (2) aliased match
    }
  }
  return assembled;
}

/**
 * Best-effort extraction of the top-level keys a zod object schema expects, so
 * we know which candidate fields to assemble. Falls back to the candidate's own
 * keys when the schema shape can't be introspected (non-object schemas, etc.).
 */
function schemaKeysOf(schema: Schema): string[] | null {
  const def = (schema as unknown as { _def?: Record<string, unknown> })._def;
  const shape = def?.shape;
  if (typeof shape === 'function') {
    try {
      return Object.keys(shape());
    } catch {
      return null;
    }
  }
  if (shape && typeof shape === 'object') return Object.keys(shape as object);
  return null;
}

/**
 * JSON-LD fast path: try to satisfy `schema` directly from a page's structured
 * data without invoking an LLM. Returns `{ data }` on a successful parse, else
 * `null` so the caller can fall back to the router.
 */
export function extractFromStructuredData(
  html: string,
  schema: ZodType,
): { data: unknown } | null {
  const $ = cheerio.load(html);
  const rawCandidates = gatherCandidates($);
  if (rawCandidates.length === 0) return null;

  // Normalize each candidate (flatten schema.org shapes like Recipe/Product).
  const candidates = rawCandidates.map(normalizeSchemaOrg);
  const schemaKeys = schemaKeysOf(schema);

  for (const candidate of candidates) {
    // Map candidate -> schema keys (case-insensitive + aliases). When schema
    // keys are unknown, fall back to trying the candidate as-is.
    const assembled = schemaKeys ? coerceToSchema(candidate, schemaKeys) : candidate;
    const result = schema.safeParse(assembled);
    if (result.success) return { data: result.data };
  }

  return null;
}
