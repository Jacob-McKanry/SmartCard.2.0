import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AttendeeImportClaimPrefill } from "@smartcard/types";

import { ClaimReview } from "./claim-review";

/**
 * THE REVIEW SCREEN, TESTED AS THE RULES §4.2 STEP 4 AND §2.3.1'S COPY PASS
 * ACTUALLY REQUIRE. Same posture as
 * `events/[eventId]/import/import-screens.test.tsx`: not happy-path checks,
 * assertions that the obvious future mistake turns red.
 *
 *   1. A FIELD WITH NO VALUE OFFERS NO CHECKBOX. There is nothing to keep or
 *      discard, and a checkbox for a blank field invites confusion about
 *      what checking it would even do.
 *   2. EVERY FIELD THAT HAS A VALUE STARTS CHECKED. Unlike the host's
 *      attestation checkbox (which must start unticked because it is a
 *      claim of authority over someone else), these are the caller's own
 *      data — §4.2's "default is filled in".
 *   3. THE SOCIAL-LINKS TOGGLE APPEARS ONLY WHEN THERE IS AT LEAST ONE LINK.
 *   4. NO SCREEN IN THIS FLOW EVER SAYS "ATTENDED". §2.3.1: this system has
 *      no check-in signal from any CSV import, only "the host says you were
 *      on the list" — the copy pass this rule guards against regressing.
 */

vi.mock("./actions", () => ({
  claimEventImportAction: async () => ({}),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

// Same mechanical reason `import-screens.test.tsx` stubs these: a plain Node
// run picks up a second React instance through lucide-react's own peer
// dependency, whose hook dispatcher is null. Every icon on this screen is
// `aria-hidden` decoration, so nothing is lost.
vi.mock("lucide-react", () => {
  const Stub = () => <svg aria-hidden />;
  return { Check: Stub };
});

function prefillWith(over: Partial<AttendeeImportClaimPrefill> = {}): AttendeeImportClaimPrefill {
  return {
    first_name: "Kim",
    last_name: "Alvarez",
    phone_number: null,
    company_name: null,
    company_role: null,
    social_links: [],
    ...over,
  };
}

function reviewMarkup(prefill: AttendeeImportClaimPrefill): string {
  return renderToStaticMarkup(
    <ClaimReview
      lookupToken="tok"
      eventId="11111111-1111-4111-8111-111111111111"
      eventName="Founders Dinner"
      hostFirstName="Jacob"
      hostLastName="McKanry"
      prefill={prefill}
    />,
  );
}

/** Same extraction helper `import-screens.test.tsx` uses, for the same reason. */
function tagOf(markup: string, pattern: RegExp): string | undefined {
  const tags = markup.match(/<input\b[^>]*>/g) ?? [];
  return tags.find((tag) => pattern.test(tag));
}

describe("field checkboxes", () => {
  it("renders no checkbox for a null field", () => {
    const markup = reviewMarkup(prefillWith({ phone_number: null }));
    expect(tagOf(markup, /name="phone_number"/)).toBeUndefined();
  });

  it("renders no checkbox for a blank (whitespace-only) field", () => {
    const markup = reviewMarkup(prefillWith({ company_name: "   " }));
    expect(tagOf(markup, /name="company_name"/)).toBeUndefined();
  });

  it("renders a checked checkbox for a field that has a value", () => {
    const markup = reviewMarkup(prefillWith({ first_name: "Kim" }));
    const tag = tagOf(markup, /name="first_name"/);
    expect(tag).toBeDefined();
    expect(tag).toMatch(/checked=""/);
  });

  it("renders the value text next to its checkbox so the caller can see what they're keeping", () => {
    const markup = reviewMarkup(prefillWith({ company_role: "Head of Growth" }));
    expect(markup).toContain("Head of Growth");
  });
});

describe("social links", () => {
  it("omits the toggle entirely when there are no links", () => {
    const markup = reviewMarkup(prefillWith({ social_links: [] }));
    expect(tagOf(markup, /name="social_links"/)).toBeUndefined();
  });

  it("shows a checked toggle, with every link's URL, when links are present", () => {
    const markup = reviewMarkup(
      prefillWith({
        social_links: [
          { platform: "instagram", url: "https://instagram.com/kim" },
          { platform: "linkedin", url: "https://linkedin.com/in/kim" },
        ],
      }),
    );
    const tag = tagOf(markup, /name="social_links"/);
    expect(tag).toBeDefined();
    expect(tag).toMatch(/checked=""/);
    expect(markup).toContain("https://instagram.com/kim");
    expect(markup).toContain("https://linkedin.com/in/kim");
  });
});

describe("copy pass — never claims attendance the data can't support", () => {
  it("never contains the word 'attended', in any prefill shape", () => {
    const withEverything = reviewMarkup(
      prefillWith({
        first_name: "Kim",
        last_name: "Alvarez",
        phone_number: "555-0100",
        company_name: "Northwind",
        company_role: "Head of Growth",
        social_links: [{ platform: "instagram", url: "https://instagram.com/kim" }],
      }),
    );
    const withNothing = reviewMarkup(
      prefillWith({
        first_name: null,
        last_name: null,
        phone_number: null,
        company_name: null,
        company_role: null,
        social_links: [],
      }),
    );

    expect(withEverything.toLowerCase()).not.toContain("attended");
    expect(withNothing.toLowerCase()).not.toContain("attended");
  });

  it("says 'guest list' rather than asserting attendance", () => {
    const markup = reviewMarkup(prefillWith());
    expect(markup).toContain("guest list");
  });
});
