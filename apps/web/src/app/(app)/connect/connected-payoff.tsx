"use client";

import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";

import { LocalTimestamp } from "@/components/local-timestamp";

import { AvatarDisc } from "../connections/lib/avatar-disc";
import {
  ConnectButton,
  ConnectLink,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  TERTIARY_BUTTON,
} from "./lib/connect-ui";
import { loadConnectPayoff, type ConnectPayoffDetails } from "./payoff-lookup";

/**
 * "You're connected" — the biggest flourish in the app (`docs/design/
 * DESIGN.md` §6), ported from the `data-screen-label="Connected"` block of
 * `SmartCard 2.0.dc.html` (exploration 1a, "Two orbits, joined").
 *
 * THE CHOREOGRAPHY, VERBATIM FROM THE PROTOTYPE
 *
 *   0.00s  the two discs slide in from opposite sides and settle
 *          (`sc-merge` / `sc-merge-l`, .9s glide)
 *   0.50s  the checkmark medallion springs in on the seam
 *          (`sc-spring-in`, .7s spring)
 *   0.75s  its stroke draws (`sc-draw`, .5s glide)
 *   0.55s  the wordmark block rises
 *   0.70s  the buttons rise
 *
 * The medallion is a positioned outer span wrapping an animated inner span,
 * because §2 forbids animating an entrance in the same transform property
 * that is doing the centring — do not collapse the two.
 *
 * ---------------------------------------------------------------------------
 * WHERE THIS DEPARTS FROM THE DESIGN, AND WHY IT HAD TO
 *
 * **1. No tick bands on the discs.** §3's diagram encodes a person's
 * connection / event / city counts, one tick per record. Neither party's
 * counts are readable from a client: `connections` only returns edges the
 * caller is party to, other people's RSVPs are nobody's to read, and cities
 * come from meeting locations behind the consent mechanic. §3's "one tick =
 * one record" makes a decorative tick a false claim, so the discs carry the
 * two faces and the motion, and no ring is drawn. The same constraint is
 * documented on the meeting record, which is the other place §3's diagram was
 * specified.
 *
 * **2. The presenter's payoff has no counterpart and says so.** After
 * somebody scans your code, the heartbeat tells you `status: "consumed"` and
 * nothing more — deliberately, and documented at length in
 * `packages/types/src/connect/index.ts`: the presenter's session response was
 * given exactly one new bit and no identity. So `counterpart` is null on that
 * path, the second disc is drawn as an explicit unknown, and the copy states
 * that this screen is not told who scanned rather than implying the app is
 * still thinking about it. Guessing — "the newest connection in your list must
 * be them" — would be exactly the kind of plausible inference a connect screen
 * must never make.
 *
 * The scanner's payoff does have the counterpart, because `redeemQr` returns
 * a `connectionId` the caller is unambiguously a party to; see
 * `payoff-lookup.ts` for why resolving it is a subset of a page they can
 * already open, not a new exposure.
 */

export interface PayoffViewer {
  initials: string;
  photoUrl: string | null;
}

export function ConnectedPayoff({
  viewer,
  connectionId,
  onAgain,
  againLabel,
}: {
  viewer: PayoffViewer;
  /**
   * The connection that was just created, when this side of the flow knows
   * it. Null on the presenter's screen — see departure 2 in the header.
   */
  connectionId: string | null;
  /** Restart this side of the flow in place (show a new code / scan another). */
  onAgain: () => void;
  againLabel: string;
}) {
  const details = useConnectPayoffDetails(connectionId);

  return (
    <div className="flex flex-col items-center gap-6 px-1 pt-2.5 pb-1.5">
      <div className="relative flex items-center justify-center">
        <div style={{ animation: "sc-merge .9s var(--sc-ease-glide) both" }}>
          <AvatarDisc size={84} fontSize={22} initials={viewer.initials} photoUrl={viewer.photoUrl} />
        </div>
        <div
          className="-ml-3.5"
          style={{ animation: "sc-merge-l .9s var(--sc-ease-glide) both" }}
        >
          {/*
           * The dashed unknown disc is reserved for "this screen is never
           * told who" (the presenter path), and is chosen on `connectionId`
           * rather than on `details` for exactly that reason. The scanner
           * path always draws a real disc — briefly with no initials while
           * the lookup is in flight, which is a plate waiting for a face, not
           * a claim that the person is unknown. Keying it off `details` would
           * flash "we don't know who this is" at somebody who is about to be
           * shown a name.
           */}
          {connectionId === null ? (
            <UnknownDisc />
          ) : (
            <AvatarDisc
              size={84}
              fontSize={22}
              initials={details?.initials ?? ""}
              photoUrl={details?.photoUrl ?? null}
            />
          )}
        </div>

        {/* Outer positions, inner animates — §2. */}
        <span
          aria-hidden
          className="absolute top-1/2 left-1/2 size-11 -translate-x-1/2 -translate-y-1/2"
        >
          <span
            className="flex size-11 items-center justify-center rounded-full"
            style={{
              background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
              boxShadow: "0 10px 24px -8px rgba(11,96,255,.8), 0 0 0 5px var(--sc-canvas)",
              animation: "sc-spring-in .7s var(--sc-ease-spring) .5s both",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path
                d="M20 6 9 17l-5-5"
                style={{ strokeDasharray: 36, animation: "sc-draw .5s var(--sc-ease-glide) .75s both" }}
              />
            </svg>
          </span>
        </span>
      </div>

      <div
        className="flex flex-col items-center gap-1.5"
        style={{ animation: "sc-rise .5s var(--sc-ease-glide) .55s both" }}
      >
        <h2 className="text-[28px] leading-8 font-semibold tracking-[-0.035em]">
          You&rsquo;re connected
        </h2>
        {details !== null && (
          <p className="text-[15px] leading-[21px] font-semibold">{details.name}</p>
        )}

        <div className="mt-1 text-center">
          {/*
           * True on both paths and on both methods: the connection exists at
           * all only because the server verified a co-located tap or scan.
           */}
          <div
            className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.14em]"
            style={{ color: "var(--sc-text-muted)" }}
          >
            VERIFIED IN PERSON
          </div>
          {details !== null && (
            <div className="mt-[5px] font-mono text-[12px] leading-[17px] font-medium uppercase">
              {/*
               * The place clause disappears entirely when no location was
               * captured, rather than becoming "somewhere" or "nearby" — §7's
               * "absence is often normal", and a placeholder here would be a
               * claim about where two people were.
               */}
              {details.placeLabel ? `${details.placeLabel} · ` : ""}
              <LocalTimestamp iso={details.occurredAt} format="time" />
            </div>
          )}
        </div>

        {connectionId === null && (
          <p
            className="mt-2 max-w-[38ch] text-center text-[13px] leading-[19px]"
            style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
          >
            Your code was scanned in person, so the connection is already made. This screen
            isn&rsquo;t told who scanned it — open People for the new meeting record.
          </p>
        )}
      </div>

      <div
        className="flex w-full max-w-[320px] flex-col gap-[9px]"
        style={{ animation: "sc-rise .5s var(--sc-ease-glide) .7s both" }}
      >
        {connectionId === null ? (
          <ConnectLink href="/connections" style={PRIMARY_BUTTON}>
            See it in People
          </ConnectLink>
        ) : (
          <ConnectLink href={`/connections/${connectionId}`} style={PRIMARY_BUTTON}>
            See the meeting record
          </ConnectLink>
        )}
        <ConnectButton onClick={onAgain} style={SECONDARY_BUTTON}>
          {againLabel}
        </ConnectButton>
        <ConnectLink href="/" style={TERTIARY_BUTTON}>
          Continue
        </ConnectLink>
      </div>
    </div>
  );
}

/**
 * The second disc when this screen does not know who the other person is.
 *
 * Drawn as an explicit unknown — dashed edge, muted silhouette — rather than
 * as a blank or a skeleton. A skeleton would say "loading, a name is coming";
 * nothing is coming, and the copy beneath says why.
 */
function UnknownDisc() {
  return (
    <span
      className="flex size-[84px] items-center justify-center rounded-full border border-dashed"
      style={{ borderColor: "rgba(13,18,32,.2)", background: "rgba(13,18,32,.035)" }}
      aria-hidden
    >
      <UserRound size={30} strokeWidth={1.6} color="var(--sc-text-subtle)" />
    </span>
  );
}

/**
 * Resolves the counterpart's name, photo and the place/time of the meeting,
 * or stays `null` forever when there is no `connectionId` to resolve.
 *
 * Note what this deliberately does NOT do: there is no retry, no error state
 * and no spinner. The connection is already made — that fact is not
 * contingent on this lookup — so a failure degrades the screen from "you're
 * connected to Alex Chen at Blue Bottle" to "you're connected", and the
 * meeting-record link still works. Turning a cosmetic lookup into a visible
 * failure on a success screen would misreport what happened.
 */
function useConnectPayoffDetails(connectionId: string | null): ConnectPayoffDetails | null {
  /**
   * Stored *with* the id it describes, and matched on read below, rather than
   * reset whenever `connectionId` changes. Two reasons: a reset would be a
   * synchronous state update inside an effect (a cascading render React's own
   * lint rules reject), and pairing the result with its id is the stronger
   * guarantee anyway — one scan's counterpart can never be painted onto
   * another scan's payoff, even for a frame.
   */
  const [loaded, setLoaded] = useState<{
    id: string;
    details: ConnectPayoffDetails | null;
  } | null>(null);

  useEffect(() => {
    if (connectionId === null) return;

    let cancelled = false;
    void loadConnectPayoff(connectionId).then((details) => {
      if (!cancelled) setLoaded({ id: connectionId, details });
    });

    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  return loaded !== null && loaded.id === connectionId ? loaded.details : null;
}
