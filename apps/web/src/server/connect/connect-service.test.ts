import { beforeEach, describe, expect, it } from "vitest";
import type { ConnectStore, SessionRecord, VerificationConfig } from "@smartcard/core";
import type { RequestContext } from "@smartcard/core";

import { heartbeatQrSession } from "./connect-service";

/**
 * `heartbeatQrSession`'s `status` field is the one addition to the connect
 * API surface this build makes (see the doc comment on
 * `qrHeartbeatResponseSchema` in `packages/types/src/connect/index.ts` for the
 * full reasoning). These tests are the check that the three-way split —
 * active / consumed / ended — actually reflects what the store said, and,
 * just as importantly, that a session belonging to someone else never leaks
 * its status to this caller.
 */

process.env.CONNECT_IP_HASH_SALT = "test-salt-not-a-real-one";
process.env.QR_SIGNING_SECRET = "test-signing-secret-not-a-real-one";

const PRESENTER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";

const CONFIG: VerificationConfig = {
  qr_max_distance_m: 150,
  qr_max_accuracy_m: 100,
  qr_token_ttl_seconds: 45,
  qr_rotation_seconds: 30,
  presenter_location_max_age_seconds: 90,
  session_max_lifetime_seconds: 300,
  qr_relaxation_enabled: true,
  qr_relaxation_failure_threshold: 2,
  qr_relaxation_window_seconds: 600,
  qr_relaxed_max_distance_m: 500,
  qr_relaxed_max_accuracy_m: 150,
  qr_relaxation_cooldown_seconds: 3600,
  nfc_tap_notification_coalesce_seconds: 300,
  rate_limit_qr_session_create_per_user_hour: 60,
  rate_limit_qr_redeem_per_user_hour: 60,
  rate_limit_qr_redeem_failures_per_session: 5,
  rate_limit_nfc_redeem_per_card_hour: 20,
  rate_limit_nfc_redeem_per_user_hour: 60,
  rate_limit_connect_per_ip_hour: 600,
};

function baseSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: SESSION_ID,
    method: "qr_gps",
    presenterUserId: PRESENTER_ID,
    status: "active",
    // 32 hex chars, matching the real shape `generateNonce()` produces
    // (`qr-token.ts`) — `qrTokenPayloadSchema.nonce` requires >=16 chars, and
    // a shorter fixture value fails `signQrToken`'s own parse before the
    // "active" branch's assertions ever run.
    currentNonce: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    previousNonce: null,
    nonceIssuedAt: new Date("2026-08-13T18:00:00.000Z"),
    presenterLatitude: null,
    presenterLongitude: null,
    presenterAccuracyM: null,
    presenterLocationAt: null,
    deviceId: null,
    expiresAt: new Date("2026-08-13T18:05:00.000Z"),
    ...overrides,
  };
}

/**
 * Only the methods `heartbeatQrSession` actually calls are implemented for
 * real; everything else throws, so a test that accidentally exercises a path
 * this file does not own fails loudly instead of silently doing nothing.
 */
class FakeStore implements ConnectStore {
  heartbeatResult: SessionRecord | null = null;
  loadSessionResult: SessionRecord | null = null;

  async loadConfig(): Promise<VerificationConfig> {
    return CONFIG;
  }

  async heartbeat(): Promise<SessionRecord | null> {
    return this.heartbeatResult;
  }

  async loadSession(): Promise<SessionRecord | null> {
    return this.loadSessionResult;
  }

  async consumeRateLimit(): Promise<boolean> {
    return true;
  }

  createSession(): Promise<SessionRecord> {
    throw new Error("not implemented — unused by heartbeatQrSession");
  }
  areConnected(): Promise<boolean> {
    throw new Error("not implemented — unused by heartbeatQrSession");
  }
  isBlockedEitherWay(): Promise<boolean> {
    throw new Error("not implemented — unused by heartbeatQrSession");
  }
  findCardByCode(): Promise<never> {
    throw new Error("not implemented — unused by heartbeatQrSession");
  }
  countSessionRejections(): Promise<number> {
    throw new Error("not implemented — unused by heartbeatQrSession");
  }
  burnSession(): Promise<void> {
    throw new Error("not implemented — unused by heartbeatQrSession");
  }
  loadRelaxationHistory(): Promise<never> {
    throw new Error("not implemented — unused by heartbeatQrSession");
  }
  logAttempt(): Promise<string | null> {
    throw new Error("not implemented — unused by heartbeatQrSession");
  }
  commitVerifiedConnection(): Promise<never> {
    throw new Error("not implemented — unused by heartbeatQrSession");
  }
}

function ctxFor(callerUserId: string): RequestContext {
  return { callerUserId, ipHash: null, userAgent: null, now: new Date("2026-08-13T18:01:00.000Z") };
}

const HEARTBEAT_BODY = {
  sessionId: SESSION_ID,
  location: {
    latitude: 40.0,
    longitude: -73.0,
    accuracyM: 10,
    capturedAt: "2026-08-13T18:01:00.000Z",
  },
};

describe("heartbeatQrSession status", () => {
  let store: FakeStore;

  beforeEach(() => {
    store = new FakeStore();
  });

  it("reports status: active with a fresh token while the session is still live", async () => {
    store.heartbeatResult = baseSession();

    const result = await heartbeatQrSession(ctxFor(PRESENTER_ID), HEARTBEAT_BODY, {
      store,
      signingSecret: "test-signing-secret-not-a-real-one",
    });

    expect(result.status).toBe("active");
    if (result.status === "active") {
      expect(typeof result.token).toBe("string");
      expect(result.rotateAfterSeconds).toBe(CONFIG.qr_rotation_seconds);
    }
  });

  it("reports status: consumed when the presenter's own session was just scanned — the success signal", async () => {
    store.heartbeatResult = null; // the store's own `status = 'active'` predicate no longer matches
    store.loadSessionResult = baseSession({ status: "consumed" });

    const result = await heartbeatQrSession(ctxFor(PRESENTER_ID), HEARTBEAT_BODY, {
      store,
      signingSecret: "test-signing-secret-not-a-real-one",
    });

    expect(result).toEqual({ status: "consumed" });
  });

  it("collapses expired and revoked into status: ended — the presenter never learns which", async () => {
    store.heartbeatResult = null;
    store.loadSessionResult = baseSession({ status: "revoked" });

    const revoked = await heartbeatQrSession(ctxFor(PRESENTER_ID), HEARTBEAT_BODY, {
      store,
      signingSecret: "test-signing-secret-not-a-real-one",
    });
    expect(revoked).toEqual({ status: "ended" });

    store.loadSessionResult = baseSession({ status: "expired" });
    const expired = await heartbeatQrSession(ctxFor(PRESENTER_ID), HEARTBEAT_BODY, {
      store,
      signingSecret: "test-signing-secret-not-a-real-one",
    });
    expect(expired).toEqual({ status: "ended" });
  });

  it("never reports another user's session status — falls back to the ordinary refusal", async () => {
    store.heartbeatResult = null;
    // The session exists and is genuinely consumed, but belongs to someone else.
    store.loadSessionResult = baseSession({ status: "consumed", presenterUserId: OTHER_USER_ID });

    await expect(
      heartbeatQrSession(ctxFor(PRESENTER_ID), HEARTBEAT_BODY, {
        store,
        signingSecret: "test-signing-secret-not-a-real-one",
      }),
    ).rejects.toThrow(/couldn't complete|need to be near/i);
  });

  it("refuses with the ordinary message when the session id does not exist at all", async () => {
    store.heartbeatResult = null;
    store.loadSessionResult = null;

    await expect(
      heartbeatQrSession(ctxFor(PRESENTER_ID), HEARTBEAT_BODY, {
        store,
        signingSecret: "test-signing-secret-not-a-real-one",
      }),
    ).rejects.toThrow();
  });
});
