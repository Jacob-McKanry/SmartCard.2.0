import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BadgeCheck, CalendarX2, ChevronLeft, Lock, Users } from "lucide-react";
import type { RsvpStatus } from "@smartcard/types";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { isVerifiedHost } from "@/server/events/attendee-import-service";
import {
  getConnectionsAttending,
  getEventAttendanceCounts,
  getEventForViewer,
  getEventHostProfile,
  getOwnConnectionsAtEvent,
  getOwnRsvp,
} from "@/server/events/events-service";
import { listEventInvites } from "@/server/events/events-service";
import { listOwnAttendedEventIds } from "@/server/events/attended-events-service";
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
import { CancelEventButton } from "./cancel-event-button";
import { CoverUploader } from "./cover-uploader";
import { DeleteDraftButton } from "./delete-draft-button";
import { HostTools } from "./host-tools";
import { InviteLauncher, type InviteCandidate } from "./invite-launcher";
import { PublishDraftButton } from "./publish-draft-button";

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
 *  5. **"You were on the guest list" (`AttendedNote`, C5) is not an RSVP.** It
 *     reads `own_attended_events()` — the viewer's own claimed CSV-import
 *     rows — and renders independently of `ownRsvp`. §2.4 of the import
 *     design keeps attendance out of the RSVP status enum on purpose.
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

  const [ownRsvp, counts, connectionsAttending, host, coverUrl, ownConnectionsHere, attendedEventIds] =
    await Promise.all([
      getOwnRsvp(supabase, event.id, userId),
      getEventAttendanceCounts(supabase, event.id),
      getConnectionsAttending(supabase, event.id),
      getEventHostProfile(supabase, event.host_user_id),
      signedEventCoverUrl(supabase, event.cover_image_path),
      getOwnConnectionsAtEvent(supabase, event.id, userId),
      listOwnAttendedEventIds(supabase),
    ]);
  const wasClaimedGuest = attendedEventIds.has(event.id);

  const role = viewerRole(event.host_user_id, userId, ownRsvp);
  const knowLine = connectionsAttendingLine(connectionsAttending);
  const hostPhotoUrl = host ? await signedProfilePhotoUrl(supabase, host.photo_path) : null;
  const ended = eventHasEndedNow(event.starts_at, event.ends_at);

  /*
   * A cancelled event is, today, one whose host deleted their account —
   * `public.soft_delete_own_account()` (20260815130300) is the only writer of
   * this column. You are seeing it because you already answered for it, were
   * invited to it, or host it: the amended `private.can_see_event`
   * (20260815130200) dropped cancelled events from the "any authenticated user
   * may see a public event" branch, so nobody else finds it at all.
   *
   * Every control that could change the guest list is withheld below, and that
   * is a correctness fix rather than tidiness: the trigger in 20260815130100
   * refuses every INSERT and UPDATE on `event_rsvps` for a cancelled event, so
   * an RSVP button here would be a control whose only possible outcome is an
   * error.
   */
  const isCancelled = event.status === "cancelled";

  /*
   * `events.status === 'draft'` (20260830150000). This branch only ever runs
   * for the host: `private.can_see_event`'s public branch requires
   * `status = 'scheduled'`, and this page's own `getEventForViewer` read is
   * gated by exactly that function via the `events` SELECT policy — so a
   * signed-in stranger's request for a draft 404s before this line ever
   * executes (`getEventForViewer` returns null for "does not exist" and "you
   * may not see it" identically, per that function's own header). The RSVP
   * block and the invite controls are withheld below for the same reason
   * `isCancelled` withholds them: `request_event_rsvp` would not refuse a
   * host RSVPing to their own draft (nothing currently gates that), but
   * offering the control here would invite a use nobody asked for on an event
   * that is not live to anyone else yet.
   */
  const isDraft = event.status === "draft";

  // Only asked when it matters: a draft is visible to nobody but its host
  // (the SELECT policy's public branch requires `status = 'scheduled'`), so
  // whenever `isDraft` is true here the viewer already IS the host — no
  // separate role check needed before spending this RPC call.
  const canPublish = isDraft ? await isVerifiedHost(supabase) : false;

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
    !isCancelled &&
    !isDraft &&
    event.visibility === "private" &&
    (role === "host" || ownRsvp?.status === "going");
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

      {isCancelled ? <CancelledNotice ownStatus={ownRsvp?.status ?? null} /> : null}
      {isDraft ? <DraftNotice eventId={event.id} canPublish={canPublish} /> : null}

      <HostRow
        name={host === null ? null : displayName(host)}
        initials={host === null ? "•" : initialsFor(host)}
        photoUrl={hostPhotoUrl}
        knowLine={knowLine}
        isHosting={role === "host"}
      />

      {wasClaimedGuest ? <AttendedNote /> : null}

      <StatRow stats={counts === null ? null : publicStats(counts)} />

      {event.description?.trim() ? (
        <p
          className="max-w-[58ch] text-[14px] leading-[22px] whitespace-pre-line"
          style={{ textWrap: "pretty" }}
        >
          {event.description.trim()}
        </p>
      ) : null}

      {isCancelled || isDraft ? null : (
        <RsvpBlock
          eventId={event.id}
          storedStatus={ownRsvp?.status ?? null}
          requiresApproval={event.requires_approval}
          isFull={counts?.isFull ?? false}
          hasEnded={ended}
          isPrivate={event.visibility === "private"}
          isHost={role === "host"}
        />
      )}

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
          /*
           * The cover control, host-only — see `cover-uploader.tsx` for why it
           * lives after creation rather than on the create form. `hasCover` is
           * the stored column, so the button reads "Add"/"Replace" from what the
           * database holds rather than from anything this render assumed.
           */
          coverSlot={
            <CoverUploader eventId={event.id} hasCover={event.cover_image_path !== null} />
          }
          /*
           * Only for a LIVE event. A draft's own delete lives on
           * `DraftNotice` instead (a real delete, not a cancel — see that
           * component's header), and an already-cancelled event has nothing
           * left to cancel.
           */
          dangerSlot={
            !isCancelled && !isDraft ? (
              <CancelEventButton
                eventId={event.id}
                going={counts?.going ?? 0}
                pendingOrWaitlisted={(counts?.pending ?? 0) + (counts?.waitlist ?? 0)}
              />
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

/**
 * The banner a cancelled event carries, at the top of the page rather than
 * beside the RSVP block.
 *
 * WHY IT IS THE FIRST THING UNDER THE COVER
 *
 * The whole reason a cancelled event stays visible is that "the event vanished"
 * is a worse outcome for the people who answered than "the event is cancelled"
 * — so the news has to arrive before the date, the venue and the stat row,
 * which otherwise read as an event that is still on. A quiet badge next to the
 * title would technically be present and practically be missed.
 *
 * WHAT IT DOES NOT SAY, AND WHY
 *
 * It does not say the host deleted their account. That is true today — this
 * column has exactly one writer — but it is somebody else's private decision,
 * and disclosing it to everyone who ever RSVP'd would be a much larger
 * disclosure than the event's own status. The `users` policy was just amended to
 * hide the person; announcing the reason on their events would put it straight
 * back. "The host cancelled it" is what an attendee needs and all they are owed.
 *
 * It also does not invent a refund, a contact route or a rescheduling promise:
 * §7's rule, and none of the three exists.
 */
function CancelledNotice({ ownStatus }: { ownStatus: RsvpStatus | null }) {
  return (
    <div
      className="flex items-start gap-[11px] rounded-[22px] p-[15px]"
      style={{ background: "rgba(217,45,32,.06)", border: "1px solid rgba(217,45,32,.22)" }}
    >
      <span
        className="flex size-[30px] shrink-0 items-center justify-center rounded-[10px]"
        style={{ background: "rgba(217,45,32,.1)", color: "var(--sc-danger)" }}
        aria-hidden
      >
        <CalendarX2 size={15} strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] leading-[17px] font-semibold">
          This event was cancelled
        </span>
        <span
          className="mt-[3px] block text-[12px] leading-[17px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          {/*
           * The second sentence is chosen by what the person actually asked
           * for, because "your request is still waiting" is the specific wrong
           * impression a cancelled event's queue would otherwise leave — and
           * nobody can answer it: the host's decision path refuses a cancelled
           * event outright.
           */}
          {ownStatus === "pending" || ownStatus === "waitlist"
            ? "It is not going ahead, so your request will not be answered. Nothing else about your account changes."
            : "It is not going ahead. It stays here so you know, rather than disappearing from your list."}
        </span>
      </span>
    </div>
  );
}

/**
 * The banner a draft carries, at the top of the page — same position as
 * `CancelledNotice`, for the same reason: whether this event is live is the
 * first thing worth knowing before the date, venue and stat row that
 * otherwise read as an ordinary, already-public event.
 *
 * Only ever rendered for the host (see `isDraft`'s own comment on the page
 * component), so there is no separate "you are the host" branch here the way
 * `HostRow` has one — this whole component IS the host-only branch.
 *
 * `canPublish` decides which control this banner offers, added 2026-09-01
 * alongside publishing's own verified-host gate (20260901130000): a verified
 * host gets the "Publish event" button exactly as before; an unverified one
 * gets a prompt to apply instead of a button that would only be refused. Same
 * §7 reasoning `CreateEventForm` already applies to hiding "Publish event"
 * outright — a control that leads to a guaranteed refusal is worse than its
 * absence, and the account's actual database-enforced standing is what
 * decides which is shown, not a client-side guess.
 */
function DraftNotice({ eventId, canPublish }: { eventId: string; canPublish: boolean }) {
  return (
    <div
      className="flex flex-col gap-[13px] rounded-[22px] p-[15px]"
      style={{ background: "rgba(13,18,32,.04)", border: "1px solid rgba(13,18,32,.1)" }}
    >
      <span className="min-w-0">
        <span className="block text-[13px] leading-[17px] font-semibold">This is a draft</span>
        <span
          className="mt-[3px] block text-[12px] leading-[17px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          Only you can see it. Publish when it&rsquo;s ready — nobody else finds a draft, however
          it&rsquo;s set to who-can-find-it.
        </span>
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {canPublish ? (
          <PublishDraftButton eventId={eventId} />
        ) : (
          <Link
            href="/host/apply"
            className="flex min-h-11 shrink-0 items-center rounded-full px-[16px] text-[12.5px] leading-[17px] font-semibold"
            style={{ background: "var(--sc-text)", color: "#fff" }}
          >
            Apply to publish
          </Link>
        )}
        {/*
         * A real delete, not a cancel — see `delete-draft-button.tsx`'s own
         * header. Sits beside Publish/Apply rather than on `HostTools`,
         * because both buttons here answer the same question ("what happens
         * to this draft") and splitting them across two panels would make a
         * host hunt for the second one.
         */}
        <DeleteDraftButton eventId={eventId} />
      </div>
    </div>
  );
}

/**
 * C5 — §4.3 of the 2026-08-22 attendee-import design: "the event page...
 * plus 'You attended this.'" Shown whenever the viewer's own claimed rows
 * (`own_attended_events()`, 20260828150000) include this event.
 *
 * WHY THE WORDS ARE NOT "YOU ATTENDED", EVEN THOUGH §4.3's OWN HEADING SAYS
 * THAT
 *
 * §2.3.1 is explicit that the softening it requires for the claim screens
 * "applies to any 'you attended' chip" on the event page too — this system
 * has no check-in signal from any CSV a host has ever uploaded, only "the
 * host said this person was on the list." Copying §4.3's heading verbatim
 * would be exactly the regression that rule exists to prevent, so this uses
 * the identical phrasing `claim-review.tsx` and `claim-teaser.tsx` already
 * use rather than inventing a third variant of the same sentence.
 *
 * WHY THIS IS COMPLETELY SEPARATE FROM `ownRsvp`/`RsvpBlock`
 *
 * §2.4 of the import design: "deliberately not adding an `attended` value to
 * the RSVP status enum... 'events I attended' is answered from the claimed
 * import rows instead, which touches nothing existing." This note reads
 * `attendedEventIds`, never `ownRsvp.status`, and renders independently of
 * it — a claimed guest can also hold any RSVP status (`going`, no row at
 * all, even `denied` for a private event they later got added to by CSV) and
 * none of that combination needs the RSVP machinery to know about this.
 */
function AttendedNote() {
  return (
    <div
      className="flex items-center gap-[11px] rounded-[22px] p-[15px]"
      style={{ background: "var(--sc-accent-tint)", border: "1px solid rgba(11,96,255,.18)" }}
    >
      <span
        className="flex size-[30px] shrink-0 items-center justify-center rounded-[10px]"
        style={{ background: "rgba(255,255,255,.6)", color: "var(--sc-accent-deep)" }}
        aria-hidden
      >
        <BadgeCheck size={15} strokeWidth={2} />
      </span>
      <span className="min-w-0 text-[13px] leading-[18px] font-medium">
        You were on the guest list for this event.
      </span>
    </div>
  );
}

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
