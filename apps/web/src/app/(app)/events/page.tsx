/**
 * PHASE 1 SCAFFOLD — replaced by the real Events browse screen in phase 2.
 *
 * WHY THIS FILE EXISTS AT ALL. Phase 1 ports the design system and the
 * navigation shell, and that shell has seven slots with Home at the centre
 * (`nav.tsx`, and `docs/design/DESIGN.md` §4). Events is one of the seven, so
 * the moment the dock shipped, `/events` became reachable — and with no route
 * here it would have been a 404 sitting in the middle of the navigation bar.
 *
 * WHY IT IS NOT THE REAL SCREEN YET. The designed browse screen
 * (`SmartCard 2.0.dc.html`, "Events browse") is city filter pills, an
 * upcoming/past segmented control, and cover-image cards carrying counts,
 * seats-left, "you know N going", and Hosting/Private badges. Every one of
 * those is backed by a real function in `@/server/events/events-service`
 * (`browseEvents`, `listActiveCities`, `getEventAttendanceCounts`,
 * `getConnectionsAttending`) — none of it is blocked. It is simply a screen's
 * worth of work, and stapling a rushed half-version onto the end of the
 * design-system pass would defeat the point of reviewing these in phases.
 *
 * The copy below therefore states plainly that the screen is coming, rather
 * than dressing an unbuilt feature up as an empty state. `DESIGN.md` §7 is
 * explicit that a screen must never imply a capability that is not there, and
 * "No events yet" would be a lie: there may well be events, this page just
 * cannot show them yet.
 */
import { CalendarClock } from "lucide-react";

export default function EventsPage() {
  return (
    <main className="mx-auto w-full max-w-[520px] px-5 pt-8">
      <h1 className="text-[30px] leading-[34px] font-semibold tracking-[-0.03em]">Events</h1>

      <div
        className="mt-6 flex flex-col items-center gap-3 rounded-[26px] border border-dashed px-6 py-10 text-center"
        style={{ borderColor: "rgba(13,18,32,.14)" }}
      >
        <span
          className="flex size-11 items-center justify-center rounded-2xl"
          style={{ background: "var(--sc-accent-tint)", color: "var(--sc-accent-deep)" }}
        >
          <CalendarClock size={22} strokeWidth={1.9} aria-hidden />
        </span>
        <p className="text-[17px] leading-[22px] font-semibold tracking-[-0.02em]">
          The Events screens are being built
        </p>
        <p
          className="max-w-[42ch] text-[13px] leading-[19px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          Creating events, RSVPs, the host approval queue and invites all already work
          underneath — they just have no screens yet. This page is next.
        </p>
      </div>
    </main>
  );
}
