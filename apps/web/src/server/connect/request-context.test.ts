import { beforeEach, describe, expect, it } from "vitest";

import { buildRequestContext, clientIpFrom, hashIpAddress } from "./request-context";

/**
 * The per-request context is where two rules the rest of the flow depends on
 * are actually enforced: the caller's identity comes from the auth bridge and
 * never from the request, and an IP is hashed before it can be stored anywhere.
 */

const SALT = "test-salt-not-a-real-one";

beforeEach(() => {
  process.env.CONNECT_IP_HASH_SALT = SALT;
});

describe("hashIpAddress", () => {
  it("is deterministic, so a rate-limit subject is stable across requests", () => {
    expect(hashIpAddress("203.0.113.7")).toBe(hashIpAddress("203.0.113.7"));
  });

  it("separates different addresses", () => {
    expect(hashIpAddress("203.0.113.7")).not.toBe(hashIpAddress("203.0.113.8"));
  });

  it("never contains the address it hashed", () => {
    // The point of hashing: the stored value must not be the personal datum.
    expect(hashIpAddress("203.0.113.7")).not.toContain("203.0.113.7");
    expect(hashIpAddress("203.0.113.7")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("changes completely when the salt changes", () => {
    const withFirst = hashIpAddress("203.0.113.7");
    process.env.CONNECT_IP_HASH_SALT = "a-different-salt";
    expect(hashIpAddress("203.0.113.7")).not.toBe(withFirst);
  });

  it("refuses to hash at all when no salt is configured", () => {
    // Fail closed. An unsalted hash of an IP is reversible by enumerating the
    // whole address space, i.e. it is storing raw IPs while believing you did
    // not — so "no salt" must be an error, never a silent downgrade.
    delete process.env.CONNECT_IP_HASH_SALT;
    expect(() => hashIpAddress("203.0.113.7")).toThrow(/CONNECT_IP_HASH_SALT/);
  });
});

describe("clientIpFrom", () => {
  it("takes the left-most entry of x-forwarded-for, which is the original client", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" });
    expect(clientIpFrom(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIpFrom(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("returns null when neither header is present or both are blank", () => {
    expect(clientIpFrom(new Headers())).toBeNull();
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "   " }))).toBeNull();
  });
});

describe("buildRequestContext", () => {
  it("takes the caller id from its argument — there is no header or body it can come from", () => {
    const ctx = buildRequestContext({
      callerUserId: "11111111-1111-4111-8111-111111111111",
      headers: new Headers({
        "x-forwarded-for": "203.0.113.7",
        // All of these are ignored. A request cannot name who it is.
        "x-user-id": "22222222-2222-4222-8222-222222222222",
        authorization: "Bearer whatever",
      }),
    });
    expect(ctx.callerUserId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("hashes the IP rather than carrying it", () => {
    const ctx = buildRequestContext({
      callerUserId: "u",
      headers: new Headers({ "x-forwarded-for": "203.0.113.7" }),
    });
    expect(ctx.ipHash).toBe(hashIpAddress("203.0.113.7"));
    expect(JSON.stringify(ctx)).not.toContain("203.0.113.7");
  });

  it("bounds the user agent before it can reach a database column", () => {
    const ctx = buildRequestContext({
      callerUserId: "u",
      headers: new Headers({ "user-agent": "A".repeat(10_000) }),
    });
    expect(ctx.userAgent?.length).toBe(512);
  });

  it("carries a null ipHash rather than a placeholder when there is no header", () => {
    // The service layer charges a request with no IP to the literal subject
    // "unknown" rather than skipping the limit — deciding that here would hide
    // it from the place that has to reason about it.
    expect(buildRequestContext({ callerUserId: "u", headers: new Headers() }).ipHash).toBeNull();
  });
});
