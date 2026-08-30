import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  IGNORE_COLUMN,
  detectColumnMapping,
  normaliseImportRows,
  type ColumnMapping,
  type NormalizeResult,
} from "@smartcard/core";

import { assignColumn } from "./import-fields";
import { ImportDone } from "./import-done";
import { ReviewAndAttest } from "./review-and-attest";

/**
 * THE IMPORT SCREENS, TESTED AS THE RULES THEY HAVE TO KEEP.
 *
 * Same posture as `events/lib/access-rules.test.tsx`, and for the same reason:
 * these are not happy-path tests. Each one describes something the screens must
 * refuse to do, written so the obvious future mistake turns it red.
 *
 * THREE RULES ARE UNDER TEST HERE.
 *
 *   1. ONE FIELD, ONE COLUMN. Two columns mapped to `email` does not error and
 *      does not merge — `normaliseImportRows` takes the first match in key
 *      order, so one silently wins. That produces a guest list keyed on the
 *      wrong address, found out when the claim emails reach nobody. The UI must
 *      make the state unreachable rather than warn about it.
 *
 *   2. THE ATTESTATION GATES THE SUBMIT. It is the feature's lawful basis for
 *      holding contact details belonging to people who never signed up, so the
 *      button cannot be pressable before the box is ticked, and the box cannot
 *      arrive pre-ticked.
 *
 *   3. THE RESULT SCREEN NAMES NOBODY. `skipped_already_claimed` says how many
 *      of the host's guests already hold accounts. Which ones is a fact about
 *      those people, not about the host's file.
 *
 * `./actions` is mocked because it is a `"use server"` module whose import
 * chain reaches Kinde and the Supabase client. Nothing here invokes a Server
 * Action — these rules are about what is *drawn* and what is *pressable* —
 * and pulling a real auth stack into a rendering test would make it fail for
 * reasons unrelated to the rule under test.
 */
vi.mock("./actions", () => ({
  importAttendeesAction: async () => ({}),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * Lucide icons are stubbed for the mechanical reason `access-rules.test.tsx`
 * sets out: pnpm installs `lucide-react/node_modules/react` to satisfy its peer
 * range, so inside a plain Node run the icon components hold a *second* React
 * instance whose hook dispatcher is null, and any render containing one throws.
 *
 * Nothing is lost — every icon on these screens is `aria-hidden` decoration.
 * Named one by one rather than through a Proxy, because a Proxy that answers
 * every key also answers `then`, which makes the module namespace thenable and
 * hangs the dynamic import Vitest uses to load it.
 */
vi.mock("lucide-react", () => {
  const Stub = () => <svg aria-hidden />;
  return { Check: Stub, Upload: Stub };
});

// ---------------------------------------------------------------------------
// 1. One field, one column
// ---------------------------------------------------------------------------

describe("assignColumn", () => {
  const START: ColumnMapping = detectColumnMapping(["Email", "First Name", "Backup Email"]);

  it("starts from a mapping that already holds the rule", () => {
    // `detectColumnMapping`'s own guarantee. Asserted so that a change there
    // which starts double-assigning is caught here too.
    expect(START["Email"]).toBe("email");
    expect(START["Backup Email"]).toBe(IGNORE_COLUMN);
  });

  it("takes the field off the column that held it", () => {
    const next = assignColumn(START, "Backup Email", "email");

    expect(next["Backup Email"]).toBe("email");
    expect(next["Email"]).toBe(IGNORE_COLUMN);
  });

  it("never leaves two columns holding the same field, however many times you switch", () => {
    // The property, not one instance of it: reassigning around a loop must
    // never produce a mapping where a field appears twice.
    let mapping = START;
    for (const header of ["Backup Email", "Email", "First Name", "Backup Email", "Email"]) {
      mapping = assignColumn(mapping, header, "email");

      const holders = Object.values(mapping).filter((a) => a === "email");
      expect(holders).toHaveLength(1);
    }
  });

  it("lets any number of columns sit at “don't import”, which is the normal state", () => {
    let mapping = START;
    for (const header of Object.keys(START)) {
      mapping = assignColumn(mapping, header, IGNORE_COLUMN);
    }

    expect(Object.values(mapping).every((a) => a === IGNORE_COLUMN)).toBe(true);
  });

  it("does not mutate the mapping it was given", () => {
    // The caller holds this object in React state. Mutating it in place makes
    // the change invisible to a re-render and the screen stops matching itself.
    const before = { ...START };
    assignColumn(START, "Backup Email", "email");

    expect(START).toStrictEqual(before);
  });

  it("keeps `normaliseImportRows` reading the column the host actually picked", () => {
    // The end-to-end version of rule 1: after a steal, the rows key off the
    // NEW column, not the old one. This is the assertion that would fail if the
    // steal were dropped and key order happened to favour the stale column.
    const mapping = assignColumn(START, "Backup Email", "email");
    const rows = [{ Email: "old@x.co", "First Name": "Kim", "Backup Email": "new@x.co" }];

    const result = normaliseImportRows(rows, mapping);

    expect(result.rows.map((r) => r.email)).toEqual(["new@x.co"]);
  });
});

// ---------------------------------------------------------------------------
// 2. The attestation gates the submit
// ---------------------------------------------------------------------------

function resultWith(rowCount: number): NormalizeResult {
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    email: `guest${i}@example.com`,
    first_name: `Guest${i}`,
    last_name: null,
    phone_number: null,
    company_name: null,
    company_role: null,
    social_links: [],
  }));
  return {
    rows,
    skipped: {
      noEmail: 0,
      excludedStatus: 0,
      waitlistNotIncluded: 0,
      approvedNotIncluded: 0,
      duplicate: 0,
    },
  };
}

function reviewMarkup(result: NormalizeResult): string {
  return renderToStaticMarkup(
    <ReviewAndAttest
      eventId="event-1"
      fileName="guests.csv"
      result={result}
      onBack={() => {}}
      onDone={() => {}}
    />,
  );
}

/**
 * The opening tag of one element, so an attribute can be asserted on the tag
 * that carries it rather than on the whole document.
 *
 * WORTH THE HELPER, BECAUSE THE OBVIOUS REGEX IS WRONG. The first cut of these
 * tests used `/<button[^>]*type="submit"[^>]*disabled/` and passed against
 * markup where the button was NOT disabled — `[^>]*` runs on into the class
 * attribute, which contains Tailwind's `disabled:opacity-50`, so the literal
 * string `disabled` is present on every one of these buttons whether or not
 * the property is. Caught by a mutation that removed the attestation from the
 * disabled condition and produced no red. Matching `disabled=""` on an
 * extracted tag is what actually distinguishes the two.
 */
function tagOf(markup: string, pattern: RegExp): string {
  const tags = markup.match(/<(?:button|input)\b[^>]*>/g) ?? [];
  const found = tags.find((tag) => pattern.test(tag));
  if (found === undefined) throw new Error(`no tag matching ${String(pattern)}`);
  return found;
}

describe("the review screen's attestation", () => {
  it("renders the checkbox unticked", () => {
    // Asserted on the extracted tag rather than on the document, so the result
    // does not depend on where React happens to place `checked` in the
    // attribute order relative to `name`.
    const checkbox = tagOf(reviewMarkup(resultWith(3)), /name="attested"/);

    expect(checkbox).not.toMatch(/\bchecked\b/);
  });

  it("renders the submit button disabled", () => {
    const submit = tagOf(reviewMarkup(resultWith(3)), /type="submit"/);

    expect(submit).toMatch(/\sdisabled=""/);
  });

  it("keeps the submit disabled even with rows ready and no error", () => {
    // Stated separately because "disabled" could plausibly be explained by the
    // empty-list or pending cases. Neither applies here: 250 rows, first render.
    const markup = reviewMarkup(resultWith(250));

    expect(markup).toContain("Import 250");
    expect(tagOf(markup, /type="submit"/)).toMatch(/\sdisabled=""/);
  });

  it("sends the reviewed rows verbatim, not a re-derived list", () => {
    // §11.2: what the host saw is what gets imported. The hidden field has to
    // be the same array the counts and preview describe.
    const result = resultWith(2);
    const markup = reviewMarkup(result);

    expect(markup).toContain('name="rows"');
    // The emails are in the payload. Escaped `&quot;` in the attribute, so the
    // check is on the values rather than on raw JSON.
    expect(markup).toContain("guest0@example.com");
    expect(markup).toContain("guest1@example.com");
  });

  it("shows only the first ten rows however long the list is", () => {
    // Not privacy — the host exported this file. A wall of rows invites the
    // scroll-to-the-bottom-and-tick behaviour this step exists to prevent.
    const markup = reviewMarkup(resultWith(40));
    const previewed = markup.match(/Guest\d+</g) ?? [];

    expect(previewed).toHaveLength(10);
    expect(markup).toContain("Import 40");
  });
});

// ---------------------------------------------------------------------------
// 3. The result screen names nobody
// ---------------------------------------------------------------------------

describe("the result screen", () => {
  const SUMMARY = {
    imported: 137,
    updated: 5,
    skipped_no_email: 2,
    skipped_already_claimed: 9,
  };

  it("reports added and updated separately", () => {
    // A host who re-uploads a corrected file needs to tell "nothing happened"
    // from "142 rows corrected". One combined total cannot say which.
    const markup = renderToStaticMarkup(
      <ImportDone eventId="event-1" summary={SUMMARY} onImportAnother={() => {}} />,
    );

    expect(markup).toContain("137");
    expect(markup).toContain("Updated");
    expect(markup).toContain("142 guests on the list");
  });

  it("offers no way to see WHO already claimed", () => {
    // The count is the host's business; the identities are not.
    //
    // UPDATED 2026-08-29, AND THE PROPERTY IS NARROWER THAN IT LOOKS. This
    // assertion used to pin the exact href list to `["/events/event-1"]`,
    // standing in for "there is no read path into `event_attendee_imports`
    // anywhere in this app". There is now exactly one — `/import/links`, the
    // interim hand-delivery screen (§11.5 of the design doc) — so pinning the
    // href list no longer expresses anything about disclosure, only about
    // navigation. What actually has to hold is the §3.9 rule the test was
    // named for, and it still does: that screen lists ONLY UNCLAIMED rows, so
    // no route from here can tell the host which of their guests hold
    // SmartCard accounts. The allowed set below is exhaustive on purpose — a
    // third link appearing is a change worth failing on.
    const markup = renderToStaticMarkup(
      <ImportDone eventId="event-1" summary={SUMMARY} onImportAnother={() => {}} />,
    );

    expect(markup).toContain("9");
    expect(markup).not.toMatch(/see who|view (the )?list|who claimed|attendee list/i);
    const hrefs = [...markup.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toStrictEqual(["/events/event-1/import/links", "/events/event-1"]);
  });

  it("points the host at the links screen, because nothing else will send them", () => {
    // The other half of §7's rule. It bans implying a capability that does not
    // exist; it does not ban naming one that does. An import nobody is told
    // about achieves nothing until the email phase lands, and a host who reads
    // "that's a separate step still being built" and leaves has done exactly
    // that — so the screen has to say where the links actually are.
    const markup = renderToStaticMarkup(
      <ImportDone eventId="event-1" summary={SUMMARY} onImportAnother={() => {}} />,
    );

    expect(markup).toContain("/events/event-1/import/links");
    expect(markup).toMatch(/send/i);
  });

  it("does not claim anybody was emailed, because nothing was", () => {
    // §7: never imply a capability that does not exist. The email phase is not
    // built, and a host who believes it ran will not send anything themselves.
    const markup = renderToStaticMarkup(
      <ImportDone eventId="event-1" summary={SUMMARY} onImportAnother={() => {}} />,
    );

    expect(markup).toMatch(/Nobody has been emailed yet/i);
  });

  it("does not describe an import as making connections", () => {
    // The non-negotiable product rule. Importing records attendance; it is not
    // a route to a connection, and the copy must not blur that.
    const markup = renderToStaticMarkup(
      <ImportDone eventId="event-1" summary={SUMMARY} onImportAnother={() => {}} />,
    );

    expect(markup).toMatch(/connections still only happen in person/i);
  });
});
