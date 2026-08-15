import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HOUR_SECONDS,
  RATE_LIMIT_ACTIONS,
  isTokenExpired,
  verifyQrToken,
  type CardRecord,
  type RateLimitRequest,
  type SessionRecord,
} from "@smartcard/core";
import { cardCodeSchema, type AppConfigKey } from "@smartcard/types";

import { clientIpFrom, hashIpAddress } from "@/server/connect/request-context";
import { supabaseConnectStore } from "@/server/connect/supabase-connect-store";
import { qrSigningSecret } from "@/server/env";
import { serviceRoleClient } from "@/server/supabase/service-role-client";

/**
 * The non-user card preview: the one place in this product where contact
 * details are shown to somebody who is not signed in.
 *
 * ============================================================================
 * WHY THIS FILE HOLDS THE SERVICE-ROLE CLIENT, AND WHAT THAT MAKES IT
 * RESPONSIBLE FOR
 * ============================================================================
 *
 * Read `service-role-client.ts` first. Its header says the service role "is not
 * an admin login — it is the absence of the second lock", and that "adding a
 * second caller is a decision, not a convenience. If a feature seems to need
 * this client, first check whether it actually needs a policy."
 *
 * That check was made, and the answer is that a policy is impossible here. Every
 * policy in this schema is written as a relationship between the reader and the
 * row — `id = current_user_id()`, `are_connected(...)`, `shares_event_with(...)`
 * — and evaluated against `auth.uid()`. The reader in this feature has no
 * account, no `users` row, and no JWT, so there is no `auth.uid()` for a policy
 * to name. The only policy that could serve this page is one whose USING clause
 * is effectively `true` for `anon`, on `users`, the table 20260809211100 calls
 * "the most important policy file in the project" precisely because it has no
 * branch that is true for an arbitrary reader. Adding that branch would open
 * the whole table to every unauthenticated caller in the world and leave the
 * narrowing to whatever `select()` list the application happened to send —
 * which is exactly backwards.
 *
 * So this is the decision, made explicitly. It is the sixth importer of the
 * service-role client, after `ensureUser()`, the ConnectStore, the geocoding
 * job, the push sender and the connect service, and the allowlist in
 * `no-second-write-path.test.ts` was updated by hand to say so.
 *
 * WHAT THE TYPESCRIPT IN THIS FILE IS NOW SOLELY RESPONSIBLE FOR. Everywhere
 * else in this app, a bug that queries the wrong row returns nothing, because
 * RLS refuses it. On this path there is no second lock, so this file — and only
 * this file — is what stands between a visitor with no account and the `users`
 * table. Concretely, it alone enforces:
 *
 *   1. That the ONLY inputs are a card code or a QR token. Neither function
 *      here takes a user id, a column name, a filter, an ordering, or a limit.
 *      There is no argument a caller could supply that changes which row is
 *      read or which columns come back, because the row is resolved from the
 *      credential and the columns are a literal in this file.
 *   2. That the disclosed field list is FIXED (`PREVIEW_COLUMNS` below), and
 *      that no raw database row ever leaves this module. Every read is mapped
 *      field by field into `CardPreview`. A column added to `users` tomorrow —
 *      a home address, an admin note, an internal flag — does not appear here,
 *      because appearing would require somebody editing this constant.
 *   3. That `social_links` is NEVER read. Not filtered, not truncated —
 *      untouched. 20260809211100 gives the reason and it is not a style
 *      preference: anything looser than the profile's own gate "would be a
 *      searchable directory of people's off-platform handles bolted onto a
 *      product whose premise is that strangers cannot find you."
 *   4. That every refusal is the SAME refusal. See the next section.
 *
 * ============================================================================
 * ONE REFUSAL, INDISTINGUISHABLE FROM EVERY OTHER
 * ============================================================================
 *
 * Both entry points return `CardPreview | null`, and `null` is returned — with
 * no reason, no code, no variant — for every one of:
 *
 *   * a card code that is the wrong shape
 *   * a card code that matches no card
 *   * a card that exists but is `unassigned` (stock nobody owns)
 *   * a card that exists and is `revoked` (the owner's kill switch)
 *   * a card whose owner is `suspended` or `deleted`
 *   * a QR token with a bad signature, a malformed payload, or a passed `exp`
 *   * a QR token naming a session that does not exist, is not `qr_gps`, is not
 *     `active`, has passed its own `expires_at`, or whose nonce is two
 *     rotations stale
 *   * either budget being exhausted
 *   * a missing or malformed `app_config` row
 *   * any exception at all, from anywhere below
 *
 * The routes render one shared component for `null`, so the rendered bytes are
 * identical too. This is `nfc-verifier.ts`'s rule applied one layer out: it
 * refuses `card_not_found`, `card_unassigned` and `card_revoked` with the same
 * words because "telling a tapper 'this card was revoked' confirms they are
 * holding somebody's lost property and are being watched, which helps them and
 * not the owner". The same argument holds harder here, because this caller is
 * anonymous and unlimited in a way a signed-in tapper is not: any distinction
 * between refusals turns this route into an oracle for which of the 7,142
 * printed codes are real and which of those are live.
 *
 * FAIL CLOSED ON EVERY BRANCH. There is no branch below that continues on a
 * partial answer. A rate limiter that errors throws, and a throw becomes
 * `null`. A missing config row throws, and that becomes `null`. Nothing here
 * has a default, because CLAUDE.md's rule for this path is that a check which
 * cannot be completed rejects.
 *
 * ============================================================================
 * WHAT THIS FEATURE IS NOT
 * ============================================================================
 *
 * It creates no connection and offers no way to create one. It is not §2.8's
 * `pending_connections` flow and does not touch that table — in fact it points
 * the opposite way: §2.8 captures the NON-USER's details inbound, this shows
 * the CARDHOLDER's details outbound. The non-negotiable product rule is
 * untouched: there is still no search, no directory, and no "connect" action
 * anywhere on these pages. A visitor's only affordances are "save this contact"
 * and "sign in".
 */

// ---------------------------------------------------------------------------
// What a visitor may be shown
// ---------------------------------------------------------------------------

/**
 * The disclosed field list, as a literal. Adding to it is the whole of the
 * decision to disclose more, and it happens here or not at all.
 *
 * `photo_path` is in the SELECT but is NOT disclosed as-is: it is an object key
 * inside a private bucket and is exchanged for a short-lived signed URL before
 * it leaves this module (see `signedPhotoUrl`).
 *
 * `status` is in the SELECT purely so this module can refuse a suspended or
 * deleted owner. It is never returned.
 */
const PREVIEW_COLUMNS =
  "id, first_name, last_name, company_name, company_role, bio, phone_number, email, photo_path, status";

/**
 * Exactly what a non-user sees. Seven disclosed fields plus a photo URL.
 *
 * Deliberately NOT `Pick<UserRow, …>`: a `Pick` follows `users` as it grows,
 * and this type must not. It is spelled out so that widening it is a visible
 * edit to a type a reviewer reads, not a consequence of a migration somewhere
 * else.
 */
export interface CardPreview {
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  companyRole: string | null;
  bio: string | null;
  phoneNumber: string | null;
  email: string;
  /** A signed, short-lived URL, or null. Never a storage path. */
  photoUrl: string | null;
}

/** The row shape this module reads. Internal — never returned to a caller. */
export interface PreviewSubjectRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  company_role: string | null;
  bio: string | null;
  phone_number: string | null;
  email: string;
  photo_path: string | null;
  status: string;
}

/** Which of the two entry points, and what was handed over. Mirrors the CHECK constraints. */
export type PreviewSource = "card_code" | "qr_token";
export type PreviewSurface = "preview" | "vcard";

export interface CardPreviewViewRecord {
  source: PreviewSource;
  surface: PreviewSurface;
  subjectUserId: string;
  cardId: string | null;
  sessionId: string | null;
  ipHash: string | null;
  userAgent: string | null;
}

/** The two `app_config` rows seeded by 20260815120000. */
export interface CardPreviewLimits {
  perIpHour: number;
  perCardHour: number;
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * Everything this module needs from the outside world, as one interface.
 *
 * Same reasoning as `ConnectStore` (`packages/core/src/connect/ports.ts`): the
 * decisions in this file are the security property, and they only get tested if
 * hostile world-states are cheap to construct. "A revoked card", "a suspended
 * owner", "a session consumed a millisecond ago", "the rate limiter is over
 * budget" are three lines each against a fake and a fixture each against a real
 * database — and the assertion that matters, that all of them produce the
 * *identical* answer, is only worth writing if all of them are easy to reach.
 *
 * Every method is a question or a command. None of them decides anything.
 */
export interface CardPreviewStore {
  /** Reads the two thresholds. THROWS if either row is missing or unusable — never defaults. */
  loadLimits(): Promise<CardPreviewLimits>;
  /** Records the event and reports whether the subject is still inside its budget. */
  consumeRateLimit(request: RateLimitRequest): Promise<boolean>;
  findCardByCode(cardCode: string): Promise<CardRecord | null>;
  loadSession(sessionId: string): Promise<SessionRecord | null>;
  /** The `users` read, restricted to `PREVIEW_COLUMNS`. Returns the row as stored; status is judged by the caller. */
  loadPreviewSubject(userId: string): Promise<PreviewSubjectRow | null>;
  signedPhotoUrl(photoPath: string | null): Promise<string | null>;
  recordView(view: CardPreviewViewRecord): Promise<void>;
}

export interface CardPreviewDeps {
  store: CardPreviewStore;
  /** `QR_SIGNING_SECRET`. Verifying with the wrong key refuses everything, which is the safe direction. */
  signingSecret: string;
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export interface CardPreviewRequest {
  /** Used only for the hashed IP and the bounded user agent. Nothing in it selects a row. */
  headers: Headers;
  /** Which disclosure this is: the rendered page, or the downloaded contact file. */
  surface: PreviewSurface;
  /** Injected once per request so every time-dependent check answers against the same instant. */
  now?: Date;
}

/**
 * `/card/<code>`, signed out. Resolves the tapped card's owner, or refuses.
 *
 * ORDER, AND WHY IT IS THIS ORDER
 *   1. Per-IP budget, BEFORE anything touches a card. This mirrors
 *      `nfc-verifier.ts`'s reasoning exactly: unlike the QR path there is no
 *      cheap cryptographic gate that can stand in front of the database,
 *      because on this path the card code IS the credential and the first real
 *      step is a lookup. So the budget that does not need the card is spent
 *      first, and enforced immediately — an anonymous flood is precisely what
 *      it exists to stop, and running the rest of the pipeline first would
 *      defeat it.
 *   2. Shape filter. A malformed code is refused before it reaches a lookup.
 *      `cardCodeSchema`'s own comment is careful that this "is a cheap shape
 *      filter, not a security control"; its value here is only that garbage
 *      does not become a database round trip.
 *   3. Resolve the card.
 *   4. Per-card budget, which cannot be evaluated any earlier. Consumed even
 *      when the card then fails a check below, so that hammering a revoked card
 *      is not free — the same property `nfc-verifier.ts` states for redeems.
 *   5. Card status, then owner status.
 *
 * Steps 3 through 5 all refuse identically, so the order between them is an
 * audit-and-clarity choice rather than a security one.
 */
export async function resolveCardCodePreview(
  code: string,
  request: CardPreviewRequest,
  deps: CardPreviewDeps = defaultCardPreviewDeps(),
): Promise<CardPreview | null> {
  return refuseOnThrow("card_code", async () => {
    const { store } = deps;
    const audit = auditFieldsFrom(request.headers);
    const limits = await store.loadLimits();

    if (!(await withinIpBudget(store, limits, audit.ipHash))) return null;

    const parsedCode = cardCodeSchema.safeParse(code);
    if (!parsedCode.success) return null;

    const card = await store.findCardByCode(parsedCode.data);
    if (card === null) return null;

    const withinCardBudget = await store.consumeRateLimit({
      action: RATE_LIMIT_ACTIONS.cardPreview,
      subjectKind: "card",
      subjectKey: card.id,
      limit: limits.perCardHour,
      windowSeconds: HOUR_SECONDS,
    });
    if (!withinCardBudget) return null;

    // `revoked` before `assigned`, matching `nfc-verifier.ts`. The two produce
    // the same answer to the visitor; checking in this order means the more
    // specific fact is the one a reader of this code sees named.
    if (card.status === "revoked") return null;
    if (card.status !== "assigned" || card.ownerUserId === null) return null;

    return discloseSubject(deps, {
      subjectUserId: card.ownerUserId,
      source: "card_code",
      surface: request.surface,
      cardId: card.id,
      sessionId: null,
      audit,
    });
  });
}

/**
 * `/c/<token>` — the URL a presenter's QR code actually encodes
 * (`connect/lib/qr-url.ts`), which until now resolved to nothing at all because
 * no route existed for it. A phone camera pointed at a SmartCard QR got a 404.
 *
 * THE VALIDATION ORDER IS §4.2 STEP 5's, TRUNCATED AT THE POINT WHERE IT STOPS
 * BEING ABOUT THIS FEATURE. Steps 1 to 5 run here, in that order, unchanged:
 *
 *   1. HMAC signature — never interpret unverified data
 *   2. `exp` not passed
 *   3. session exists, is `qr_gps`, and is `active`
 *   4. session `expires_at` not passed
 *   5. nonce matches `current_nonce` or `previous_nonce`
 *
 * Steps 6 to 9 (self-connect, graph position, the GPS gate, per-user limits)
 * are absent because every one of them is a question about a scanner, and there
 * is no scanner here — nobody is connecting to anybody. Their absence is the
 * feature, not an omission: this page shows a preview and cannot create an
 * edge.
 *
 * WHY STEP 5 IS HERE AT ALL, WHEN NOTHING IS BEING REDEEMED. A preview does not
 * strictly need a current nonce; the signature and the live session already
 * prove the token came from us and that the presenter is still displaying. The
 * nonce check is kept because dropping it would quietly re-open half of §4.7
 * threat 1 on this new surface: a photograph of somebody's QR would keep
 * resolving to their phone number and email for the whole life of the session,
 * long after the code on screen had rotated away from it. Rotation exists so a
 * screenshot goes stale in seconds, and it should go stale for every reader of
 * the token, not only for the one trying to connect.
 *
 * The per-IP budget is spent first, for the same reason as on the card path.
 * There is no per-card budget here — there is no card — and no per-session one:
 * a token cannot be guessed, so the only person who can reach this page is
 * somebody who was pointed at a live code, and the session's own 45-second
 * token TTL and rotation bound the window far more tightly than an hourly
 * counter could.
 */
export async function resolveQrTokenPreview(
  token: string,
  request: CardPreviewRequest,
  deps: CardPreviewDeps = defaultCardPreviewDeps(),
): Promise<CardPreview | null> {
  return refuseOnThrow("qr_token", async () => {
    const { store, signingSecret } = deps;
    const audit = auditFieldsFrom(request.headers);
    const now = request.now ?? new Date();
    const limits = await store.loadLimits();

    if (!(await withinIpBudget(store, limits, audit.ipHash))) return null;

    // (1) Signature. `verifyQrToken` bounds the input, computes the MAC over
    // the received characters, and only then decodes — see its header for why
    // that order is not negotiable. Nothing below interprets a byte of an
    // unverified token.
    const verified = await verifyQrToken(signingSecret, token);
    if (!verified.ok) return null;
    const payload = verified.payload;

    // (2) Token expiry.
    if (isTokenExpired(payload, now)) return null;

    // (3) Session exists, is the right method, and is live. A consumed or
    // burned session lands here, which is how "consuming the session kills
    // every outstanding token" reaches this surface too.
    const session = await store.loadSession(payload.sid);
    if (session === null || session.method !== "qr_gps" || session.status !== "active") return null;

    // (4) Session lifetime.
    if (session.expiresAt.getTime() <= now.getTime()) return null;

    // (5) Nonce, with the same one-rotation grace window the redeem path allows
    // for a request that was already in flight when the code changed.
    const nonceMatches =
      (session.currentNonce !== null && session.currentNonce === payload.nonce) ||
      (session.previousNonce !== null && session.previousNonce === payload.nonce);
    if (!nonceMatches) return null;

    return discloseSubject(deps, {
      subjectUserId: session.presenterUserId,
      source: "qr_token",
      surface: request.surface,
      cardId: null,
      sessionId: session.id,
      audit,
    });
  });
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

interface AuditFields {
  ipHash: string | null;
  userAgent: string | null;
}

/**
 * The hashed IP and bounded user agent, derived the same way every connect
 * request derives them (`request-context.ts`) and with the same salt.
 *
 * Reused rather than reimplemented on purpose: a second hashing scheme would
 * mean the same visitor counted under two different subject keys, which is a
 * rate limit that silently does not apply.
 */
function auditFieldsFrom(headers: Headers): AuditFields {
  const ip = clientIpFrom(headers);
  return {
    ipHash: ip === null ? null : hashIpAddress(ip),
    userAgent: headers.get("user-agent")?.slice(0, 512) ?? null,
  };
}

/**
 * A caller with no usable IP header is charged to the literal subject
 * `"unknown"` rather than skipping the limit — §4.6's rule, and it matters more
 * here than anywhere else it is applied. On the connect endpoints, skipping
 * would only bypass the one limit not tied to an account; on this path there is
 * no account, so "send no `x-forwarded-for`" would bypass the only per-caller
 * limit that exists at all.
 */
async function withinIpBudget(
  store: CardPreviewStore,
  limits: CardPreviewLimits,
  ipHash: string | null,
): Promise<boolean> {
  return store.consumeRateLimit({
    action: RATE_LIMIT_ACTIONS.cardPreview,
    subjectKind: "ip",
    subjectKey: ipHash ?? "unknown",
    limit: limits.perIpHour,
    windowSeconds: HOUR_SECONDS,
  });
}

/**
 * The last gate and the only disclosure, shared by both entry points so there
 * is exactly one place that decides what leaves this module.
 *
 * The owner's account status is checked HERE rather than in each caller, so
 * neither path can forget it. `users.status` is `active | suspended | deleted`
 * (20260809210100), and a soft-deleted person's phone number must not still be
 * answering a permanent URL — a soft delete that leaves a live disclosure
 * endpoint pointing at you is not a delete.
 *
 * The audit row is written BEFORE the preview is returned, and a failure to
 * write it refuses the disclosure rather than proceeding without it. That is
 * the opposite of `logAttempt`'s posture in the ConnectStore, which deliberately
 * swallows its own failure because "a rejection that cannot be logged must
 * still be a rejection". The asymmetry is intentional: there, refusing to log
 * would convert a refusal into a 500; here, the thing that cannot be logged is
 * a DISCLOSURE, and §4.7 threat 7's defence on this path is detection. An
 * unlogged disclosure is the one outcome this feature must not produce, so it
 * fails closed like everything else.
 */
async function discloseSubject(
  deps: CardPreviewDeps,
  input: {
    subjectUserId: string;
    source: PreviewSource;
    surface: PreviewSurface;
    cardId: string | null;
    sessionId: string | null;
    audit: AuditFields;
  },
): Promise<CardPreview | null> {
  const subject = await deps.store.loadPreviewSubject(input.subjectUserId);
  if (subject === null) return null;
  if (subject.status !== "active") return null;

  await deps.store.recordView({
    source: input.source,
    surface: input.surface,
    subjectUserId: subject.id,
    cardId: input.cardId,
    sessionId: input.sessionId,
    ipHash: input.audit.ipHash,
    userAgent: input.audit.userAgent,
  });

  // Field by field, from a literal. No spread, no rest, no `...row`: a spread
  // here is how a column added to `users` next year ends up on an anonymous
  // page without anybody deciding that it should.
  return {
    firstName: subject.first_name,
    lastName: subject.last_name,
    companyName: subject.company_name,
    companyRole: subject.company_role,
    bio: subject.bio,
    phoneNumber: subject.phone_number,
    email: subject.email,
    photoUrl: await deps.store.signedPhotoUrl(subject.photo_path),
  };
}

/**
 * The catch-all that makes "any thrown error" one of the identical refusals.
 *
 * Every failure the store can raise arrives here: the rate limiter erroring
 * (which throws rather than answering "yes" — see `consumeRateLimit`), a
 * missing `app_config` row, a dropped connection, a bug. All of them become
 * `null`, and the detail goes to the server log where it is a monitoring
 * problem rather than something an anonymous visitor learns from the shape of
 * a response.
 */
async function refuseOnThrow(
  source: PreviewSource,
  work: () => Promise<CardPreview | null>,
): Promise<CardPreview | null> {
  try {
    return await work();
  } catch (error) {
    console.error("[card-preview] refusing after an unexpected failure", {
      source,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Production wiring
// ---------------------------------------------------------------------------

/**
 * Seconds. Five minutes, not the hour `photo-url.ts` mints for signed-in
 * viewers.
 *
 * A signed URL is a bearer credential: whoever holds it can fetch the object
 * until it expires, with no further check. An hour is right for a signed-in
 * session that navigates around the app and expects images to keep working.
 * This page renders once, for somebody with no session, and the URL is in the
 * HTML of a page that may well be screenshotted or forwarded — so it should
 * outlive the render by as little as possible.
 */
const PREVIEW_PHOTO_URL_TTL_SECONDS = 5 * 60;

/**
 * Typed as `AppConfigKey` so a typo here is a compile error rather than a
 * lookup that quietly finds nothing — which, but for
 * `requirePositiveIntegerConfig` below, is how a rate limit becomes a limit
 * that does not exist.
 */
const PREVIEW_LIMIT_KEYS: Record<"perIpHour" | "perCardHour", AppConfigKey> = {
  perIpHour: "rate_limit_card_preview_per_ip_hour",
  perCardHour: "rate_limit_card_preview_per_card_hour",
};

/**
 * The production store.
 *
 * WHY THESE THRESHOLDS ARE NOT IN `CONNECT_CONFIG_KEYS`, WHICH IS WHERE EVERY
 * OTHER THRESHOLD IN THIS PRODUCT LIVES. `parseVerificationConfig` treats its
 * key list as closed and refuses the WHOLE connect flow if any single row is
 * missing — its header is explicit that this is deliberate, including for the
 * two event-tagging keys that are not security thresholds: "delete either row
 * and the whole connect flow refuses". That trade is right for keys the connect
 * flow reads. It is wrong for these two: a missing preview row would stop
 * people connecting in person, which is the product, over a courtesy page for
 * strangers. So the preview reads its own two rows and refuses only itself.
 *
 * The rule that is NOT relaxed is the one that matters. There is no default
 * anywhere below. A missing row, a null, a string, a zero, a negative — all
 * throw, and the throw becomes the same "nothing here" as everything else. The
 * reasoning is `config.ts`'s, verbatim in effect: a default here would be a
 * security threshold chosen by whoever last edited a TypeScript file, silently
 * overriding the row an operator thought they were tuning.
 */
export function supabaseCardPreviewStore(
  client: SupabaseClient = serviceRoleClient(),
): CardPreviewStore {
  // The connect store already owns `findCardByCode`, `loadSession` and
  // `consumeRateLimit` against this exact client. Re-implementing them here
  // would be a second copy of "how do we resolve a card code", which is the
  // kind of duplication that ends with two answers to the same question.
  const connect = supabaseConnectStore(client);

  return {
    async loadLimits(): Promise<CardPreviewLimits> {
      const keys = [PREVIEW_LIMIT_KEYS.perIpHour, PREVIEW_LIMIT_KEYS.perCardHour];
      const { data, error } = await client
        .from("app_config")
        .select("key, value")
        .in("key", keys);

      if (error) {
        throw new Error(`Failed to read card-preview limits: ${error.message}`, { cause: error });
      }

      const byKey = new Map((data ?? []).map((row) => [row.key as string, row.value as unknown]));
      return {
        perIpHour: requirePositiveIntegerConfig(byKey, PREVIEW_LIMIT_KEYS.perIpHour),
        perCardHour: requirePositiveIntegerConfig(byKey, PREVIEW_LIMIT_KEYS.perCardHour),
      };
    },

    consumeRateLimit(request: RateLimitRequest): Promise<boolean> {
      return connect.consumeRateLimit(request);
    },

    findCardByCode(cardCode: string): Promise<CardRecord | null> {
      return connect.findCardByCode(cardCode);
    },

    loadSession(sessionId: string): Promise<SessionRecord | null> {
      return connect.loadSession(sessionId);
    },

    async loadPreviewSubject(userId: string): Promise<PreviewSubjectRow | null> {
      // `.eq("id", …)` on a server-derived uuid, with a literal column list.
      // No `.or()`, no `.ilike()`, no caller-supplied filter — the source scan
      // in `no-second-write-path.test.ts` asserts the absence of the search
      // shapes, and this is the query it is asserting about.
      const { data, error } = await client
        .from("users")
        .select(PREVIEW_COLUMNS)
        .eq("id", userId)
        .maybeSingle<PreviewSubjectRow>();

      if (error) {
        throw new Error(`Failed to read preview subject: ${error.message}`, { cause: error });
      }
      return data;
    },

    async signedPhotoUrl(photoPath: string | null): Promise<string | null> {
      if (!photoPath) return null;

      // DELIBERATE DEVIATION FROM `photo-url.ts`, RECORDED HERE BECAUSE THAT
      // FILE FORBIDS IT IN TERMS. Its header says minting must go through the
      // caller's own RLS-bound client, because Storage enforces RLS at signing
      // time, and that "using the service role here would silently reopen the
      // exact gate this function exists to keep shut".
      //
      // That gate cannot be used on this path: there is no caller client to
      // bind to, because there is no caller identity. The alternatives were to
      // widen the `profile-photos` storage policy to `anon` — which would let
      // anyone who obtained or guessed ANY path fetch the bytes for every user
      // in the product, a blast radius far beyond this feature — or to mint
      // here, for one path this module already resolved from a credential, at a
      // five-minute TTL. The second is narrower by a wide margin, so it is what
      // this does, and `photo-url.ts` remains the only sanctioned route for
      // every signed-in surface.
      //
      // A signing failure degrades to "no photo", never to a thrown error: a
      // missing avatar must not turn a preview into a refusal, because that
      // would make the refusal distinguishable by whether the person had
      // uploaded a picture.
      const { data, error } = await client.storage
        .from("profile-photos")
        .createSignedUrl(photoPath, PREVIEW_PHOTO_URL_TTL_SECONDS);

      if (error || !data) return null;
      return data.signedUrl;
    },

    async recordView(view: CardPreviewViewRecord): Promise<void> {
      const { error } = await client.from("card_preview_views").insert({
        source: view.source,
        surface: view.surface,
        subject_user_id: view.subjectUserId,
        card_id: view.cardId,
        session_id: view.sessionId,
        ip_hash: view.ipHash,
        user_agent: view.userAgent,
      });

      // Thrown, not swallowed. `discloseSubject`'s header explains why this is
      // the opposite call from `logAttempt`: the thing being logged here is a
      // disclosure, and an unlogged disclosure defeats the only control this
      // path has.
      if (error) {
        throw new Error(`Failed to record card preview view: ${error.message}`, { cause: error });
      }
    },
  };
}

export function defaultCardPreviewDeps(): CardPreviewDeps {
  return { store: supabaseCardPreviewStore(), signingSecret: qrSigningSecret() };
}

/**
 * Reads one threshold, or throws.
 *
 * `Number(undefined)` is `NaN` and every comparison against `NaN` is false, so
 * a naive parse turns "no configured limit" into "no limit at all" — the exact
 * trap `config.ts`'s header names. This checks the type rather than coercing,
 * and requires a positive integer, so a `0`, a `-1`, a `"40"` or a missing row
 * all land in the same place: an exception, and therefore a refusal.
 */
function requirePositiveIntegerConfig(byKey: Map<string, unknown>, key: string): number {
  const value = byKey.get(key);
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(
      `app_config.${key} is missing or unusable. The card preview refuses to run on a default — ` +
        `see the header of apps/web/src/server/cards/card-preview-service.ts.`,
    );
  }
  return value;
}
