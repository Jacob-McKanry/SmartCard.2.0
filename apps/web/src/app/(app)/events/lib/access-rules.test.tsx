import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RsvpStatus } from "@smartcard/types";

import type { EventAttendanceCounts, HostQueueEntry } from "@/server/events/events-service";

import {
  connectionsAttendingLine,
  decidableQueueEntries,
  hostPendingCount,
  publicStats,
  rsvpMismatchNotice,
  viewerRole,
} from "./access-rules";
import { rsvpPillStyle } from "./rsvp-pill";
import { EventCard, type EventCardProps } from "../event-card";
import { HostTools } from "../[eventId]/host-tools";
import { QueueView } from "../[eventId]/queue/queue-view";

/**
 * THE ACCESS RULES OF THE EVENTS SCREENS, TESTED AS RULES.
 *
 * These are deliberately not happy-path tests. Every one of them describes
 * something the screens must **refuse** to do, and each is written so that the
 * obvious future mistake — a reasonable-looking `.map()` over data the page
 * already holds — turns it red.
 *
 * Two kinds of assertion appear below and both are needed:
 *
 *   - Pure-function assertions prove the rule module gives the right answer.
 *   - `renderToStaticMarkup` assertions prove no component renders a value the
 *     rule module said to withhold. A pure test cannot catch a component that
 *     ignores its inputs and reaches for the raw count itself; the markup can.
 *
 * The fixtures use absurd sentinel values (`PENDING_COUNT = 4242`, ids that are
 * obvious strings) precisely so `expect(markup).not.toContain(...)` cannot pass
 * by coincidence against some other number on the card.
 *
 * `../actions` is mocked because it is a `"use server"` module whose import
 * chain reaches Kinde and the Supabase client. Nothing here exercises a Server
 * Action — the rules under test are about what is *drawn* — and pulling a real
 * auth stack into a rendering test would make it fail for reasons that have
 * nothing to do with the rule it is checking.
 */
/**
 * `next/link` reads Next's router context, which only exists inside a real Next
 * render. Swapping it for a plain anchor keeps these tests about what text ends
 * up in the markup — the thing the access rules are about — rather than about
 * the framework. The `href` is preserved so a test could still assert on where a
 * link points.
 */
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * Lucide icons are stubbed, and the reason is mechanical rather than a shortcut.
 * pnpm installs `lucide-react/node_modules/react` to satisfy its peer range, so
 * inside a plain Node run the icon components hold a *second* React instance
 * whose hook dispatcher is null, and any render containing one throws.
 *
 * Nothing is lost. Every icon in these screens is `aria-hidden` decoration, and
 * §8's rule is that colour and iconography are never the only signal — the words
 * beside them carry the meaning, and the words are exactly what these tests
 * assert on.
 */
vi.mock("lucide-react", () => {
  const Stub = () => <svg aria-hidden />;
  // Named one by one rather than through a Proxy: a Proxy that answers every
  // key also answers `then`, which makes the module namespace thenable and hangs
  // the dynamic import Vitest uses to load it.
  return {
    Check: Stub,
    ChevronLeft: Stub,
    Clock: Stub,
    ListChecks: Stub,
    Lock: Stub,
    Upload: Stub,
    UserPlus: Stub,
    Users: Stub,
    X: Stub,
  };
});

/**
 * Same nested-React problem as the icons, this time via `@radix-ui/react-avatar`
 * inside `AvatarDisc`. Only the Radix primitives are stubbed, so `AvatarDisc`
 * itself still runs and still decides what it puts on screen — which is
 * initials and a photo URL, never a name.
 */
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  AvatarImage: () => null,
  AvatarFallback: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../actions", () => ({
  createEventAction: vi.fn(),
  updateEventAction: vi.fn(),
  inviteToEventAction: vi.fn(),
  requestRsvpAction: vi.fn(),
  withdrawRsvpAction: vi.fn(),
  decideRsvpAction: vi.fn(),
}));

/** Host-only, and deliberately unmistakable in a string of markup. */
const PENDING_COUNT = 4242;

function counts(over: Partial<EventAttendanceCounts> = {}): EventAttendanceCounts {
  return {
    going: 3,
    interested: 2,
    waitlist: 1,
    pending: PENDING_COUNT,
    capacity: 10,
    seatsRemaining: 7,
    isFull: false,
    connectionsMade: 0,
    ...over,
  };
}

function queueEntry(over: Partial<HostQueueEntry> = {}): HostQueueEntry {
  return {
    rsvpId: "rsvp-1",
    userId: "user-1",
    status: "pending",
    respondedAt: "2026-08-01T10:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    capacityOverride: false,
    firstName: "Pending",
    lastName: "Person",
    username: "pendingperson",
    photoPath: null,
    ...over,
  };
}

function card(over: Partial<EventCardProps> = {}): EventCardProps {
  return {
    eventId: "event-1",
    title: "Rooftop supper club",
    startsAt: "2026-09-01T18:00:00.000Z",
    timezone: "UTC",
    venueName: "The roof",
    cityName: "San Francisco",
    isPrivate: false,
    isHosting: false,
    isCancelled: false,
    isDraft: false,
    attendedViaGuestList: false,
    coverUrl: null,
    counts: counts(),
    knowLine: null,
    ownStatus: null,
    ...over,
  };
}

const EVERY_ROLE = ["host", "answered", "onlooker"] as const;

/* ========================================================================= */

describe("Rule 1 — the attendee list is nobody's", () => {
  it("drops every non-decidable row from the host queue, including `going`", () => {
    const entries = [
      queueEntry({ rsvpId: "a", userId: "u-a", status: "pending", firstName: "Ada" }),
      queueEntry({ rsvpId: "b", userId: "u-b", status: "waitlist", firstName: "Bo" }),
      queueEntry({ rsvpId: "c", userId: "u-c", status: "going", firstName: "Cass" }),
      queueEntry({ rsvpId: "d", userId: "u-d", status: "denied", firstName: "Dee" }),
      queueEntry({ rsvpId: "e", userId: "u-e", status: "interested", firstName: "Eli" }),
      queueEntry({ rsvpId: "f", userId: "u-f", status: "not_going", firstName: "Fin" }),
    ];

    expect(decidableQueueEntries(entries).map((entry) => entry.rsvpId)).toEqual(["a", "b"]);
  });

  it("never renders an attending person's name to the host, even though the RPC returns it", () => {
    // `event_rsvp_queue` really does hand the host `going` rows with names on
    // them. Rendering them would be a guest list. This is the assertion that
    // stops somebody "fixing" the filter later.
    const markup = renderToStaticMarkup(
      <QueueView
        role="host"
        eventId="event-1"
        eventTitle="Rooftop supper club"
        seatsRemaining={7}
        entries={[
          queueEntry({ rsvpId: "a", userId: "u-a", status: "pending", firstName: "Askingperson" }),
          queueEntry({ rsvpId: "c", userId: "u-c", status: "going", firstName: "Attendingperson" }),
        ]}
        photoUrls={{}}
      />,
    );

    expect(markup).toContain("Askingperson");
    expect(markup).not.toContain("Attendingperson");
  });

  it("renders no queue at all to a viewer who is not the host", () => {
    for (const role of EVERY_ROLE.filter((r) => r !== "host")) {
      const markup = renderToStaticMarkup(
        <QueueView
          role={role}
          eventId="event-1"
          eventTitle="Rooftop supper club"
          seatsRemaining={7}
          entries={[queueEntry({ firstName: "Askingperson" })]}
          photoUrls={{}}
        />,
      );

      expect(markup).toBe("");
      expect(markup).not.toContain("Askingperson");
    }
  });

  it("produces no attendee identities on a browse card for any viewer role", () => {
    // The page passes a finished sentence, never ids — but if a future edit
    // passed the summary through, this is what catches it.
    for (const role of EVERY_ROLE) {
      const markup = renderToStaticMarkup(
        <EventCard
          {...card({
            isHosting: role === "host",
            ownStatus: role === "answered" ? "going" : null,
            knowLine: connectionsAttendingLine({
              going: ["identity-going-1", "identity-going-2"],
              interested: ["identity-interested-1"],
            }),
          })}
        />,
      );

      expect(markup).toContain("You know 2 going");
      expect(markup).not.toContain("identity-going-1");
      expect(markup).not.toContain("identity-going-2");
      expect(markup).not.toContain("identity-interested-1");
    }
  });
});

describe("Rule 2 — counts are public, the pending count is host-only", () => {
  it("hands the pending count to the host", () => {
    expect(hostPendingCount(counts(), "host")).toBe(PENDING_COUNT);
  });

  it("withholds it from every other role even when the RPC leaked a number", () => {
    // The RPC already returns `pending: null` to a non-host. This asserts the
    // *second* gate: if that ever changed, or the counts were fetched with the
    // wrong client, the screen still refuses. Fail closed.
    for (const role of EVERY_ROLE.filter((r) => r !== "host")) {
      expect(hostPendingCount(counts(), role)).toBeNull();
    }
  });

  it("cannot express a pending count in the public stat row", () => {
    const stats = publicStats(counts());

    expect(stats.map((stat) => stat.key)).toEqual(["going", "interested", "waitlist", "seats"]);
    expect(stats.map((stat) => stat.value)).not.toContain(String(PENDING_COUNT));
    expect(stats.map((stat) => stat.label).join(" ")).not.toContain("pending");
  });

  it("never prints the pending count on a browse card, including the host's own", () => {
    for (const role of EVERY_ROLE) {
      const markup = renderToStaticMarkup(<EventCard {...card({ isHosting: role === "host" })} />);
      expect(markup).not.toContain(String(PENDING_COUNT));
    }
  });

  it("prints the pending count only on the host panel, and only when it was granted", () => {
    const shown = renderToStaticMarkup(
      <HostTools eventId="event-1" pendingCount={hostPendingCount(counts(), "host")} isPrivate />,
    );
    expect(shown).toContain(`${PENDING_COUNT} pending`);

    for (const role of EVERY_ROLE.filter((r) => r !== "host")) {
      const withheld = renderToStaticMarkup(
        <HostTools eventId="event-1" pendingCount={hostPendingCount(counts(), role)} isPrivate />,
      );
      expect(withheld).not.toContain(String(PENDING_COUNT));
      expect(withheld).not.toContain("pending<");
    }
  });

  it("keeps going / interested / waitlist / seats public for every role", () => {
    // The permissive half of the rule is as deliberate as the restrictive half:
    // attendance numbers are not a host privilege.
    for (const role of EVERY_ROLE) {
      const markup = renderToStaticMarkup(<EventCard {...card({ isHosting: role === "host" })} />);
      expect(markup).toContain("3 going");
      expect(markup).toContain("7 seats left");
    }
  });

  it("says 'no cap' rather than zero seats when capacity is unlimited", () => {
    const stats = publicStats(counts({ capacity: null, seatsRemaining: null }));
    const seats = stats.find((stat) => stat.key === "seats");

    expect(seats?.value).toBe("∞");
    expect(seats?.label).toBe("no cap");
  });
});

describe("Rule 3 — 'you know N going' is a count, never a roster", () => {
  it("returns a sentence built from lengths and never an identity", () => {
    const line = connectionsAttendingLine({
      going: ["id-a", "id-b", "id-c"],
      interested: ["id-d"],
    });

    expect(line).toBe("You know 3 going · 1 interested");
    expect(line).not.toContain("id-");
  });

  it("keeps the two counts separate rather than summing them", () => {
    // Q21: "5 of your connections will be there" is a promise the data does not
    // support when two of them tapped *maybe*.
    expect(connectionsAttendingLine({ going: ["a", "b", "c"], interested: ["d", "e"] })).not.toContain(
      "5",
    );
  });

  it("says nothing at all when you know nobody", () => {
    expect(connectionsAttendingLine({ going: [], interested: [] })).toBeNull();
  });

  it("omits the empty half rather than printing a zero", () => {
    expect(connectionsAttendingLine({ going: ["a"], interested: [] })).toBe("You know 1 going");
    expect(connectionsAttendingLine({ going: [], interested: ["a"] })).toBe(
      "You know 1 interested",
    );
  });
});

describe("Rule 4 — render stored state, never the tapped intent", () => {
  it("renders the stored status when it differs from what was tapped", () => {
    // Tapped "going" on an approval-gated event; the database stored `pending`.
    const markup = renderToStaticMarkup(<EventCard {...card({ ownStatus: "pending" })} />);

    expect(markup).toContain("Waiting on host");
    expect(markup).not.toContain(">Going<");
  });

  it("renders the stored status when a full event turned a tap into a waitlist place", () => {
    const markup = renderToStaticMarkup(<EventCard {...card({ ownStatus: "waitlist" })} />);

    expect(markup).toContain("Waitlisted");
    expect(markup).not.toContain(">Going<");
  });

  it("explains an approval-gated mismatch without claiming the seat", () => {
    const notice = rsvpMismatchNotice("going", "pending");

    expect(notice).not.toBeNull();
    expect(notice).toContain("not a seat");
  });

  it("explains a capacity mismatch as a waitlist place", () => {
    expect(rsvpMismatchNotice("going", "waitlist")).toContain("waitlist");
  });

  it("says nothing when the stored status is what was asked for", () => {
    expect(rsvpMismatchNotice("going", "going")).toBeNull();
    expect(rsvpMismatchNotice("interested", "interested")).toBeNull();
  });

  it("treats a withdrawal as an absence of an answer, not a mismatch", () => {
    expect(rsvpMismatchNotice("going", null)).toBeNull();
  });
});

describe("§5 status pills — six states, and `going` is the only solid accent", () => {
  const EVERY_STATUS: RsvpStatus[] = [
    "going",
    "interested",
    "waitlist",
    "pending",
    "not_going",
    "denied",
  ];

  it("gives every status its own words, so colour is never the only signal (§8)", () => {
    const labels = EVERY_STATUS.map((status) => rsvpPillStyle(status).label);
    expect(new Set(labels).size).toBe(EVERY_STATUS.length);
    expect(labels.every((label) => label.trim() !== "")).toBe(true);
  });

  it("reserves the solid accent field for `going` alone", () => {
    expect(rsvpPillStyle("going").background).toBe("var(--sc-accent)");
    for (const status of EVERY_STATUS.filter((s) => s !== "going")) {
      expect(rsvpPillStyle(status).background).not.toBe("var(--sc-accent)");
    }
  });

  it("keeps `--pending` for waiting and never for a success", () => {
    expect(rsvpPillStyle("pending").color).toBe("var(--sc-pending)");
    for (const status of EVERY_STATUS.filter((s) => s !== "pending")) {
      expect(rsvpPillStyle(status).color).not.toBe("var(--sc-pending)");
    }
  });
});

describe("viewerRole", () => {
  it("calls the event's own host the host", () => {
    expect(viewerRole("user-1", "user-1", null)).toBe("host");
  });

  it("does not promote somebody to host for holding a `going` RSVP", () => {
    expect(viewerRole("host-1", "user-2", { status: "going" })).toBe("answered");
  });

  it("treats an unanswered non-host as an onlooker", () => {
    expect(viewerRole("host-1", "user-2", null)).toBe("onlooker");
  });
});
