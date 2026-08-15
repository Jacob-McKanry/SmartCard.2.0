"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { Check, UserPlus, X } from "lucide-react";

import { AvatarDisc } from "../../connections/lib/avatar-disc";
import { inviteToEventAction } from "../actions";
import { initialEventActionState } from "../action-state";
import { SECONDARY_BUTTON } from "../lib/surfaces";

/**
 * "Give someone access" — the invite sheet from the prototype's `inviteOpen`
 * block, spec'd in `docs/design-lab-reference.md` under Invites.
 *
 * IT IS A CONNECTION PICKER AND IT CANNOT BE ANYTHING ELSE. THAT IS THE POINT.
 *
 * There is no email field, no name field, no "invite by link", and no search
 * across people — only a list of the viewer's own connections, and a filter over
 * that list. This is the security-relevant half of the invite feature, not a
 * convenience:
 *
 *   An invite makes a private event visible. Two people both `going` to one
 *   event become mutually readable profiles (`private.shares_event_with`, §3.4).
 *   So an invite that could reach a stranger would be a way to gain profile
 *   visibility of somebody you have never met — no tap, no scan — which is the
 *   one thing CLAUDE.md's non-negotiable product rule exists to prevent.
 *
 * The database already enforces it: the `event_invites` INSERT policy requires
 * `private.are_connected(caller, invitee)`, so a forged id in this form is
 * refused, not merely unhelpful. What this component must not do is *imply*
 * otherwise. A free-text recipient box would advertise a capability that does
 * not exist and would produce an unexplainable refusal on every use.
 *
 * The filter box below searches only the names already on screen. It never
 * queries the server, so there is no request that could be widened later into a
 * people search — the list arrived complete from `listOwnConnections`, which
 * returns the caller's own graph and takes no query.
 *
 * WHY THE BUTTON SAYS "INVITE" AND THE RESULT SAYS "INVITED", NEVER "ADDED"
 *
 * An invite grants visibility and creates no RSVP. The person still answers for
 * themselves — that invariant is what keeps `shares_event_with()` safe — so copy
 * that read "added to the guest list" would describe a different feature.
 *
 * THERE IS NO UN-INVITE, AND NOTHING HERE PRETENDS THERE IS
 *
 * Once sent, an invite row cannot be removed (20260814060100 records why: a
 * DELETE would not remove visibility from anyone who had already answered, so it
 * would work only when it did not matter). The sent state is therefore a plain
 * "Invited" label, not a toggle.
 */
export interface InviteCandidate {
  userId: string;
  name: string;
  initials: string;
  /** Signed, short-lived URL, or `null`. */
  photoUrl: string | null;
  /** Whether an invite this viewer can see already exists for them. */
  alreadyInvited: boolean;
}

export function InviteLauncher({
  eventId,
  candidates,
  tone,
}: {
  eventId: string;
  candidates: readonly InviteCandidate[];
  /** `dark` when launched from the host panel, `light` from an attendee's block. */
  tone: "dark" | "light";
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-[7px] rounded-full px-[18px] text-[13px] leading-[17px] font-semibold"
        style={
          tone === "dark"
            ? { border: "1px solid rgba(255,255,255,.22)", background: "transparent", color: "#fff" }
            : SECONDARY_BUTTON
        }
      >
        <UserPlus size={15} strokeWidth={2.1} aria-hidden />
        Invite a connection
      </button>
      {open ? <InviteSheet eventId={eventId} candidates={candidates} onClose={close} /> : null}
    </>
  );
}

function InviteSheet({
  eventId,
  candidates,
  onClose,
}: {
  eventId: string;
  candidates: readonly InviteCandidate[];
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const needle = filter.trim().toLowerCase();
  const shown =
    needle === "" ? candidates : candidates.filter((c) => c.name.toLowerCase().includes(needle));

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col justify-end"
      style={{ background: "rgba(13,18,32,.28)", backdropFilter: "blur(3px)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-sheet-title"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[78%] flex-col rounded-t-[32px]"
        style={{
          background: "rgba(255,255,255,.9)",
          backdropFilter: "blur(34px) saturate(1.8)",
          WebkitBackdropFilter: "blur(34px) saturate(1.8)",
          borderTop: "1px solid rgba(255,255,255,.9)",
          boxShadow: "0 -20px 60px rgba(13,18,32,.24)",
          animation: "sc-sheet .46s var(--sc-ease-glide) both",
        }}
      >
        <div className="flex items-start gap-3 px-[22px] pt-5 pb-3.5">
          <div className="min-w-0 flex-1">
            <h2
              id="invite-sheet-title"
              className="text-[18px] leading-[23px] font-semibold tracking-[-0.02em]"
            >
              Give someone access
            </h2>
            <p
              className="mt-0.5 text-[12px] leading-[17px]"
              style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
            >
              Your connections only. An invite lets them see the event — they still answer for
              themselves, and an invite can&rsquo;t be taken back.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-11 shrink-0 items-center justify-center rounded-full"
            style={{
              border: "1px solid rgba(13,18,32,.1)",
              background: "rgba(255,255,255,.7)",
              color: "var(--sc-text-muted)",
            }}
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>

        {candidates.length === 0 ? (
          <p
            className="px-[22px] pb-6 text-[13px] leading-[19px]"
            style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
          >
            You have no connections to invite yet. An invite can only reach somebody you have
            already met in person — there is no other way to add a name to this list.
          </p>
        ) : (
          <>
            <div className="px-[22px] pb-3">
              <label className="sr-only" htmlFor="invite-filter">
                Filter your connections
              </label>
              <input
                id="invite-filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter your connections"
                className="h-11 w-full rounded-[16px] px-[15px] text-[14px] leading-5 outline-none"
                style={{
                  border: "1px solid rgba(13,18,32,.1)",
                  background: "rgba(255,255,255,.85)",
                }}
              />
            </div>
            <ul className="flex flex-1 flex-col gap-1 overflow-y-auto px-3.5 pb-[22px]">
              {shown.map((candidate) => (
                <li key={candidate.userId}>
                  <InviteRow eventId={eventId} candidate={candidate} />
                </li>
              ))}
              {shown.length === 0 ? (
                <li
                  className="px-3 py-4 text-[13px] leading-[19px]"
                  style={{ color: "var(--sc-text-muted)" }}
                >
                  Nobody in your connections matches that.
                </li>
              ) : null}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function InviteRow({ eventId, candidate }: { eventId: string; candidate: InviteCandidate }) {
  const [state, formAction, pending] = useActionState(
    inviteToEventAction.bind(null, eventId),
    initialEventActionState,
  );
  const sent = candidate.alreadyInvited || state.success === true;

  return (
    <form action={formAction} className="flex items-center gap-3 rounded-[18px] px-2.5 py-2.5">
      <input type="hidden" name="invited_user_id" value={candidate.userId} />
      <AvatarDisc size={40} fontSize={13} initials={candidate.initials} photoUrl={candidate.photoUrl} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] leading-[19px] font-semibold">
          {candidate.name}
        </span>
        {state.error !== undefined ? (
          <span className="block text-[12px] leading-4" style={{ color: "var(--sc-danger)" }}>
            {state.error}
          </span>
        ) : null}
      </span>
      {sent ? (
        <span
          className="flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2.5 text-[12px] leading-4 font-semibold"
          style={{ background: "rgba(11,96,255,.08)", color: "var(--sc-accent-deep)" }}
        >
          <Check size={13} strokeWidth={2.4} aria-hidden />
          Invited
        </span>
      ) : (
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 shrink-0 rounded-full px-4 text-[12px] leading-4 font-semibold text-white disabled:opacity-70"
          style={{ background: "var(--sc-accent)" }}
        >
          {pending ? "Inviting…" : "Invite"}
        </button>
      )}
    </form>
  );
}
