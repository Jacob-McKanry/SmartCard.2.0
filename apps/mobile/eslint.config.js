// eslint-config-expo/flat is CommonJS, so this file stays CommonJS too
// (matching the rest of this Expo app) rather than the ESM style used by
// apps/web's eslint.config.mjs. The root shared config is ESM-only (its
// dependencies — typescript-eslint, eslint-config-prettier — ship ESM), so
// it's pulled in via a dynamic import; ESLint's flat config format allows a
// config file to export a Promise for exactly this situation.
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = (async () => {
  const { sharedConfig } = await import("../../eslint.config.base.mjs");

  return defineConfig([
    // Root-shared base first, so eslint-config-expo's more specific
    // parser/rule setup below takes precedence where the two overlap.
    // (Uses `sharedConfig`, not `baseConfig` — eslint-config-expo brings
    // its own "@typescript-eslint" plugin instance, and flat config throws
    // if two different instances of the same plugin name both get
    // registered.)
    ...sharedConfig,
    expoConfig,
    {
      ignores: ["dist/**"],
    },
  ]);
})();
