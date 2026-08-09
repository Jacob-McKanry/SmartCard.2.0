import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { sharedConfig } from "../../eslint.config.base.mjs";

const eslintConfig = defineConfig([
  // Root-shared base first, so eslint-config-next's more specific
  // parser/rule setup below takes precedence where the two overlap.
  // (Uses `sharedConfig`, not `baseConfig` — eslint-config-next brings its
  // own "@typescript-eslint" plugin instance, and flat config throws if two
  // different instances of the same plugin name both get registered.)
  ...sharedConfig,
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
