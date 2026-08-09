import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These are workspace packages (packages/core, packages/types,
  // packages/api-client) exporting untranspiled TypeScript source directly —
  // Next.js only transpiles files inside apps/web by default, so anything
  // imported from node_modules (including pnpm workspace symlinks) needs to
  // be listed here or the build fails on the raw `.ts` syntax.
  transpilePackages: [
    "@smartcard/core",
    "@smartcard/types",
    "@smartcard/api-client",
  ],
};

export default nextConfig;
