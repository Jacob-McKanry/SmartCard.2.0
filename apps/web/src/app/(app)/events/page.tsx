import Link from "next/link";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CalendarRange, Plus } from "lucide-react";
import type { CityRow, RsvpStatus } from "@smartcard/types";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import {
  browseEvents,
  getConnectionsAttending,
  getEventAttendanceCounts,
  listActiveCities,
  listAttendingEvents,
  listHostedEvents,
  listInvitedEvents,
  type BrowseEventItem,
} from "@/server/events/events-service";
import { signedEventCoverUrl } from "@/server/events/cover-url";

import { EventCard, type EventCardProps } from "./event-card";
import { connectionsAttendingLine } from "./lib/access-rules";
import { mergeBrowseList, type BrowseWhen } from "./lib/browse-list";
import { NEUTRAL_BUTTON } from "./lib/surfaces";

/**
 * EVENTS BROWSE — `docs/design/DESIGN.md` §6 and the
 * `data-screen-label="Events browse"` block of `SmartCard 2.0.dc.html`.
 *
 * This replaces the Phase-1 placeholder that stood here. That file's header
 * explained it was a stand-in so `/events` would not 404 from the middle of the
 * nav dock; the screen it described is what this is.
 *
 * WHAT THIS LIST ACTUALLY CONTAINS, AND WHY IT IS NOT JUST `browseEvents`
 *
 * `browseEvents` returns public events only — deliberately, per its own header:
 * browse is the public directory, and a host's private events turning up in a
 * city list next to public ones would be a confusing list rather than a leak.
 * But the design draws a **Private** badge on this screen, which means the
 * screen has to be able to contain a private event, and there is a harder
 * reason than the badge: a private event you were *invited* to is reachable
 * from nowhere else in the app. It is not public, you do not host it, and an
 * invite creates no RSVP row, so none of the other list functions return it.
 * Until this screen showed it, an invite could only be redeemed by somebody
 * typing a UUID into the URL bar.
 *
 * So the list is the union of four reads, deduplicated by event id:
 *
 *   browseEvents(city, when)   the public directory, filtered in the database
 *   listHostedEvents           your own, including private       → Hosting badge
 *   listAttendingEvents        anything you answered, incl. private → status pill
 *   listInvitedEvents          private events you may see because you were invited
 *
 * The last three are filtered to the selected city and upcoming/past *here*,
 * because those functions take no filters. That is a product filter over rows
 * the caller may already read — not a security one. RLS decided membership of
 * all four sets before this file saw them.
 *
 * THE ACCESS RULES THIS SCREEN IS SHAPED BY (see `lib/access-rules.ts`)
 *
 *  - Counts on a card are the public ones. There is no pending count anywhere
 *    on this screen, for anybody, including on a card the viewer hosts — the
 *    host's queue depth lives on the dark host panel of the detail screen,
 *    where it cannot be mistaken for a public number.
 *  - "You know 3 going" is computed from `.length` and arrives at the card as a
 *    finished sentence. `getConnectionsAttending` returns user *ids*; they are
 *    consumed here and never handed to a component.
 *  - There is no search box. §7 forbids a directory, and city + upcoming/past is
 *    the whole of browse by design (`docs/design-lab-reference.md`: "any kind of
 *    public search across all events beyond city + upcoming/past browse" is
 *    listed under what does not exist).
 */
export const dynamic = "force-dynamic";

type When = BrowseWhen;

/**
 * The one place this screen reads the clock. Outside every component because
 * `react-hooks/purity` rightly refuses `Date.now()` in a render body — the page
 * is `force-dynamic`, so "now" is read once per request here and everything it
 * feeds is a pure function of what it produced. Same arrangement Home uses for
 * `selectUpcomingEvents`.
 */
function browseListNow(args: {
  publicItems: readonly BrowseEventItem[];
  ownItems: readonly BrowseEventItem[];
  cityId: string | null;
  when: When;
}): BrowseEventItem[] {
  return mergeBrowseList({ ...args, nowMs: Date.now() });
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }
  const { supabase, userId } = context;

  const query = await searchParams;
  const when: When = readOne(query.when) === "past" ? "past" : "upcoming";
  const citySlug = readOne(query.city);

  const cities = await listActiveCities(supabase);
  const selectedCity = cities.find((city) => city.slug === citySlug) ?? null;

  const [publicItems, hosted, attending, invited] = await Promise.all([
    browseEvents(supabase, { cityId: selectedCity?.id, when }),
    listHostedEvents(supabase, userId),
    listAttendingEvents(supabase, userId),
    listInvitedEvents(supabase, userId),
  ]);

  const ownStatuses = new Map<string, RsvpStatus>(
    attending.map((item) => [item.event.id, item.rsvp.status]),
  );

  const items = browseListNow({
    publicItems,
    ownItems: [...hosted, ...attending, ...invited],
    cityId: selectedCity?.id ?? null,
    when,
  });

  const cards = await Promise.all(
    items.map((item) => buildCard(supabase, item, userId, ownStatuses.get(item.event.id) ?? null)),
  );

  return (
    <main
      className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-[22px] pt-6 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <header className="flex items-end justify-between gap-3 pt-1.5">
        <div className="flex flex-col gap-1">
          <h1 className="text-[30px] leading-[34px] font-semibold tracking-[-0.03em]">Events</h1>
          <p className="text-[13px] leading-[18px]" style={{ color: "var(--sc-text-subtle)" }}>
            {countLine(cards.length, when, selectedCity)}
          </p>
        </div>
        <Link
          href="/events/new"
          className="flex min-h-11 shrink-0 items-center gap-[7px] rounded-full px-[17px] text-[13px] leading-[17px] font-semibold"
          style={NEUTRAL_BUTTON}
        >
          <Plus size={15} strokeWidth={2.2} aria-hidden />
          Host
        </Link>
      </header>

      <CityPills cities={cities} selectedSlug={selectedCity?.slug ?? null} when={when} />
      <WhenToggle when={when} citySlug={selectedCity?.slug ?? null} />

      {cards.length === 0 ? (
        <EmptyBrowse when={when} city={selectedCity} />
      ) : (
        <ul className="flex flex-col gap-3.5 pb-2">
          {cards.map((card) => (
            <li key={card.eventId}>
              <EventCard {...card} />
            </li>
          ))}
        </ul>
      )}

      {/*
       * §8 puts any text stating a rule at `--text-muted` or darker — the
       * prototype's `#a4abbb` for this line is `--text-subtle`, which §2
       * reserves for decoration. The rule wins over the swatch, the same call
       * `/connections` made for its own footnote.
       */}
      <p
        className="max-w-[54ch] pb-2 text-[12px] leading-[17px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        Counts are visible to everyone who can see an event. The guest list never is — not to
        attendees, not to the host, not to you.
      </p>
    </main>
  );
}

/* ------------------------------------------------------------------- data */

function readOne(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Everything one card needs, resolved.
 *
 * Two RPCs and a signed URL per card, issued in parallel across the whole list
 * by the caller's `Promise.all`. At pilot scale — a handful of cities with a
 * handful of events each, capped at `BROWSE_LIMIT` — that is a bounded number of
 * concurrent round trips, and the alternative (one aggregate RPC over a list of
 * event ids) would be a new database function for a screen that does not need
 * one yet. Revisit alongside real pagination, not before.
 */
async function buildCard(
  supabase: SupabaseClient,
  item: BrowseEventItem,
  userId: string,
  ownStatus: RsvpStatus | null,
): Promise<EventCardProps> {
  const [counts, connectionsAttending, coverUrl] = await Promise.all([
    getEventAttendanceCounts(supabase, item.event.id),
    getConnectionsAttending(supabase, item.event.id),
    signedEventCoverUrl(supabase, item.event.cover_image_path),
  ]);

  return {
    eventId: item.event.id,
    title: item.event.title,
    startsAt: item.event.starts_at,
    timezone: item.event.timezone,
    venueName: item.event.venue_name,
    cityName: item.city.name,
    isPrivate: item.event.visibility === "private",
    isHosting: item.event.host_user_id === userId,
    coverUrl,
    counts,
    // The ids in `connectionsAttending` stop here. See rule 3 in
    // `lib/access-rules.ts`.
    knowLine: connectionsAttendingLine(connectionsAttending),
    ownStatus,
  };
}

function countLine(count: number, when: When, city: CityRow | null): string {
  const where = city === null ? "every city" : city.name;
  const noun = count === 1 ? "event" : "events";
  return when === "upcoming"
    ? `${count} upcoming ${noun} · ${where}`
    : `${count} past ${noun} · ${where}`;
}

/* ---------------------------------------------------------------- filters */

/**
 * The city filter. Links rather than buttons, so each filter state is a real
 * URL that survives a refresh and a back button, and so the whole screen keeps
 * working as a Server Component with no client JavaScript.
 *
 * The city list is the curated `cities` table, never free text — that is the
 * schema's own rule (`events.city_id` is a NOT NULL FK) and it is also what
 * keeps browse from becoming a search box.
 */
function CityPills({
  cities,
  selectedSlug,
  when,
}: {
  cities: CityRow[];
  selectedSlug: string | null;
  when: When;
}) {
  const options: { slug: string | null; label: string }[] = [
    { slug: null, label: "All cities" },
    ...cities.map((city) => ({ slug: city.slug, label: city.name })),
  ];

  return (
    <div className="-mx-1 flex gap-[7px] overflow-x-auto px-1 pb-0.5">
      {options.map((option) => {
        const on = option.slug === selectedSlug;
        return (
          <Link
            key={option.slug ?? "all"}
            href={hrefFor(option.slug, when)}
            aria-current={on ? "true" : undefined}
            className="flex min-h-11 shrink-0 items-center rounded-full border px-[15px] text-[12px] leading-4 font-semibold transition-all duration-200"
            style={{
              borderColor: on ? "transparent" : "rgba(13,18,32,.1)",
              background: on ? "var(--sc-accent)" : "rgba(255,255,255,.6)",
              color: on ? "#ffffff" : "var(--sc-text-muted)",
              transitionTimingFunction: "var(--sc-ease-glide)",
            }}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}

function WhenToggle({ when, citySlug }: { when: When; citySlug: string | null }) {
  return (
    <div
      className="flex gap-0.5 self-start rounded-full border p-[3px]"
      style={{ background: "rgba(255,255,255,.6)", borderColor: "rgba(255,255,255,.85)" }}
    >
      {(["upcoming", "past"] as const).map((option) => {
        const on = option === when;
        return (
          <Link
            key={option}
            href={hrefFor(citySlug, option)}
            aria-current={on ? "true" : undefined}
            className="flex min-h-11 items-center rounded-full px-4 text-[12px] leading-4 font-semibold transition-all duration-200"
            style={{
              background: on ? "#ffffff" : "transparent",
              color: on ? "var(--sc-text)" : "var(--sc-text-muted)",
              boxShadow: on ? "0 1px 4px rgba(16,24,40,.12)" : undefined,
            }}
          >
            {option === "upcoming" ? "Upcoming" : "Past"}
          </Link>
        );
      })}
    </div>
  );
}

function hrefFor(citySlug: string | null, when: When): string {
  const params = new URLSearchParams();
  if (citySlug !== null) params.set("city", citySlug);
  if (when === "past") params.set("when", "past");
  const qs = params.toString();
  return qs === "" ? "/events" : `/events?${qs}`;
}

/* ------------------------------------------------------------------ empty */

/**
 * §5's empty state: dashed 26px panel, 44px icon plate, a title naming the
 * context, one sentence saying why empty is expected, one action.
 *
 * The sentence differs for past and upcoming because the honest explanation
 * differs. An empty *upcoming* list means nobody has scheduled anything, which
 * the viewer can fix by hosting. An empty *past* list is just a young city, and
 * offering "host one here" as the fix for it would be a non-sequitur — so the
 * past variant offers the way back to upcoming instead.
 */
function EmptyBrowse({ when, city }: { when: When; city: CityRow | null }) {
  const where = city === null ? "any city yet" : city.name;

  return (
    <div
      className="flex flex-col items-center gap-2.5 rounded-[26px] border border-dashed px-6 py-[34px] text-center"
      style={{ borderColor: "rgba(13,18,32,.16)", background: "rgba(255,255,255,.45)" }}
    >
      <span
        className="flex size-11 items-center justify-center rounded-2xl border"
        style={{
          background: "rgba(255,255,255,.7)",
          borderColor: "rgba(13,18,32,.07)",
          color: "var(--sc-text-muted)",
        }}
        aria-hidden
      >
        <CalendarRange size={20} strokeWidth={1.8} />
      </span>
      <p className="text-[14px] leading-[19px] font-semibold">
        {when === "upcoming" ? `Nothing scheduled in ${where}` : `No past events in ${where}`}
      </p>
      <p
        className="max-w-[38ch] text-[13px] leading-[19px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        {when === "upcoming"
          ? "Events show up here once someone schedules one. Private events you were invited to appear here too — everything else stays invisible."
          : "This list fills in as events finish. Nothing here yet means nothing has happened here yet."}
      </p>
      {when === "upcoming" ? (
        <Link
          href="/events/new"
          className="mt-0.5 flex min-h-11 items-center gap-[7px] rounded-full px-[18px] text-[13px] leading-[17px] font-semibold"
          style={NEUTRAL_BUTTON}
        >
          <Plus size={14} strokeWidth={2.2} aria-hidden />
          Host one here
        </Link>
      ) : (
        <Link
          href={hrefFor(city?.slug ?? null, "upcoming")}
          className="mt-0.5 flex min-h-11 items-center rounded-full border px-4 text-[13px] leading-[17px] font-semibold"
          style={{
            background: "rgba(255,255,255,.7)",
            borderColor: "rgba(13,18,32,.1)",
            color: "var(--sc-text)",
          }}
        >
          See what&rsquo;s coming up
        </Link>
      )}
    </div>
  );
}
