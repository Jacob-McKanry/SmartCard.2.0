import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { countEventsAttended } from "./attendance-count";
import { listAttendingEvents } from "./events-service";

/**
 * THE BUG THIS FILE EXISTS FOR
 *
 * Profile used to derive "events attended" by filtering `listAttendingEvents`
 * in TypeScript. That function is capped at the 50 most recent RSVPs — right for
 * a browse list, wrong as the input to a count — so a person with more than 50
 * qualifying RSVPs was shown 50 on their own profile, while `/card/<code>`,
 * which counted in SQL, showed strangers the true figure. Neither screen said
 * anything was missing.
 *
 * The interesting case is therefore *above* the cap, and it is the case the old
 * code got wrong. `above the 50-row cap` below is the regression test proper:
 * with 63 qualifying RSVPs the counter answers 63, and — asserted in the same
 * test, against the same fake database — the old derivation over
 * `listAttendingEvents` answers 50. If a future change quietly routes the count
 * back through a row list, the first assertion fails and the second explains
 * why.
 *
 * WHAT THE FAKE MODELS, AND WHY IT IS WORTH THE LINES
 *
 * The two behaviours that produced the bug: PostgREST's `count: "exact"` with
 * `head: true` reports the size of the whole matching set regardless of any row
 * limit, and `.limit(n)` truncates a row query. A fake that ignored either would
 * make both code paths agree and the test would prove nothing. It also models
 * the filters both queries apply (`user_id`, `status`, and `events.starts_at` in
 * the past) so "counts the right rows" is tested alongside "counts all of them".
 *
 * It is NOT a Supabase emulator and does not attempt to be: no RLS, no policy
 * evaluation. RLS is what decides *whose* rows either query can see, and that is
 * not testable from this environment (this sandbox cannot reach the project's
 * Supabase host — the same limit recorded against the auth-bridge checks). What
 * is testable here is the arithmetic that was wrong, and it is what this covers.
 */

interface RsvpFixtureRow {
  id: string;
  event_id: string;
  user_id: string;
  status: string;
  responded_at: string;
  decided_by: string | null;
  decided_at: string | null;
  capacity_override: boolean;
}

interface EventFixtureRow {
  id: string;
  starts_at: string;
  [column: string]: unknown;
}

const SUBJECT = "11111111-1111-1111-1111-111111111111";
const SOMEBODY_ELSE = "22222222-2222-2222-2222-222222222222";
const NOW = new Date("2026-08-15T12:00:00.000Z");

/** An RSVP plus the event it points at, as one fixture line. */
function rsvp(options: {
  index: number;
  userId?: string;
  status?: string;
  startsAt: string;
}): { rsvp: RsvpFixtureRow; event: EventFixtureRow } {
  const eventId = `event-${options.index}`;
  return {
    rsvp: {
      id: `rsvp-${options.index}`,
      event_id: eventId,
      user_id: options.userId ?? SUBJECT,
      status: options.status ?? "going",
      // Descending `responded_at` order is what decides which 50 rows survive
      // the cap, so the fixture gives every row a distinct one.
      responded_at: new Date(Date.UTC(2026, 0, 1) + options.index * 86_400_000).toISOString(),
      decided_by: null,
      decided_at: null,
      capacity_override: false,
    },
    event: {
      id: eventId,
      host_user_id: SOMEBODY_ELSE,
      city_id: "city-1",
      title: `Event ${options.index}`,
      description: null,
      starts_at: options.startsAt,
      ends_at: null,
      timezone: null,
      venue_name: null,
      venue_address: null,
      latitude: null,
      longitude: null,
      visibility: "public",
      capacity: null,
      requires_approval: false,
      cover_image_path: null,
      created_at: "2026-01-01T00:00:00.000Z",
      cities: { id: "city-1", slug: "nyc", name: "New York", state: "NY" },
    },
  };
}

/**
 * The smallest thing that behaves like the two PostgREST queries under test.
 *
 * Filters are collected as they are chained and applied at await time, which is
 * how supabase-js's builder behaves. `head: true` resolves to `{ data: null,
 * count }` — an empty body and a count of the whole matching set — and a row
 * query resolves to `{ data }` truncated by `.limit()`. That asymmetry is the
 * bug, modelled.
 */
function fakeClient(
  rsvps: RsvpFixtureRow[],
  events: EventFixtureRow[],
): { client: SupabaseClient; queries: { table: string; head: boolean }[] } {
  const queries: { table: string; head: boolean }[] = [];

  function builderFor(table: string) {
    const eq: [string, unknown][] = [];
    let inFilter: [string, unknown[]] | null = null;
    let startsBefore: string | null = null;
    let limit: number | null = null;
    let head = false;

    function matchingRsvps(): RsvpFixtureRow[] {
      return rsvps.filter((row) => {
        for (const [column, value] of eq) {
          if ((row as unknown as Record<string, unknown>)[column] !== value) return false;
        }
        if (startsBefore !== null) {
          const event = events.find((candidate) => candidate.id === row.event_id);
          // `events!inner` — no event, no row, which is exactly what an inner
          // join does and is also what RLS would produce for an event the
          // caller cannot see.
          if (event === undefined) return false;
          if (!(new Date(event.starts_at).getTime() < new Date(startsBefore).getTime())) {
            return false;
          }
        }
        return true;
      });
    }

    function matchingEvents(): EventFixtureRow[] {
      return events.filter((row) => {
        if (inFilter !== null && inFilter[0] === "id" && !inFilter[1].includes(row.id)) return false;
        return true;
      });
    }

    function resolve(): { data: unknown; error: null; count: number | null } {
      queries.push({ table, head });
      if (table === "event_rsvps") {
        const rows = matchingRsvps();
        if (head) {
          // The whole matching set, never the truncated page.
          return { data: null, error: null, count: rows.length };
        }
        return {
          data: limit === null ? rows : rows.slice(0, limit),
          error: null,
          count: null,
        };
      }
      const rows = matchingEvents();
      return { data: limit === null ? rows : rows.slice(0, limit), error: null, count: null };
    }

    const builder = {
      select(_columns: string, options?: { count?: string; head?: boolean }) {
        head = options?.head === true;
        return builder;
      },
      eq(column: string, value: unknown) {
        eq.push([column, value]);
        return builder;
      },
      in(column: string, values: unknown[]) {
        inFilter = [column, values];
        return builder;
      },
      lt(column: string, value: string) {
        // The only `lt` either query makes is against the embedded event.
        if (column === "events.starts_at") startsBefore = value;
        return builder;
      },
      order() {
        // Both real queries order by `responded_at` descending, and the fixture
        // is built in ascending index order, so reverse to match.
        rsvps.reverse();
        return builder;
      },
      limit(value: number) {
        limit = value;
        return builder;
      },
      then(onFulfilled: (value: ReturnType<typeof resolve>) => unknown) {
        return Promise.resolve(resolve()).then(onFulfilled);
      },
    };
    return builder;
  }

  return {
    client: { from: (table: string) => builderFor(table) } as unknown as SupabaseClient,
    queries,
  };
}

const PAST = "2026-03-01T18:00:00.000Z";
const FUTURE = "2026-12-01T18:00:00.000Z";

describe("countEventsAttended", () => {
  it("is exact above the 50-row cap, where deriving it from a list is not", async () => {
    // 63 — comfortably past `BROWSE_LIMIT`, and not a round number, so an
    // off-by-something is visible rather than plausible.
    const fixture = Array.from({ length: 63 }, (_, index) =>
      rsvp({ index, startsAt: PAST }),
    );
    const { client } = fakeClient(
      fixture.map((f) => f.rsvp),
      fixture.map((f) => f.event),
    );

    await expect(countEventsAttended(client, SUBJECT, NOW)).resolves.toBe(63);

    // The old derivation, against the same data: `listAttendingEvents` returns
    // 50 rows because that is what it is for, and counting them gives 50. This
    // assertion is the bug, pinned — it documents why the count must not be
    // rebuilt on top of a row list.
    const listed = await listAttendingEvents(client, SUBJECT);
    expect(listed).toHaveLength(50);
    expect(listed.filter((item) => item.rsvp.status === "going")).toHaveLength(50);
  });

  it("counts only `going`, and only events that have already started", async () => {
    const fixture = [
      rsvp({ index: 0, startsAt: PAST }),
      rsvp({ index: 1, startsAt: PAST }),
      // Answered `going`, but the event has not happened yet — not attendance.
      rsvp({ index: 2, startsAt: FUTURE }),
      // Past events with every other status. None of these is attendance;
      // `going` is the only one the database itself treats as such.
      rsvp({ index: 3, startsAt: PAST, status: "interested" }),
      rsvp({ index: 4, startsAt: PAST, status: "pending" }),
      rsvp({ index: 5, startsAt: PAST, status: "waitlist" }),
      rsvp({ index: 6, startsAt: PAST, status: "denied" }),
      rsvp({ index: 7, startsAt: PAST, status: "not_going" }),
      // Somebody else's attendance at a past event.
      rsvp({ index: 8, startsAt: PAST, userId: SOMEBODY_ELSE }),
    ];
    const { client } = fakeClient(
      fixture.map((f) => f.rsvp),
      fixture.map((f) => f.event),
    );

    await expect(countEventsAttended(client, SUBJECT, NOW)).resolves.toBe(2);
  });

  it("returns zero rather than failing when there is nothing to count", async () => {
    const { client } = fakeClient([], []);
    await expect(countEventsAttended(client, SUBJECT, NOW)).resolves.toBe(0);
  });

  it("transfers no rows — it asks for a count with an empty body", async () => {
    // The property that lets the card preview run this on the service-role
    // client with no policy behind it: `head: true` means the widest thing a bug
    // here can disclose is a different number, never a person. Asserted rather
    // than trusted to the comment that says so.
    const fixture = [rsvp({ index: 0, startsAt: PAST })];
    const { client, queries } = fakeClient(
      fixture.map((f) => f.rsvp),
      fixture.map((f) => f.event),
    );

    await countEventsAttended(client, SUBJECT, NOW);

    expect(queries).toEqual([{ table: "event_rsvps", head: true }]);
  });

  it("throws rather than reporting a zero it did not compute", async () => {
    // A missing count header with no error. Defaulting to 0 here would put "no
    // events attended" on a profile as though it were a fact — DESIGN.md §7's
    // exact prohibition — so the caller has to be told and decide.
    const brokenClient = {
      from: () => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          lt: () => builder,
          then: (onFulfilled: (value: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null, count: null }).then(onFulfilled),
        };
        return builder;
      },
    } as unknown as SupabaseClient;

    await expect(countEventsAttended(brokenClient, SUBJECT, NOW)).rejects.toThrow(
      /without a count/,
    );
  });

  it("throws on a query error rather than swallowing it", async () => {
    const failingClient = {
      from: () => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          lt: () => builder,
          then: (onFulfilled: (value: unknown) => unknown) =>
            Promise.resolve({
              data: null,
              error: { message: "permission denied for table event_rsvps" },
              count: null,
            }).then(onFulfilled),
        };
        return builder;
      },
    } as unknown as SupabaseClient;

    await expect(countEventsAttended(failingClient, SUBJECT, NOW)).rejects.toThrow(
      /permission denied/,
    );
  });
});
