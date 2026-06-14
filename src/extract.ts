import type { ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Router } from './types.js';

const DEFAULT_INSTRUCTION =
  'Extract the data described by the schema from the content. Use null for fields not present.';

/**
 * Extract structured data from `content` by delegating to a swoosh Router.
 *
 * swoosh composition: this function deliberately does NOT pick a model, provider,
 * temperature, or prompt-wrapping strategy. It only declares the *shape* it
 * needs (via JSON Schema) and the *capability* it requires
 * (`structured_output`). The Router owns model choice and any escalation when
 * validation fails — pluck just states intent and validates the result.
 */
export async function extractWithRouter(
  content: string,
  schema: ZodType,
  router: Router,
  opts?: { instruction?: string },
): Promise<{ data: unknown }> {
  // Convert the zod schema to JSON Schema so the router can hand a
  // provider-agnostic structured-output spec to whichever model it selects.
  const jsonSchema = zodToJsonSchema(schema) as Record<string, unknown>;

  const value = await router.extract({
    content,
    jsonSchema,
    instruction: opts?.instruction ?? DEFAULT_INSTRUCTION,
    requiresFeatures: ['structured_output'],
  });

  // Validate against the source of truth (the zod schema). On failure we throw
  // with the concrete issues so the caller/router can decide to escalate
  // (e.g. retry with a stronger model).
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Router extraction failed schema validation: ${JSON.stringify(parsed.error.issues)}`,
    );
  }

  return { data: parsed.data };
}
