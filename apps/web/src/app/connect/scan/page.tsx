import { LoginLink } from "@kinde-oss/kinde-auth-nextjs/components";

import { getAuthenticatedContext } from "@/server/auth/current-user";

import { ScannerFlow } from "./scanner-flow";

/**
 * `/connect/scan` — "Scan a code". See `present/page.tsx`'s header for why
 * this page-level auth check is UX only, not the security boundary.
 */
export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const context = await getAuthenticatedContext();

  if (context === null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">Sign in to scan a code</h1>
        <p className="text-sm text-muted-foreground">
          SmartCard connections only happen through an in-person tap or scan — sign in to scan the
          code the person in front of you is showing.
        </p>
        <LoginLink postLoginRedirectURL="/connect/scan">
          <span className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
            Sign in with Kinde
          </span>
        </LoginLink>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6 sm:p-10">
      <header className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold">Scan a code</h1>
        <p className="text-sm text-muted-foreground">
          Point your camera at the code they&rsquo;re showing.
        </p>
      </header>
      <ScannerFlow />
    </main>
  );
}
