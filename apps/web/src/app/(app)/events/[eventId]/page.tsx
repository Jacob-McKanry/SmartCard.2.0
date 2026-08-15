import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Lock, Users } from "lucide-react";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import {
  getConnectionsAttending,
  getEventAttendanceCounts,
  getEventForViewer,
  getEventHostProfile,
  getOwnConnectionsAtEvent,
  getOwnRsvp,
} from "@/server/events/events-service";
import { listEventInvites } from "@/server/events/events-service";
import { listOwnConnections } from "@/server/connections/connections-service";
import { signedEventCoverUrl } from "@/server/events/cover-url";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BlurUpPhoto } from "@/components/blur-up-photo";
import { AvatarDisc } from "../../connections/lib/avatar-disc";

import {
  connectionsAttendingLine,
  hostPendingCount,
  publicStats,
  viewerRole,
  type EventStat,
} from "../lib/access-rules";
import { displayName, hasEnded, initialsFor, whenLine, whereLine } from "../lib/format";
import { COVER_PLACEHOLDER, GLASS, GLASS_LIQUID } from "../lib/surfaces";
import { RsvpBlock } from "./rsvp-block";
import { HostTools } from "./host-tools";
import { InviteLauncher, type InviteCandidate } from "./invite-launcher";

/**
 * EVENT DETAIL — `docs/design/DESIGN.md` §6 ("Detail: immersive cover with a
 * glass panel overlapping it, host row, four-stat row, description, RSVP
 * block") and the `data-screen-label="Event detail"` block of the prototype.
 *
 * WHY A MISSING EVENT AND AN INVISIBLE ONE BOTH 404
 *
 * `getEventForViewer` returns `null` for both, deliberately — see its header.
 * Distinguishing them here, with a friendlier "you don't have access" screen,
 * would turn this route into a probe for whether a given private event exists.
 * `notFound()` is the same answer for both.
 *
 * THE ACCESS RULES THIS SCREEN IS SHAPED BY (`../lib/access-rules.ts`)
 *
 *  1. **No attendee list, for anyone.** There is no "see who's going" control
 *     on this page for any viewer, including the host. The four stats are
 *     numbers; the host's queue lists only people awaiting a decision.
 *  2. **The pending count is host-only** and appears only inside `HostTools`,
 *     which sits on the dark panel §6 requires so it cannot be read as part of
 *     the public view. `publicStats` — the only thing the stat row is built
 *     from — cannot express a pending count at all.
 *  3. **"You know 3 going" is a count.** `getConnectionsAttending` returns user
 *     ids; they are turned into a sentence here and never reach a component.
 *  4. **The pill renders the stored status**, read back from `event_rsvps`, not
 *     the button the viewer pressed.
 *
 * WHERE THE DESIGN WANTED SOMETHING THIS BACKEND DOES NOT HAVE
 *
 *  - **The host's name is often not renderable.** `users`'s read policy lets you
 *    read somebody only if they are you, a connection, or someone you are both
 *    `going` with; hosting creates no RSVP row, so for most viewers of most
 *    public events the host is unreadable. The row then states the rule instead
 *    of naming a person — it does not guess, and it does not disappear, because
 *    "who is behind this event" is a fair question to have answered with "you'll
 *    see once you've met them".
 *  - **No waitlist position for your own answer.** §5 draws the waitlist pill
 *    "with a position". Computing one needs every other waiting person's
 *    `responded_at`, which is exactly the attendee data the RSVP select policy
 *    withholds. Omitted here; shown in the host's queue, where the host really
 *    does hold the whole list.
 */
export const dynamic = "force-dynamic";

/**
 * The one clock read on this page. Module scope, not the render body, because
 * `react-hooks/purity` rightly refuses an impure call during render; the page is
 * `force-dynamic` so "now" is read once per request. The rule itself lives in
 * `lib/format.ts` next to the SQL it has to stay identical to.
 */
function eventHasEndedNow(startsAt: string, endsAt: string | null): boolean {
  return hasEnded(startsAt, endsAt, Date.now());
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }
  const { supabase, userId } = context;
  const { eventId } = await params;

  const item = await getEventForViewer(supabase, eventId);
  if (item === null) {
    notFound();
  }
  const { event, city } = item;

  const [ownRsvp, counts, connectionsAttending, host, coverUrl, ownConnectionsHere] =
    await Promise.all([
      getOwnRsvp(supabase, event.id, userId),
      getEventAttendanceCounts(supabase, event.id),
      getConnectionsAttending(supabase, event.id),
      getEventHostProfile(supabase, event.host_user_id),
      signedEventCoverUrl(supabase, event.cover_image_path),
      getOwnConnectionsAtEvent(supabase, event.id, userId),
    ]);

  const role = viewerRole(event.host_user_id, userId, ownRsvp);
  const knowLine = connectionsAttendingLine(connectionsAttending);
  const hostPhotoUrl = host ? await signedProfilePhotoUrl(supabase, host.photo_path) : null;
  const ended = eventHasEndedNow(event.starts_at, event.ends_at);

  /*
   * WHO SEES AN INVITE CONTROL, AND WHY THE TEST HAS TWO HALVES.
   *
   * `host or going` mirrors the `event_invites` INSERT policy — a UI offering
   * the action to somebody the database would refuse is just a confusing dead
   * end. `private` is the *product* half and is not in that policy: a public
   * event needs no invite, because anybody signed in can already find it and
   * answer, so an invite button there would be a control with nothing to do.
   *
   * This is a display decision only. Whether a given insert is allowed is
   * re-derived from the JWT by the policy on every call, so nothing here is
   * load-bearing for access.
   */
  const canInvite =
    event.visibility === "private" && (role === "host" || ownRsvp?.status === "going");
  const inviteCandidates = canInvite ? await buildInviteCandidates(supabase, event.id, userId) : [];

  return (
    <main
      className="mx-auto flex w-full max-w-[640px] flex-col gap-[18px] px-[22px] pt-4 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <Link
        href="/events"
        className="-ml-1 flex min-h-11 items-center gap-1.5 self-start px-1 text-[13px] leading-[18px] font-medium"
        style={{ color: "var(--sc-text-muted)" }}
      >
        <ChevronLeft size={16} strokeWidth={2} aria-hidden />
        Events
      </Link>

      {/* The immersive cover, with the glass panel overlapping its lower edge. */}
      <div
        className="relative overflow-hidden rounded-[30px] border"
        style={{
          borderColor: "var(--sc-glass-bd)",
          boxShadow: "0 22px 50px -18px rgba(16,24,40,.28)",
        }}
      >
        <div className="h-[246px]" style={COVER_PLACEHOLDER}>
          {coverUrl ? (
            <BlurUpPhoto src={coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center" aria-hidden>
              <span
                className="rounded-md px-2.5 py-1.5 font-mono text-[10px]"
                style={{ background: "rgba(255,255,255,.86)", color: "#7b8398" }}
              >
                no cover
              </span>
            </div>
          )}
        </div>
        <div className="absolute inset-x-3.5 bottom-3.5 rounded-[23px] p-[17px]" style={GLASS_LIQUID}>
          <div
            className="font-mono text-[11px] leading-[15px] font-medium"
            style={{ color: "var(--sc-accent-deep)", letterSpacing: ".04em" }}
          >
            {whenLine(event.starts_at, event.timezone)}
          </div>
          <h1 className="mt-1.5 text-[25px] leading-[29px] font-semibold tracking-[-0.03em]">
            {event.title}
          </h1>
          <p className="mt-[5px] text-[13px] leading-[18px]" style={{ color: "var(--sc-text-muted)" }}>
            {whereLine(event.venue_name, city.name)}
          </p>
        </div>
      </div>

      <HostRow
        name={host === null ? null : displayName(host)}
        initials={host === null ? "•" : initialsFor(host)}
        photoUrl={hostPhotoUrl}
        knowLine={knowLine}
        isHosting={role === "host"}
      />

      <StatRow stats={counts === null ? null : publicStats(counts)} />

      {event.description?.trim() ? (
        <p
          className="max-w-[58ch] text-[14px] leading-[22px] whitespace-pre-line"
          style={{ textWrap: "pretty" }}
        >
          {event.description.trim()}
        </p>
      ) : null}

      <RsvpBlock
        eventId={event.id}
        storedStatus={ownRsvp?.status ?? null}
        requiresApproval={event.requires_approval}
        isFull={counts?.isFull ?? false}
        hasEnded={ended}
        isPrivate={event.visibility === "private"}
        isHost={role === "host"}
      />

      {role === "host" ? (
        <HostTools
          eventId={event.id}
          pendingCount={counts === null ? null : hostPendingCount(counts, role)}
          isPrivate={event.visibility === "private"}
          inviteSlot={
            canInvite ? (
              <InviteLauncher eventId={event.id} candidates={inviteCandidates} tone="dark" />
            ) : null
          }
        />
      ) : null}

      {/*
       * A `going` guest may invite one of their own connections to a private
       * event — the host is not the only gatekeeper (20260814060100 explains
       * why). It gets its own light panel rather than a place on the dark one,
       * because the dark ground means "host-only" and this is not.
       */}
      {role !== "host" && canInvite ? (
        <div className="flex flex-col gap-2.5 rounded-[22px] p-[15px]" style={GLASS}>
          <p className="text-[13px] leading-[17px] font-semibold">Bring someone you know</p>
          <p
            className="text-[12px] leading-[17px]"
            style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
          >
            You&rsquo;re going, so you can let one of your own connections see this event. They
            still answer for themselves, and an invite can&rsquo;t be taken back.
          </p>
          <div className="flex">
            <InviteLauncher eventId={event.id} candidates={inviteCandidates} tone="light" />
          </div>
        </div>
      ) : null}

      {event.visibility === "private" ? <PrivateNote /> : null}

      {ended ? (
        <MetHereNote
          connectionsMade={counts?.connectionsMade ?? 0}
          ownConnectionsHere={ownConnectionsHere}
        />
      ) : null}

      {/*
       * §8: text that states a rule sits at `--text-muted` or darker. The
       * prototype's `#a4abbb` is `--text-subtle`, which §2 reserves for
       * decoration.
       */}
      <p
        className="max-w-[54ch] pb-2 text-[12px] leading-[17px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        No guest list, for anyone — not for attendees and not for the host. Counts say how many;
        nothing here says who.
      </p>
    </main>
  );
}

/* ---------------------------------------------------------------- invites */

/**
 * The people this viewer may invite: their own connections, and nobody else.
 *
 * `listOwnConnections` takes no query and returns only the caller's own graph,
 * so there is no shape of this function that could reach a stranger — which is
 * the property that matters, since an invite to a private event is what lets
 * two people become mutually visible once they are both `going`.
 *
 * `alreadyInvited` is a display nicety, not a gate. `listEventInvites` is
 * RLS-scoped: a host sees every invite to their event, a `going` guest sees only
 * the ones they sent. So a guest may see "Invite" next to somebody the host
 * already invited, and pressing it is a harmless no-op — `inviteToEvent`
 * swallows the unique violation by design. The alternative, showing a guest who
 * else has been invited, would be a partial guest list.
 */
async function buildInviteCandidates(
  supabase: SupabaseClient,
  eventId: string,
  userId: string,
): Promise<InviteCandidate[]> {
  const [connections, invites] = await Promise.all([
    listOwnConnections(supabase, userId),
    listEventInvites(supabase, eventId),
  ]);
  const invitedIds = new Set(invites.map((invite) => invite.invited_user_id));

  return Promise.all(
    connections.map(async (connection) => ({
      userId: connection.otherUser.id,
      name: displayName(connection.otherUser),
      initials: initialsFor(connection.otherUser),
      photoUrl: await signedProfilePhotoUrl(supabase, connection.otherUser.photo_path),
      alreadyInvited: invitedIds.has(connection.otherUser.id),
    })),
  );
}

/* --------------------------------------------------------------- host row */

/**
 * "Hosted by …", or the reason it cannot say.
 *
 * The unreadable case is deliberately not silent. §7 says absence is often
 * normal and gets no error styling — this follows that — but it also says a
 * screen must never imply a capability or a fact it does not have, and an empty
 * space where a host's name goes invites the reader to assume the app is broken.
 * So the row states the rule in words: names in this product come from having
 * met somebody.
 */
function HostRow({
  name,
  initials,
  photoUrl,
  knowLine,
  isHosting,
}: {
  name: string | null;
  initials: string;
  photoUrl: string | null;
  knowLine: string | null;
  isHosting: boolean;
}) {
  return (
    <div
      className="flex items-center gap-[11px] rounded-[20px] px-[15px] py-[13px]"
      style={{ background: "rgba(255,255,255,.6)", border: "1px solid rgba(13,18,32,.07)" }}
    >
      <AvatarDisc
        size={36}
        fontSize={12}
        initials={initials}
        photoUrl={photoUrl}
        tone={name === null ? "flat" : "live"}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-[17px] font-semibold">
          {isHosting ? "You're hosting" : name === null ? "Host not shown" : `Hosted by ${name}`}
        </span>
        <span
          className="block truncate text-[12px] leading-4"
          style={{ color: name === null && knowLine === null ? "var(--sc-text-muted)" : "var(--sc-text-subtle)" }}
        >
          {knowLine ?? (name === null ? "You see someone's name once you've met them in person." : "")}
        </span>
      </span>
      {isHosting ? (
        <span
          className="shrink-0 rounded-full px-[11px] py-1.5 text-[10px] leading-[13px] font-semibold text-white"
          style={{ background: "var(--sc-text)" }}
        >
          Hosting
        </span>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- stat row */

/**
 * The four-stat row. Public numbers, for every viewer who can see the event —
 * §7's "counts are public, names are not", the *permissive* half of which is as
 * deliberate as the restrictive half: attendance numbers are not a host
 * privilege.
 *
 * There is no fifth tile and no way to add one from this data: `publicStats`
 * returns a closed union of four keys, and `pending` is not among them.
 */
function StatRow({ stats }: { stats: EventStat[] | null }) {
  if (stats === null) return null;

  return (
    <dl className="grid grid-cols-4 gap-[9px]">
      {stats.map((stat) => (
        <div key={stat.key} className="rounded-[18px] px-3 py-[13px]" style={GLASS}>
          <dd className="text-[21px] leading-[25px] font-semibold tracking-[-0.02em]">
            {stat.value}
          </dd>
          <dt className="text-[11px] leading-[15px]" style={{ color: "var(--sc-text-subtle)" }}>
            {stat.label}
          </dt>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------ side notes */

function PrivateNote() {
  return (
    <div
      className="flex items-start gap-[11px] rounded-[22px] p-[15px]"
      style={{ background: "rgba(255,255,255,.55)", border: "1px solid rgba(13,18,32,.07)" }}
    >
      <span
        className="flex size-[30px] shrink-0 items-center justify-center rounded-[10px]"
        style={{ background: "rgba(13,18,32,.05)", color: "var(--sc-text-muted)" }}
        aria-hidden
      >
        <Lock size={15} strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] leading-[17px] font-semibold">Private event</span>
        <span
          className="mt-[3px] block text-[12px] leading-[17px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          Invisible unless you were invited or already answered. Anyone going can invite one of
          their own connections — there is no link to share.
        </span>
      </span>
    </div>
  );
}

/**
 * The two "meetings here" numbers, for an event that has finished.
 *
 * Both are real columns rather than a designed flourish, and they answer
 * genuinely different questions, so they are labelled separately rather than
 * reconciled: `connectionsMade` counts *meetings* tagged to this event, which
 * never move, and `ownConnectionsHere` counts the viewer's own *active* edges
 * from it, which falls if they later remove one. The two disagreeing is
 * expected — `getOwnConnectionsAtEvent`'s header spells this out — and neither
 * names anybody.
 *
 * Nothing renders when both are zero: "0 people met here" is a claim about an
 * event, and §7's absence rule covers the honest alternative.
 */
function MetHereNote({
  connectionsMade,
  ownConnectionsHere,
}: {
  connectionsMade: number;
  ownConnectionsHere: number;
}) {
  if (connectionsMade === 0 && ownConnectionsHere === 0) return null;

  return (
    <div className="flex items-center gap-[11px] rounded-[22px] p-[15px]" style={GLASS}>
      <span
        className="flex size-[30px] shrink-0 items-center justify-center rounded-[10px]"
        style={{ background: "var(--sc-accent-tint)", color: "var(--sc-accent-deep)" }}
        aria-hidden
      >
        <Users size={15} strokeWidth={2} />
      </span>
      <span className="min-w-0 text-[13px] leading-[18px]">
        {connectionsMade > 0 ? (
          <span className="block font-semibold">
            {connectionsMade} {connectionsMade === 1 ? "meeting" : "meetings"} happened here
          </span>
        ) : null}
        {ownConnectionsHere > 0 ? (
          <span className="block" style={{ color: "var(--sc-text-muted)" }}>
            {ownConnectionsHere} of them {ownConnectionsHere === 1 ? "is" : "are"} still your
            connection
          </span>
        ) : null}
      </span>
    </div>
  );
}
