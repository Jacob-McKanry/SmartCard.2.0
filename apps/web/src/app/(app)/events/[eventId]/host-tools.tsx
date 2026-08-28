import Link from "next/link";
import { ListChecks, Upload } from "lucide-react";

import { HOST_PANEL } from "../lib/surfaces";

/**
 * The host's own controls, on the dark panel `docs/design/DESIGN.md` §6
 * requires: "Host-only management sits on a dark panel so it can never be
 * mistaken for the public view."
 *
 * THE DARK GROUND IS THE ACCESS RULE MADE VISIBLE, NOT A STYLE CHOICE
 *
 * A host looking at their own event sees the public numbers and their private
 * ones on the same scroll. The pending count is the one number on this screen
 * that nobody else can see, and the only thing distinguishing "everyone can see
 * this" from "only you can see this" is which surface the number is printed on.
 * If this panel ever becomes glass like the rest of the page, a host loses the
 * one cue telling them what they may repeat out loud. Anything host-only goes
 * here; nothing that is not host-only should.
 *
 * `pendingCount` arrives from `hostPendingCount`, which returns `null` for any
 * viewer this page did not establish as the host, and is itself downstream of an
 * RPC that returns `null` for a non-host. This component is rendered only for a
 * host — three independent gates for one number, which is the right ratio for
 * the one number on the page that is not public.
 *
 * WHAT IS NOT HERE, AND WHY
 *
 *  - **No guest list, and no link to one.** There is no screen behind this panel
 *    that lists who is attending. The approval queue below shows only people
 *    awaiting a decision — see `decidableQueueEntries`.
 *  - **No "un-invite".** No such capability exists at any layer, and it cannot
 *    be built as it sounds: revoking an invite would not remove visibility from
 *    somebody who has already RSVP'd, because `can_see_event`'s RSVP branch
 *    still holds. A control that silently fails exactly where a host expects it
 *    to work is worse than its absence, so §7's "never invent a capability"
 *    applies to the copy here too — nothing on this panel implies an invite can
 *    be taken back.
 *  - **No waitlist-promotion toggle.** Promotion is automatic and unconditional,
 *    inside the transaction that frees the seat. There is no per-event setting,
 *    so there is no switch to draw.
 *
 * THE GUEST-LIST IMPORT LINK IS NOT AN EXCEPTION TO "NO GUEST LIST"
 *
 * `/events/[eventId]/import` takes a CSV *in*. It does not show one back: there
 * is no read path to `event_attendee_imports` anywhere in this app, and the
 * import answers with counts rather than rows. So this panel still has no
 * screen behind it that lists who is attending, and the link's copy is careful
 * not to imply one.
 *
 * It is shown to every host rather than only to verified ones, deliberately.
 * Whether the caller may import is a question for the database, and answering
 * it here would mean this component either reading a flag it has no business
 * holding or hiding a door for the wrong reason during an outage. The page
 * behind the link explains itself to a host who cannot use it yet — a visible
 * "here is why not" beats a control that silently is not there.
 *
 * WHAT IS HERE THAT A READER MIGHT EXPECT ON THE CREATE FORM
 *
 * The cover-image control (`coverSlot`). A cover's Storage key is
 * `{event_id}/cover.{ext}` and the policies parse the event id out of it to
 * decide whether the writer is the host, so a cover cannot exist before its
 * event does — the create form has no id to key one under and no host for a
 * policy to check. Setting a cover is also host-only, which is what makes this
 * panel its right home rather than a general edit screen.
 */
export function HostTools({
  eventId,
  pendingCount,
  isPrivate,
  inviteSlot,
  coverSlot,
}: {
  eventId: string;
  /** Host-only queue depth. `null` when the counts could not be read. */
  pendingCount: number | null;
  isPrivate: boolean;
  /** The invite launcher, when this event can take invites. */
  inviteSlot?: React.ReactNode;
  /** The cover-image control. Host-only, hence its place on this panel. */
  coverSlot?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-[11px] rounded-[26px] p-[17px]" style={HOST_PANEL}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[14px] leading-[18px] font-semibold">Your hosting view</h2>
        {pendingCount === null ? null : (
          <span
            className="rounded-full px-[11px] py-[5px] text-[11px] leading-[14px] font-semibold"
            style={{ background: "rgba(255,255,255,.14)" }}
          >
            {pendingCount} pending
          </span>
        )}
      </div>

      <p
        className="text-[12px] leading-[18px]"
        style={{ color: "rgba(255,255,255,.62)", textWrap: "pretty" }}
      >
        Only you see the pending count and the names of people waiting on your decision. Everyone
        else sees the same counts you do above — and nobody, including you, gets a list of who is
        going.
      </p>

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/events/${eventId}/queue`}
          className="flex min-h-11 items-center gap-[7px] rounded-full px-[18px] text-[13px] leading-[17px] font-semibold"
          style={{ background: "#ffffff", color: "var(--sc-text)" }}
        >
          <ListChecks size={15} strokeWidth={2.1} aria-hidden />
          Approval queue
        </Link>
        <Link
          href={`/events/${eventId}/import`}
          className="flex min-h-11 items-center gap-[7px] rounded-full px-[18px] text-[13px] leading-[17px] font-semibold"
          style={{ border: "1px solid rgba(255,255,255,.22)", color: "#fff" }}
        >
          <Upload size={15} strokeWidth={2.1} aria-hidden />
          Import a guest list
        </Link>
        {inviteSlot}
      </div>

      {coverSlot === undefined ? null : (
        <div
          className="flex flex-col gap-2 border-t pt-[11px]"
          style={{ borderTopColor: "rgba(255,255,255,.12)" }}
        >
          <h3 className="text-[13px] leading-[17px] font-semibold">Cover image</h3>
          {coverSlot}
        </div>
      )}

      {isPrivate ? null : (
        <p className="text-[12px] leading-[17px]" style={{ color: "rgba(255,255,255,.5)" }}>
          This event is public, so there is nobody to invite — anyone signed in can already find it
          and answer.
        </p>
      )}
    </section>
  );
}
