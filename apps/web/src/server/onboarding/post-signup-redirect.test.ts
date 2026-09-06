import { describe, expect, it } from "vitest";

import { isSafeInternalRedirectPath } from "./post-signup-redirect";

/**
 * The open-redirect guard behind `consumePostSignupRedirect` — see that
 * module's header for why a value that only this codebase ever writes still
 * gets validated on read. Only this pure function is exercised directly;
 * mocking `next/headers`'s `cookies()` end-to-end would test Next's own
 * cookie plumbing, not the property this file actually cares about.
 */
describe("isSafeInternalRedirectPath", () => {
  it("accepts an ordinary internal path", () => {
    expect(isSafeInternalRedirectPath("/events/abc-123/roster")).toBe(true);
  });

  it("accepts the root path", () => {
    expect(isSafeInternalRedirectPath("/")).toBe(true);
  });

  it("rejects a protocol-relative URL (the open-redirect shape)", () => {
    expect(isSafeInternalRedirectPath("//evil.example.com/phish")).toBe(false);
  });

  it("rejects a full URL with a scheme", () => {
    expect(isSafeInternalRedirectPath("https://evil.example.com")).toBe(false);
    expect(isSafeInternalRedirectPath("javascript:alert(1)")).toBe(false);
  });

  it("rejects a path with no leading slash", () => {
    expect(isSafeInternalRedirectPath("events/abc-123/roster")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isSafeInternalRedirectPath("")).toBe(false);
  });

  it("rejects embedded whitespace or control characters", () => {
    expect(isSafeInternalRedirectPath("/events/abc\nSet-Cookie: x=1")).toBe(false);
    expect(isSafeInternalRedirectPath("/events/abc\r\nLocation: https://evil.example.com")).toBe(
      false,
    );
    expect(isSafeInternalRedirectPath("/events/abc def")).toBe(false);
  });
});
