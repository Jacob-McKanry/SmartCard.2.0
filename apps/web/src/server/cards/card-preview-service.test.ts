/**
 * The non-user preview's refusal behaviour, which is the whole of its security
 * story.
 *
 * `card-preview-service.ts` claims one property above all others: every way of
 * failing produces the same answer, so the route cannot be used as an oracle
 * for which of the 7,142 printed card codes are real, which of those are live,
 * or whose account is still active. A claim like that is worth nothing asserted
 * in prose — it has to be exercised, and it has to be exercised across the
 * whole set of failures at once rather than one test per branch, because the
 * bug it guards against is precisely "one of them behaves slightly differently".
 *
 * These run against a fake store for the reason `ports.ts` gives: a revoked
 * card, a suspended owner, a session consumed a millisecond ago and an
 * exhausted budget are three lines each here and a fixture each against a real
 * database, and the tests that get written are the ones that are cheap to
 * write.
 */

// `hashIpAddress` refuses to run without this, on purpose (`env.ts`): an
// unsalted hash of an IP is reversible by enumerating the address space. Set
// before the module under test is imported so the first call sees it.
process.env.CONNECT_IP_HASH_SALT ??= "test-salt-not-a-real-secret";

import { beforeEach, describe, expect, it } from "vitest";

import { signQrToken, type CardRecord, type RateLimitRequest, type SessionRecord } from "@smartcard/core";

import {
  resolveCardCodePreview,
  resolveQrTokenPreview,
  type CardPreview,
  type CardPreviewDeps,
  type CardPreviewLimits,
  type CardPreviewStore,
  type CardPreviewViewRecord,
  type PreviewSubjectRow,
} from "./card-preview-service";

const SIGNING_SECRET = "test-qr-signing-secret-not-a-real-one";
const NOW = new Date("2026-08-15T12:00:00.000Z");

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const CARD_ID = "33333333-3333-4333-8333-333333333333";

const GOOD_CODE = "CUSTOM-f2a930bcb5fe";
const UNKNOWN_CODE = "CUSTOM-aaaaaaaaaaaa";

function activeOwner(overrides: Partial<PreviewSubjectRow> = {}): PreviewSubjectRow {
  return {
    id: OWNER_ID,
    first_name: "Sam",
    last_name: "Rivera",
    company_name: "Northwind",
    company_role: "Head of Partnerships",
    bio: "Coffee and supply chains.",
    phone_number: "+1 415 555 0132",
    email: "sam@northwind.example",
    photo_path: `${OWNER_ID}/avatar.jpg`,
    status: "active",
    ...overrides,
  };
}

function assignedCard(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: CARD_ID,
    cardCode: GOOD_CODE,
    status: "assigned",
    ownerUserId: OWNER_ID,
    ...overrides,
  };
}

function liveSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: SESSION_ID,
    method: "qr_gps",
    presenterUserId: OWNER_ID,
    status: "active",
    currentNonce: "a".repeat(32),
    previousNonce: "b".repeat(32),
    nonceIssuedAt: new Date(NOW.getTime() - 5_000),
    presenterLatitude: null,
    presenterLongitude: null,
    presenterAccuracyM: null,
    presenterLocationAt: null,
    deviceId: null,
    expiresAt: new Date(NOW.getTime() + 600_000),
    ...overrides,
  };
}

interface FakeWorld {
  limits?: CardPreviewLimits | (() => never);
  cards?: Record<string, CardRecord>;
  sessions?: Record<string, SessionRecord>;
  subjects?: Record<string, PreviewSubjectRow>;
  /** Return false to put the subject over budget. Called for every consume. */
  allowRateLimit?: (request: RateLimitRequest) => boolean;
  photoUrl?: string | null;
  recordViewThrows?: boolean;
  loadSubjectThrows?: boolean;
}

interface Fake {
  deps: CardPreviewDeps;
  consumed: RateLimitRequest[];
  recorded: CardPreviewViewRecord[];
}

function fakeWorld(world: FakeWorld = {}): Fake {
  const consumed: RateLimitRequest[] = [];
  const recorded: CardPreviewViewRecord[] = [];

  const store: CardPreviewStore = {
    async loadLimits(): Promise<CardPreviewLimits> {
      if (typeof world.limits === "function") return world.limits();
      return world.limits ?? { perIpHour: 40, perCardHour: 20 };
    },
    async consumeRateLimit(request: RateLimitRequest): Promise<boolean> {
      consumed.push(request);
      return world.allowRateLimit?.(request) ?? true;
    },
    async findCardByCode(cardCode: string): Promise<CardRecord | null> {
      return world.cards?.[cardCode] ?? null;
    },
    async loadSession(sessionId: string): Promise<SessionRecord | null> {
      return world.sessions?.[sessionId] ?? null;
    },
    async loadPreviewSubject(userId: string): Promise<PreviewSubjectRow | null> {
      if (world.loadSubjectThrows) throw new Error("boom");
      return world.subjects?.[userId] ?? null;
    },
    async signedPhotoUrl(photoPath: string | null): Promise<string | null> {
      if (photoPath === null) return null;
      return world.photoUrl === undefined ? "https://storage.example/signed" : world.photoUrl;
    },
    async recordView(view: CardPreviewViewRecord): Promise<void> {
      if (world.recordViewThrows) throw new Error("audit write failed");
      recorded.push(view);
    },
  };

  return { deps: { store, signingSecret: SIGNING_SECRET }, consumed, recorded };
}

/** A world in which everything is fine, so a test only has to break one thing. */
function healthyWorld(overrides: FakeWorld = {}): FakeWorld {
  return {
    cards: { [GOOD_CODE]: assignedCard() },
    sessions: { [SESSION_ID]: liveSession() },
    subjects: { [OWNER_ID]: activeOwner() },
    ...overrides,
  };
}

const request = (surface: "preview" | "vcard" = "preview") => ({
  headers: new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "TestAgent/1.0" }),
  surface,
  now: NOW,
});

async function validToken(overrides: { nonce?: string; expOffsetSeconds?: number } = {}) {
  const iat = Math.floor(NOW.getTime() / 1000);
  return signQrToken(SIGNING_SECRET, {
    sid: SESSION_ID,
    nonce: overrides.nonce ?? "a".repeat(32),
    iat,
    exp: iat + (overrides.expOffsetSeconds ?? 45),
  });
}

// ---------------------------------------------------------------------------

describe("what a successful card preview discloses", () => {
  it("returns exactly the seven hardcoded fields plus a signed photo URL", async () => {
    const fake = fakeWorld(healthyWorld());
    const preview = await resolveCardCodePreview(GOOD_CODE, request(), fake.deps);

    // The key set is asserted, not just the values. This is the test that fails
    // if somebody widens the disclosure by spreading a row, and it is the
    // reason `discloseSubject` maps field by field from a literal.
    expect(preview).not.toBeNull();
    expect(Object.keys(preview as CardPreview).sort()).toEqual(
      [
        "bio",
        "companyName",
        "companyRole",
        "email",
        "firstName",
        "lastName",
        "phoneNumber",
        "photoUrl",
      ].sort(),
    );
  });

  it("never carries social links, a username, an id, an admin flag or a raw storage path", async () => {
    // `social_links` is the specific thing 20260809211100 forbids exposing —
    // "a searchable directory of people's off-platform handles". The store this
    // module talks to has no method that could return one, which is the real
    // guarantee; this asserts the shape that guarantee produces.
    const fake = fakeWorld(healthyWorld());
    const preview = await resolveCardCodePreview(GOOD_CODE, request(), fake.deps);
    const serialised = JSON.stringify(preview);

    for (const forbidden of ["socialLinks", "social_links", "username", "is_admin", "status", "id"]) {
      expect(Object.keys(preview as CardPreview)).not.toContain(forbidden);
    }
    // The storage object key must be exchanged for a signed URL, never handed
    // over as-is: a raw path plus a public bucket would be an ungated copy of
    // gated data (§6.5).
    expect(serialised).not.toContain("avatar.jpg");
  });

  it("records one audit row per disclosure, attributed to the right person and card", async () => {
    const fake = fakeWorld(healthyWorld());
    await resolveCardCodePreview(GOOD_CODE, request("preview"), fake.deps);
    await resolveCardCodePreview(GOOD_CODE, request("vcard"), fake.deps);

    expect(fake.recorded).toHaveLength(2);
    expect(fake.recorded[0]).toMatchObject({
      source: "card_code",
      surface: "preview",
      subjectUserId: OWNER_ID,
      cardId: CARD_ID,
      sessionId: null,
      userAgent: "TestAgent/1.0",
    });
    expect(fake.recorded[1]?.surface).toBe("vcard");
    // Hashed, never the address itself.
    expect(fake.recorded[0]?.ipHash).not.toBe("203.0.113.7");
    expect(fake.recorded[0]?.ipHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("spends both budgets, per IP and per card, under one action", async () => {
    const fake = fakeWorld(healthyWorld());
    await resolveCardCodePreview(GOOD_CODE, request(), fake.deps);

    expect(fake.consumed.map((c) => [c.action, c.subjectKind, c.subjectKey])).toEqual([
      ["card_preview", "ip", expect.any(String)],
      ["card_preview", "card", CARD_ID],
    ]);
  });
});

describe("what a successful QR preview discloses", () => {
  it("resolves the presenter behind a live session", async () => {
    const fake = fakeWorld(healthyWorld());
    const preview = await resolveQrTokenPreview(await validToken(), request(), fake.deps);

    expect(preview?.firstName).toBe("Sam");
    expect(fake.recorded[0]).toMatchObject({
      source: "qr_token",
      subjectUserId: OWNER_ID,
      sessionId: SESSION_ID,
      cardId: null,
    });
  });

  it("accepts the previous nonce, so a scan already in flight when the code rotated still resolves", async () => {
    const fake = fakeWorld(healthyWorld());
    const preview = await resolveQrTokenPreview(
      await validToken({ nonce: "b".repeat(32) }),
      request(),
      fake.deps,
    );
    expect(preview).not.toBeNull();
  });

  it("spends only the per-IP budget — there is no card and no per-session counter", async () => {
    const fake = fakeWorld(healthyWorld());
    await resolveQrTokenPreview(await validToken(), request(), fake.deps);
    expect(fake.consumed.map((c) => c.subjectKind)).toEqual(["ip"]);
  });
});

// ---------------------------------------------------------------------------

/**
 * The centre of this file. Every one of these must be `null`, and — because
 * "indistinguishable" is a statement about the SET and not about any pair — the
 * set of distinct results across all of them is asserted at the end.
 */
describe("every refusal on the card path is the same refusal", () => {
  const cases: [name: string, world: FakeWorld, code: string][] = [
    ["a code that is not even the right shape", healthyWorld(), "not-a-card-code"],
    ["a code that matches no card", healthyWorld(), UNKNOWN_CODE],
    [
      "a card that exists but is unassigned stock",
      healthyWorld({
        cards: { [GOOD_CODE]: assignedCard({ status: "unassigned", ownerUserId: null }) },
      }),
      GOOD_CODE,
    ],
    [
      "a card the owner revoked",
      healthyWorld({ cards: { [GOOD_CODE]: assignedCard({ status: "revoked" }) } }),
      GOOD_CODE,
    ],
    [
      "an assigned card with no owner (a state the CHECK constraint forbids)",
      healthyWorld({ cards: { [GOOD_CODE]: assignedCard({ ownerUserId: null }) } }),
      GOOD_CODE,
    ],
    [
      "an owner whose account is suspended",
      healthyWorld({ subjects: { [OWNER_ID]: activeOwner({ status: "suspended" }) } }),
      GOOD_CODE,
    ],
    [
      "an owner who has been soft-deleted",
      healthyWorld({ subjects: { [OWNER_ID]: activeOwner({ status: "deleted" }) } }),
      GOOD_CODE,
    ],
    ["an owner row that has vanished entirely", healthyWorld({ subjects: {} }), GOOD_CODE],
    [
      "the per-IP budget being exhausted",
      healthyWorld({ allowRateLimit: (r) => r.subjectKind !== "ip" }),
      GOOD_CODE,
    ],
    [
      "the per-card budget being exhausted",
      healthyWorld({ allowRateLimit: (r) => r.subjectKind !== "card" }),
      GOOD_CODE,
    ],
    [
      "a missing or unusable app_config row",
      healthyWorld({
        limits: () => {
          throw new Error("app_config.rate_limit_card_preview_per_ip_hour is missing");
        },
      }),
      GOOD_CODE,
    ],
    ["the database throwing mid-read", healthyWorld({ loadSubjectThrows: true }), GOOD_CODE],
    [
      "the audit write failing, which refuses rather than disclosing unlogged",
      healthyWorld({ recordViewThrows: true }),
      GOOD_CODE,
    ],
  ];

  it.each(cases)("refuses %s", async (_name, world, code) => {
    const fake = fakeWorld(world);
    await expect(resolveCardCodePreview(code, request(), fake.deps)).resolves.toBeNull();
  });

  it.each(cases)("discloses nothing and writes no audit row for %s", async (_name, world, code) => {
    const fake = fakeWorld(world);
    await resolveCardCodePreview(code, request(), fake.deps);
    expect(fake.recorded).toEqual([]);
  });

  it("produces exactly one distinct result across every failure mode", async () => {
    const results = await Promise.all(
      cases.map(([, world, code]) => resolveCardCodePreview(code, request(), fakeWorld(world).deps)),
    );
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(results.every((r) => r === null)).toBe(true);
  });

  it("an unknown code and a revoked card are literally the same answer", async () => {
    // The pair the brief singles out, asserted directly as well as inside the
    // set above, because it is the one an enumerator actually runs: "does this
    // code exist?" must not be answerable, and neither must "did somebody
    // revoke it?".
    const unknown = await resolveCardCodePreview(
      UNKNOWN_CODE,
      request(),
      fakeWorld(healthyWorld()).deps,
    );
    const revoked = await resolveCardCodePreview(
      GOOD_CODE,
      request(),
      fakeWorld(healthyWorld({ cards: { [GOOD_CODE]: assignedCard({ status: "revoked" }) } })).deps,
    );
    expect(unknown).toStrictEqual(revoked);
  });

  it("still charges the card's budget for a revoked card, so probing one is not free", async () => {
    const fake = fakeWorld(
      healthyWorld({ cards: { [GOOD_CODE]: assignedCard({ status: "revoked" }) } }),
    );
    await resolveCardCodePreview(GOOD_CODE, request(), fake.deps);
    expect(fake.consumed.map((c) => c.subjectKind)).toEqual(["ip", "card"]);
  });

  it("never reaches the card lookup once the per-IP budget is gone", async () => {
    const fake = fakeWorld(healthyWorld({ allowRateLimit: (r) => r.subjectKind !== "ip" }));
    await resolveCardCodePreview(GOOD_CODE, request(), fake.deps);
    expect(fake.consumed).toHaveLength(1);
  });

  it("charges a caller with no IP header to a subject rather than skipping the limit", async () => {
    // Otherwise "send no x-forwarded-for" is how you opt out of the only
    // per-caller limit that exists on an unauthenticated path.
    const fake = fakeWorld(healthyWorld());
    await resolveCardCodePreview(
      GOOD_CODE,
      { headers: new Headers(), surface: "preview", now: NOW },
      fake.deps,
    );
    expect(fake.consumed[0]).toMatchObject({ subjectKind: "ip", subjectKey: "unknown" });
  });
});

// ---------------------------------------------------------------------------

describe("every refusal on the QR path is the same refusal", () => {
  let forgedToken: string;
  let expiredToken: string;
  let goodToken: string;
  let staleNonceToken: string;

  beforeEach(async () => {
    const iat = Math.floor(NOW.getTime() / 1000);
    goodToken = await validToken();
    // Correctly structured, correctly current — signed with the wrong key.
    forgedToken = await signQrToken("a-different-secret", {
      sid: SESSION_ID,
      nonce: "a".repeat(32),
      iat,
      exp: iat + 45,
    });
    expiredToken = await validToken({ expOffsetSeconds: -1 });
    staleNonceToken = await validToken({ nonce: "c".repeat(32) });
  });

  it("refuses a forged signature without interpreting the payload", async () => {
    const fake = fakeWorld(healthyWorld());
    await expect(resolveQrTokenPreview(forgedToken, request(), fake.deps)).resolves.toBeNull();
    // The session was never looked up: the signature gate stands in front of
    // all I/O, which is what makes it safe to spend only one budget here.
    expect(fake.recorded).toEqual([]);
  });

  it("refuses an expired token even though everything else about it is real", async () => {
    const fake = fakeWorld(healthyWorld());
    await expect(resolveQrTokenPreview(expiredToken, request(), fake.deps)).resolves.toBeNull();
  });

  it("refuses a nonce two rotations old, so a photographed code goes stale here too", async () => {
    const fake = fakeWorld(healthyWorld());
    await expect(resolveQrTokenPreview(staleNonceToken, request(), fake.deps)).resolves.toBeNull();
  });

  it("refuses a consumed session, so redeeming kills every outstanding token on this surface too", async () => {
    const fake = fakeWorld(
      healthyWorld({ sessions: { [SESSION_ID]: liveSession({ status: "consumed" }) } }),
    );
    await expect(resolveQrTokenPreview(goodToken, request(), fake.deps)).resolves.toBeNull();
  });

  it("refuses a session burned by the five-failure rule", async () => {
    const fake = fakeWorld(
      healthyWorld({ sessions: { [SESSION_ID]: liveSession({ status: "revoked" }) } }),
    );
    await expect(resolveQrTokenPreview(goodToken, request(), fake.deps)).resolves.toBeNull();
  });

  it("refuses a session that has passed its own expires_at", async () => {
    const fake = fakeWorld(
      healthyWorld({
        sessions: { [SESSION_ID]: liveSession({ expiresAt: new Date(NOW.getTime() - 1) }) },
      }),
    );
    await expect(resolveQrTokenPreview(goodToken, request(), fake.deps)).resolves.toBeNull();
  });

  it("refuses a session belonging to the other verification method", async () => {
    const fake = fakeWorld(
      healthyWorld({ sessions: { [SESSION_ID]: liveSession({ method: "nfc_card" }) } }),
    );
    await expect(resolveQrTokenPreview(goodToken, request(), fake.deps)).resolves.toBeNull();
  });

  it("refuses garbage, injection-shaped and empty tokens identically", async () => {
    const fake = fakeWorld(healthyWorld());
    const junk = [
      "",
      ".",
      "....",
      "not a token at all",
      "'; drop table users; --",
      "<script>alert(1)</script>",
      "__proto__.polluted",
      "a".repeat(5000),
    ];
    const results = await Promise.all(
      junk.map((token) => resolveQrTokenPreview(token, request(), fake.deps)),
    );
    expect(results.every((r) => r === null)).toBe(true);
    expect(fake.recorded).toEqual([]);
  });

  it("produces exactly one distinct result across every QR failure mode", async () => {
    const worlds: [string, FakeWorld][] = [
      [forgedToken, healthyWorld()],
      [expiredToken, healthyWorld()],
      [staleNonceToken, healthyWorld()],
      [goodToken, healthyWorld({ sessions: {} })],
      [goodToken, healthyWorld({ sessions: { [SESSION_ID]: liveSession({ status: "consumed" }) } })],
      [goodToken, healthyWorld({ subjects: { [OWNER_ID]: activeOwner({ status: "deleted" }) } })],
      [goodToken, healthyWorld({ allowRateLimit: () => false })],
      [goodToken, healthyWorld({ recordViewThrows: true })],
      ["garbage", healthyWorld()],
    ];

    const results = await Promise.all(
      worlds.map(([token, world]) => resolveQrTokenPreview(token, request(), fakeWorld(world).deps)),
    );
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(results.every((r) => r === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("the preview and the vCard see the same person", () => {
  it("both surfaces resolve identical field values, so the file cannot say more than the page", async () => {
    const fake = fakeWorld(healthyWorld());
    const page = await resolveCardCodePreview(GOOD_CODE, request("preview"), fake.deps);
    const file = await resolveCardCodePreview(GOOD_CODE, request("vcard"), fake.deps);
    expect(page).toStrictEqual(file);
  });

  it("degrades to no photo rather than refusing when signing the URL fails", async () => {
    // Otherwise the refusal would be distinguishable by whether the person had
    // ever uploaded a picture.
    const fake = fakeWorld(healthyWorld({ photoUrl: null }));
    const preview = await resolveCardCodePreview(GOOD_CODE, request(), fake.deps);
    expect(preview).not.toBeNull();
    expect(preview?.photoUrl).toBeNull();
  });
});
