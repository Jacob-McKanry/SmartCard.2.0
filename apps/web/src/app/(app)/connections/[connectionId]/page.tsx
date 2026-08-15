import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, QrCode } from "lucide-react";
import type { MeetingLocationRow, MeetingRow, UserRow } from "@smartcard/types";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";
import {
  getConnectionForViewer,
  getMeetingLocation,
  getMeetingParticipants,
  getMeetingRecord,
  getOtherParticipantProfile,
} from "@/server/connections/connections-service";

import { LocalTimestamp } from "@/components/local-timestamp";

import { displayName, initialsFor, verificationMethodLabel } from "../lib/format";
import { AvatarDisc } from "../lib/avatar-disc";
import { deriveLocationSharingStatus } from "./location-sharing";
import { LocationControls } from "./location-controls";
import { RemoveConnection } from "./remove-connection";

/**
 * The meeting-record view for one connection (README build order item 3;
 * task doc §"A meeting-record view"). This is the first screen to touch the
 * location-consent mechanic, so read this alongside
 * `20260809211200_rls_policies_graph_and_meetings.sql` before changing it —
 * every value rendered below is fetched, not assumed, and every control maps
 * to exactly one column-level UPDATE grant in that migration (see the build
 * report for the mapping table).
 *
 * WHY THIS RENDERS EVEN A `removed` CONNECTION, JUST WITHOUT CONTROLS
 *
 * The `connections` select policy has no status filter — a participant can
 * always read their own edge, active or removed (this is what makes
 * "confirm the removal happened" possible at all). Rather than 404 a
 * just-removed connection's old URL, this page shows the historical meeting
 * record and drops the mutation controls, since there is nothing left to
 * manage. As of the design pass this is not a fallback for a bookmarked URL
 * but the *designed destination* of the removal itself — `docs/design/
 * DESIGN.md` §6 "Connection removed" — so `removeConnectionAction` no longer
 * redirects away from it. See that action's header for the deviation note.
 *
 * WHY A MISSING CONNECTION 404s INSTEAD OF SHOWING AN ERROR
 *
 * `getConnectionForViewer` returns `null` for both "no such connection" and
 * "exists, but you're not a party to it" — see that function's comment for
 * why those two cases are deliberately indistinguishable. Either way, a
 * generic 404 is the right response: it says nothing about which case it
 * was, which is the same posture the connect flow takes toward rejections
 * (§4.2 step 7 — never confirm or deny specifics to someone not entitled to
 * them).
 *
 * ---------------------------------------------------------------------------
 * DESIGN PASS (`docs/design/DESIGN.md` §6 "Meeting record" / "Connection
 * removed", ported from the `Connection detail` and `Connection removed`
 * blocks of `SmartCard 2.0.dc.html`).
 *
 * WHAT THE DESIGN ASKED FOR THAT THE DATABASE CANNOT HONESTLY PROVIDE
 *
 * §6 specifies the hero as "their ring diagram … name + role + counts", the
 * counts being that person's connections / events attended / cities met people
 * in. None of the three is readable here, and that is a deliberate property of
 * the schema rather than a missing query:
 *
 *   - connections: the `connections` select policy only ever returns edges the
 *     *caller* is a party to, so their total is not countable by anyone but
 *     them;
 *   - events: §7's "the attendee list is nobody's" — RSVPs of other people are
 *     not readable;
 *   - cities: derived from the locations of their meetings, which are gated by
 *     the same consent mechanic this very screen manages.
 *
 * Counting any of them would require the service role, i.e. deliberately
 * stepping around the policies, to render decoration. So the hero is the
 * person's avatar with the accent halo and no tick bands, and the caption is
 * the one thing that is unambiguously true and verified — that this meeting
 * happened in person. Ticks are never invented: §3's "one tick = one record"
 * means a fabricated ring is a false statement, not a placeholder. This is
 * recorded here rather than in DESIGN.md because the constraint is a property
 * of the access rules, and DESIGN.md's own preamble says the access rule wins.
 */
export const dynamic = "force-dynamic";

const GLASS_PANEL: React.CSSProperties = {
  background: "var(--sc-glass-bg)",
  backdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  WebkitBackdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  border: "1px solid var(--sc-glass-bd)",
  boxShadow: "var(--sc-glass-sh)",
};

export default async function ConnectionDetailPage({
  params,
}: {
  params: Promise<{ connectionId: string }>;
}) {
  const { connectionId } = await params;
  const context = await getAuthenticatedContext();

  if (context === null) {
    redirect("/sign-in");
  }

  const { supabase, userId } = context;

  const connection = await getConnectionForViewer(supabase, connectionId);
  if (connection === null) {
    notFound();
  }

  const otherUserId = connection.user_a_id === userId ? connection.user_b_id : connection.user_a_id;

  const [meeting, participants, location, otherUser] = await Promise.all([
    getMeetingRecord(supabase, connection.origin_meeting_id),
    getMeetingParticipants(supabase, connection.origin_meeting_id),
    getMeetingLocation(supabase, connection.origin_meeting_id),
    getOtherParticipantProfile(supabase, otherUserId),
  ]);

  /*
   * A null `meeting` still means something is structurally wrong: `meetings.id`
   * is referenced by `connections.origin_meeting_id` with ON DELETE RESTRICT
   * (§2.3), so it cannot go missing under a live edge.
   *
   * AMENDED 2026-08-15 — A NULL `otherUser` NOW HAS AN ORDINARY CAUSE. This
   * comment used to say the same about both, on the grounds that the `users`
   * policy had already let the connection resolve to `otherUserId`. Since
   * 20260815130200 that policy drops its `are_connected` branch for a person
   * whose account is `deleted`, so the other party's profile legitimately stops
   * resolving while the connection row stays exactly where it was — the edge is
   * left `active` on purpose, because removing it is one-way and would make the
   * soft delete irreversible.
   *
   * Both still 404, which is the right answer for the new case as well as the
   * old one: there is no meeting record to show without the other person, and
   * this page is reached from a list they have already disappeared from.
   */
  if (meeting === null || otherUser === null) {
    notFound();
  }

  const viewerParticipant = participants.find((p) => p.user_id === userId) ?? null;
  const otherParticipant = participants.find((p) => p.user_id === otherUserId) ?? null;
  if (viewerParticipant === null || otherParticipant === null) {
    notFound();
  }

  const otherName = displayName(otherUser);
  const photoUrl = await signedProfilePhotoUrl(supabase, otherUser.photo_path);

  if (connection.status === "removed") {
    return (
      <ConnectionRemoved
        otherUser={otherUser}
        otherName={otherName}
        photoUrl={photoUrl}
        meeting={meeting}
        location={location}
      />
    );
  }

  return (
    <main
      className="mx-auto flex w-full max-w-[640px] flex-col gap-[18px] px-[22px] pt-4 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <BackToPeople />

      {/* Outer element positions, inner element animates — §2's motion rule. */}
      <div className="flex h-[168px] items-center justify-center">
        <div className="relative">
          <span
            aria-hidden
            className="absolute rounded-full"
            style={{
              inset: -26,
              background:
                "radial-gradient(circle at 50% 50%, var(--sc-accent-tint), transparent 70%)",
              animation: "sc-halo 4.5s ease-in-out infinite",
            }}
          />
          <AvatarDisc size={92} fontSize={25} initials={initialsFor(otherUser)} photoUrl={photoUrl} />
        </div>
      </div>

      <div className="text-center">
        <h1 className="text-[25px] leading-[29px] font-semibold tracking-[-0.035em]">{otherName}</h1>
        <p
          className="mt-2 font-mono text-[10px] leading-[14px] font-medium tracking-[0.14em]"
          style={{ color: "var(--sc-text-muted)" }}
        >
          VERIFIED IN PERSON
        </p>
      </div>

      <section
        aria-labelledby="meeting-heading"
        className="flex flex-col gap-[11px] rounded-[24px] px-4 py-[15px]"
        style={GLASS_PANEL}
      >
        <h2 id="meeting-heading" className="sr-only">
          How you connected
        </h2>
        <MeetingFacts otherName={otherName} meeting={meeting} location={location} />

        {location === null ? (
          <>
            <Divider />
            {/*
             * No location row means there is nothing to consent about, so the
             * three controls are not rendered at all rather than rendered
             * inert — an inert toggle implies a value that could be changed.
             * §7's "absence is often normal": this gets a plain explanation,
             * not an error.
             */}
            <p
              className="text-[12px] leading-[17px]"
              style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
            >
              {meeting.verification_method === "nfc_card"
                ? `No location was recorded. An NFC tap proves you were within physical range of the card, so it doesn't need GPS — there's nothing here to share or hide.`
                : `No location was recorded for this meeting, so there's nothing here to share or hide.`}
            </p>
          </>
        ) : (
          <>
            <Divider />
            <LocationControls
              meetingId={meeting.id}
              connectionId={connection.id}
              otherName={otherName}
              locationVisibility={meeting.location_visibility}
              viewerConsent={viewerParticipant.location_share_consent}
              otherConsent={otherParticipant.location_share_consent}
              viewerMarkedPrivate={viewerParticipant.marked_private}
              otherMarkedPrivate={otherParticipant.marked_private}
              sharingStatus={deriveLocationSharingStatus({
                locationVisibility: meeting.location_visibility,
                viewerConsent: viewerParticipant.location_share_consent,
                otherConsent: otherParticipant.location_share_consent,
                hiddenByPrivacyOverride:
                  meeting.is_private ||
                  viewerParticipant.marked_private ||
                  otherParticipant.marked_private,
              })}
            />
          </>
        )}
      </section>

      <div className="flex gap-2 pb-2">
        <Link
          href="/"
          className="flex min-h-11 flex-1 items-center justify-center rounded-[16px] px-3 py-3 text-[13px] leading-[17px] font-semibold text-white"
          style={{ background: "var(--sc-text)" }}
        >
          Continue
        </Link>
        <RemoveConnection connectionId={connection.id} otherName={otherName} />
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ pieces */

function BackToPeople() {
  return (
    <Link
      href="/connections"
      className="-ml-1 inline-flex min-h-11 items-center gap-1.5 self-start px-1 text-[13px] leading-[18px] font-medium"
      style={{ color: "var(--sc-text-muted)" }}
    >
      <ChevronLeft size={16} strokeWidth={2} aria-hidden />
      People
    </Link>
  );
}

function Divider() {
  return <div aria-hidden className="h-px" style={{ background: "rgba(13,18,32,.08)" }} />;
}

/**
 * Who / When / How / Where — §6's four-row grid, in that order.
 *
 * "Where" is always rendered, including when there is nothing to put in it.
 * Hiding the row when a meeting has no location would make its absence look
 * like a rendering quirk; naming it and saying "not recorded" is §7's
 * "absence is often normal" done properly.
 */
function MeetingFacts({
  otherName,
  meeting,
  location,
}: {
  otherName: string;
  meeting: MeetingRow;
  location: MeetingLocationRow | null;
}) {
  const rows: readonly [string, React.ReactNode][] = [
    ["Who", `You and ${otherName}`],
    ["When", <LocalTimestamp key="when" iso={meeting.occurred_at} />],
    ["How", verificationMethodLabel(meeting.verification_method)],
    ["Where", placeRowFor(meeting.verification_method, location)],
  ];

  return (
    <dl className="grid grid-cols-[60px_1fr] gap-x-3 gap-y-[7px] text-[12.5px] leading-[17px]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt style={{ color: "var(--sc-text-subtle)" }}>{term}</dt>
          <dd style={{ textWrap: "pretty" }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * What the "Where" row says. THREE states, not two — collapsing the middle one
 * into the first was a bug, and the one the owner reported as "it didn't
 * confirm the location".
 *
 * A `meeting_locations` row exists if and only if the verification captured a
 * GPS fix, and `place_label` is filled in *separately, afterwards*, by
 * `server/connect/geocode.ts`, which is explicitly allowed to fail (§2.4: "a
 * missing label is a cosmetic loss, not a security one"). So:
 *
 *  - **No row.** Nothing was captured. For `nfc_card` that is by design and
 *    permanent; for `qr_gps` it is unusual, but still just an absence.
 *  - **Row, no label.** The location *was* recorded — for a `qr_gps` meeting
 *    it is the very thing that let the connection be made at all — and only
 *    the human-readable name for it is missing.
 *  - **Row with a label.** Say the place.
 *
 * The middle case used to print "Not recorded", which is a false statement
 * about the record, on the screen whose entire job is to be the record. §7
 * forbids a screen implying something it cannot back, and it forbids it in
 * this direction too: understating what happened is as much a false claim as
 * overstating it, and here it quietly told two people that the GPS check
 * behind their connection had not happened.
 *
 * The wording is lifted verbatim from `feed/feed-item.tsx`'s `PlaceLine`,
 * which already drew this distinction — deliberately word-for-word, so the two
 * screens cannot drift into describing one state two ways.
 */
function placeRowFor(
  method: MeetingRow["verification_method"],
  location: MeetingLocationRow | null,
): string {
  if (location === null) {
    return method === "nfc_card" ? "Not recorded — an NFC tap doesn't use GPS" : "Not recorded";
  }
  return location.place_label ?? "Location captured, no place name on file";
}

/* ------------------------------------------------- the removed-state screen */

/**
 * §6 "Connection removed": the history stays, the rings go dashed and greyed,
 * the copy states plainly that nothing restores it, and the only button opens
 * Connect with a line saying that is all it does.
 *
 * THE THREE THINGS THIS SCREEN MUST NOT DO
 *
 *  1. **Imply a way back.** No "reconnect", no "restore", no "undo", and the
 *     Connect button is captioned with exactly what it does and does not do.
 *     There is no `removed -> active` grant, so any softer framing would be
 *     describing a capability that does not exist (§7).
 *  2. **Keep showing the location controls.** Every one of them writes to a
 *     row the viewer can still *read* as history, but changing a sharing
 *     setting on a connection that no longer exists is meaningless — and
 *     rendering them would suggest the relationship is merely paused.
 *  3. **Reuse the live avatar treatment.** The greyed, dashed variant is the
 *     state's only at-a-glance signal, paired with the words "Connection
 *     removed" so colour is never carrying it alone (§8).
 */
function ConnectionRemoved({
  otherUser,
  otherName,
  photoUrl,
  meeting,
  location,
}: {
  otherUser: Pick<UserRow, "first_name" | "last_name">;
  otherName: string;
  photoUrl: string | null;
  meeting: MeetingRow;
  location: MeetingLocationRow | null;
}) {
  // Built from the stored row, never asserted: the place clause disappears
  // entirely when no location was captured rather than becoming "somewhere".
  // Unlike the "Where" row above this omits the label-less case too — in a
  // sentence, ", location captured, no place name on file," is noise about a
  // connection the reader has just ended, and leaving a clause out claims
  // nothing either way.
  const where = location?.place_label;

  // A fragment rather than one string, because the timestamp is a component
  // now: it has to reach the browser as an element the inline script can
  // correct to the reader's own zone, which a `${...}` interpolation into a
  // template literal cannot be. See `@/components/local-timestamp`.
  const historyLine = (
    <>
      The record of the meeting stays here as your history —{" "}
      <LocalTimestamp iso={meeting.occurred_at} />
      {where ? `, ${where}` : ""}
      {`, ${verificationMethodLabel(meeting.verification_method).toLowerCase()}. `}
      Nothing about it is shared any further, and {otherName} can no longer see your profile.
    </>
  );

  return (
    <main
      className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-[22px] pt-4 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <BackToPeople />

      <div className="flex items-center gap-4" style={{ opacity: 0.72 }}>
        <div className="relative size-[120px] shrink-0">
          {[68, 94, 118].map((diameter, index) => (
            <span
              key={diameter}
              aria-hidden
              className="absolute top-1/2 left-1/2 rounded-full border border-dashed"
              style={{
                width: diameter,
                height: diameter,
                margin: -diameter / 2,
                borderColor: `rgba(13,18,32,${[0.16, 0.13, 0.1][index]})`,
              }}
            />
          ))}
          <span className="absolute top-1/2 left-1/2 -mt-[26px] -ml-[26px]">
            <AvatarDisc
              size={52}
              fontSize={15}
              initials={initialsFor(otherUser)}
              photoUrl={photoUrl}
              tone="removed"
            />
          </span>
        </div>
        <div className="min-w-0">
          <h1
            className="text-[23px] leading-[27px] font-semibold tracking-[-0.03em]"
            style={{ color: "var(--sc-text-muted)" }}
          >
            {otherName}
          </h1>
          <p className="mt-[3px] text-[13px] leading-[18px]" style={{ color: "var(--sc-text-muted)" }}>
            Connection removed
          </p>
        </div>
      </div>

      <div
        className="flex flex-col gap-2.5 rounded-[22px] p-4"
        style={{ background: "rgba(255,255,255,.6)", border: "1px solid rgba(13,18,32,.07)" }}
      >
        <p className="text-[13.5px] leading-5" style={{ textWrap: "pretty" }}>
          {historyLine}
        </p>
        <Divider />
        <p
          className="text-[12.5px] leading-[18px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          There&rsquo;s no button that undoes this. Connecting again means being in the same place
          again — a tap or a scan, like the first time.
        </p>
      </div>

      <Link
        href="/connect"
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full py-[14px] text-[14px] leading-[18px] font-semibold text-white"
        style={{
          background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
          boxShadow: "0 14px 30px -10px rgba(11,96,255,.55)",
        }}
      >
        <QrCode size={17} strokeWidth={1.9} aria-hidden />
        Connect again in person
      </Link>
      <Link
        href="/"
        className="flex min-h-11 items-center justify-center py-1.5 text-[14px] leading-[18px] font-semibold"
        style={{ color: "var(--sc-text-muted)" }}
      >
        Continue
      </Link>
      <p
        className="mb-2 text-center text-[12px] leading-4"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        Opens Connect — it doesn&rsquo;t notify {otherName} and it doesn&rsquo;t restore anything on
        its own.
      </p>
    </main>
  );
}
