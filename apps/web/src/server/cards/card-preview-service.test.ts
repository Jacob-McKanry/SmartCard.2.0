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
  resolveCardCodeLanding,
  resolveCardCodePreview,
  resolveQrTokenPreview,
  type CardPreview,
  type CardPreviewDeps,
  type CardPreviewLimits,
  type CardPreviewStore,
  type CardPreviewViewRecord,
  type PreviewCounts,
  type PreviewPhoto,
  type PreviewSocialLink,
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

const SOCIAL_LINKS: PreviewSocialLink[] = [
  { id: "link-1", platform: "Instagram", url: "https://instagram.com/samrivera" },
  { id: "link-2", platform: "GitHub", url: "https://github.com/samrivera" },
];

const COUNTS: PreviewCounts = { connections: 9, eventsAttended: 4 };

const PHOTO: PreviewPhoto = { vCardType: "WEBP", base64: "UklGRg==" };

interface FakeWorld {
  limits?: CardPreviewLimits | (() => never);
  cards?: Record<string, CardRecord>;
  sessions?: Record<string, SessionRecord>;
  subjects?: Record<string, PreviewSubjectRow>;
  /** Return false to put the subject over budget. Called for every consume. */
  allowRateLimit?: (request: RateLimitRequest) => boolean;
  photoUrl?: string | null;
  socialLinks?: PreviewSocialLink[];
  counts?: PreviewCounts;
  photoBytes?: PreviewPhoto | null;
  recordViewThrows?: boolean;
  loadSubjectThrows?: boolean;
  /** The three enrichment reads, each independently breakable — they must degrade, not refuse. */
  socialLinksThrow?: boolean;
  countsThrow?: boolean;
  photoBytesThrow?: boolean;
  photoUrlThrows?: boolean;
}

interface Fake {
  deps: CardPreviewDeps;
  consumed: RateLimitRequest[];
  recorded: CardPreviewViewRecord[];
  /** Every `(userId, now)` the counts were asked for, so tests can assert they weren't. */
  countsAsked: { userId: string; now: Date }[];
  /** Every path the vCard byte reader was asked for. Empty on the preview surface. */
  photoBytesAsked: (string | null)[];
}

function fakeWorld(world: FakeWorld = {}): Fake {
  const consumed: RateLimitRequest[] = [];
  const recorded: CardPreviewViewRecord[] = [];
  const countsAsked: { userId: string; now: Date }[] = [];
  const photoBytesAsked: (string | null)[] = [];

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
    async listPreviewSocialLinks(): Promise<PreviewSocialLink[]> {
      if (world.socialLinksThrow) throw new Error("social links read failed");
      return world.socialLinks ?? SOCIAL_LINKS;
    },
    async loadPreviewCounts(userId: string, now: Date): Promise<PreviewCounts> {
      countsAsked.push({ userId, now });
      if (world.countsThrow) throw new Error("aggregate failed");
      return world.counts ?? COUNTS;
    },
    async signedPhotoUrl(photoPath: string | null): Promise<string | null> {
      if (world.photoUrlThrows) throw new Error("signing failed");
      if (photoPath === null) return null;
      return world.photoUrl === undefined ? "https://storage.example/signed" : world.photoUrl;
    },
    async loadPhotoBytes(photoPath: string | null): Promise<PreviewPhoto | null> {
      photoBytesAsked.push(photoPath);
      if (world.photoBytesThrow) throw new Error("download failed");
      if (photoPath === null) return null;
      return world.photoBytes === undefined ? PHOTO : world.photoBytes;
    },
    async recordView(view: CardPreviewViewRecord): Promise<void> {
      if (world.recordViewThrows) throw new Error("audit write failed");
      recorded.push(view);
    },
  };

  return {
    deps: { store, signingSecret: SIGNING_SECRET },
    consumed,
    recorded,
    countsAsked,
    photoBytesAsked,
  };
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

/** The complete disclosed key set, in one place, so a widening has to edit it. */
const DISCLOSED_KEYS = [
  "bio",
  "companyName",
  "companyRole",
  "counts",
  "email",
  "firstName",
  "lastName",
  "phoneNumber",
  "photo",
  "photoUrl",
  "socialLinks",
].sort();

describe("what a successful card preview discloses", () => {
  it("returns exactly the hardcoded field list and nothing else", async () => {
    const fake = fakeWorld(healthyWorld());
    const preview = await resolveCardCodePreview(GOOD_CODE, request(), fake.deps);

    // The key set is asserted, not just the values. This is the test that fails
    // if somebody widens the disclosure by spreading a row, and it is the
    // reason `discloseSubject` maps field by field from a literal.
    expect(preview).not.toBeNull();
    expect(Object.keys(preview as CardPreview).sort()).toEqual(DISCLOSED_KEYS);
  });

  it("never carries a username, an id, an admin flag, a status or a raw storage path", async () => {
    const fake = fakeWorld(healthyWorld());
    const preview = await resolveCardCodePreview(GOOD_CODE, request(), fake.deps);
    const serialised = JSON.stringify(preview);

    for (const forbidden of ["username", "is_admin", "status", "id", "photo_path"]) {
      expect(Object.keys(preview as CardPreview)).not.toContain(forbidden);
    }
    // The storage object key must be exchanged for a signed URL, never handed
    // over as-is: a raw path plus a public bucket would be an ungated copy of
    // gated data (§6.5).
    expect(serialised).not.toContain("avatar.jpg");
  });

  it("discloses social links as three fields each, never as rows", async () => {
    // 20260809211100's objection was to a *directory*, and its amendment
    // records why this is not one. What that amendment does not license is
    // handing over the rows themselves: `user_id` is an internal identifier and
    // the timestamps are a behavioural detail about when somebody edited their
    // profile, neither of which a link tile has ever rendered.
    const fake = fakeWorld(healthyWorld());
    const preview = await resolveCardCodePreview(GOOD_CODE, request(), fake.deps);

    expect(preview?.socialLinks).toHaveLength(2);
    for (const link of preview?.socialLinks ?? []) {
      expect(Object.keys(link).sort()).toEqual(["id", "platform", "url"]);
    }
    expect(JSON.stringify(preview?.socialLinks)).not.toContain(OWNER_ID);
  });

  it("discloses counts as two numbers, and asks for them against the request's own clock", async () => {
    const fake = fakeWorld(healthyWorld());
    const preview = await resolveCardCodePreview(GOOD_CODE, request(), fake.deps);

    expect(preview?.counts).toStrictEqual({ connections: 9, eventsAttended: 4 });
    expect(Object.keys(preview?.counts ?? {}).sort()).toEqual(["connections", "eventsAttended"]);
    // Every count is a number. Nothing in this object can be a name, an id or a
    // row, and this asserts the property rather than trusting the query.
    for (const value of Object.values(preview?.counts ?? {})) {
      expect(typeof value).toBe("number");
    }
    // The clock is the one injected for the whole request, not a fresh
    // `new Date()` inside the store — otherwise "events that have already
    // started" answers against a different instant from everything else.
    expect(fake.countsAsked).toEqual([{ userId: OWNER_ID, now: NOW }]);
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
    // Added 2026-08-15 with the links, counts and embedded photo. A refusal must
    // stay one refusal now that a success carries considerably more, and the
    // enrichment reads must not become a new way for one to differ from another.
    [
      "a revoked card whose owner also has links and counts to leak",
      healthyWorld({ cards: { [GOOD_CODE]: assignedCard({ status: "revoked" }) } }),
      GOOD_CODE,
    ],
    [
      "a suspended owner whose social links read would have succeeded",
      healthyWorld({ subjects: { [OWNER_ID]: activeOwner({ status: "suspended" }) } }),
      GOOD_CODE,
    ],
    [
      "an unknown code in a world where every enrichment read is broken",
      healthyWorld({ socialLinksThrow: true, countsThrow: true, photoBytesThrow: true }),
      UNKNOWN_CODE,
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

  it("an unknown code and a revoked card stay identical on the vCard surface too", async () => {
    // The download surface is the one that now carries image bytes, so it is
    // the one where a refusal has the most to accidentally differ by.
    const unknown = await resolveCardCodePreview(
      UNKNOWN_CODE,
      request("vcard"),
      fakeWorld(healthyWorld()).deps,
    );
    const revoked = await resolveCardCodePreview(
      GOOD_CODE,
      request("vcard"),
      fakeWorld(healthyWorld({ cards: { [GOOD_CODE]: assignedCard({ status: "revoked" }) } })).deps,
    );
    expect(unknown).toBeNull();
    expect(unknown).toStrictEqual(revoked);
  });

  it("a refusal is identical whether the subject is link-rich or has nothing at all", async () => {
    // The thing that would make this fail is an enrichment read moved above the
    // owner-status check: a page that took visibly longer, or errored
    // differently, for somebody with twelve links than for somebody with none.
    // Asserted as one distinct result across four differently-populated worlds.
    const worlds: FakeWorld[] = [
      healthyWorld({ subjects: { [OWNER_ID]: activeOwner({ status: "deleted" }) } }),
      healthyWorld({
        subjects: { [OWNER_ID]: activeOwner({ status: "deleted" }) },
        socialLinks: [],
        counts: { connections: 0, eventsAttended: 0 },
      }),
      healthyWorld({
        subjects: { [OWNER_ID]: activeOwner({ status: "deleted", photo_path: null }) },
      }),
      healthyWorld({
        subjects: { [OWNER_ID]: activeOwner({ status: "deleted" }) },
        socialLinksThrow: true,
        countsThrow: true,
      }),
    ];

    const results = await Promise.all(
      worlds.map((world) => resolveCardCodePreview(GOOD_CODE, request(), fakeWorld(world).deps)),
    );
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(results.every((r) => r === null)).toBe(true);
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

  it("refuses the session a soft delete burned, so a QR still on screen stops resolving", async () => {
    // `soft_delete_own_account()` flips every `active` session of the deleting
    // person to `revoked` in the same transaction as the card revocation, and
    // for the same reason: a code that was on screen at the moment they tapped
    // Delete would otherwise keep minting tokens that resolve to their phone
    // number for the rest of the session's life. This asserts the surface
    // honours that write — the `revoked` branch is shared with the
    // five-failure rule, and the point here is that the delete reaches it.
    const fake = fakeWorld(
      healthyWorld({
        sessions: { [SESSION_ID]: liveSession({ status: "revoked" }) },
        subjects: { [OWNER_ID]: activeOwner({ status: "deleted" }) },
      }),
    );

    await expect(resolveQrTokenPreview(goodToken, request(), fake.deps)).resolves.toBeNull();
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
      // The enrichment reads must not create a new distinguishable QR refusal
      // either, in any combination with the checks that were already here.
      [goodToken, healthyWorld({ sessions: {}, socialLinksThrow: true, countsThrow: true })],
      [
        goodToken,
        healthyWorld({
          subjects: { [OWNER_ID]: activeOwner({ status: "suspended" }) },
          socialLinks: [],
        }),
      ],
      [staleNonceToken, healthyWorld({ counts: { connections: 0, eventsAttended: 0 } })],
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
  it("the embedded photo is the ONLY field that differs between the two surfaces", async () => {
    // This used to be a flat `toStrictEqual`. It cannot be any more — the page
    // does not download the image bytes, because the browser is about to fetch
    // the same picture itself from `photoUrl`. So the property is asserted the
    // long way instead of weakened: every other field is compared, and the set
    // of differing keys is asserted to be exactly `{photo}`.
    const fake = fakeWorld(healthyWorld());
    const page = await resolveCardCodePreview(GOOD_CODE, request("preview"), fake.deps);
    const file = await resolveCardCodePreview(GOOD_CODE, request("vcard"), fake.deps);

    expect(page).not.toBeNull();
    expect(file).not.toBeNull();
    const differing = DISCLOSED_KEYS.filter(
      (key) =>
        JSON.stringify(page?.[key as keyof CardPreview]) !==
        JSON.stringify(file?.[key as keyof CardPreview]),
    );
    expect(differing).toEqual(["photo"]);
  });

  it("the page never downloads the photo bytes, and the file always tries to", async () => {
    const pageFake = fakeWorld(healthyWorld());
    const page = await resolveCardCodePreview(GOOD_CODE, request("preview"), pageFake.deps);
    expect(pageFake.photoBytesAsked).toEqual([]);
    expect(page?.photo).toBeNull();

    const fileFake = fakeWorld(healthyWorld());
    const file = await resolveCardCodePreview(GOOD_CODE, request("vcard"), fileFake.deps);
    expect(fileFake.photoBytesAsked).toEqual([`${OWNER_ID}/avatar.jpg`]);
    expect(file?.photo).toStrictEqual(PHOTO);
  });

  it("the file cannot contain a fact the page did not have", async () => {
    // The invariant `vcard.ts` states, checked from the data side: everything
    // the vCard builder reads must be present and equal on the page's own
    // object. The photo is the exception and is licensed by the test above —
    // it is the same image the page rendered, in a durable form.
    const fake = fakeWorld(healthyWorld());
    const page = await resolveCardCodePreview(GOOD_CODE, request("preview"), fake.deps);
    const file = await resolveCardCodePreview(GOOD_CODE, request("vcard"), fake.deps);

    for (const key of [
      "firstName",
      "lastName",
      "companyName",
      "companyRole",
      "bio",
      "phoneNumber",
      "email",
    ] as const) {
      expect(file?.[key]).toStrictEqual(page?.[key]);
    }
  });

  it("refuses identically when the server itself is misconfigured", async () => {
    // No injected deps, and no SUPABASE_URL / QR_SIGNING_SECRET in this
    // process: `defaultCardPreviewDeps()` throws while building the
    // service-role client. It is resolved inside the try for exactly this
    // reason — as a default parameter the throw would escape the catch and
    // produce a framework error page, which is a visibly different answer from
    // "nothing here" and therefore a signal.
    await expect(resolveCardCodePreview(GOOD_CODE, request())).resolves.toBeNull();
    await expect(resolveQrTokenPreview(await validToken(), request())).resolves.toBeNull();
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

// ---------------------------------------------------------------------------

/**
 * The other direction of failing closed, and the one that is easy to get
 * backwards.
 *
 * The gates above `discloseSubject` fail closed by REFUSING. The three
 * enrichment reads fail closed by DISCLOSING LESS, and they have to: a read
 * that turned into a refusal would make "Nothing here" depend on a fact about
 * the subject — whether their avatar downloads, whether an aggregate timed out
 * — which is exactly the distinguishable refusal the rest of this file exists
 * to prevent.
 */
describe("a failed enrichment read discloses less, never refuses and never lies", () => {
  const brokenWorlds: [name: string, world: FakeWorld][] = [
    ["the social-links read throwing", healthyWorld({ socialLinksThrow: true })],
    ["the aggregate queries throwing", healthyWorld({ countsThrow: true })],
    ["the photo download throwing", healthyWorld({ photoBytesThrow: true })],
    ["the photo signing throwing", healthyWorld({ photoUrlThrows: true })],
    ["every enrichment read failing at once", healthyWorld({
      socialLinksThrow: true,
      countsThrow: true,
      photoBytesThrow: true,
      photoUrlThrows: true,
    })],
  ];

  it.each(brokenWorlds)("still returns a preview when %s", async (_name, world) => {
    const fake = fakeWorld(world);
    const preview = await resolveCardCodePreview(GOOD_CODE, request("vcard"), fake.deps);

    expect(preview).not.toBeNull();
    // The identity fields are untouched by any of these failures — the preview
    // is degraded, not partial-and-wrong.
    expect(preview?.firstName).toBe("Sam");
    expect(preview?.email).toBe("sam@northwind.example");
    // And it is still logged as a disclosure, because it still was one.
    expect(fake.recorded).toHaveLength(1);
  });

  it("a failed links read looks exactly like having no links", async () => {
    const broken = await resolveCardCodePreview(
      GOOD_CODE,
      request(),
      fakeWorld(healthyWorld({ socialLinksThrow: true })).deps,
    );
    const genuinelyEmpty = await resolveCardCodePreview(
      GOOD_CODE,
      request(),
      fakeWorld(healthyWorld({ socialLinks: [] })).deps,
    );
    expect(broken?.socialLinks).toEqual([]);
    expect(broken).toStrictEqual(genuinelyEmpty);
  });

  it("a failed aggregate omits the diagram rather than reporting zero", async () => {
    // A ring diagram of zeroes is a claim about somebody's life, and it is one
    // the app has no basis for. §7: never imply more than is known.
    const fake = fakeWorld(healthyWorld({ countsThrow: true }));
    const preview = await resolveCardCodePreview(GOOD_CODE, request(), fake.deps);
    expect(preview?.counts).toBeNull();

    const genuineZero = await resolveCardCodePreview(
      GOOD_CODE,
      request(),
      fakeWorld(healthyWorld({ counts: { connections: 0, eventsAttended: 0 } })).deps,
    );
    expect(genuineZero?.counts).toStrictEqual({ connections: 0, eventsAttended: 0 });
  });

  it("a failed photo download still produces a preview whose page photo works", async () => {
    // The two photo paths are independent: the download can fail while the
    // signed URL is fine, and the visitor should still see the picture.
    const fake = fakeWorld(healthyWorld({ photoBytesThrow: true }));
    const preview = await resolveCardCodePreview(GOOD_CODE, request("vcard"), fake.deps);
    expect(preview?.photo).toBeNull();
    expect(preview?.photoUrl).toBe("https://storage.example/signed");
  });

  it("a subject with no photo is asked for no bytes and gets none", async () => {
    const fake = fakeWorld(
      healthyWorld({ subjects: { [OWNER_ID]: activeOwner({ photo_path: null }) } }),
    );
    const preview = await resolveCardCodePreview(GOOD_CODE, request("vcard"), fake.deps);
    expect(preview?.photo).toBeNull();
    expect(preview?.photoUrl).toBeNull();
  });

  /**
   * ADDED 2026-08-15 WITH SELF-SERVE ACCOUNT DELETION.
   *
   * The cases above already cover "a revoked card" and "an owner who has been
   * soft-deleted" as separate refusals. What they do not cover is the state a
   * real deletion actually produces, which is BOTH AT ONCE plus a burned
   * session — and the property worth asserting is not that each half refuses
   * (that is already tested) but that the combination is still the same single
   * refusal, on every surface, with nothing logged.
   *
   * These are extensions of the equivalence set rather than new tests of the
   * same branches: each one is written as the post-deletion world and compared
   * against the canonical "unknown code" answer.
   */
  it("refuses the exact state a soft delete leaves behind, identically", async () => {
    // `soft_delete_own_account()` sets the owner to `deleted` AND flips every
    // assigned card to `revoked`, in one transaction. Two independent locks on
    // this surface, and the test asserts the pair produces the ordinary refusal
    // rather than some third behaviour neither branch was tested for.
    const afterDeletion = healthyWorld({
      cards: { [GOOD_CODE]: assignedCard({ status: "revoked" }) },
      subjects: { [OWNER_ID]: activeOwner({ status: "deleted" }) },
    });

    const deleted = await resolveCardCodePreview(GOOD_CODE, request(), fakeWorld(afterDeletion).deps);
    const unknown = await resolveCardCodePreview(
      UNKNOWN_CODE,
      request(),
      fakeWorld(healthyWorld()).deps,
    );

    expect(deleted).toBeNull();
    expect(deleted).toStrictEqual(unknown);
  });

  it("refuses a deleted owner even if the card revocation somehow did not happen", () => {
    // The belt-and-braces claim stated as a test. The transaction makes a
    // half-applied delete impossible, but this surface must not DEPEND on that:
    // the owner-status check in `discloseSubject` is what refuses here, and it
    // is reached whatever state the card is in.
    return expect(
      resolveCardCodePreview(
        GOOD_CODE,
        request(),
        fakeWorld(
          healthyWorld({ subjects: { [OWNER_ID]: activeOwner({ status: "deleted" }) } }),
        ).deps,
      ),
    ).resolves.toBeNull();
  });

  it("refuses a deleted owner on the vCard surface too, and writes no audit row", async () => {
    // The download is the surface that outlives the page — a `.vcf` saved into
    // somebody's contacts is the disclosure that cannot be taken back — so it
    // gets its own assertion rather than being assumed to follow the page.
    const fake = fakeWorld(
      healthyWorld({
        cards: { [GOOD_CODE]: assignedCard({ status: "revoked" }) },
        subjects: { [OWNER_ID]: activeOwner({ status: "deleted" }) },
      }),
    );

    await expect(resolveCardCodePreview(GOOD_CODE, request("vcard"), fake.deps)).resolves.toBeNull();
    expect(fake.recorded).toEqual([]);
    expect(fake.photoBytesAsked).toEqual([]);
  });

  it("never reads links, counts or photo bytes for a subject it is about to refuse", async () => {
    // The enrichment reads sit after the owner-status check and after the audit
    // row, so a suspended owner's links are never touched at all.
    const fake = fakeWorld(
      healthyWorld({ subjects: { [OWNER_ID]: activeOwner({ status: "suspended" }) } }),
    );
    await resolveCardCodePreview(GOOD_CODE, request("vcard"), fake.deps);
    expect(fake.countsAsked).toEqual([]);
    expect(fake.photoBytesAsked).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

/**
 * The 2026-08-21 reversal: `unassigned` is the ONE refusal the landing page now
 * tells apart from the others, so that somebody handed a blank card has a way
 * in. Everything in this block exists to pin down how far that split goes,
 * because the failure worth catching is not "blank cards don't work" — it is
 * "something else started answering `blank` too".
 *
 * `resolveCardCodePreview` is asserted alongside it on purpose. It feeds the
 * vCard route, which must be completely unaffected: there is no contact file to
 * download for a card nobody owns, and a route that started returning one would
 * be disclosing an empty profile rather than refusing.
 */
describe("a blank card is distinguishable, and nothing else is", () => {
  const blankWorld = () =>
    healthyWorld({
      cards: { [GOOD_CODE]: assignedCard({ status: "unassigned", ownerUserId: null }) },
    });

  it("answers `blank` for unassigned stock", async () => {
    const fake = fakeWorld(blankWorld());
    await expect(resolveCardCodeLanding(GOOD_CODE, request(), fake.deps)).resolves.toEqual({
      kind: "blank",
    });
  });

  /**
   * The containment that matters most in this file.
   *
   * `revoked` is the owner's kill switch for a card they lost (§4.5). If it
   * ever fell through to the unassigned branch, the finder of somebody's lost
   * card would be offered the chance to take it over — the precise inversion of
   * what the kill switch is for. The ordering in `resolveCardCodeLanding` is
   * what prevents it, and ordering is exactly the kind of thing a later edit
   * rearranges without noticing.
   */
  it("does NOT answer `blank` for a card the owner revoked", async () => {
    const fake = fakeWorld(
      healthyWorld({ cards: { [GOOD_CODE]: assignedCard({ status: "revoked" }) } }),
    );
    await expect(resolveCardCodeLanding(GOOD_CODE, request(), fake.deps)).resolves.toEqual({
      kind: "nothing",
    });
  });

  it("keeps every other refusal fused into `nothing`", async () => {
    const cases: [name: string, world: FakeWorld, code: string][] = [
      ["a malformed code", healthyWorld(), "not-a-card-code"],
      ["a code matching no card", healthyWorld(), UNKNOWN_CODE],
      [
        "an assigned card with no owner",
        healthyWorld({ cards: { [GOOD_CODE]: assignedCard({ ownerUserId: null }) } }),
        GOOD_CODE,
      ],
      [
        "a suspended owner",
        healthyWorld({ subjects: { [OWNER_ID]: activeOwner({ status: "suspended" }) } }),
        GOOD_CODE,
      ],
      [
        "a deleted owner",
        healthyWorld({ subjects: { [OWNER_ID]: activeOwner({ status: "deleted" }) } }),
        GOOD_CODE,
      ],
      ["a vanished owner row", healthyWorld({ subjects: {} }), GOOD_CODE],
    ];

    const results = await Promise.all(
      cases.map(([, world, code]) => resolveCardCodeLanding(code, request(), fakeWorld(world).deps)),
    );

    expect(results.every((r) => r.kind === "nothing")).toBe(true);
  });

  /**
   * A failure must never be reported as a claimable card. Inviting somebody to
   * claim a card because the database was briefly unreachable would have them
   * act on a state nobody confirmed.
   */
  it("answers `nothing`, never `blank`, when the store throws", async () => {
    const fake = fakeWorld({ ...blankWorld(), limits: () => { throw new Error("boom"); } });
    await expect(resolveCardCodeLanding(GOOD_CODE, request(), fake.deps)).resolves.toEqual({
      kind: "nothing",
    });
  });

  it("answers `nothing`, never `blank`, when a budget is exhausted", async () => {
    const perIp = fakeWorld({ ...blankWorld(), allowRateLimit: (r) => r.subjectKind !== "ip" });
    await expect(resolveCardCodeLanding(GOOD_CODE, request(), perIp.deps)).resolves.toEqual({
      kind: "nothing",
    });

    const perCard = fakeWorld({ ...blankWorld(), allowRateLimit: (r) => r.subjectKind !== "card" });
    await expect(resolveCardCodeLanding(GOOD_CODE, request(), perCard.deps)).resolves.toEqual({
      kind: "nothing",
    });
  });

  /**
   * Both budgets are spent before a blank answer is given, so sorting a list of
   * codes into claimable and not is capped at the same rate as previewing.
   */
  it("spends both budgets before answering `blank`", async () => {
    const fake = fakeWorld(blankWorld());
    await resolveCardCodeLanding(GOOD_CODE, request(), fake.deps);

    expect(fake.consumed.map((r) => r.subjectKind)).toEqual(["ip", "card"]);
  });

  it("records no disclosure for a blank card, because nothing was disclosed", async () => {
    const fake = fakeWorld(blankWorld());
    await resolveCardCodeLanding(GOOD_CODE, request(), fake.deps);

    expect(fake.recorded).toHaveLength(0);
  });

  it("leaves the vCard path refusing an unassigned card exactly as before", async () => {
    const fake = fakeWorld(blankWorld());
    await expect(
      resolveCardCodePreview(GOOD_CODE, request("vcard"), fake.deps),
    ).resolves.toBeNull();
  });

  it("still returns the preview for a healthy assigned card", async () => {
    const fake = fakeWorld(healthyWorld());
    const landing = await resolveCardCodeLanding(GOOD_CODE, request(), fake.deps);

    expect(landing.kind).toBe("preview");
  });
});
