// pluck.ts — the orchestrator.
//
// Ties the modules together into the public client: fetch → (JSON-LD fast path
// | reduce + router) → verify → cache. pluck owns crawl/reduce/verify/cache;
// the Router owns the model call. Every public method resolves to an
// ExtractResult discriminated union — thrown errors become { ok:false }.

import type { ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import type {
  PluckConfig,
  ExtractOptions,
  ExtractResult,
  Provenance,
  ExtractSource,
  VerifyConfig,
  CachedExtraction,
} from './types.js';
import { plainFetcher } from './fetch/plain.js';
import { extractFromStructuredData } from './jsonld.js';
import { htmlToMarkdown } from './reduce.js';
import { extractWithRouter } from './extract.js';
import { verify } from './verify.js';
import { hashContent, hashSchema, cacheKey } from './cache.js';

/** Default verification threshold: at least half of leaf fields traced back. */
const DEFAULT_MIN_RATIO = 0.5;

/**
 * The public pluck client. Created via {@link createPluck}.
 */
export interface PluckClient {
  /**
   * Extract structured, schema-typed data from `url`, verified against the
   * page's own content. Never throws — failures resolve to { ok:false }.
   */
  pluck<T>(
    url: string,
    schema: ZodType<T>,
    opts?: ExtractOptions,
  ): Promise<ExtractResult<T>>;

  /**
   * Bind a schema (and options) up front, yielding a reusable extractor.
   */
  define<T>(
    schema: ZodType<T>,
    opts?: ExtractOptions,
  ): { extract(url: string): Promise<ExtractResult<T>> };
}

/** Resolve the verify config into { enabled, minRatio }. Defaults: on, 0.5. */
function resolveVerify(verifyCfg: PluckConfig['verify']): {
  enabled: boolean;
  minRatio: number;
} {
  if (verifyCfg === false) return { enabled: false, minRatio: DEFAULT_MIN_RATIO };
  if (verifyCfg === undefined || verifyCfg === true) {
    return { enabled: true, minRatio: DEFAULT_MIN_RATIO };
  }
  const cfg = verifyCfg as VerifyConfig;
  return { enabled: true, minRatio: cfg.minRatio ?? DEFAULT_MIN_RATIO };
}

/**
 * Create a pluck client bound to the given configuration.
 */
export function createPluck(config: PluckConfig = {}): PluckClient {
  const fetcher = config.fetcher ?? plainFetcher;
  const { enabled: verifyEnabled, minRatio } = resolveVerify(config.verify);

  async function pluck<T>(
    url: string,
    schema: ZodType<T>,
    opts?: ExtractOptions,
  ): Promise<ExtractResult<T>> {
    try {
      // Identity of the schema, stable across key ordering.
      const jsonSchema = zodToJsonSchema(schema) as Record<string, unknown>;
      const schemaHash = hashSchema(jsonSchema);

      // 1. Fetch the page (honoring an explicit render request).
      const fetched = await fetcher.fetch(url, { render: opts?.render });
      const html = fetched.html ?? '';
      const contentHash = hashContent(html);

      const key = cacheKey(contentHash, schemaHash);

      // 2. Cache lookup: an unchanged (content, schema) pair is a guaranteed hit.
      if (config.cache) {
        const hit = await config.cache.get(key);
        if (hit) {
          return {
            ok: true,
            data: hit.data as T,
            provenance: hit.provenance,
            cached: true,
            source: hit.source,
          };
        }
      }

      // 3. Choose data + the content we verify it against.
      let data: unknown;
      let source: ExtractSource;
      let verifyContent: string;

      const jsonLdResult =
        config.jsonLdFirst !== false ? extractFromStructuredData(html, schema) : null;

      // The text we trace JSON-LD claims against is the page's visible markdown.
      const htmlMarkdown = htmlToMarkdown(html);

      let acceptedJsonLd = false;
      if (jsonLdResult) {
        // Provisionally verify the JSON-LD data against the page's own text.
        const provisional = verify(jsonLdResult.data, htmlMarkdown);
        // If verification is off, accept JSON-LD outright; otherwise it must
        // clear the threshold to be trusted (structured data can lie / drift).
        if (!verifyEnabled || provisional.verifiedRatio >= minRatio) {
          data = jsonLdResult.data;
          source = 'jsonld';
          verifyContent = htmlMarkdown;
          acceptedJsonLd = true;
        }
      }

      if (!acceptedJsonLd) {
        // 4. LLM path: reduce to markdown and delegate to the router.
        if (!config.router) {
          return {
            ok: false,
            reason:
              'No structured data satisfied the schema and no router is configured. ' +
              'Pass a router (callbackRouter/swooshRouter) via PluckConfig.router to enable LLM extraction.',
          };
        }
        const markdown = htmlMarkdown;
        const extracted = await extractWithRouter(markdown, schema, config.router, {
          instruction: opts?.instruction,
        });
        data = extracted.data;
        source = 'llm';
        verifyContent = markdown;
      }

      // 5. Verify the chosen data against its source content.
      const provenance: Provenance = verify(data, verifyContent!);

      if (verifyEnabled && provenance.verifiedRatio < minRatio) {
        return {
          ok: false,
          reason:
            `Extraction failed verification: ${Math.round(provenance.verifiedRatio * 100)}% of ` +
            `fields traced to the source (need ${Math.round(minRatio * 100)}%).`,
          partial: data as Partial<T>,
        };
      }

      // 6. Persist and return.
      const cached: CachedExtraction = {
        data,
        provenance,
        contentHash,
        schemaHash,
        source: source!,
        at: new Date().toISOString(),
      };
      if (config.cache) {
        await config.cache.set(key, cached);
      }

      return {
        ok: true,
        data: data as T,
        provenance,
        cached: false,
        source: source!,
      };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  function define<T>(
    schema: ZodType<T>,
    opts?: ExtractOptions,
  ): { extract(url: string): Promise<ExtractResult<T>> } {
    return {
      extract(url: string): Promise<ExtractResult<T>> {
        return pluck(url, schema, opts);
      },
    };
  }

  return { pluck, define };
}
