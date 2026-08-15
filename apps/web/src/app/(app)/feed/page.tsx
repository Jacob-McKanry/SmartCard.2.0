import { redirect } from "next/navigation";
import Link from "next/link";
import { Newspaper } from "lucide-react";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { listFeedItems } from "@/server/feed/feed-service";

import { FeedItemCard } from "./feed-item";

/**
 * The meeting feed (README build order item 4; architecture doc §2.9), drawn to
 * `docs/design/DESIGN.md` §6 and the prototype's `data-screen-label="Feed"`.
 *
 * Every card here is one of exactly two post types the product spec allows —
 * "You met [Name]" for meetings the viewer attended, "[A] met [B]" for meetings
 * between two of the viewer's mutual connections — computed on read from
 * `meetings` + `meeting_participants` + `connections` through the viewer's own
 * RLS-bound client. There is no feed table, no ranking, and nothing rendered
 * here that a `SELECT` didn't actually return: see
 * `@/server/feed/feed-service.ts` for exactly which query does the security work
 * (all of it) and which queries only format what RLS already decided.
 *
 * WHY THIS IS THE CALLER'S OWN FEED ONLY
 *
 * `listFeedItems` takes the caller's own RLS-bound client and the caller's own
 * id — there is no "view someone else's feed" variant, for the same reason
 * `/connections` has none: CLAUDE.md's non-negotiable product rule forbids
 * anything reachable from a URL that looks like a stranger directory, and a feed
 * keyed by an arbitrary user id would be exactly that.
 *
 * WHAT THE DESIGN PASS CHANGED
 *
 * Glass cards in place of hairline rows, and one addition of substance: the
 * event a meeting happened at. `listFeedItems` has been returning `item.event`
 * for a while and nothing rendered it. See `feed-item.tsx` for why only the
 * editorial card variant of §6's two exists.
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
    <main
      className="mx-auto flex w-full max-w-[560px] flex-col gap-[18px] px-5 pt-5 sm:px-7 sm:pt-8"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <header className="flex flex-col gap-1.5 pt-1.5">
        <h1 className="text-[30px] leading-[34px] font-semibold" style={{ letterSpacing: "-.03em" }}>
          Feed
        </h1>
        <p
          className="max-w-[52ch] text-[14px] leading-5"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          Meetings you were part of, and meetings between your mutual connections. Nothing
          suggested, nothing algorithmic — just what actually happened, most recent first.
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyFeedState />
      ) : (
        <ul className="flex flex-col gap-3.5 pb-2">
          {items.map((item) => (
            <FeedItemCard key={item.meetingId} item={item} supabase={supabase} />
          ))}
        </ul>
      )}
    </main>
  );
}

/**
 * A deliberately designed empty state, not a blank div — §5's dashed panel, and
 * the reason it exists is §7's "absence is often normal".
 *
 * The product spec's own words are "the feed is intentionally sparse. Do not pad
 * it with filler, suggestions, or algorithmic content" (architecture doc §2.9),
 * and a pilot user's realistic day-one meeting count is single digits, meaning
 * many users will land on this exact screen. A feed with zero rows and zero
 * explanation reads as broken — did sign-in fail, did the query error, is the
 * app empty by mistake? This state answers that in words instead of making the
 * viewer guess: nothing is wrong, the feed is working exactly as designed, and
 * here is the one and only way to put something in it.
 *
 * The link goes to `/connect` — no new destination invented for this, and
 * deliberately no "people you may know", which would be exactly the filler the
 * spec rules out.
 */
function EmptyFeedState() {
  return (
    <div
      className="flex flex-col items-center gap-2.5 rounded-[26px] border border-dashed px-6 py-10 text-center"
      style={{ borderColor: "rgba(13,18,32,.16)" }}
    >
      <span
        className="flex size-11 items-center justify-center rounded-2xl border"
        style={{
          background: "rgba(255,255,255,.7)",
          borderColor: "rgba(13,18,32,.06)",
          color: "var(--sc-text-muted)",
        }}
      >
        <Newspaper size={20} strokeWidth={1.7} aria-hidden />
      </span>
      <p className="text-[17px] leading-[22px] font-semibold" style={{ letterSpacing: "-.02em" }}>
        Nothing here yet &mdash; and that&rsquo;s expected
      </p>
      <p
        className="max-w-[44ch] text-[13px] leading-[19px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        This feed only shows meetings verified in person. It stays quiet until one actually happens
        &mdash; there&rsquo;s nothing to fill the space with in the meantime.
      </p>
      <Link
        href="/connect"
        className="mt-2 flex min-h-11 items-center rounded-full px-5 text-[13.5px] leading-[18px] font-semibold text-white"
        style={{
          background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
          boxShadow: "0 14px 30px -10px rgba(11,96,255,.55)",
        }}
      >
        Connect with someone
      </Link>
    </div>
  );
}
