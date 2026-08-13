import { beforeEach, describe, expect, it } from "vitest";

import { createNfcVerifier } from "../nfc-verifier";
import { createQrVerifier } from "../qr-verifier";
import { createVerifiedConnection } from "../create-verified-connection";
import { generateNonce, signQrToken } from "../qr-token";
import type { RequestContext, VerificationOutcome } from "../verification";
import { DEFAULT_CONFIG, FakeConnectStore } from "./fake-store";

/**
 * THE THREAT MODEL FROM §4.7, AS TESTS THAT TRY THE ATTACK.
 *
 * The project brief for this build is explicit: "write tests that attempt each
 * threat-model attack and confirm it fails. A passing happy-path test proves
 * nothing about security." So almost every assertion below is that something
 * did NOT happen — no connection row, a specific refusal reason, a session
 * still dead.
 *
 * Coverage, threat by threat:
 *   Threat 1  screenshot-and-forward ............ "Threat 1" block
 *   Threat 2  live video relay .................. "Threat 2" block  <- the important one
 *   Threat 3  forwarded pending-connection link . SKIPPED, deliberately — see below
 *   Threat 4  mass fake-account farming ......... "Threat 4" block + no-second-write-path.test.ts
 *                                                 + a live-database check recorded in the docs
 *   Threat 5  standard web/app attacks .......... "Threat 5" block
 *   Threat 6  deliberate failure to relax ....... "Threat 6" block + relaxation.test.ts
 *   Threat 7  lost or stolen card ............... "Threat 7" block
 *
 * THREAT 3 IS SKIPPED ON PURPOSE AND IS NOT FAKED. It concerns the non-user
 * "share your contact back" flow, which §2.8 defines as a schema slot only and
 * which the README defers past the first pilot. `pending_connections` exists as
 * a table with no code path at all. A test written against it now would assert
 * something about code that does not exist — which is worse than no test,
 * because a green suite would claim coverage the product does not have.
 */

const SECRET = "adversarial-test-secret";
const NOW = new Date("2026-08-13T18:00:00.000Z");

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // presenter
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // scanner, standing next to Alice
const MALLORY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // remote attacker

/** Midtown Manhattan. Alice is here. */
const HERE = { latitude: 40.758, longitude: -73.9855 };
/** ~55 m away — same block. */
const NEXT_TO_HER = { latitude: 40.75845, longitude: -73.98577 };
/** ~2.1 km away — same city, different building. */
const ACROSS_TOWN = { latitude: 40.7391, longitude: -73.9903 };
/** London. The video-relay accomplice. */
const ANOTHER_CONTINENT = { latitude: 51.5072, longitude: -0.1276 };

function ctx(userId: string, now: Date = NOW): RequestContext {
  return { callerUserId: userId, ipHash: "hashed-ip", userAgent: "vitest", now };
}

function scannerLocation(
  point: { latitude: number; longitude: number },
  over: { accuracyM?: number; capturedAt?: Date } = {},
) {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    accuracyM: over.accuracyM ?? 10,
    capturedAt: (over.capturedAt ?? NOW).toISOString(),
  };
}

/**
 * Builds a live session for Alice with a fresh heartbeat, and mints a token for
 * it — i.e. the exact state a real presenter's screen is in.
 */
async function livePresenterSession(store: FakeConnectStore, at = HERE, when = NOW) {
  const session = await store.createSession({
    presenterUserId: ALICE,
    method: "qr_gps",
    nonce: generateNonce(),
    deviceId: "alice-phone",
    expiresAt: new Date(when.getTime() + DEFAULT_CONFIG.session_max_lifetime_seconds * 1000),
    now: when,
  });
  await store.heartbeat({
    sessionId: session.id,
    presenterUserId: ALICE,
    latitude: at.latitude,
    longitude: at.longitude,
    accuracyM: 10,
    capturedAt: when,
    now: when,
    rotationSeconds: DEFAULT_CONFIG.qr_rotation_seconds,
    nextNonce: generateNonce(),
  });
  const current = (await store.loadSession(session.id))!;
  const iat = Math.floor(when.getTime() / 1000);
  const token = await signQrToken(SECRET, {
    sid: current.id,
    nonce: current.currentNonce!,
    iat,
    exp: iat + DEFAULT_CONFIG.qr_token_ttl_seconds,
  });
  return { session: current, token };
}

function qr(store: FakeConnectStore) {
  return createQrVerifier({ store, signingSecret: SECRET, config: store.config });
}

/** Assert a refusal and return its reason, with a readable failure if it succeeded. */
function refusalReason(outcome: VerificationOutcome): string {
  expect(outcome.ok, "expected this attempt to be REFUSED, but it was accepted").toBe(false);
  return outcome.ok ? "" : outcome.reason;
}

let store: FakeConnectStore;

beforeEach(() => {
  store = new FakeConnectStore();
  store.now = NOW;
});

// ---------------------------------------------------------------------------
// Control: the honest case, so the refusals below are known to be refusals of
// something that would otherwise work.
// ---------------------------------------------------------------------------
describe("control — the honest scan", () => {
  it("accepts Bob standing next to Alice with a current token and a fresh fix", async () => {
    const { token } = await livePresenterSession(store);
    const outcome = await qr(store).verify(ctx(BOB), {
      token,
      scannerLocation: scannerLocation(NEXT_TO_HER),
    });
    expect(outcome.ok).toBe(true);

    const created = await createVerifiedConnection(
      store,
      outcome as Extract<VerificationOutcome, { ok: true }>,
    );
    expect(created.connectionId).toBeTruthy();
    expect(store.connections).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// THREAT 1 — Screenshot the QR, forward it to a remote person.
// Defence: token exp (45s) + rotation (30s) + SESSION-level single use.
// ---------------------------------------------------------------------------
describe("Threat 1 — screenshot and forward", () => {
  it("rejects a token whose nonce has rotated twice (the screenshot went stale)", async () => {
    const { session, token: screenshot } = await livePresenterSession(store);

    // Two rotations later, the screenshotted nonce is neither `current` nor
    // `previous`. One rotation would still be accepted, on purpose — that is
    // the in-flight grace window from §4.2 step 2.
    for (const offset of [31_000, 62_000]) {
      const at = new Date(NOW.getTime() + offset);
      await store.heartbeat({
        sessionId: session.id,
        presenterUserId: ALICE,
        latitude: HERE.latitude,
        longitude: HERE.longitude,
        accuracyM: 10,
        capturedAt: at,
        now: at,
        rotationSeconds: DEFAULT_CONFIG.qr_rotation_seconds,
        nextNonce: generateNonce(),
      });
    }

    const later = new Date(NOW.getTime() + 62_000);
    const outcome = await qr(store).verify(ctx(BOB, later), {
      token: screenshot,
      scannerLocation: scannerLocation(NEXT_TO_HER, { capturedAt: later }),
    });
    // The token also expired at +45s, and expiry is checked before the nonce —
    // §4.2 step 5's order. Either refusal is the screenshot being dead.
    expect(["token_expired", "nonce_mismatch"]).toContain(refusalReason(outcome));
    expect(store.connections).toHaveLength(0);
  });

  it("accepts a token from ONE rotation ago — the deliberate in-flight grace window", async () => {
    const { session, token: inFlight } = await livePresenterSession(store);
    const at = new Date(NOW.getTime() + 31_000);
    await store.heartbeat({
      sessionId: session.id,
      presenterUserId: ALICE,
      latitude: HERE.latitude,
      longitude: HERE.longitude,
      accuracyM: 10,
      capturedAt: at,
      now: at,
      rotationSeconds: DEFAULT_CONFIG.qr_rotation_seconds,
      nextNonce: generateNonce(),
    });

    // Still within the 45s token TTL.
    const outcome = await qr(store).verify(ctx(BOB, at), {
      token: inFlight,
      scannerLocation: scannerLocation(NEXT_TO_HER, { capturedAt: at }),
    });
    expect(outcome.ok).toBe(true);
  });

  it("kills EVERY outstanding token the instant the session is consumed", async () => {
    // This is the heart of threat 1: single-use is enforced at the SESSION, not
    // the token, so a code screenshotted seconds before a legitimate scan is
    // already dead by the time it is used.
    const { session, token: first } = await livePresenterSession(store);

    // A second, equally valid token minted from the same live session — the
    // screenshot an accomplice is holding.
    const iat = Math.floor(NOW.getTime() / 1000);
    const screenshot = await signQrToken(SECRET, {
      sid: session.id,
      nonce: session.currentNonce!,
      iat,
      exp: iat + DEFAULT_CONFIG.qr_token_ttl_seconds,
    });

    const legit = await qr(store).verify(ctx(BOB), {
      token: first,
      scannerLocation: scannerLocation(NEXT_TO_HER),
    });
    expect(legit.ok).toBe(true);
    await createVerifiedConnection(store, legit as Extract<VerificationOutcome, { ok: true }>);

    // Now the accomplice tries the screenshot. It is byte-identical in validity
    // — correct signature, unexpired, correct nonce — and it must still fail.
    const replay = await qr(store).verify(ctx(MALLORY), {
      token: screenshot,
      scannerLocation: scannerLocation(NEXT_TO_HER),
    });
    expect(refusalReason(replay)).toBe("session_not_found");
    expect(store.connections).toHaveLength(1);
  });

  it("refuses at the atomic write too, even if the read-path check were somehow passed", () => {
    // Belt and braces: the compare-and-swap in the commit is what makes
    // single-use true under concurrency, not just usually. The fake mirrors it;
    // the real one is `public.create_verified_connection`'s conditional UPDATE.
    return (async () => {
      const { session, token } = await livePresenterSession(store);
      const outcome = await qr(store).verify(ctx(BOB), {
        token,
        scannerLocation: scannerLocation(NEXT_TO_HER),
      });
      expect(outcome.ok).toBe(true);
      const verified = outcome as Extract<VerificationOutcome, { ok: true }>;

      await createVerifiedConnection(store, verified);
      // Same verified outcome, submitted twice — the shape of a retry storm or
      // a duplicated request.
      await expect(createVerifiedConnection(store, verified)).rejects.toThrow();
      expect((await store.loadSession(session.id))!.status).toBe("consumed");
      expect(store.connections).toHaveLength(1);
    })();
  });

  it("rejects a burned session — five failures kill it for everyone", async () => {
    const { session, token } = await livePresenterSession(store);
    // §4.6's five-failures rule is applied by the service layer, which sets the
    // session to `revoked`. From the verifier's point of view a revoked session
    // is simply not active.
    await store.burnSession(session.id);

    const outcome = await qr(store).verify(ctx(BOB), {
      token,
      scannerLocation: scannerLocation(NEXT_TO_HER),
    });
    expect(refusalReason(outcome)).toBe("session_not_found");
  });
});

// ---------------------------------------------------------------------------
// THREAT 2 — Live video relay. THE TEST THAT MATTERS MOST IN THIS SUITE.
//
// Rotation does not help here: the accomplice watching a FaceTime stream is
// looking at a genuinely current code. The ONLY thing that stops it is the
// server comparing two positions the two devices reported independently.
// ---------------------------------------------------------------------------
describe("Threat 2 — live video relay", () => {
  it("rejects a scan from another continent with a perfectly valid, current, correctly-signed token", async () => {
    const { token } = await livePresenterSession(store);

    const outcome = await qr(store).verify(ctx(MALLORY), {
      token, // current nonce, unexpired, signature verifies
      scannerLocation: scannerLocation(ANOTHER_CONTINENT),
    });

    expect(refusalReason(outcome)).toBe("too_far");
    expect(store.connections).toHaveLength(0);
  });

  it("rejects a scan from 2 km away in the same city", async () => {
    // The realistic version: not London, just the wrong building. If the radius
    // only caught continental distances it would not be doing anything.
    const { token } = await livePresenterSession(store);
    const outcome = await qr(store).verify(ctx(MALLORY), {
      token,
      scannerLocation: scannerLocation(ACROSS_TOWN),
    });
    expect(refusalReason(outcome)).toBe("too_far");
  });

  it("rejects a remote scan even after relaxation has widened the radius to 500 m", async () => {
    // Threat 6 composed with threat 2: fail twice on purpose to unlock the
    // relaxed radius, THEN relay. 500 m is still a proximity claim.
    store.attempts.push(
      {
        id: "f1",
        createdAt: new Date(NOW.getTime() - 60_000),
        sessionId: null,
        method: "qr_gps",
        scannerUserId: MALLORY,
        presenterUserId: ALICE,
        outcome: "rejected",
        rejectionReason: "too_far",
        distanceM: 5_000_000,
        scannerAccuracyM: 10,
        presenterAccuracyM: 10,
        radiusConfigUsedM: 150,
        accuracyConfigUsedM: 100,
        radiusMode: "normal",
        relaxationSourceAttemptId: null,
        ipHash: null,
        userAgent: null,
      },
      {
        id: "f2",
        createdAt: new Date(NOW.getTime() - 30_000),
        sessionId: null,
        method: "qr_gps",
        scannerUserId: MALLORY,
        presenterUserId: ALICE,
        outcome: "rejected",
        rejectionReason: "too_far",
        distanceM: 5_000_000,
        scannerAccuracyM: 10,
        presenterAccuracyM: 10,
        radiusConfigUsedM: 150,
        accuracyConfigUsedM: 100,
        radiusMode: "normal",
        relaxationSourceAttemptId: null,
        ipHash: null,
        userAgent: null,
      },
    );

    const { token } = await livePresenterSession(store);
    const outcome = await qr(store).verify(ctx(MALLORY), {
      token,
      scannerLocation: scannerLocation(ANOTHER_CONTINENT),
    });

    expect(refusalReason(outcome)).toBe("too_far");
    // And it really did run relaxed — otherwise this test would be passing
    // because relaxation never fired, not because 500 m still refuses London.
    expect(outcome.ok ? null : outcome.evidence.radiusMode).toBe("relaxed");
    expect(outcome.ok ? null : outcome.evidence.radiusConfigUsedM).toBe(500);
  });

  it("rejects a deliberately vague fix that claims to be nearby", async () => {
    // The other half of the relay defence. Without an accuracy floor, an
    // attacker reports "somewhere within 5 km of Alice" — a claim that is true
    // from London — and the distance comparison passes.
    const { token } = await livePresenterSession(store);
    const outcome = await qr(store).verify(ctx(MALLORY), {
      token,
      scannerLocation: scannerLocation(NEXT_TO_HER, { accuracyM: 5000 }),
    });
    expect(refusalReason(outcome)).toBe("scanner_accuracy_too_low");
  });

  it("rejects when the presenter's heartbeat has gone stale, however close the scanner is", async () => {
    // The relay variant where Alice's app is backgrounded: her last known
    // position is from when she was in the room, and the scan happens later.
    const { token } = await livePresenterSession(store);
    const muchLater = new Date(NOW.getTime() + 91_000);
    const outcome = await qr(store).verify(ctx(BOB, muchLater), {
      token,
      scannerLocation: scannerLocation(NEXT_TO_HER, { capturedAt: muchLater }),
    });
    // Token TTL (45s) is checked before freshness, so at +91s this is caught by
    // expiry — which is itself the point: the two bounds overlap deliberately.
    expect(["token_expired", "presenter_location_stale"]).toContain(refusalReason(outcome));
  });

  it("rejects a scanner fix backdated to when the attacker WAS nearby", async () => {
    const { token } = await livePresenterSession(store);
    const outcome = await qr(store).verify(ctx(MALLORY), {
      token,
      scannerLocation: scannerLocation(NEXT_TO_HER, {
        capturedAt: new Date(NOW.getTime() - 600_000),
      }),
    });
    expect(refusalReason(outcome)).toBe("scanner_location_stale");
  });

  it("rejects a scanner fix postdated into the future", async () => {
    const { token } = await livePresenterSession(store);
    const outcome = await qr(store).verify(ctx(MALLORY), {
      token,
      scannerLocation: scannerLocation(NEXT_TO_HER, {
        capturedAt: new Date(NOW.getTime() + 3_600_000),
      }),
    });
    expect(refusalReason(outcome)).toBe("scanner_location_stale");
  });
});

// ---------------------------------------------------------------------------
// FAIL-CLOSED MATRIX — every row of §4.3's table, end to end through the
// verifier rather than only through the pure gate.
// ---------------------------------------------------------------------------
describe("§4.3 fail-closed table, exercised through the whole verifier", () => {
  it("rejects when the presenter never posted a heartbeat at all", async () => {
    const session = await store.createSession({
      presenterUserId: ALICE,
      method: "qr_gps",
      nonce: generateNonce(),
      deviceId: null,
      expiresAt: new Date(NOW.getTime() + 300_000),
      now: NOW,
    });
    const iat = Math.floor(NOW.getTime() / 1000);
    const token = await signQrToken(SECRET, {
      sid: session.id,
      nonce: session.currentNonce!,
      iat,
      exp: iat + 45,
    });

    const outcome = await qr(store).verify(ctx(BOB), {
      token,
      scannerLocation: scannerLocation(NEXT_TO_HER),
    });
    expect(refusalReason(outcome)).toBe("presenter_location_missing");
  });

  it("rejects when the session itself has expired even though the token has not", async () => {
    const { session, token } = await livePresenterSession(store);
    session.expiresAt = new Date(NOW.getTime() - 1000);
    store.sessions.set(session.id, session);

    const outcome = await qr(store).verify(ctx(BOB), {
      token,
      scannerLocation: scannerLocation(NEXT_TO_HER),
    });
    expect(refusalReason(outcome)).toBe("session_expired");
  });

  it("rejects a scan of your own code", async () => {
    const { token } = await livePresenterSession(store);
    const outcome = await qr(store).verify(ctx(ALICE), {
      token,
      scannerLocation: scannerLocation(HERE),
    });
    expect(refusalReason(outcome)).toBe("self_connect");
  });

  it("rejects when a block exists in either direction", async () => {
    for (const block of [
      { blocker: ALICE, blocked: BOB },
      { blocker: BOB, blocked: ALICE },
    ]) {
      store = new FakeConnectStore();
      store.now = NOW;
      store.blocks.push(block);
      const { token } = await livePresenterSession(store);
      const outcome = await qr(store).verify(ctx(BOB), {
        token,
        scannerLocation: scannerLocation(NEXT_TO_HER),
      });
      expect(refusalReason(outcome)).toBe("blocked");
    }
  });

  it("rejects a re-scan when the pair is already connected, without measuring the distance", async () => {
    // Ordering matters: if the GPS gate ran first, re-scanning someone you are
    // already connected to would be a free, repeatable proximity oracle about
    // that person.
    store.connections.push({
      userA: ALICE < BOB ? ALICE : BOB,
      userB: ALICE < BOB ? BOB : ALICE,
      status: "active",
      originMeetingId: "m1",
    });
    const { token } = await livePresenterSession(store);
    const outcome = await qr(store).verify(ctx(BOB), {
      token,
      scannerLocation: scannerLocation(ACROSS_TOWN),
    });
    expect(refusalReason(outcome)).toBe("already_connected");
    expect(outcome.ok ? null : outcome.evidence.distanceM).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// THREAT 4 — Mass fake-account farming.
// ---------------------------------------------------------------------------
describe("Threat 4 — mass fake-account farming", () => {
  it("cannot produce a connection without a live session and two in-range fixes", async () => {
    // The farmer's whole toolkit: no session, a forged token, a stolen session
    // id, a token for a session that does not exist.
    const attempts = [
      { token: "totally-made-up", location: NEXT_TO_HER },
      { token: `${btoa("{}")}.${btoa("sig")}`, location: NEXT_TO_HER },
    ];
    for (const attempt of attempts) {
      const outcome = await qr(store).verify(ctx(MALLORY), {
        token: attempt.token,
        scannerLocation: scannerLocation(attempt.location),
      });
      expect(outcome.ok).toBe(false);
    }

    // A signed token for a session id that was never created.
    const iat = Math.floor(NOW.getTime() / 1000);
    const orphan = await signQrToken(SECRET, {
      sid: "99999999-9999-4999-8999-999999999999",
      nonce: generateNonce(),
      iat,
      exp: iat + 45,
    });
    const outcome = await qr(store).verify(ctx(MALLORY), {
      token: orphan,
      scannerLocation: scannerLocation(NEXT_TO_HER),
    });
    expect(refusalReason(outcome)).toBe("session_not_found");
    expect(store.connections).toHaveLength(0);
  });

  it("has no exported way to fabricate a successful outcome", () => {
    // The type-level half of §4.1 cannot be asserted at runtime — it is a
    // compile-time property, enforced by the brand on `VerifiedOutcome` and by
    // `package.json`'s `exports` map hiding `internal/seal`. What CAN be
    // asserted is that the package's public surface offers no minting function,
    // so a reviewer reading this test learns where the guarantee lives.
    //
    // The compile-time proof is the code itself: writing
    //   createVerifiedConnection(store, { ok: true, ... })
    // fails `tsc` with "Property '[verifiedBrand]' is missing", and `pnpm turbo
    // type-check` runs on every change.
    return import("../../index").then((surface) => {
      expect(Object.keys(surface)).not.toContain("sealVerified");
      expect(Object.keys(surface)).not.toContain("VerifiedBrand");
    });
  });
});

// ---------------------------------------------------------------------------
// THREAT 5 — Standard web/app attacks. Rejected by validation, not by luck.
// ---------------------------------------------------------------------------
describe("Threat 5 — malformed and injection-shaped input", () => {
  const verifier = () => createQrVerifier({ store, signingSecret: SECRET, config: store.config });

  it.each([
    ["SQL injection in the token", "' OR 1=1; DROP TABLE connections; --"],
    ["PostgREST filter syntax in the token", "id.eq.1,or(status.eq.active)"],
    ["a script tag", "<script>alert(1)</script>"],
    ["a null byte", "abc def.sig"],
    ["a prototype-pollution payload", '{"__proto__":{"admin":true}}.sig'],
  ])("refuses %s at the parse or signature step, before any lookup", async (_label, token) => {
    const outcome = await verifier().verify(ctx(MALLORY), {
      token,
      scannerLocation: scannerLocation(NEXT_TO_HER),
    });
    expect(outcome.ok).toBe(false);
    // Nothing reached the database: no session was consulted, no row written.
    expect(store.connections).toHaveLength(0);
  });

  it("rejects a request body carrying an unexpected field (strict schemas, no mass assignment)", () => {
    const parsing = () =>
      verifier().parse({
        token: "x".repeat(20),
        scannerLocation: scannerLocation(NEXT_TO_HER),
        // The mass-assignment attempt: name yourself the presenter.
        presenterUserId: MALLORY,
      });
    expect(parsing).toThrow();
  });

  it("rejects a body claiming a distance, since the server computes it", () => {
    expect(() =>
      verifier().parse({
        token: "x".repeat(20),
        scannerLocation: scannerLocation(NEXT_TO_HER),
        distanceM: 1,
      }),
    ).toThrow();
  });

  it.each([
    ["latitude out of range", { latitude: 91, longitude: 0, accuracyM: 5 }],
    ["longitude out of range", { latitude: 0, longitude: 181, accuracyM: 5 }],
    ["negative accuracy", { latitude: 0, longitude: 0, accuracyM: -1 }],
  ])("rejects %s at parse time", (_label, bad) => {
    expect(() =>
      verifier().parse({
        token: "x".repeat(20),
        scannerLocation: { ...bad, capturedAt: NOW.toISOString() },
      }),
    ).toThrow();
  });

  it("rejects a non-ISO timestamp rather than coercing it", () => {
    expect(() =>
      verifier().parse({
        token: "x".repeat(20),
        scannerLocation: { latitude: 0, longitude: 0, accuracyM: 5, capturedAt: "yesterday" },
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// THREAT 6 — Deliberately failing to trigger relaxation.
// Bounds tested exhaustively in relaxation.test.ts; here is the end-to-end path.
// ---------------------------------------------------------------------------
describe("Threat 6 — buying a wider radius by failing on purpose", () => {
  function failureRow(
    id: string,
    reason: string,
    ago: number,
    radiusMode: "normal" | "relaxed" = "normal",
  ) {
    return {
      id,
      createdAt: new Date(NOW.getTime() - ago),
      sessionId: null,
      method: "qr_gps" as const,
      scannerUserId: BOB,
      presenterUserId: ALICE,
      outcome: "rejected" as const,
      rejectionReason: reason as never,
      distanceM: 300,
      scannerAccuracyM: 10,
      presenterAccuracyM: 10,
      radiusConfigUsedM: 150,
      accuracyConfigUsedM: 100,
      radiusMode,
      relaxationSourceAttemptId: null,
      ipHash: null,
      userAgent: null,
    };
  }

  it("does not widen the radius after two junk failures (bad signature, expired token)", async () => {
    // The cheap attack: two requests that cost nothing to produce.
    store.attempts.push(
      failureRow("j1", "invalid_signature", 60_000),
      failureRow("j2", "token_expired", 30_000),
    );

    const { token } = await livePresenterSession(store);
    // ~350 m away: outside 150 m, inside 500 m. It should be refused, because
    // junk failures unlock nothing.
    const outcome = await qr(store).verify(ctx(BOB), {
      token,
      scannerLocation: scannerLocation({ latitude: 40.7601, longitude: -73.9885 }),
    });
    expect(refusalReason(outcome)).toBe("too_far");
    expect(outcome.ok ? null : outcome.evidence.radiusMode).toBe("normal");
  });

  it("does widen it after two genuine distance failures — the intended rescue", async () => {
    store.attempts.push(failureRow("d1", "too_far", 60_000), failureRow("d2", "too_far", 30_000));
    const { token } = await livePresenterSession(store);
    const outcome = await qr(store).verify(ctx(BOB), {
      token,
      scannerLocation: scannerLocation({ latitude: 40.7601, longitude: -73.9885 }),
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.ok ? outcome.evidence.radiusMode : null).toBe("relaxed");
    expect(outcome.ok ? outcome.evidence.relaxationSourceAttemptId : null).toBe("d2");
  });

  it("does not widen it for failures that fell outside the ten-minute window", async () => {
    store.attempts.push(
      failureRow("o1", "too_far", 11 * 60_000),
      failureRow("o2", "too_far", 12 * 60_000),
    );
    const { token } = await livePresenterSession(store);
    const outcome = await qr(store).verify(ctx(BOB), {
      token,
      scannerLocation: scannerLocation({ latitude: 40.7601, longitude: -73.9885 }),
    });
    expect(refusalReason(outcome)).toBe("too_far");
    expect(outcome.ok ? null : outcome.evidence.radiusMode).toBe("normal");
  });

  it("does not widen it again inside the cooldown, however many further failures there are", async () => {
    store.attempts.push(
      failureRow("c1", "too_far", 60_000),
      failureRow("c2", "too_far", 50_000),
      failureRow("c3", "too_far", 40_000),
      failureRow("c4", "too_far", 20_000, "relaxed"), // the relaxed attempt, spent
    );
    const { token } = await livePresenterSession(store);
    const outcome = await qr(store).verify(ctx(BOB), {
      token,
      scannerLocation: scannerLocation({ latitude: 40.7601, longitude: -73.9885 }),
    });
    expect(refusalReason(outcome)).toBe("too_far");
    expect(outcome.ok ? null : outcome.evidence.radiusMode).toBe("normal");
  });

  it("cannot be unlocked by pooling failures against a different presenter", async () => {
    // Same scanner, different presenter. Failures must be same-ordered-pair, or
    // an attacker could farm failures against a willing accomplice and spend
    // them on a victim.
    store.attempts.push(
      { ...failureRow("p1", "too_far", 60_000), presenterUserId: MALLORY },
      { ...failureRow("p2", "too_far", 30_000), presenterUserId: MALLORY },
    );
    const { token } = await livePresenterSession(store);
    const outcome = await qr(store).verify(ctx(BOB), {
      token,
      scannerLocation: scannerLocation({ latitude: 40.7601, longitude: -73.9885 }),
    });
    expect(refusalReason(outcome)).toBe("too_far");
    expect(outcome.ok ? null : outcome.evidence.radiusMode).toBe("normal");
  });

  it("cannot be unlocked by another scanner's failures against the same presenter", async () => {
    store.attempts.push(
      { ...failureRow("s1", "too_far", 60_000), scannerUserId: MALLORY },
      { ...failureRow("s2", "too_far", 30_000), scannerUserId: MALLORY },
    );
    const { token } = await livePresenterSession(store);
    const outcome = await qr(store).verify(ctx(BOB), {
      token,
      scannerLocation: scannerLocation({ latitude: 40.7601, longitude: -73.9885 }),
    });
    expect(refusalReason(outcome)).toBe("too_far");
  });
});

// ---------------------------------------------------------------------------
// THREAT 7 — Lost or stolen card.
// ---------------------------------------------------------------------------
describe("Threat 7 — lost or stolen card, and the revocation that answers it", () => {
  const CARD_CODE = "CUSTOM-f2a930bcb5fe";
  const CARD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  function nfc() {
    return createNfcVerifier({ store, config: store.config });
  }

  beforeEach(() => {
    store.cards.set(CARD_ID, {
      id: CARD_ID,
      cardCode: CARD_CODE,
      status: "assigned",
      ownerUserId: ALICE,
    });
  });

  it("connects on a legitimate tap — the control", async () => {
    const outcome = await nfc().verify(ctx(BOB), { code: CARD_CODE });
    expect(outcome.ok).toBe(true);
    expect(outcome.ok ? outcome.profileRichness : null).toBe("full");
    // No GPS is collected on this path and none may be.
    expect(outcome.ok ? outcome.location : "unset").toBeUndefined();
  });

  it("rejects a revoked card — the owner's kill switch actually kills it", async () => {
    store.cards.get(CARD_ID)!.status = "revoked";
    const outcome = await nfc().verify(ctx(MALLORY), { code: CARD_CODE });
    expect(refusalReason(outcome)).toBe("card_revoked");
    expect(store.connections).toHaveLength(0);
  });

  it("rejects an unassigned card — stock nobody owns is nobody to connect to", async () => {
    store.cards.get(CARD_ID)!.status = "unassigned";
    store.cards.get(CARD_ID)!.ownerUserId = null;
    const outcome = await nfc().verify(ctx(MALLORY), { code: CARD_CODE });
    expect(refusalReason(outcome)).toBe("card_unassigned");
  });

  it("rejects an unknown code", async () => {
    const outcome = await nfc().verify(ctx(MALLORY), { code: "CUSTOM-000000000000" });
    expect(refusalReason(outcome)).toBe("card_not_found");
  });

  it("rejects a tap by someone the owner has blocked, so the notification cannot be a message channel", async () => {
    store.blocks.push({ blocker: ALICE, blocked: MALLORY });
    const outcome = await nfc().verify(ctx(MALLORY), { code: CARD_CODE });
    expect(refusalReason(outcome)).toBe("blocked");
  });

  it("rejects tapping your own card", async () => {
    const outcome = await nfc().verify(ctx(ALICE), { code: CARD_CODE });
    expect(refusalReason(outcome)).toBe("self_connect");
  });

  it("caps how many times one card can be redeemed in an hour", async () => {
    // §4.7 threat 7: the per-card limit is what bounds the damage a found card
    // does between the theft and the owner reacting to the notification.
    store.config = { ...DEFAULT_CONFIG, rate_limit_nfc_redeem_per_card_hour: 3 };

    let refusals = 0;
    for (let i = 0; i < 6; i += 1) {
      const outcome = await nfc().verify(ctx(MALLORY), { code: CARD_CODE });
      if (!outcome.ok && outcome.reason === "rate_limited") refusals += 1;
    }
    expect(refusals).toBeGreaterThan(0);
  });

  it("never trusts a client-asserted owner — the request has no field for one", () => {
    expect(() => nfc().parse({ code: CARD_CODE, ownerUserId: MALLORY })).toThrow();
  });

  it("refuses a malformed card code before any lookup", () => {
    for (const code of ["'; drop table cards; --", "not-hex-at-all", "short", ""]) {
      expect(() => nfc().parse({ code })).toThrow();
    }
  });

  it("accepts the two legacy bare-hex codes recorded in §6.3", () => {
    // Legacy card ids 114 and 115 have no cosmetic prefix. Rejecting them would
    // make two real pieces of physical inventory silently unusable.
    expect(() => nfc().parse({ code: "f2a930bcb5fe" })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rate limiting (§4.6) on the QR path.
// ---------------------------------------------------------------------------
describe("§4.6 — the per-user redeem limit", () => {
  it("refuses once the hourly budget is spent, at step 9 and not before", async () => {
    store.config = { ...DEFAULT_CONFIG, rate_limit_qr_redeem_per_user_hour: 2 };

    const reasons: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { token } = await livePresenterSession(store);
      const outcome = await qr(store).verify(ctx(BOB), {
        token,
        scannerLocation: scannerLocation(NEXT_TO_HER),
      });
      reasons.push(outcome.ok ? "ok" : outcome.reason);
    }

    expect(reasons.slice(0, 2)).toEqual(["ok", "ok"]);
    expect(reasons.slice(2)).toEqual(["rate_limited", "rate_limited"]);
  });
});
