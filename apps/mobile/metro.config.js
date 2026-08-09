// Metro (Expo's bundler) needs two adjustments to work inside this pnpm
// monorepo, on top of the .npmrc `node-linker=hoisted` setting:
//
// 1. By default Metro only watches files inside this app's own directory, so
//    edits to packages/core, packages/types, packages/api-client (which this
//    app imports over the pnpm workspace symlink) would silently not
//    hot-reload. `watchFolders` tells Metro to also watch the monorepo root.
// 2. Workspace packages are resolved via a symlink from this app's
//    node_modules into ../../packages/*, but *their* dependencies live in the
//    hoisted root node_modules, not a node_modules next to the symlink target.
//    `resolver.nodeModulesPaths` tells Metro to also look there.
//
// See docs/architecture/2026-08-09-initial-architecture-proposal.md §1.2 for
// the pnpm/Metro background, and https://docs.expo.dev/guides/monorepos/ for
// the general pattern this follows.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

module.exports = withNativeWind(config, { input: "./src/global.css" });
