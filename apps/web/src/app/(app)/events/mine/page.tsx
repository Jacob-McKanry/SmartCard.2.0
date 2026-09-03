import Link from "next/link";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CalendarRange } from "lucide-react";
import type { RsvpStatus } from "@smartcard/types";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import {
  getConnectionsAttending,
  getEventAttendanceCounts,
  listAttendingEvents,
  listHostedEvents,
} from "@/server/events/events-service";
import { listOwnAttendedEvents } from "@/server/events/attended-events-service";
import { signedEventCoverUrl } from "@/server/events/cover-url";

import { EventCard, type EventCardProps } from "../event-card";
import { connectionsAttendingLine } from "../lib/access-rules";
import { mergeAttendingList, splitUpcomingPast, type MyAttendingItem } from "../lib/mine-list";

/**
 * MY EVENTS — Hosting / Attending, requested after the CSV-import claim
 * screens shipped: a claimed attendee had no way to see their own claim
 * reflected anywhere except a note on the one event page they happened to
 * navigate to directly. `20260903150000` fixed *that* page's visibility;
 * this screen is the list that makes the fact findable at all.
 *
 * WHY THIS IS A SEPARATE ROUTE FROM `/events`, NOT A THIRD TAB BOLTED ONTO IT
 *
 * `/events` is the public directory — §7 of the import design and this
 * file's own sibling explain at length why it stays "public + your own
 * reachable-no-other-way" and nothing wider. "My events" asks a different
 * question ("what have I hosted or attended", full stop, any city, any
 * time) and answers it from sources `/events` deliberately does not merge in
 * (`listOwnAttendedEvents` — see that function's header for why a claimed
 * guest-list row is not part of the browse union). Keeping them separate
 * routes keeps each page's own header honest about what it shows.
 *
 * ATTENDING TAB = RSVP'D ∪ CLAIMED, DEDUPED — SEE `lib/mine-list.ts`
 *
 * The two are still different facts (an RSVP is a decision the person made
 * in the app; a claimed guest-list row is the host's word, later confirmed
 * by the person clicking their own claim link or an auto-attach matching
 * their verified email — see `docs/architecture/2026-08-22-event-attendee-import.md`
 * §11.9). A card can carry both: the stored RSVP pill for the former, the
 * "Guest list" badge for the latter. Neither is invented for the other.
 */
export const dynamic = "force-dynamic";

type Tab = "attending" | "hosting";

export default async function MyEventsPage({
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
  const tab: Tab = readOne(query.tab) === "hosting" ? "hosting" : "attending";

  const items: MyAttendingItem[] =
    tab === "hosting"
      ? (await listHostedEvents(supabase, userId)).map((item) => ({
          ...item,
          rsvp: null,
          attendedViaGuestList: false,
        }))
      : mergeAttendingList(
          ...(await Promise.all([listAttendingEvents(supabase, userId), listOwnAttendedEvents(supabase)])),
        );

  const { upcoming, past } = splitMineListNow(items);

  const [upcomingCards, pastCards] = await Promise.all([
    Promise.all(upcoming.map((item) => buildCard(supabase, item, userId))),
    Promise.all(past.map((item) => buildCard(supabase, item, userId))),
  ]);

  return (
    <main
      className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-[22px] pt-6 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <header className="flex flex-col gap-1 pt-1.5">
        <h1 className="text-[30px] leading-[34px] font-semibold tracking-[-0.03em]">My events</h1>
        <p className="text-[13px] leading-[18px]" style={{ color: "var(--sc-text-subtle)" }}>
          {countLine(upcomingCards.length + pastCards.length, tab)}
        </p>
      </header>

      <TabToggle tab={tab} />

      {upcomingCards.length === 0 && pastCards.length === 0 ? (
        <EmptyMine tab={tab} />
      ) : (
        <div className="flex flex-col gap-5 pb-2">
          {upcomingCards.length > 0 ? <CardSection label="Upcoming" cards={upcomingCards} /> : null}
          {pastCards.length > 0 ? <CardSection label="Past" cards={pastCards} /> : null}
        </div>
      )}
    </main>
  );
}

/**
 * The one place this screen reads the clock — outside the component, like
 * `/events`'s own `browseListNow`, because `react-hooks/purity` refuses a
 * direct `Date.now()` call inside a Server Component's render body. The page
 * is `force-dynamic`, so "now" is read once per request here.
 */
function splitMineListNow(items: readonly MyAttendingItem[]): {
  upcoming: MyAttendingItem[];
  past: MyAttendingItem[];
} {
  return splitUpcomingPast(items, Date.now());
}

/* ------------------------------------------------------------------- data */

function readOne(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Identical field set to `/events`'s own `buildCard` — see that function's header. */
async function buildCard(
  supabase: SupabaseClient,
  item: MyAttendingItem,
  userId: string,
): Promise<EventCardProps> {
  const [counts, connectionsAttending, coverUrl] = await Promise.all([
    getEventAttendanceCounts(supabase, item.event.id),
    getConnectionsAttending(supabase, item.event.id),
    signedEventCoverUrl(supabase, item.event.cover_image_path),
  ]);

  const ownStatus: RsvpStatus | null = item.rsvp?.status ?? null;

  return {
    eventId: item.event.id,
    title: item.event.title,
    startsAt: item.event.starts_at,
    timezone: item.event.timezone,
    venueName: item.event.venue_name,
    cityName: item.city.name,
    isPrivate: item.event.visibility === "private",
    isHosting: item.event.host_user_id === userId,
    isCancelled: item.event.status === "cancelled",
    isDraft: item.event.status === "draft",
    attendedViaGuestList: item.attendedViaGuestList,
    coverUrl,
    counts,
    knowLine: connectionsAttendingLine(connectionsAttending),
    ownStatus,
  };
}

function countLine(count: number, tab: Tab): string {
  const noun = count === 1 ? "event" : "events";
  return tab === "hosting" ? `${count} hosted ${noun}` : `${count} ${noun} you're on the list for`;
}

/* ---------------------------------------------------------------- filters */

/**
 * The Hosting/Attending toggle. A link, not a client-side control, mirroring
 * `/events`'s own `WhenToggle` for the same reason: each state is a real URL,
 * and the page stays a Server Component with no client JavaScript.
 */
function TabToggle({ tab }: { tab: Tab }) {
  return (
    <div
      className="flex gap-0.5 self-start rounded-full border p-[3px]"
      style={{ background: "rgba(255,255,255,.6)", borderColor: "rgba(255,255,255,.85)" }}
    >
      {(["attending", "hosting"] as const).map((option) => {
        const on = option === tab;
        return (
          <Link
            key={option}
            href={option === "attending" ? "/events/mine" : "/events/mine?tab=hosting"}
            aria-current={on ? "true" : undefined}
            className="flex min-h-11 items-center rounded-full px-4 text-[12px] leading-4 font-semibold transition-all duration-200"
            style={{
              background: on ? "#ffffff" : "transparent",
              color: on ? "var(--sc-text)" : "var(--sc-text-muted)",
              boxShadow: on ? "0 1px 4px rgba(16,24,40,.12)" : undefined,
            }}
          >
            {option === "attending" ? "Attending" : "Hosting"}
          </Link>
        );
      })}
    </div>
  );
}

function CardSection({ label, cards }: { label: string; cards: EventCardProps[] }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2
        className="px-1 text-[12px] leading-4 font-semibold tracking-[.02em] uppercase"
        style={{ color: "var(--sc-text-subtle)" }}
      >
        {label}
      </h2>
      <ul className="flex flex-col gap-3.5">
        {cards.map((card) => (
          <li key={card.eventId}>
            <EventCard {...card} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ empty */

function EmptyMine({ tab }: { tab: Tab }) {
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
        {tab === "hosting" ? "You haven't hosted anything yet" : "Nothing here yet"}
      </p>
      <p
        className="max-w-[38ch] text-[13px] leading-[19px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        {tab === "hosting"
          ? "Events you host, upcoming or past, will show up here."
          : "Events you've RSVP'd to, or been added to a host's guest list for and claimed, will show up here."}
      </p>
      <Link
        href={tab === "hosting" ? "/events/new" : "/events"}
        className="mt-0.5 flex min-h-11 items-center rounded-full border px-4 text-[13px] leading-[17px] font-semibold"
        style={{
          background: "rgba(255,255,255,.7)",
          borderColor: "rgba(13,18,32,.1)",
          color: "var(--sc-text)",
        }}
      >
        {tab === "hosting" ? "Host an event" : "Browse events"}
      </Link>
    </div>
  );
}
