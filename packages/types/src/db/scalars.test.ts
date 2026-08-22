import { z } from "zod";
import { describe, expect, it } from "vitest";

import { withoutDefaults } from "./scalars";
import { eventUpdateSchema } from "./events";
import { socialLinkUpdateSchema } from "./social-links";

/**
 * Regression tests for a real, shipping bug found 2026-08-22 while building
 * the mobile events routes: `insertSchema.partial()` does not make a
 * default-bearing field optional in the sense anyone editing this file would
 * expect. Zod still runs the field's own schema — default included — against
 * `undefined` when a key is omitted, so `.partial()` alone turns "leave this
 * field alone" into "reset this field to its create-time default". See
 * `withoutDefaults`'s header for the mechanism and for which two schemas in
 * this package had it.
 *
 * The generic test proves the mechanism in isolation; the two schema-specific
 * tests each pin down exactly the field that was silently resetting in
 * production before this fix, so a future refactor that reintroduces
 * `.partial()` directly on an insert schema fails here rather than being
 * rediscovered by someone's event losing its capacity or someone's social
 * links reordering themselves.
 */
describe("withoutDefaults", () => {
  const base = z.object({
    title: z.string(),
    visibility: z.enum(["public", "private"]).default("private"),
    capacity: z.number().nullable().default(null),
  });

  it("leaves an omitted defaulted field genuinely absent after .partial()", () => {
    const schema = withoutDefaults(base).partial().strict();

    expect(schema.parse({ title: "New title" })).toEqual({ title: "New title" });
  });

  it("still validates a field that IS supplied, using its real (non-default) rules", () => {
    const schema = withoutDefaults(base).partial().strict();

    expect(() => schema.parse({ visibility: "sideways" })).toThrow();
    expect(schema.parse({ visibility: "public" })).toEqual({ visibility: "public" });
  });

  it("leaves a field with no default entirely unaffected", () => {
    const schema = withoutDefaults(base).partial().strict();

    expect(() => schema.parse({ title: 42 })).toThrow();
  });

  it("demonstrates the bug directly: plain .partial() DOES resurrect defaults", () => {
    // Not testing this package's exported schemas here — proving the
    // underlying Zod behaviour that motivated `withoutDefaults` at all, so
    // this test still means something if Zod ever changes it.
    const naive = base.partial().strict();

    expect(naive.parse({ title: "New title" })).toEqual({
      title: "New title",
      visibility: "private",
      capacity: null,
    });
  });
});

describe("eventUpdateSchema no longer resets unrelated columns", () => {
  it("updating only the title touches nothing else", () => {
    expect(eventUpdateSchema.parse({ title: "New title" })).toEqual({ title: "New title" });
  });

  it("updating only capacity does not also reset visibility, description, or the cover", () => {
    expect(eventUpdateSchema.parse({ capacity: 50 })).toEqual({ capacity: 50 });
  });

  it("a field that IS sent is still checked by its real validator", () => {
    // capacity must be positive per eventInsertSchema — withoutDefaults must
    // not have accidentally loosened that on the way to removing the default.
    expect(() => eventUpdateSchema.parse({ capacity: 0 })).toThrow();
  });
});

describe("socialLinkUpdateSchema no longer resets display_order", () => {
  it("updating only platform and url leaves display_order untouched", () => {
    expect(
      socialLinkUpdateSchema.parse({ platform: "instagram", url: "https://instagram.com/x" }),
    ).toEqual({ platform: "instagram", url: "https://instagram.com/x" });
  });

  it("updating only display_order still validates its type", () => {
    expect(() => socialLinkUpdateSchema.parse({ display_order: "first" })).toThrow();
  });
});
