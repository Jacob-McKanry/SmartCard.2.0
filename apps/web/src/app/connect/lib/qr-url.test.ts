import { describe, expect, it } from "vitest";

import { buildConnectUrl, parseConnectToken } from "./qr-url";

const ORIGIN = "https://smartcard.tech";

describe("buildConnectUrl", () => {
  it("builds https://<origin>/c/<token>", () => {
    expect(buildConnectUrl(ORIGIN, "abc.def")).toBe("https://smartcard.tech/c/abc.def");
  });

  it("strips a trailing slash from the origin", () => {
    expect(buildConnectUrl("https://smartcard.tech/", "tok")).toBe("https://smartcard.tech/c/tok");
  });

  it("percent-encodes token characters that would otherwise change the URL's shape", () => {
    const url = buildConnectUrl(ORIGIN, "a/b c");
    expect(url).toBe("https://smartcard.tech/c/a%2Fb%20c");
  });
});

describe("parseConnectToken", () => {
  it("round-trips whatever buildConnectUrl produced", () => {
    const token = "eyJzaWQiOiJhYmMifQ.c2ln"; // token-shaped, not a real signed token
    expect(parseConnectToken(buildConnectUrl(ORIGIN, token))).toBe(token);
  });

  it("returns null for text that isn't a URL at all", () => {
    expect(parseConnectToken("not a url")).toBeNull();
    expect(parseConnectToken("")).toBeNull();
  });

  it("returns null for a well-formed URL on a different path — including the NFC card link", () => {
    expect(parseConnectToken("https://smartcard.tech/card/abcd-0123456789ab")).toBeNull();
    expect(parseConnectToken("https://example.com/totally/unrelated")).toBeNull();
  });

  it("returns null for a /c/ path with no token", () => {
    expect(parseConnectToken(`${ORIGIN}/c/`)).toBeNull();
  });

  it("returns null when a path segment after the token would smuggle in extra structure", () => {
    expect(parseConnectToken(`${ORIGIN}/c/abc/def`)).toBeNull();
  });

  it("enforces the same origin when one is given, and ignores it when not", () => {
    const url = `${ORIGIN}/c/sometoken`;
    expect(parseConnectToken(url, "https://evil.example")).toBeNull();
    expect(parseConnectToken(url, ORIGIN)).toBe("sometoken");
    expect(parseConnectToken(url)).toBe("sometoken");
  });

  it("rejects a token longer than qrRedeemRequestSchema's 4096-character bound", () => {
    const tooLong = `${ORIGIN}/c/${"a".repeat(4097)}`;
    expect(parseConnectToken(tooLong)).toBeNull();
  });
});
