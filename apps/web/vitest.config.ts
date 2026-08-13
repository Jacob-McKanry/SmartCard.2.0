import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Vitest for the web app's SERVER modules.
 *
 * There is no jsdom and no React testing here on purpose: the things in
 * `apps/web` worth testing at this point in the build are the security-relevant
 * server helpers (IP hashing, proxy-header parsing, notification payload
 * construction), and everything about the verification decision itself lives in
 * `packages/core`, which has its own suite and no framework around it at all.
 * Adding a browser environment we do not use would slow every run and invite
 * component tests that belong with the screens, which are not built.
 *
 * `server-only` is aliased to an empty module. That package exists to make
 * importing a server module from a Client Component a build error, and it does
 * that by throwing on import outside React's server condition — which a plain
 * Node test runner is. Aliasing it away is the standard workaround and costs
 * nothing here: the guarantee it provides is enforced by `next build`, which
 * runs against the real thing.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
