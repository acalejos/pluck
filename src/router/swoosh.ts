import type { Router, RouterRequest } from '../types.js';

/**
 * The seam: pluck owns crawl/verify/cache; swoosh-router owns *which model under
 * what policy*. pluck never names a model — it declares the capabilities a
 * request needs (here, structured output) via `requiresFeatures`, and the
 * router does capability filtering + model selection on its side.
 *
 * swoosh-router is a Promise-based, zero-dep model router. A router instance
 * exposes `run`/`plan` methods that return Promise<T> and reject with a
 * ModelRouterError. We adapt such an instance into pluck's Router interface.
 *
 * It is an OPTIONAL peer dependency: we never hard-import it at module top
 * level, so pluck builds and runs without it installed. The instance is passed
 * in by the caller; we only reach for a dynamic import() if we need a helper
 * (e.g. to recognize/unwrap a ModelRouterError) and we wrap that in try/catch.
 */

/** Subset of the swoosh-router request shape pluck cares about. */
interface SwooshRunRequest {
  content: string;
  jsonSchema: Record<string, unknown>;
  instruction?: string;
  /**
   * Capability requirements. ModelFeature is:
   *   "structured_output" | "tools" | "reasoning" | "attachments" | "web_search" | (string & {})
   * pluck always asks for "structured_output" here; callers may add more via
   * RouterRequest.requiresFeatures.
   */
  requiresFeatures: string[];
}

/** Structural view of a swoosh-router instance. Both methods are optional so we
 * can probe for whichever the instance actually implements. */
interface SwooshInstance {
  run?: (req: SwooshRunRequest) => Promise<unknown>;
  runText?: (req: SwooshRunRequest) => Promise<unknown>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Best-effort parse of whatever the router returned into the structured object.
 * Routers may return the object directly, a JSON string, or a wrapper such as
 * { data } / { output } / { result } / { content }.
 */
function parseStructured(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (isObject(raw)) {
    for (const key of ['data', 'output', 'result', 'content', 'object', 'json'] as const) {
      if (key in raw) return parseStructured(raw[key]);
    }
  }
  return raw;
}

export async function swooshRouter(instance: unknown): Promise<Router> {
  if (!isObject(instance)) {
    throw new TypeError(
      'swooshRouter(instance): expected a swoosh-router instance, received ' + typeof instance,
    );
  }

  const swoosh = instance as SwooshInstance;
  const run = typeof swoosh.run === 'function' ? swoosh.run.bind(swoosh) : undefined;
  const runText = typeof swoosh.runText === 'function' ? swoosh.runText.bind(swoosh) : undefined;

  if (!run && !runText) {
    // We only reach for the package if we couldn't make sense of the instance,
    // so we can give the user an actionable message. Dynamic, try/caught.
    try {
      // Optional peer dep: may be absent at build time. Dynamic + ts-ignored so
      // pluck compiles and runs without swoosh-router installed.
      // @ts-expect-error - swoosh-router is an optional peer dependency
      await import('swoosh-router');
      throw new Error(
        'swooshRouter(instance): the provided object exposes neither run() nor runText(). ' +
          'Pass an instance created by swoosh-router (e.g. createRouter(...)).',
      );
    } catch (err) {
      throw new Error(
        'swooshRouter(instance): no run()/runText() found and swoosh-router is not installed. ' +
          'Install it with `npm install swoosh-router` and pass a router instance.',
        { cause: err },
      );
    }
  }

  return {
    async extract(req: RouterRequest): Promise<unknown> {
      // Translate pluck's RouterRequest into a structured-output run request.
      // pluck declares capability needs; swoosh-router picks the model.
      const features = Array.from(
        new Set<string>(['structured_output', ...(req.requiresFeatures ?? [])]),
      );
      const swooshReq: SwooshRunRequest = {
        content: req.content,
        jsonSchema: req.jsonSchema,
        instruction: req.instruction,
        requiresFeatures: features,
      };

      // Prefer run() (structured); fall back to runText() if that's all there is.
      const raw = run ? await run(swooshReq) : await runText!(swooshReq);
      return parseStructured(raw);
    },
  };
}
