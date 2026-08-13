import { describe, expect, it } from "vitest";

import {
  generateNonce,
  isTokenExpired,
  signQrToken,
  timingSafeEqual,
  verifyQrToken,
} from "./qr-token";

/**
 * The token is check (1) of the nine in §4.2 step 5, and it is the only check
 * that stands between an unauthenticated request and the database. Everything
 * below is an attempt to make `verifyQrToken` say yes to something it should
 * not.
 */

const SECRET = "test-signing-secret-not-a-real-one";
const OTHER_SECRET = "a-different-secret-entirely";

const PAYLOAD = {
  sid: "11111111-1111-4111-8111-111111111111",
  nonce: "0123456789abcdef0123456789abcdef",
  iat: 1_800_000_000,
  exp: 1_800_000_045,
};

describe("signQrToken / verifyQrToken", () => {
  it("round-trips a token it minted itself", async () => {
    const token = await signQrToken(SECRET, PAYLOAD);
    const result = await verifyQrToken(SECRET, token);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toEqual(PAYLOAD);
  });

  it("refuses to mint with an empty secret rather than producing a forgeable token", async () => {
    await expect(signQrToken("", PAYLOAD)).rejects.toThrow(/forgeable/i);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signQrToken(OTHER_SECRET, PAYLOAD);
    const result = await verifyQrToken(SECRET, token);
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a token whose payload was edited to name a different session", async () => {
    // The attack: take a token you were legitimately shown, swap the session id
    // for somebody else's, keep the signature. This is the reason the MAC covers
    // the payload segment as received.
    const token = await signQrToken(SECRET, PAYLOAD);
    const [, mac] = token.split(".");
    const forgedPayload = btoa(
      JSON.stringify({ ...PAYLOAD, sid: "22222222-2222-4222-8222-222222222222" }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const result = await verifyQrToken(SECRET, `${forgedPayload}.${mac}`);
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a token whose expiry was pushed out", async () => {
    const token = await signQrToken(SECRET, PAYLOAD);
    const [, mac] = token.split(".");
    const forgedPayload = btoa(JSON.stringify({ ...PAYLOAD, exp: PAYLOAD.exp + 86_400 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(await verifyQrToken(SECRET, `${forgedPayload}.${mac}`)).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  it("rejects a token with a single flipped character in the signature", async () => {
    const token = await signQrToken(SECRET, PAYLOAD);
    const flipped = token.slice(0, -1) + (token.at(-1) === "A" ? "B" : "A");
    const result = await verifyQrToken(SECRET, flipped);
    expect(result.ok).toBe(false);
  });

  it.each([
    ["not a string", 42],
    ["null", null],
    ["empty", ""],
    ["no separator", "abcdef"],
    ["empty payload segment", ".abcdef"],
    ["empty signature segment", "abcdef."],
    ["three segments", "a.b.c"],
    ["non-base64url characters", "not base64!.also not!"],
  ])("rejects a structurally invalid token (%s)", async (_label, token) => {
    const result = await verifyQrToken(SECRET, token as unknown);
    expect(result.ok).toBe(false);
  });

  it("bounds the input before hashing it", async () => {
    // An unbounded string handed to a hash function is a cheap way to make the
    // server do expensive work on an endpoint that has not authenticated
    // anything yet.
    const huge = `${"a".repeat(5000)}.${"b".repeat(100)}`;
    expect(await verifyQrToken(SECRET, huge)).toEqual({ ok: false, reason: "malformed_token" });
  });

  it("rejects a correctly-signed payload that is not a valid payload shape", async () => {
    // Signature verifies, structure does not: proves the payload is validated
    // AFTER the MAC and that a valid MAC alone is not enough.
    const junk = btoa(JSON.stringify({ hello: "world" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const macBytes = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(junk)),
    );
    let binary = "";
    for (const byte of macBytes) binary += String.fromCharCode(byte);
    const mac = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    expect(await verifyQrToken(SECRET, `${junk}.${mac}`)).toEqual({
      ok: false,
      reason: "malformed_token",
    });
  });
});

describe("isTokenExpired", () => {
  it("is true at the exact expiry instant, not only after it", () => {
    expect(isTokenExpired(PAYLOAD, new Date(PAYLOAD.exp * 1000))).toBe(true);
  });

  it("is false one second before expiry", () => {
    expect(isTokenExpired(PAYLOAD, new Date((PAYLOAD.exp - 1) * 1000))).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  it("is true only for identical bytes", () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });

  it("is false for different lengths, including a prefix", () => {
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe("generateNonce", () => {
  it("produces 128 bits of hex", () => {
    expect(generateNonce()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("does not repeat across a large sample", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateNonce()));
    expect(seen.size).toBe(2000);
  });
});
