import { LoginLink } from "@kinde-oss/kinde-auth-nextjs/components";

import { getAuthenticatedContext } from "@/server/auth/current-user";

import { PresenterFlow } from "./presenter-flow";

/**
 * `/connect/present` — "Show my code".
 *
 * Same shape as `/profile/page.tsx`: a Server Component that resolves auth
 * and either sends a signed-out visitor to sign in or renders the real
 * screen. This page-level check exists for UX only — landing here signed out
 * should not flash a broken screen — not as the security boundary. The
 * boundary is `getAuthenticatedContext()` re-run inside every
 * `/api/connect/*` route on every request `PresenterFlow` makes (see
 * `route-helpers.ts`'s header comment).
 */
export const dynamic = "force-dynamic";

export default async function PresentPage() {
  const context = await getAuthenticatedContext();

  if (context === null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">Sign in to show your code</h1>
        <p className="text-sm text-muted-foreground">
          SmartCard connections only happen through an in-person tap or scan — sign in to generate a
          code the person in front of you can scan.
        </p>
        <LoginLink postLoginRedirectURL="/connect/present">
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
        <h1 className="text-xl font-semibold">Show my code</h1>
        <p className="text-sm text-muted-foreground">
          Have the other person scan this with SmartCard.
        </p>
      </header>
      <PresenterFlow />
    </main>
  );
}
