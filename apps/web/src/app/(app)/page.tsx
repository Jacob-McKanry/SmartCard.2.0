import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarDays, QrCode, Ticket } from "lucide-react";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { getOwnProfile } from "@/server/profile/profile-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";
import {
  listOwnConnections,
  type ConnectionListItem,
} from "@/server/connections/connections-service";
import { listAttendingEvents, type AttendingEventItem } from "@/server/events/events-service";
import { BlurUpPhoto } from "@/components/blur-up-photo";
import { LocalDateLine } from "@/components/local-date-line";

import { dayLabel, monthLabel, timeLabel } from "./events/lib/format";
import { RsvpPill } from "./events/lib/rsvp-pill";

/**
 * Home, ported from `docs/design/prototypes/SmartCard 2.0.dc.html`
 * (`data-screen-label="Home"`) against the spec in `docs/design/DESIGN.md` §6:
 * "greeting, one big accent Connect card (with a slow shimmer sweep), next two
 * events, latest meeting. Nothing algorithmic."
 *
 * WHY THIS STAYS DELIBERATELY SPARSE — unchanged from the version this replaces
 *
 * `/feed`'s header lays out this product's stance on padding a screen with
 * filler: "the feed is intentionally sparse... do not pad it with suggestions
 * or algorithmic content." Home follows the same rule. Every block below is
 * either the one action a person opening this app is here to take, or a record
 * of something that already happened. Nothing is ranked, suggested or inferred.
 *
 * THREE PLACES THE DESIGN ASKED FOR DATA THIS BACKEND DOES NOT HAVE
 *
 * 1. The prototype heads the events block "Happening near you". There is no
 *    user location anywhere in the schema — `users` has no city column, and
 *    `cities` is a curated list that only *events* reference. "Near you" would
 *    be a claim the app cannot back, so the section is "Coming up" and shows
 *    the viewer's own answered events, which is real, and which is also the
 *    only version of this list that can carry the RSVP pill the design draws.
 *
 * 2. The prototype's latest-meeting row shows a place name ("Blue Bottle
 *    Coffee"). `listOwnConnections` does not return the origin meeting's id, so
 *    there is no way to reach `meeting_locations` from what this page loads,
 *    and inventing a query to do it was out of scope for this pass. The row
 *    shows the verification method instead — which is the more load-bearing
 *    fact anyway — and the place name is one tap away on the meeting record.
 *    Per §7 a missing location is normal and gets no error styling; here it is
 *    simply not part of the row.
 *
 * 3. The prototype's event rows show a venue. That one *is* in the schema
 *    (`events.venue_name`) and is rendered.
 */
export const dynamic = "force-dynamic";

/** §6: "next two events". Two, not a scrollable list — that is what `/events` is. */
const HOME_EVENT_COUNT = 2;

export default async function Home() {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }

  const { supabase, userId } = context;
  const [profile, connections, attending] = await Promise.all([
    getOwnProfile(supabase, userId),
    listOwnConnections(supabase, userId),
    listAttendingEvents(supabase, userId),
  ]);

  const latest = connections[0] ?? null;
  const latestPhotoUrl = latest ? await signedProfilePhotoUrl(supabase, latest.otherUser.photo_path) : null;
  const upcoming = selectUpcomingEvents(attending);

  return (
    <main
      className="mx-auto flex w-full max-w-[560px] flex-col gap-[22px] px-5 pt-5 sm:px-7 sm:pt-8"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <header className="flex flex-col gap-1.5 pt-1.5">
        <LocalDateLine />
        <h1
          className="text-[30px] leading-[34px] font-semibold sm:text-[34px] sm:leading-[38px]"
          style={{ letterSpacing: "-.03em" }}
        >
          {profile.first_name?.trim() ? `Hey, ${profile.first_name.trim()}` : "Welcome back"}
        </h1>
        <p
          className="text-[15px] leading-[22px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          {connections.length === 0
            ? "No connections yet. The only way to make one is to meet someone."
            : `${connections.length} connection${connections.length === 1 ? "" : "s"}, all made in person.`}
        </p>
      </header>

      <ConnectCard />

      <Section
        title="Coming up"
        action={{ href: "/events", label: "All events" }}
        titleId="home-events"
      >
        <UpcomingEvents upcoming={upcoming} />
      </Section>

      <Section title="Latest" titleId="home-latest">
        <LatestMeeting connection={latest} photoUrl={latestPhotoUrl} />
      </Section>
    </main>
  );
}

/* ----------------------------------------------------------------- connect */

/**
 * The one full accent field on this screen. §2 reserves a solid blue field for
 * exactly two moments — the Connect CTA and the "you're connected" payoff — so
 * nothing else on Home may use it, and the two events sections deliberately use
 * glass instead however important they look.
 *
 * The shimmer is the prototype's own: a translucent band swept across on a
 * 3.6s loop. It is decorative and sits behind the label; `prefers-reduced-motion`
 * collapses it globally (see `globals.css`).
 */
function ConnectCard() {
  return (
    <Link
      href="/connect"
      className="relative block overflow-hidden rounded-[28px] border p-[22px] text-white transition-transform duration-300 hover:-translate-y-0.5"
      style={{
        borderColor: "rgba(255,255,255,.55)",
        background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
        boxShadow: "0 18px 40px -12px rgba(11,96,255,.55)",
        transitionTimingFunction: "var(--sc-ease-spring)",
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-[-40%] left-0 h-[180%] w-[36%]"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,.28), transparent)",
          animation: "sc-shimmer 3.6s var(--sc-ease-glide) infinite",
        }}
      />
      <span className="relative flex items-center gap-4">
        <span
          className="flex size-[52px] shrink-0 items-center justify-center rounded-[18px] border"
          style={{ background: "rgba(255,255,255,.18)", borderColor: "rgba(255,255,255,.28)" }}
        >
          <QrCode size={26} strokeWidth={1.8} aria-hidden />
        </span>
        <span className="min-w-0">
          <span
            className="block text-[20px] leading-6 font-semibold"
            style={{ letterSpacing: "-.02em" }}
          >
            Connect
          </span>
          <span
            className="mt-0.5 block text-[13px] leading-[18px]"
            style={{ color: "rgba(255,255,255,.82)" }}
          >
            Show your code, or scan theirs
          </span>
        </span>
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ events */

/**
 * The viewer's own next events, soonest first.
 *
 * RENDERS STORED STATE, NOT THE TAPPED INTENT (§7). The pill shows
 * `event_rsvps.status` exactly as the database holds it. Someone who tapped
 * "going" on an approval-gated event has a stored status of `pending`, and this
 * screen says "Waiting on host" — the thing that is true — rather than echoing
 * what they asked for.
 *
 * `not_going` and `denied` answers are filtered out of this block, and that is a
 * product decision rather than a rendering one: this is a "what is coming up for
 * you" list, and an event you declined is not coming up for you. Both statuses
 * remain visible on `/events`, so nothing is hidden — it is just not on the
 * summary screen. No new query does the filtering; it is applied to rows
 * `listAttendingEvents` already returned.
 */
function UpcomingEvents({ upcoming }: { upcoming: AttendingEventItem[] }) {
  if (upcoming.length === 0) {
    return (
      <EmptyPanel
        icon={<Ticket size={20} strokeWidth={1.7} aria-hidden />}
        title="Nothing on your calendar"
        body="Events you answer show up here. Until you answer one, there is nothing for this space to hold."
        action={{ href: "/events", label: "Browse events" }}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {upcoming.map((item) => (
        <li key={item.event.id}>
          <Link
            href="/events"
            className="flex items-center gap-3.5 rounded-[22px] border p-3 transition-transform duration-300 hover:-translate-y-0.5"
            style={glassSurface}
          >
            <span
              className="flex h-14 w-[52px] shrink-0 flex-col items-center justify-center rounded-2xl border"
              style={{ background: "rgba(255,255,255,.7)", borderColor: "rgba(255,255,255,.9)" }}
              aria-hidden
            >
              <span
                className="text-[10px] leading-3 font-medium"
                style={{
                  fontFamily: "var(--font-geist-mono)",
                  color: "var(--sc-accent)",
                  letterSpacing: ".06em",
                }}
              >
                {monthLabel(item.event.starts_at, item.event.timezone)}
              </span>
              <span className="text-[20px] leading-6 font-semibold">
                {dayLabel(item.event.starts_at, item.event.timezone)}
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-[15px] leading-5 font-semibold"
                style={{ letterSpacing: "-.01em" }}
              >
                {item.event.title}
              </span>
              <span
                className="mt-px block truncate text-[13px] leading-[18px]"
                style={{ color: "var(--sc-text-muted)" }}
              >
                {eventWhenAndWhere(item)}
              </span>
            </span>
            <RsvpPill status={item.rsvp.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Reads the clock, so it lives outside every component — `react-hooks/purity`
 * rightly refuses `Date.now()` inside a render, and this page is dynamic
 * (`force-dynamic`), so "now" is read once per request here and the components
 * below are pure functions of what it produced.
 */
function selectUpcomingEvents(attending: AttendingEventItem[]): AttendingEventItem[] {
  const nowMs = Date.now();
  return attending
    .filter((item) => new Date(item.event.starts_at).getTime() >= nowMs)
    .filter((item) => item.rsvp.status !== "not_going" && item.rsvp.status !== "denied")
    .sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at))
    .slice(0, HOME_EVENT_COUNT);
}

/* ----------------------------------------------------------------- latest */

/**
 * The most recent connection the viewer made. `listOwnConnections` is ordered
 * by `connections.created_at` descending, so index 0 is the newest edge without
 * this page re-sorting anything.
 */
function LatestMeeting({
  connection,
  photoUrl,
}: {
  connection: ConnectionListItem | null;
  photoUrl: string | null;
}) {
  if (connection === null) {
    return (
      <EmptyPanel
        icon={<CalendarDays size={20} strokeWidth={1.7} aria-hidden />}
        title="No meetings yet"
        body="This fills in the first time you meet someone in person. There is nothing to put here before that — the app has no other way to add a connection."
        action={{ href: "/connect", label: "Connect with someone" }}
      />
    );
  }

  const name = displayName(connection.otherUser);

  return (
    <Link
      href={`/connections/${connection.connectionId}`}
      className="flex items-center gap-3 rounded-[22px] border p-3.5 transition-transform duration-300 hover:-translate-y-0.5"
      style={glassSurface}
    >
      <span
        className="relative flex size-[42px] shrink-0 items-center justify-center overflow-hidden rounded-full text-[13px] font-semibold"
        style={{
          background: "linear-gradient(140deg, rgba(11,96,255,.16), rgba(124,58,237,.14))",
          lineHeight: 1,
        }}
      >
        <span aria-hidden>{initialsFor(connection.otherUser)}</span>
        {photoUrl ? (
          <BlurUpPhoto src={photoUrl} alt="" className="absolute inset-0 size-full object-cover" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] leading-[19px] font-semibold">
          You met {name}
        </span>
        <span
          className="block truncate text-[12px] leading-[17px]"
          style={{ color: "var(--sc-text-subtle)" }}
        >
          {formatOccurredAt(connection.occurredAt)} &middot;{" "}
          {verificationMethodLabel(connection.verificationMethod)}
        </span>
      </span>
      <ArrowRight
        size={18}
        strokeWidth={2}
        aria-hidden
        className="shrink-0"
        style={{ color: "var(--sc-accent)" }}
      />
    </Link>
  );
}

/* --------------------------------------------------------------- furniture */

const glassSurface = {
  background: "var(--sc-glass-bg)",
  backdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  WebkitBackdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  borderColor: "var(--sc-glass-bd)",
  boxShadow: "var(--sc-glass-sh)",
  transitionTimingFunction: "var(--sc-ease-spring)",
} as const;

function Section({
  title,
  titleId,
  action,
  children,
}: {
  title: string;
  titleId: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2.5 last:pb-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id={titleId}
          className="text-[15px] leading-5 font-semibold"
          style={{ letterSpacing: "-.01em" }}
        >
          {title}
        </h2>
        {action ? (
          <Link
            href={action.href}
            className="text-[13px] leading-[18px] font-semibold"
            style={{ color: "var(--sc-accent)" }}
          >
            {action.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * §5's empty state: dashed 26px panel, 44px icon plate, a title naming the
 * context, one sentence explaining why empty is expected, one action.
 *
 * The sentence is the part that matters. §7 says absence is often normal, and
 * on this product it usually is — a pilot user's realistic day-one meeting count
 * is zero. A section with nothing in it and no explanation reads as broken, so
 * every one of these says, in words, why nothing being here is the app working.
 */
function EmptyPanel({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action: { href: string; label: string };
}) {
  return (
    <div
      className="flex flex-col items-center gap-2.5 rounded-[26px] border border-dashed px-5 py-7 text-center"
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
        {icon}
      </span>
      <p className="text-[14px] leading-[19px] font-semibold">{title}</p>
      <p
        className="max-w-[42ch] text-[13px] leading-[19px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        {body}
      </p>
      <Link
        href={action.href}
        className="mt-1 flex min-h-11 items-center rounded-full border px-4 text-[13px] leading-[17px] font-semibold"
        style={{
          background: "rgba(255,255,255,.7)",
          borderColor: "rgba(13,18,32,.1)",
          color: "var(--sc-text)",
        }}
      >
        {action.label}
      </Link>
    </div>
  );
}

/* --------------------------------------------------------------- formatting */

/**
 * Event date/time formatting — including the rule that an unknown timezone
 * renders as labelled UTC rather than as a guess — now lives in
 * `events/lib/format.ts` and is imported above. It moved there when the Events
 * screens were built: the zone fallback is a §7 honesty rule, and a rule with
 * four copies is four chances for one of them to start rendering an unlabelled
 * guess. Same reasoning for `RsvpPill`, which is a §5 component with an
 * explicit "never invent a sixth treatment" invariant.
 */
function eventWhenAndWhere(item: AttendingEventItem): string {
  const time = timeLabel(item.event.starts_at, item.event.timezone);
  const venue = item.event.venue_name?.trim();
  return venue ? `${time} · ${venue}` : time;
}

/**
 * Kept local rather than imported from `feed/lib/format.ts`, following the
 * precedent that file's own header sets: these are two-line display helpers, and
 * the feed's copy exists specifically so a feed-only tweak does not ripple into
 * another screen. Same trade, same decision.
 */
function displayName(person: { first_name: string | null; last_name: string | null }): string {
  const full = `${person.first_name?.trim() ?? ""} ${person.last_name?.trim() ?? ""}`.trim();
  return full !== "" ? full : "Someone";
}

function initialsFor(person: { first_name: string | null; last_name: string | null }): string {
  const first = person.first_name?.trim().charAt(0) ?? "";
  const last = person.last_name?.trim().charAt(0) ?? "";
  const combined = `${first}${last}`.toUpperCase();
  return combined !== "" ? combined : "•";
}

function formatOccurredAt(occurredAt: string): string {
  return new Date(occurredAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function verificationMethodLabel(method: ConnectionListItem["verificationMethod"]): string {
  switch (method) {
    case "qr_gps":
      return "QR code, verified by location";
    case "nfc_card":
      return "NFC card tap";
  }
}
