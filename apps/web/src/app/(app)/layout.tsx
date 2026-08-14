import { redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";

import { Nav } from "./nav";

/**
 * The shared shell for every signed-in screen — `/`, `/feed`, `/connect`,
 * `/connections` (and `/connections/[connectionId]`), `/profile`. Two jobs:
 *
 * ONE AUTH GATE INSTEAD OF FIVE
 *
 * Every page this wraps used to run its own `getAuthenticatedContext()` and
 * render its own copy of a "sign in" screen when it came back null — five
 * near-identical blocks, one per page. That was always UX-only, never the
 * security boundary (see `presenter-flow.tsx`'s header: the boundary is
 * `getAuthenticatedContext()` re-run inside every `/api/connect/*` route on
 * every request). Centralizing it here doesn't change what's enforced, only
 * where the one already-duplicated check lives. Each page still calls
 * `getAuthenticatedContext()` itself to get its own `supabase`/`userId` for
 * its own queries — that's `cache()`-memoized per request now (see that
 * function's header), so this isn't paying for the verify-and-mint twice.
 *
 * `/card/[code]` deliberately isn't part of this group: a tapped card must
 * redirect back to itself after sign-in, not to a generic destination, so it
 * keeps its own self-contained gate. See its page header.
 *
 * THE NAVIGATION SHELL
 *
 * `<Nav>` is what used to not exist at all — every one of these five screens
 * was reachable only by typing its URL. Rendered here, once, so it's
 * impossible for a page under this group to forget it.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await getAuthenticatedContext();

  if (context === null) {
    redirect("/sign-in");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <div className="flex-1 pb-16 sm:pb-0">{children}</div>
    </div>
  );
}
