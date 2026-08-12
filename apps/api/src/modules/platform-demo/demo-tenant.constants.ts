/**
 * Compiled-in demo tenant identity.
 *
 * Reset and provisioning both target this slug. The HTTP reset endpoint
 * never accepts a tenant id/slug from the request. Schema migration only
 * adds Tenant.isDemo DEFAULT false — it does not assume wristos-demo exists.
 * Provisioning (CLI) sets isDemo=true on this slug. Reset fail-closes if
 * the row is missing or isDemo is false.
 */
export const DEMO_TENANT_SLUG = 'wristos-demo';
export const DEMO_TENANT_DEFAULT_NAME = 'Meridian Timepieces';
export const DEMO_SEED_ACTOR = 'demo-seed';
