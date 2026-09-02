import { beforeEach, describe, expect, it } from "vitest";

import { signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";

beforeEach(() => {
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "test-secret-do-not-use-in-prod";
});

describe("signUnsubscribeToken / verifyUnsubscribeToken", () => {
  it("round-trips: a token signed for an address verifies against that address", () => {
    const token = signUnsubscribeToken("sarah@example.com");
    expect(verifyUnsubscribeToken("sarah@example.com", token)).toBe(true);
  });

  it("is case- and whitespace-insensitive on the address, matching citext semantics", () => {
    const token = signUnsubscribeToken("Sarah@Example.com");
    expect(verifyUnsubscribeToken("  sarah@example.com  ", token)).toBe(true);
  });

  it("rejects a token signed for a different address", () => {
    const token = signUnsubscribeToken("sarah@example.com");
    expect(verifyUnsubscribeToken("mallory@example.com", token)).toBe(false);
  });

  it("rejects a tampered token of the same length", () => {
    const token = signUnsubscribeToken("sarah@example.com");
    const tampered = token.slice(0, -1) + (token.at(-1) === "A" ? "B" : "A");
    expect(verifyUnsubscribeToken("sarah@example.com", tampered)).toBe(false);
  });

  it("rejects a garbage token without throwing", () => {
    expect(verifyUnsubscribeToken("sarah@example.com", "not-a-real-token")).toBe(false);
    expect(verifyUnsubscribeToken("sarah@example.com", "")).toBe(false);
  });

  it("changes completely when the secret changes, so a rotated secret invalidates old links", () => {
    const withFirst = signUnsubscribeToken("sarah@example.com");
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "a-different-secret";
    expect(verifyUnsubscribeToken("sarah@example.com", withFirst)).toBe(false);
  });
});
