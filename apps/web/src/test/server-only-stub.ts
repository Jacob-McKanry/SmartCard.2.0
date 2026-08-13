/**
 * Stands in for the `server-only` package under Vitest.
 *
 * `server-only` protects against a real mistake — importing a module that holds
 * the service-role key from a Client Component, which would ship it to a
 * browser — and it does so by throwing the moment it is imported outside
 * React's server condition. A plain Node test runner is outside that condition,
 * so importing any server module under test would fail before a single
 * assertion ran.
 *
 * Aliasing it to this empty module (see `vitest.config.ts`) removes the guard
 * for tests only. The guard itself is not weakened: `next build` type-checks
 * and bundles against the real package, so a Client Component importing a
 * server module is still a build failure, which is where that check belongs.
 */
export {};
