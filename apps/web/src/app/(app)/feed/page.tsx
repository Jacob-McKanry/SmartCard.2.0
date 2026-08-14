import { redirect } from "next/navigation";
import Link from "next/link";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { listFeedItems } from "@/server/feed/feed-service";

import { FeedItemCard } from "./feed-item";

/**
 * The meeting feed (README build order item 4; architecture doc §2.9).
 *
 * Every row here is one of exactly two post types the product spec allows —
 * "You met [Name]" for meetings the viewer attended, "[A] met [B]" for
 * meetings between two of the viewer's mutual connections — computed on read
 * from `meetings` + `meeting_participants` + `connections` through the
 * viewer's own RLS-bound client. There is no feed table, no ranking, and
 * nothing rendered here that a `SELECT` didn't actually return: see
 * `@/server/feed/feed-service.ts` for exactly which query does the security
 * work (all of it) and which queries only format what RLS already decided.
 *
 * WHY THIS IS THE CALLER'S OWN FEED ONLY
 *
 * `listFeedItems` takes the caller's own RLS-bound client and the caller's
 * own id — there is no "view someone else's feed" variant, for the same
 * reason `/connections` has none: CLAUDE.md's non-negotiable product rule
 * forbids anything reachable from a URL that looks like a stranger directory,
 * and a feed keyed by an arbitrary user id would be exactly that.
 */
export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const context = await getAuthenticatedContext();

  if (context === null) {
    redirect("/sign-in");
  }

  const { supabase, userId } = context;
  const items = await listFeedItems(supabase, userId);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6 sm:p-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Feed</h1>
        <p className="text-sm text-muted-foreground">
          Meetings you were part of, and meetings between your mutual connections. Nothing suggested,
          nothing algorithmic — just what actually happened, most recent first.
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyFeedState />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <FeedItemCard key={item.meetingId} item={item} supabase={supabase} />
          ))}
        </ul>
      )}
    </main>
  );
}

/**
 * A deliberately designed empty state, not a blank div.
 *
 * WHY THIS LOOKS THE WAY IT DOES
 *
 * The product spec's own words are "the feed is intentionally sparse. Do not
 * pad it with filler, suggestions, or algorithmic content" (architecture doc
 * §2.9), and a pilot user's realistic day-one meeting count is single digits,
 * meaning many users will land on this exact screen. A feed with zero rows
 * and zero explanation reads as broken — did sign-in fail, did the query
 * error, is the app empty by mistake? This state exists to answer that
 * question in words instead of making the viewer guess: nothing is wrong,
 * the feed is working exactly as designed, and here is the one and only way
 * to put something in it. The link goes to `/connect` — the Connect Flow
 * toggle already linked from the nav and the home screen — no new
 * destination invented for this, and deliberately no "people you may know"
 * or similar suggestion, which would be exactly the filler the spec rules
 * out. (Previously two links, one each to `/connect/present` and
 * `/connect/scan` — collapsed to the one `/connect` toggle screen those
 * routes were merged into; the two-link version was missed when that merge
 * landed and kept prefetching two now-deleted routes until caught here.)
 */
function EmptyFeedState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-10 text-center">
      <p className="text-sm font-medium">Nothing here yet — and that&rsquo;s expected</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        This feed only shows meetings verified in person. It stays quiet until one actually happens —
        there&rsquo;s nothing to fill the space with in the meantime.
      </p>
      <Link href="/connect" className="mt-2 text-sm text-primary underline underline-offset-4">
        Connect with someone
      </Link>
    </div>
  );
}
