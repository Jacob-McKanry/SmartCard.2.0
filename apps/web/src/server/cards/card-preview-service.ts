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
import { countEventsAttended } from "@/server/events/attendance-count";
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
 *   2. That the disclosed field list is FIXED (`PREVIEW_COLUMNS` and
 *      `PREVIEW_SOCIAL_LINK_COLUMNS` below), and that no raw database row ever
 *      leaves this module. Every read is mapped field by field into
 *      `CardPreview`. A column added to `users` tomorrow — a home address, an
 *      admin note, an internal flag — does not appear here, because appearing
 *      would require somebody editing one of those constants.
 *   3. That the ring-diagram numbers are COUNTS AND ONLY COUNTS. The two
 *      aggregate reads below select no column a person could be identified
 *      from; they ask PostgREST for `count` with `head: true`, so no row is
 *      transferred at all. See `loadPreviewCounts`.
 *   4. That every refusal is the SAME refusal. See the next section.
 *
 * ============================================================================
 * AMENDMENT (2026-08-15, later the same day) — `social_links` IS NOW READ HERE,
 * WHICH REVERSES POINT 3 AS THIS FILE ORIGINALLY WROTE IT
 * ============================================================================
 *
 * This header used to say, as its third numbered guarantee, that `social_links`
 * "is NEVER read. Not filtered, not truncated — untouched", quoting
 * 20260809211100's reason: anything looser than the profile's own gate "would be
 * a searchable directory of people's off-platform handles bolted onto a product
 * whose premise is that strangers cannot find you."
 *
 * The project owner decided otherwise, deliberately and with the consequence
 * stated. The reasoning, recorded in full as an amendment at the bottom of
 * 20260809211100 itself (per CLAUDE.md: a deviation goes where the original
 * decision lives) and summarised here:
 *
 *   * The directory objection is an objection to DISCOVERY, and this path has
 *     none. There is no query here that takes a name, a handle, a platform or a
 *     user id. The only inputs are a card code and a signed QR token, exactly as
 *     before; a caller who cannot already produce one of those reaches nothing.
 *     A handle disclosed to somebody holding your card is not a handle in a
 *     directory — it is a handle on the card you handed them.
 *   * It follows the disclosure already made on the very same URL. This route
 *     has, since earlier today, answered a permanent forwardable link with a
 *     person's phone number and email. A public Instagram handle alongside those
 *     is a smaller disclosure than either, and withholding it while disclosing
 *     the phone number was not a coherent line.
 *   * The residual is real and is written down rather than argued away: the set
 *     of a member's off-platform accounts is now reachable by anyone holding
 *     their card's URL, permanently, until the card is revoked. That is a
 *     correlation aid — it links a name and a phone number to a set of accounts
 *     in one place, which is more than any one of those alone. §4.7 threat 1's
 *     amendment carries it.
 *
 * What did NOT change, and is what keeps the reversal narrow: the read is still
 * `.eq("user_id", <a uuid this module resolved from a credential>)`, with a
 * hardcoded three-column list, bounded at `MAX_PREVIEW_SOCIAL_LINKS`, mapped
 * field by field, and it degrades to "no links" on any failure rather than to
 * an error. There is still no query anywhere in this module that could find a
 * person rather than confirm one.
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
 *   * a card that exists but is `unassigned` (stock nobody owns) — NO LONGER
 *     TRUE ON THE LANDING PATH as of 2026-08-21; still true here, and still
 *     true for the vCard route. See the amendment below.
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
 * AMENDMENT (2026-08-21) — ONE OF THOSE IS NO LONGER FUSED WITH THE REST, ON
 * THE LANDING PATH ONLY.
 *
 * `resolveCardCodeLanding` (added below, and used by `/card/<code>`'s page)
 * answers `"blank"` for an `unassigned` card instead of the shared refusal, so
 * that somebody handed a piece of blank stock can be told how to claim it —
 * 6,809 of the 7,142 imported cards are in that state and none of them was
 * usable by anyone outside the legacy import. The full reasoning, the cost, and
 * what deliberately did NOT move with it are at that function.
 *
 * The paragraph above still describes `resolveCardCodePreview` exactly, which
 * is what the vCard routes call, and the list of ten is otherwise unchanged.
 * `revoked` in particular stays fused with "no such card" on every path.
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
 * The second hardcoded field list, added 2026-08-15 with the social-link tiles.
 * Same rule as `PREVIEW_COLUMNS`: a literal, never a spread, never anything a
 * caller supplied.
 *
 * `user_id` is absent because it is already known — this module only ever asks
 * for one person's links, using an id it resolved itself from a credential — and
 * because it is an internal identifier with no business leaving the server.
 * `display_order` is absent from the SELECT but is used by `.order()`, which
 * does not require the column to be selected: it decides the sequence without
 * being disclosed. `created_at`/`updated_at` are absent because "when did they
 * add this link" is a behavioural detail about a person, not a link tile.
 */
const PREVIEW_SOCIAL_LINK_COLUMNS = "id, platform, url";

/**
 * A ceiling on how many links a preview will render, applied in SQL.
 *
 * Not a paging control — there is no second page and there must not be one.
 * It is a bound on a list whose length is chosen by the person being previewed
 * (the legacy import brought in 465 links across 337 users, so a handful each,
 * but nothing in the schema stops someone adding two hundred). Twelve is three
 * full scroll-snap screens of §5's 184px tiles, which is past the point where a
 * visitor is reading rather than scrolling, and it keeps the page a bounded size
 * for an unauthenticated caller who pays nothing to request it.
 */
const MAX_PREVIEW_SOCIAL_LINKS = 12;

/**
 * Exactly what a non-user sees: seven fields off `users`, a signed photo URL,
 * the person's social links, two counts, and — on the vCard surface only — the
 * photo's bytes.
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
  /**
   * The person's own off-platform links, in their chosen order, bounded by
   * `MAX_PREVIEW_SOCIAL_LINKS`. Empty means either "they have none" or "the read
   * failed" — deliberately the same value, because those two must not be
   * distinguishable and because both mean the same thing to a visitor.
   */
  socialLinks: readonly PreviewSocialLink[];
  /**
   * The ring diagram's numbers, or `null` when they could not be computed.
   * `null` renders no diagram at all rather than a diagram of zeroes: DESIGN.md
   * §7 forbids a screen implying more than the app knows, and "0 connections" is
   * a claim, not an absence.
   */
  counts: PreviewCounts | null;
  /**
   * The photo, ready to embed in a vCard's `PHOTO` property. Populated ONLY on
   * the `vcard` surface — see `discloseSubject` for why the page does not pay to
   * download bytes the browser is about to fetch for itself from `photoUrl`.
   */
  photo: PreviewPhoto | null;
}

/** One link tile's worth of a `social_links` row, and nothing else. */
export interface PreviewSocialLink {
  id: string;
  platform: string;
  url: string;
}

/**
 * The two bands DESIGN.md §3 says Profile draws — and it is two, not §3's three,
 * because Profile ships two: its "cities met people in" band has no data behind
 * it (`meeting_locations.place_label` is a venue or neighbourhood name, not a
 * city), and §3's implementation notes record the omission. The preview mirrors
 * what Profile actually renders; inventing a third band here would put a number
 * on an anonymous page that the owner's own screen refuses to show them.
 *
 * These are counts and nothing but counts. Neither is derived from a query that
 * returns a row, a name or an id — see `loadPreviewCounts`.
 */
export interface PreviewCounts {
  /** `connections` rows with `status = 'active'` the subject is an endpoint of. */
  connections: number;
  /** `going` RSVPs to events that have already started — Profile's exact rule. */
  eventsAttended: number;
}

/** Image bytes plus the vCard `TYPE` token that names their format. */
export interface PreviewPhoto {
  /** A vCard 3.0 `TYPE=` token, e.g. `WEBP`. Uppercase, from a fixed allowlist. */
  vCardType: string;
  /** Standard base64, unfolded. The vCard builder folds it. */
  base64: string;
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
  /**
   * The subject's own links, restricted to `PREVIEW_SOCIAL_LINK_COLUMNS` and
   * bounded by `MAX_PREVIEW_SOCIAL_LINKS`. May throw; the caller degrades.
   */
  listPreviewSocialLinks(userId: string): Promise<PreviewSocialLink[]>;
  /**
   * The two ring-diagram numbers. Must answer with counts only — no row, no
   * name, no id of anybody counted. May throw; the caller degrades.
   */
  loadPreviewCounts(userId: string, now: Date): Promise<PreviewCounts>;
  signedPhotoUrl(photoPath: string | null): Promise<string | null>;
  /**
   * The photo's actual bytes, for embedding in a vCard. Returns `null` for no
   * photo, an unembeddable media type, or anything over the size cap. May throw;
   * the caller degrades.
   */
  loadPhotoBytes(photoPath: string | null): Promise<PreviewPhoto | null>;
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
  injectedDeps?: CardPreviewDeps,
): Promise<CardPreview | null> {
  const landing = await resolveCardCodeLanding(code, request, injectedDeps);
  return landing.kind === "preview" ? landing.preview : null;
}

/**
 * What a card code resolves to for the LANDING PAGE, which — unlike the vCard
 * route above — needs to tell one refusal apart from the others.
 *
 * THIS SPLITS A REFUSAL THAT USED TO BE INDIVISIBLE, AND THAT IS A DELIBERATE
 * REVERSAL RATHER THAN AN OVERSIGHT
 *
 * Until 2026-08-21 every failure on this path produced one `null` and one
 * rendered page, and this module's header still argues at length for why: "any
 * distinction between refusals turns this route into an oracle for which of the
 * 7,142 printed codes are real and which of those are live". That argument is
 * unchanged and still correct. The project owner weighed it against a product
 * fact — 6,809 cards are blank stock, and somebody handed one had no way to
 * make it theirs — and chose to disclose exactly one bit more: whether a code
 * names a card that is real AND unclaimed.
 *
 * WHAT MOVED AND WHAT DID NOT. `unassigned` now answers `"blank"`. Everything
 * else keeps the single shared refusal, and two of those matter enough to name:
 *
 *   * `revoked` still answers `"nothing"`, fused with "no such card". This is
 *     not symmetry for its own sake — §4.5's rule is that telling somebody a
 *     card was revoked confirms they are holding lost property that is being
 *     watched, which helps the finder and not the owner. A claimable-card
 *     disclosure does not touch that reasoning and must not be extended to it.
 *   * A suspended or deleted owner still answers `"nothing"`, because that is a
 *     fact about a person rather than about stock.
 *
 * WHAT IT COSTS, PLAINLY. Somebody holding a list of card codes can now sort it
 * into "claimable" and "not claimable" without an account. Both budgets are
 * spent before this function can answer `"blank"` — the per-IP one before the
 * lookup and the per-card one immediately after it — so the sorting is capped
 * at the same rate as previewing, but it is genuinely cheaper to do than it was
 * yesterday, when the answer carried no information at all. Recorded as an
 * amendment to §4.7 threat 1, and the claim itself is separately limited and
 * refuses reasonlessly (20260821120000).
 */
export type CardCodeLanding =
  | { kind: "preview"; preview: CardPreview }
  | { kind: "blank" }
  | { kind: "nothing" };

export async function resolveCardCodeLanding(
  code: string,
  request: CardPreviewRequest,
  injectedDeps?: CardPreviewDeps,
): Promise<CardCodeLanding> {
  return refuseLandingOnThrow("card_code", async () => {
    // Resolved INSIDE the try, not as a default parameter. `defaultCardPreviewDeps()`
    // reads two required environment variables and constructs the service-role
    // client, any of which can throw — and a throw evaluated in a default
    // parameter happens outside this catch, which would produce a framework
    // error page instead of the one shared refusal. A misconfigured server must
    // look exactly like an unknown card code, or the difference is itself a
    // signal.
    const deps = injectedDeps ?? defaultCardPreviewDeps();
    const { store } = deps;
    const audit = auditFieldsFrom(request.headers);
    // One instant for the whole request, for the reason `CardPreviewRequest`
    // gives. The card path had no time-dependent check until the events count
    // arrived; it has one now ("events that have already started"), and it
    // answers against the same clock reading as everything else.
    const now = request.now ?? new Date();
    const limits = await store.loadLimits();

    if (!(await withinIpBudget(store, limits, audit.ipHash))) return { kind: "nothing" };

    const parsedCode = cardCodeSchema.safeParse(code);
    if (!parsedCode.success) return { kind: "nothing" };

    const card = await store.findCardByCode(parsedCode.data);
    if (card === null) return { kind: "nothing" };

    const withinCardBudget = await store.consumeRateLimit({
      action: RATE_LIMIT_ACTIONS.cardPreview,
      subjectKind: "card",
      subjectKey: card.id,
      limit: limits.perCardHour,
      windowSeconds: HOUR_SECONDS,
    });
    if (!withinCardBudget) return { kind: "nothing" };

    // `revoked` before `assigned`, matching `nfc-verifier.ts`. Until 2026-08-21
    // the two produced the same answer and the order was only about which fact
    // a reader of this code sees named. It is now load-bearing: `revoked` must
    // be caught BEFORE the unassigned branch below, or a revoked card would
    // fall through and be offered up as claimable stock — handing the finder of
    // somebody's lost card the ability to take it over, which is the precise
    // inversion of what the kill switch is for.
    if (card.status === "revoked") return { kind: "nothing" };

    // Blank stock. The one refusal that is now distinguishable, and only on
    // this landing path — the vCard route calls `resolveCardCodePreview`, which
    // maps this straight back to `null`, because there is no contact file to
    // download for a card nobody owns.
    if (card.status === "unassigned") return { kind: "blank" };

    if (card.status !== "assigned" || card.ownerUserId === null) return { kind: "nothing" };

    const preview = await discloseSubject(deps, {
      subjectUserId: card.ownerUserId,
      source: "card_code",
      surface: request.surface,
      cardId: card.id,
      sessionId: null,
      audit,
      now,
    });

    return preview === null ? { kind: "nothing" } : { kind: "preview", preview };
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
  injectedDeps?: CardPreviewDeps,
): Promise<CardPreview | null> {
  return refuseOnThrow("qr_token", async () => {
    // Inside the try, for the reason `resolveCardCodePreview` gives above.
    const deps = injectedDeps ?? defaultCardPreviewDeps();
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
      now,
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
 *
 * ---------------------------------------------------------------------------
 * TWO DIFFERENT KINDS OF FAILURE, AND WHY THE ENRICHMENT READS TAKE THE OTHER
 * ONE (2026-08-15, with the links, counts and vCard photo)
 * ---------------------------------------------------------------------------
 *
 * Everything above this point fails CLOSED BY REFUSING: a throw becomes `null`
 * and the visitor sees "Nothing here". The three reads below fail closed by
 * DISCLOSING LESS: a throw becomes no links, no counts, or no embedded photo,
 * and the preview still renders. Those are not in tension, and the distinction
 * is worth being precise about because getting it backwards either way is a
 * bug:
 *
 *   * The checks above decide WHETHER to disclose. A check that cannot be
 *     completed has not passed, so it must reject — CLAUDE.md's rule.
 *   * These three decide HOW MUCH to disclose, after that decision is already
 *     made. Failing them shut discloses strictly less, which is the safe
 *     direction; failing them into a refusal would be *worse than useless*,
 *     because it would make the refusal depend on facts about the subject.
 *     "Nothing here" for a person with a broken avatar and a preview for
 *     everybody else is precisely the distinguishable refusal the top of this
 *     file spends four hundred words forbidding.
 *
 * So each is wrapped individually: one failing does not take the others with
 * it, and none of them can turn a successful disclosure into a refusal. They
 * run AFTER the audit row is written, so a read that is never going to be
 * disclosed is never performed at all.
 *
 * The counts are all-or-nothing on purpose. Two numbers computed by two queries
 * could half-fail, and a ring diagram showing a real connection count beside a
 * fabricated zero for events is a wrong fact rather than a missing one — the
 * "partial-but-wrong" outcome §7 rules out. `loadPreviewCounts` therefore
 * throws if either half fails, and the whole diagram is omitted.
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
    now: Date;
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

  const [photoUrl, socialLinks, counts, photo] = await Promise.all([
    // Minted on BOTH surfaces even though the vCard never reads it, so that the
    // two surfaces cannot disagree about the person. It costs one signing call
    // and no bytes.
    degradeOnFailure("photo url", null, () => deps.store.signedPhotoUrl(subject.photo_path)),
    degradeOnFailure<readonly PreviewSocialLink[]>("social links", [], () =>
      deps.store.listPreviewSocialLinks(subject.id),
    ),
    degradeOnFailure<PreviewCounts | null>("ring counts", null, () =>
      deps.store.loadPreviewCounts(subject.id, input.now),
    ),
    // Only the download surface pays for the bytes. On the page, the browser
    // fetches the same image itself from `photoUrl`, so downloading it here as
    // well would double the egress of every render for nothing. This is the one
    // field whose value legitimately differs by surface, and the test suite
    // asserts it is the only one.
    input.surface === "vcard"
      ? degradeOnFailure<PreviewPhoto | null>("photo bytes", null, () =>
          deps.store.loadPhotoBytes(subject.photo_path),
        )
      : Promise.resolve(null),
  ]);

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
    photoUrl,
    socialLinks,
    counts,
    photo,
  };
}

/**
 * Runs one enrichment read and turns any failure into the "we know less"
 * fallback. See `discloseSubject`'s second section for why this is the correct
 * direction for these three reads and the wrong direction for everything above
 * them.
 *
 * The failure is logged with the same shape `refuseOnThrow` uses, so a
 * systematically failing aggregate is visible in the server log rather than
 * silently showing every visitor a preview with no rings.
 */
async function degradeOnFailure<T>(
  what: string,
  fallback: T,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    console.error("[card-preview] disclosing less after a failed enrichment read", {
      what,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
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

/**
 * The same catch-all for the landing resolver, which answers with a three-way
 * result rather than `CardPreview | null`.
 *
 * `"nothing"` is the thrown-error answer for exactly the reason `null` is
 * above: a misconfigured server, a dropped connection or a bug must be
 * indistinguishable from an unknown code. Note which of the three it collapses
 * to — a failure NEVER surfaces as `"blank"`. A visitor being told a code names
 * a claimable card because the database was briefly unreachable would invite
 * them to claim something that may not exist and may not be theirs.
 */
async function refuseLandingOnThrow(
  source: PreviewSource,
  work: () => Promise<CardCodeLanding>,
): Promise<CardCodeLanding> {
  try {
    return await work();
  } catch (error) {
    console.error("[card-preview] refusing after an unexpected failure", {
      source,
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: "nothing" };
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
 * The largest image, in bytes before base64, this will embed in a `.vcf`.
 *
 * WHY THERE IS A CAP AT ALL. Base64 inflates by a third, so the bucket's own
 * ceiling (5 MiB, 20260813180355) would permit a 6.8 MB contact file — sent to a
 * phone, over mobile data, from a page whose whole purpose is a courtesy to
 * somebody who just tapped a card. A contacts database is also somewhere these
 * bytes live forever once imported.
 *
 * WHY THIS NUMBER. Every photo in the bucket today came from the legacy backfill
 * — 148 files, 7,370,556 bytes, largest 170,214 — so 256 KiB sits above every
 * real photo with room to spare while still being an order of magnitude under
 * what the bucket would allow. It is a guard against the pathological case, not
 * a limit anybody's actual avatar will meet.
 *
 * WHY NOT DOWNSCALE INSTEAD, which would let the cap be much tighter. Node has
 * no image codec in its standard library, so downscaling means adding `sharp` (a
 * native binary, on a serverless build) or a WASM decoder, for one optional
 * property of one courtesy file. That is a disproportionate dependency, and the
 * failure it would prevent — a photo between 256 KiB and 5 MiB — cannot occur
 * with the data that exists. If user-uploaded photos ever get large, downscaling
 * is the right answer and this constant is where the decision to add it lives.
 */
const MAX_EMBEDDED_PHOTO_BYTES = 256 * 1024;

/**
 * Media types this will embed, and the vCard 3.0 `TYPE=` token for each.
 *
 * An allowlist rather than "pass through whatever Storage reports", because the
 * value ends up inside a property parameter in a file handed to a contacts app:
 * an unrecognised or attacker-influenced type token has no business being
 * echoed there. Anything not on this list omits `PHOTO` entirely.
 *
 * IN PRACTICE THIS IS ALWAYS WEBP, AND THAT IS A JUDGMENT CALL WORTH READING.
 * `profile-photos` pins `allowed_mime_types` to `image/webp` (20260813180355)
 * and the uploader only accepts `image/webp`, so every photo in the product is
 * one. WebP is not one of the formats vCard 3.0's RFC had in mind in 1998, and
 * a contacts app old enough to matter will not decode it. Three options were
 * weighed:
 *
 *   * Convert to JPEG. Correct in the abstract, and rejected for the dependency
 *     reason on `MAX_EMBEDDED_PHOTO_BYTES` above.
 *   * Omit `PHOTO` for WebP. Since every photo is WebP, this is "do not build
 *     the feature", dressed up as caution.
 *   * Embed it. iOS has decoded WebP since 14 and Android since 4.0, and every
 *     mainstream importer sniffs the bytes rather than trusting `TYPE`. The
 *     failure mode when it does not work is a contact with no picture — the same
 *     outcome as omitting it — not a file that fails to import, because `PHOTO`
 *     is an optional property that a parser which cannot use it skips.
 *
 * The third is what ships: it is the only one that does anything, and its
 * downside is bounded by the upside of the option that does nothing. The other
 * three entries are here so that a future upload path accepting JPEG or PNG
 * works without anybody having to remember this file exists.
 */
const EMBEDDABLE_PHOTO_TYPES: Record<string, string> = {
  "image/webp": "WEBP",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/gif": "GIF",
};

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

    async listPreviewSocialLinks(userId: string): Promise<PreviewSocialLink[]> {
      // The same shape as `loadPreviewSubject`: one `.eq()` on a uuid this
      // module resolved from a credential, a literal column list, and a hard
      // limit. No `.or()`, no `.ilike()`, no `.textSearch()`, and — the point of
      // 20260809211100's objection — nothing that takes a handle or a platform
      // as INPUT. This query can confirm a person's links; it cannot find a
      // person from a link, which is the difference between this and a
      // directory.
      const { data, error } = await client
        .from("social_links")
        .select(PREVIEW_SOCIAL_LINK_COLUMNS)
        .eq("user_id", userId)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(MAX_PREVIEW_SOCIAL_LINKS)
        .returns<PreviewSocialLink[]>();

      if (error) {
        throw new Error(`Failed to read preview social links: ${error.message}`, { cause: error });
      }

      // Mapped field by field for the same reason `discloseSubject` maps the
      // user row: `data` is whatever PostgREST sent back, and returning it
      // directly would make the disclosed shape a property of the query string
      // rather than of this file.
      return (data ?? []).map((row) => ({ id: row.id, platform: row.platform, url: row.url }));
    },

    /**
     * The ring diagram's two numbers.
     *
     * WHY THIS IS SERVICE-ROLE AGGREGATION AND NOT A QUERY THE PREVIEW COULD
     * HAVE MADE ANYWAY. Neither number is readable through RLS by anyone but the
     * subject: the `connections` select policy returns only edges the caller is
     * an endpoint of, and `event_rsvps` is narrower still ("self + your
     * connections", 20260809211300). There is no reader here at all, so there is
     * nothing for either policy to be evaluated against — the same argument the
     * file header makes for `users`.
     *
     * WHAT KEEPS THAT NARROW: `head: true` with `count: "exact"`. PostgREST
     * answers with a `Content-Range` header and an EMPTY BODY — not one row, not
     * an id, not a name. The `select()` argument only shapes the join; no column
     * value crosses the wire. So the widest thing a bug here could disclose is a
     * different NUMBER, never a person. That property is why this is safe to run
     * without a policy behind it, and it is the reason not to "improve" this into
     * a query that returns rows and counts them in TypeScript.
     *
     * WHY THE CONNECTION COUNT IS TWO QUERIES AND NOT ONE `.or()`. `connections`
     * stores each edge once with `user_a_id < user_b_id` (20260809210600), so
     * the subject is on exactly one side of any given edge and the two counts
     * cannot overlap — their sum is exact, with no de-duplication needed. Doing
     * it with `.or("user_a_id.eq.…,user_b_id.eq.…")` would be one round trip
     * instead of two, and would introduce the first caller-shaped filter
     * expression in a module whose entire claim is that it has none. Two plain
     * `.eq()`s cost a round trip and keep the claim true.
     *
     * WHY "EVENTS ATTENDED" IS NOT COUNTED HERE ANY MORE (amended 2026-08-15).
     * It is `countEventsAttended` in `server/events/attendance-count.ts`, and
     * this module now calls the same function Profile does. This file used to
     * carry the query inline, alongside a note recording a "known, deliberate
     * difference from Profile": Profile derived its number from
     * `listAttendingEvents`, which caps at the 50 most recent RSVPs, so at 50+
     * RSVPs the owner's own screen undercounted while this page — counting in
     * SQL — did not. That was written down as a curiosity and it was a bug: a
     * person's own profile disagreeing with the page strangers see, in the
     * direction of the owner being told less about themselves. One function now
     * answers the question for both, because two implementations of one number
     * are what let them drift in the first place.
     *
     * The property that made the inline query safe to run without a policy
     * behind it is unchanged and is asserted in that module's own header:
     * `head: true` with `count: "exact"` transfers a count header and an empty
     * body, so the widest thing a bug in it can disclose is a different NUMBER,
     * never a person. The connection counts below stay here because they are
     * this page's alone — no other surface computes them.
     *
     * Throws if ANY of the three fails, so the caller omits the whole diagram
     * rather than pairing a real count with a fabricated zero.
     */
    async loadPreviewCounts(userId: string, now: Date): Promise<PreviewCounts> {
      const [aSide, bSide, eventsAttended] = await Promise.all([
        client
          .from("connections")
          .select("id", { count: "exact", head: true })
          .eq("status", "active")
          .eq("user_a_id", userId),
        client
          .from("connections")
          .select("id", { count: "exact", head: true })
          .eq("status", "active")
          .eq("user_b_id", userId),
        // The shared counter, on this module's own client. It throws on a
        // failure or a missing count header rather than defaulting, which is
        // what keeps the all-or-nothing promise below.
        countEventsAttended(client, userId, now),
      ]);

      for (const result of [aSide, bSide]) {
        if (result.error) {
          throw new Error(`Failed to count for the card preview: ${result.error.message}`, {
            cause: result.error,
          });
        }
        // A null count with no error means the header was missing or unparsed.
        // Treated as a failure rather than as zero, for `config.ts`'s reason:
        // a number that quietly defaults is a claim nobody made.
        if (typeof result.count !== "number") {
          throw new Error("Card preview count came back without a count.");
        }
      }

      return {
        connections: (aSide.count ?? 0) + (bSide.count ?? 0),
        eventsAttended,
      };
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

    /**
     * The bytes behind `photo_path`, for the vCard's `PHOTO` property.
     *
     * WHY BASE64 IN THE FILE AND NOT A `PHOTO;VALUE=URI:` POINTING AT THE SIGNED
     * URL. The URI form is smaller, costs no download here, and is wrong. A
     * signed URL is a five-minute bearer credential (see
     * `PREVIEW_PHOTO_URL_TTL_SECONDS`), and a `.vcf` is a file somebody saves —
     * the whole point of the download is that it outlives the page. A URI
     * reference would produce a contact whose photo is a broken link within
     * minutes of being saved, silently, with nothing for the person to fix.
     * Lengthening the TTL to compensate is worse: it would hand every downloader
     * a long-lived credential for a private-bucket object, which is precisely
     * what the short TTL exists to prevent. Embedding is the only form that is
     * still correct tomorrow, and it discloses nothing new — these are the same
     * bytes the preview page already renders to the same visitor.
     *
     * WHY THIS DOWNLOADS THROUGH THE SERVICE-ROLE CLIENT RATHER THAN FETCHING
     * ITS OWN SIGNED URL. Same bytes either way; this route needs no bearer
     * credential to exist even momentarily, and it does not depend on the app
     * being able to reach its own public URL. The storage policy is untouched —
     * `anon` gains nothing here.
     *
     * FAILS TO `null`, NEVER THROWS PAST THE CALLER'S GUARD. No photo, a deleted
     * object, an unembeddable media type and an oversized file all produce the
     * same "no PHOTO property", and the vCard is still valid without one.
     */
    async loadPhotoBytes(photoPath: string | null): Promise<PreviewPhoto | null> {
      if (!photoPath) return null;

      const { data, error } = await client.storage.from("profile-photos").download(photoPath);
      if (error || !data) return null;

      const vCardType = EMBEDDABLE_PHOTO_TYPES[data.type.toLowerCase()];
      if (vCardType === undefined) return null;

      // Checked on the Blob's own size before the bytes are materialised, and
      // again on the materialised length. The second check is not redundant
      // paranoia: `size` comes from a `content-length` this process did not
      // compute, and the thing being bounded is how much memory a request from
      // an unauthenticated caller can cause this server to allocate.
      if (data.size > MAX_EMBEDDED_PHOTO_BYTES) return null;
      const bytes = Buffer.from(await data.arrayBuffer());
      if (bytes.byteLength > MAX_EMBEDDED_PHOTO_BYTES) return null;

      return { vCardType, base64: bytes.toString("base64") };
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
