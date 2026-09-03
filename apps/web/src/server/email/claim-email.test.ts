import { describe, expect, it } from "vitest";

import { buildClaimEmail, type ClaimEmailInput } from "./claim-email";

const BASE: ClaimEmailInput = {
  recipientFirstName: "Sarah",
  hostFirstName: "Jacob",
  eventTitle: "Founders Dinner",
  claimUrl: "https://smartcard.tech/claim/abc123",
  unsubscribeUrl: "https://smartcard.tech/api/unsubscribe?email=sarah%40example.com&sig=xyz",
  mailingAddress: "123 Main St, Suite 100, Springfield, ST 00000",
};

describe("buildClaimEmail", () => {
  it("names the host and event in the subject, matching §2.3.1's exact required phrasing", () => {
    const { subject } = buildClaimEmail(BASE);
    expect(subject).toBe("Jacob added you to the guest list for Founders Dinner");
  });

  it("never claims attendance — §2.3.1's rule, enforced by a test like claim-review.test.tsx's own", () => {
    const { subject, html, text } = buildClaimEmail(BASE);
    expect(subject).not.toMatch(/attended/i);
    expect(html).not.toMatch(/attended/i);
    expect(text).not.toMatch(/attended/i);
    expect(html).toMatch(/guest list/i);
    expect(text).toMatch(/guest list/i);
  });

  it("falls back to a generic host phrase when the host has no first name", () => {
    const { subject } = buildClaimEmail({ ...BASE, hostFirstName: null });
    expect(subject).toBe("Your host added you to the guest list for Founders Dinner");
  });

  it("greets generically when the recipient has no first name", () => {
    const { text } = buildClaimEmail({ ...BASE, recipientFirstName: null });
    expect(text.startsWith("Hi,")).toBe(true);
    expect(text).not.toContain("Hi Sarah");
  });

  it("includes the claim URL verbatim, and the unsubscribe URL HTML-entity-escaped in the href", () => {
    const { html, text } = buildClaimEmail(BASE);
    expect(html).toContain(BASE.claimUrl);
    expect(text).toContain(BASE.claimUrl);
    // The unsubscribe URL's own "&" is a literal ampersand in text, but must
    // be HTML-entity-escaped inside an href attribute — this is `&amp;`
    // being CORRECT html, not a bug: an unescaped "&" inside an attribute is
    // itself a well-known HTML-injection vector, which is exactly what
    // `escapeHtml()` exists to close.
    expect(text).toContain(BASE.unsubscribeUrl);
    expect(html).toContain(BASE.unsubscribeUrl.replace(/&/g, "&amp;"));
  });

  it("includes the CAN-SPAM mailing address in both html and text", () => {
    const { html, text } = buildClaimEmail(BASE);
    expect(html).toContain(BASE.mailingAddress);
    expect(text).toContain(BASE.mailingAddress);
  });

  it("escapes an event title containing HTML so it cannot break the message or inject markup", () => {
    const { html } = buildClaimEmail({ ...BASE, eventTitle: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
