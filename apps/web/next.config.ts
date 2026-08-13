import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These are workspace packages (packages/core, packages/types,
  // packages/api-client) exporting untranspiled TypeScript source directly —
  // Next.js only transpiles files inside apps/web by default, so anything
  // imported from node_modules (including pnpm workspace symlinks) needs to
  // be listed here or the build fails on the raw `.ts` syntax.
  transpilePackages: ["@smartcard/core", "@smartcard/types", "@smartcard/api-client"],
  experimental: {
    serverActions: {
      // The `profile-photos` Storage bucket caps objects at 5MB
      // (20260813180355_create_profile_photos_bucket.sql) and
      // `uploadPhotoAction` (apps/web/src/app/profile/actions.ts) posts the
      // file straight through as multipart form data — the default 1MB
      // Server Action body limit would reject a legitimately-sized photo
      // before it ever reached that check. 6MB leaves room for multipart
      // boundary/header overhead on top of the 5MB payload (see this
      // option's own doc: "an additional 10-20KB is a reasonable rule of
      // thumb" — 6MB is deliberately generous rather than cutting it close).
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
