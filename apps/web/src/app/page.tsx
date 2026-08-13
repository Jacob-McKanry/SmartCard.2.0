import Link from "next/link";

export default function Home() {
  // The two `placeholder()` calls that used to sit here existed only to prove
  // the pnpm workspace wiring resolved at build time. `packages/core` now holds
  // the real connection-verification layer (§4) and is imported for that by
  // `src/server/connect/`, so the workspace wiring is proven by code that does
  // something. The placeholder export was removed with them.

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
