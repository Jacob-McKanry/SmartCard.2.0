import Link from "next/link";

import { placeholder as corePlaceholder } from "@smartcard/core";
import { placeholder as apiClientPlaceholder } from "@smartcard/api-client";

export default function Home() {
  // Proves the pnpm workspace wiring (apps/web -> packages/core,
  // packages/api-client -> packages/types) actually resolves at build time.
  console.log(corePlaceholder(), apiClientPlaceholder());

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background font-sans">
      <h1 className="text-2xl font-semibold text-foreground">SmartCard — under construction</h1>
      {/* The first real screen (README.md build order, item 1). `/auth-check`,
          the temporary page that proved the Kinde -> Supabase bridge before
          any real feature existed, was retired once this landed — see the
          Profile build notes for why. */}
      <Link href="/profile" className="text-sm text-primary underline underline-offset-4">
        Go to your profile
      </Link>
    </div>
  );
}
