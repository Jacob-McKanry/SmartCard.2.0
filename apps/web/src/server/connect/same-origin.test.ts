import { describe, expect, it } from "vitest";

import { checkSameOrigin, requestOrigin } from "./same-origin";

/**
 * The cross-site check on `/api/connect/*`.
 *
 * These endpoints are cookie-authenticated, so every downstream check — JWKS
 * verification, `ensureUser`, the minted token, RLS — passes for a forged
 * cross-site POST, because the victim really is signed in. This is the only
 * layer that asks who *caused* the request, and on the NFC path the answer
 * decides whether a connection can be created with no tap and no scan at all.
 *
 * The negative cases below are the ones that matter, and each names the attack
 * it stands for rather than just the input it feeds.
 */

const APP = "https://smartcard.tech";
const URL_ON_APP = `${APP}/api/connect/nfc/redeem`;

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("requestOrigin", () => {
  it("rebuilds the origin the browser actually addressed, from forwarded headers", () => {
    // Behind Vercel's proxy the URL the handler sees is not necessarily the URL
    // the browser typed, and it is the browser's view that `Origin` carries.
    expect(
      requestOrigin(
        headers({ "x-forwarded-host": "smartcard.tech", "x-forwarded-proto": "https" }),
        "http://localhost:3000/api/connect/nfc/redeem",
      ),
    ).toBe(APP);
  });

  it("takes the left-most scheme when x-forwarded-proto is a chain", () => {
    expect(
      requestOrigin(headers({ host: "smartcard.tech", "x-forwarded-proto": "https,http" }), ""),
    ).toBe(APP);
  });

  it("assumes https when only a host is present", () => {
    // Erring toward https matters because the comparison is a string one: an
    // assumed `http://` would fail to match a genuine same-origin request.
    expect(requestOrigin(headers({ host: "smartcard.tech" }), "")).toBe(APP);
  });

  it("falls back to the request URL when there is no host header", () => {
    expect(requestOrigin(headers({}), URL_ON_APP)).toBe(APP);
  });

  it("returns null when it cannot work out an origin at all", () => {
    expect(requestOrigin(headers({}), "not-a-url")).toBeNull();
  });
});

describe("checkSameOrigin — requests it must allow", () => {
  it("allows the app's own fetch (Sec-Fetch-Site: same-origin)", () => {
    expect(checkSameOrigin(headers({ "sec-fetch-site": "same-origin" }), URL_ON_APP)).toEqual({
      ok: true,
    });
  });

  it("allows a user-initiated navigation (Sec-Fetch-Site: none)", () => {
    // `none` means the user typed it or used a bookmark — nobody else caused
    // it, so it is not the cross-site case this check exists for.
    expect(checkSameOrigin(headers({ "sec-fetch-site": "none" }), URL_ON_APP)).toEqual({ ok: true });
  });

  it("allows a matching Origin when the browser sent no Sec-Fetch-Site", () => {
    expect(
      checkSameOrigin(
        headers({ origin: APP, host: "smartcard.tech", "x-forwarded-proto": "https" }),
        URL_ON_APP,
      ),
    ).toEqual({ ok: true });
  });

  it("allows a request carrying neither header — the future mobile client", () => {
    // Deliberate, and not a browser hole: both headers are forbidden header
    // names, so page script cannot suppress them. A request with neither is a
    // non-browser client (§5.2 sends a bearer token with no cookie, so it has
    // no ambient credential for a third party to borrow in the first place).
    expect(checkSameOrigin(headers({}), URL_ON_APP)).toEqual({ ok: true });
  });

  it("is not confused by header casing or surrounding whitespace", () => {
    expect(checkSameOrigin(headers({ "Sec-Fetch-Site": " Same-Origin " }), URL_ON_APP)).toEqual({
      ok: true,
    });
  });
});

describe("checkSameOrigin — requests it must refuse", () => {
  it("refuses a cross-site POST — the forged-connection attack", () => {
    // A page on evil.example causing the victim's browser to POST a card code
    // here would otherwise create a connection with no tap and no scan, which
    // is the one thing CLAUDE.md's product rule says cannot happen.
    expect(checkSameOrigin(headers({ "sec-fetch-site": "cross-site" }), URL_ON_APP)).toEqual({
      ok: false,
      reason: "cross_site_fetch",
    });
  });

  it("refuses same-SITE as well as cross-site", () => {
    // The app is deployed on *.vercel.app, where "same site" includes every
    // other tenant's deployment. Trusting `same-site` would trust strangers.
    expect(checkSameOrigin(headers({ "sec-fetch-site": "same-site" }), URL_ON_APP)).toEqual({
      ok: false,
      reason: "cross_site_fetch",
    });
  });

  it("refuses a foreign Origin even when the host header looks right", () => {
    expect(
      checkSameOrigin(
        headers({ origin: "https://evil.example", host: "smartcard.tech" }),
        URL_ON_APP,
      ),
    ).toEqual({ ok: false, reason: "foreign_origin" });
  });

  it("refuses a look-alike origin rather than matching on a prefix", () => {
    expect(
      checkSameOrigin(
        headers({ origin: "https://smartcard.tech.evil.example", host: "smartcard.tech" }),
        URL_ON_APP,
      ),
    ).toEqual({ ok: false, reason: "foreign_origin" });
  });

  it("refuses a scheme mismatch", () => {
    expect(
      checkSameOrigin(
        headers({ origin: "http://smartcard.tech", host: "smartcard.tech" }),
        URL_ON_APP,
      ),
    ).toEqual({ ok: false, reason: "foreign_origin" });
  });

  it("refuses when an Origin was supplied and the target origin cannot be determined", () => {
    // Fail closed: a check that cannot be completed rejects rather than
    // guesses, the same rule the GPS gate follows.
    expect(checkSameOrigin(headers({ origin: APP }), "not-a-url")).toEqual({
      ok: false,
      reason: "foreign_origin",
    });
  });

  it("does not let Sec-Fetch-Site be overridden by a friendly-looking Origin", () => {
    // Order matters: the browser's own statement about the relationship wins,
    // because it is the only signal that separates same-origin from same-site.
    expect(
      checkSameOrigin(headers({ "sec-fetch-site": "cross-site", origin: APP }), URL_ON_APP),
    ).toEqual({ ok: false, reason: "cross_site_fetch" });
  });
});
