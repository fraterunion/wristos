/**
 * Entity *Id values from the LLM (or free-form user text) are never trusted.
 * Trusted IDs enter the orchestrator only via ReferenceResolver / workspace context.
 */
const UNTRUSTED_ID_KEY = /^(.*[Ii]d|id)$/;

export function stripUntrustedEntityIds(
  entities: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(entities)) {
    if (UNTRUSTED_ID_KEY.test(key)) continue;
    out[key] = value;
  }
  return out;
}

export function mergeTrustedIds(
  entities: Record<string, string | number | boolean>,
  trusted: Record<string, string>,
): Record<string, string | number | boolean> {
  return { ...entities, ...trusted };
}
