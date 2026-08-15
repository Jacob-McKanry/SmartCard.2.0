import { describe, expect, it } from "vitest";
import type { BrowseEventItem } from "@/server/events/events-service";

import { mergeBrowseList } from "./browse-list";

/**
 * The browse list's job is to be the *only* place a viewer can reach every event
 * they are entitled to see. These tests pin the two properties that make that
 * true and are easy to break by simplifying the merge back to "just
 * `browseEvents`":
 *
 *   1. A private event the viewer may see survives (otherwise an invite is
 *      redeemable only by typing a UUID into the URL bar).
 *   2. An event that appears in two source lists renders once.
 *
 * Nothing here is a security test — RLS decided membership of every source list
 * before this function saw it, and no arrangement of these inputs can add a row
 * the caller could not already read. These are correctness tests for a product
 * filter.
 */

const NOW = Date.parse("2026-08-15T12:00:00.000Z");

function item(over: {
  id: string;
  cityId?: string;
  startsAt?: string;
  visibility?: "public" | "private";
  hostUserId?: string;
}): BrowseEventItem {
  return {
    event: {
      id: over.id,
      host_user_id: over.hostUserId ?? "host-1",
      city_id: over.cityId ?? "city-1",
      title: over.id,
      description: null,
      starts_at: over.startsAt ?? "2026-09-01T18:00:00.000Z",
      ends_at: null,
      timezone: "UTC",
      venue_name: null,
      venue_address: null,
      latitude: null,
      longitude: null,
      visibility: over.visibility ?? "public",
      capacity: null,
      requires_approval: false,
      cover_image_path: null,
      created_at: "2026-08-01T00:00:00.000Z",
    },
    city: { id: over.cityId ?? "city-1", slug: "sf", name: "San Francisco", state: "CA" },
  };
}

describe("mergeBrowseList", () => {
  it("keeps a private event the viewer holds an invite to", () => {
    const merged = mergeBrowseList({
      publicItems: [item({ id: "public-1" })],
      ownItems: [item({ id: "invited-private", visibility: "private" })],
      cityId: null,
      when: "upcoming",
      nowMs: NOW,
    });

    expect(merged.map((row) => row.event.id).sort()).toEqual(["invited-private", "public-1"]);
  });

  it("renders an event once when it appears in two source lists", () => {
    // You host a public event: it comes back from `browseEvents` AND
    // `listHostedEvents`.
    const merged = mergeBrowseList({
      publicItems: [item({ id: "mine" })],
      ownItems: [item({ id: "mine" })],
      cityId: null,
      when: "upcoming",
      nowMs: NOW,
    });

    expect(merged).toHaveLength(1);
  });

  it("applies the city filter to the viewer's own events, which arrive unfiltered", () => {
    const merged = mergeBrowseList({
      publicItems: [],
      ownItems: [
        item({ id: "here", cityId: "city-1", visibility: "private" }),
        item({ id: "elsewhere", cityId: "city-2", visibility: "private" }),
      ],
      cityId: "city-1",
      when: "upcoming",
      nowMs: NOW,
    });

    expect(merged.map((row) => row.event.id)).toEqual(["here"]);
  });

  it("applies the upcoming/past split to the viewer's own events", () => {
    const args = {
      publicItems: [],
      ownItems: [
        item({ id: "future", startsAt: "2026-09-01T18:00:00.000Z", visibility: "private" as const }),
        item({ id: "past", startsAt: "2026-07-01T18:00:00.000Z", visibility: "private" as const }),
      ],
      cityId: null,
      nowMs: NOW,
    };

    expect(mergeBrowseList({ ...args, when: "upcoming" }).map((r) => r.event.id)).toEqual([
      "future",
    ]);
    expect(mergeBrowseList({ ...args, when: "past" }).map((r) => r.event.id)).toEqual(["past"]);
  });

  it("orders upcoming soonest-first and past most-recent-first", () => {
    const rows = [
      item({ id: "a", startsAt: "2026-09-01T18:00:00.000Z" }),
      item({ id: "b", startsAt: "2026-10-01T18:00:00.000Z" }),
    ];

    expect(
      mergeBrowseList({
        publicItems: rows,
        ownItems: [],
        cityId: null,
        when: "upcoming",
        nowMs: NOW,
      }).map((r) => r.event.id),
    ).toEqual(["a", "b"]);

    expect(
      mergeBrowseList({ publicItems: rows, ownItems: [], cityId: null, when: "past", nowMs: NOW }).map(
        (r) => r.event.id,
      ),
    ).toEqual(["b", "a"]);
  });
});
