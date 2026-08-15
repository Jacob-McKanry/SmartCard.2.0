import type { BrowseEventItem } from "@/server/events/events-service";

/**
 * What the browse screen's single list actually contains.
 *
 * `browseEvents` returns public events only — deliberately, per its own header:
 * browse is the public directory, and a host's private events appearing in a
 * city list next to public ones would be a confusing list. But the design draws
 * a **Private** badge on that screen, and there is a harder reason than the
 * badge: a private event somebody was *invited* to is reachable from nowhere
 * else in the app. It is not public, they do not host it, and an invite creates
 * no RSVP row, so none of the other list functions return it. Without this
 * merge, an invite could only be redeemed by typing a UUID into the URL bar.
 *
 * So the list is the union of the public directory and the viewer's own events,
 * deduplicated by id. Everything here is a *product* filter over rows the caller
 * may already read — RLS decided membership of every source list before this
 * function saw it, and nothing below can widen that.
 *
 * Split out of `page.tsx` for two reasons: a Next route module should export
 * only the things the framework expects, and this is the piece of the screen
 * worth pinning in a test (that a private event survives the merge, and that an
 * event appearing in two source lists renders once).
 *
 * `nowMs` is a parameter rather than a `Date.now()` call so this stays a pure
 * function of its inputs — `react-hooks/purity` refuses a clock read inside a
 * render, and a test cannot pin an ordering whose clock it cannot fix.
 */
export type BrowseWhen = "upcoming" | "past";

export interface MergeBrowseListArgs {
  /** Already filtered by city and upcoming/past, in the database. */
  publicItems: readonly BrowseEventItem[];
  /** Hosted, answered and invited — none of which take filters, so they are filtered here. */
  ownItems: readonly BrowseEventItem[];
  cityId: string | null;
  when: BrowseWhen;
  nowMs: number;
}

export function mergeBrowseList({
  publicItems,
  ownItems,
  cityId,
  when,
  nowMs,
}: MergeBrowseListArgs): BrowseEventItem[] {
  const byId = new Map<string, BrowseEventItem>();

  for (const item of publicItems) {
    byId.set(item.event.id, item);
  }
  for (const item of ownItems) {
    if (byId.has(item.event.id)) continue;
    if (cityId !== null && item.event.city_id !== cityId) continue;
    const isUpcoming = new Date(item.event.starts_at).getTime() >= nowMs;
    if ((when === "upcoming") !== isUpcoming) continue;
    byId.set(item.event.id, item);
  }

  // Soonest first for what is coming up, most recent first for what has been —
  // the same ordering `browseEvents` applies in the database, restated because
  // the merged list contains rows it never saw.
  return [...byId.values()].sort((a, b) => {
    const cmp = a.event.starts_at.localeCompare(b.event.starts_at);
    return when === "upcoming" ? cmp : -cmp;
  });
}
