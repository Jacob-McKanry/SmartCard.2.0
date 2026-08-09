// Shared ESLint rules for every workspace package/app.
//
// Two exports, because eslint-config-next and eslint-config-expo each ship
// their own bundled copy of the "@typescript-eslint" plugin, and flat config
// throws ("Cannot redefine plugin") if two different module instances of the
// same plugin name both end up registered for the same files — even at the
// same rule-set version. So:
//
// - `sharedConfig`: safe to combine with ANY platform preset (apps/web,
//   apps/mobile) — no plugin registration, just eslint:recommended plus
//   Prettier conflict-disabling and shared ignores.
// - `baseConfig`: `sharedConfig` PLUS typescript-eslint's own recommended
//   rules — for packages/* only, which have no platform preset of their own
//   to collide with and therefore need this package to provide TS parsing
//   and linting outright.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

const ignoresConfig = {
  ignores: [
    "**/node_modules/**",
    "**/.next/**",
    "**/.expo/**",
    "**/.turbo/**",
    "**/dist/**",
    "**/build/**",
  ],
};

/** @type {import("eslint").Linter.Config[]} */
export const sharedConfig = [js.configs.recommended, prettierConfig, ignoresConfig];

/** @type {import("eslint").Linter.Config[]} */
export const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  ignoresConfig,
];

export default baseConfig;
