import { redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { AuthFailureScreen, classifyAuthFailure } from "@/components/auth-failure-screen";

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
 *
 * A THIRD JOB, ADDED WITH THE AUTH DESIGN PASS: THE GATE CAN ALSO *FAIL*
 *
 * `getAuthenticatedContext()` has three documented ways to throw for a person
 * holding a perfectly valid Kinde session — a suspended account, an email
 * already bound to a different identity, and a sign-in that returned no email
 * at all (see `server/auth/ensure-user.ts`). Until now every one of them
 * surfaced as Next's unstyled error page on whatever screen the person happened
 * to be opening. They are caught here because this is the one component that
 * runs before every signed-in page, so one catch covers the whole group.
 *
 * It fails closed. The catch renders a screen *instead of* `children`, so no
 * page under this layout executes; a Server Component is only evaluated when it
 * is rendered into the tree. And it re-throws anything it does not recognise —
 * a database outage must not be presented to somebody as "your account is on
 * hold", which is exactly the reassuring, confident, wrong answer that a
 * catch-all would produce.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let context;
  try {
    context = await getAuthenticatedContext();
  } catch (error) {
    const failure = classifyAuthFailure(error);
    if (failure === null) throw error;
    return <AuthFailureScreen failure={failure} />;
  }

  if (context === null) {
    redirect("/sign-in");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      {/*
       * Bottom padding clears the dock, which floats above the content rather
       * than sitting in flow (it is `fixed`, inset 14px from each edge). The
       * two values are the prototype's own `scrollPadBottom`: 104px on phone,
       * where the bar is a ~60px dock plus its 14px inset and breathing room,
       * and 44px on desktop, where the bar is at the top and this is just the
       * page's own end-of-content margin. Getting this wrong doesn't look
       * broken — it silently hides the last row of every list behind glass.
       */}
      <div className="flex-1 pb-[104px] sm:pb-11">{children}</div>
    </div>
  );
}
