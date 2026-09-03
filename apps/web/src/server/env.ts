import "server-only";

/**
 * Server-only environment variable access, read once and validated loudly.
 *
 * Two rules this file exists to enforce, both from architecture proposal §7.4:
 *
 *  1. **Secrets never get a `NEXT_PUBLIC_` prefix.** Anything read through
 *     `requiredSecret()` here is server-side only, and this module is marked
 *     `server-only` so importing it (directly or transitively) from a Client
 *     Component is a build error rather than a runtime leak of the service-role
 *     key into a browser bundle.
 *
 *  2. **A missing variable fails closed, immediately and legibly.** The
 *     alternative — `process.env.X` evaluating to `undefined` and flowing into
 *     a JWT signature or a database URL — produces failures that look like
 *     authentication bugs. `MissingEnvVarError` names the variable and where to
 *     get its value, because the person hitting it is the project owner, not
 *     the person who wrote this file.
 */

/** Thrown when a required variable is absent. Carries the fix, not just the fault. */
export class MissingEnvVarError extends Error {
  constructor(
    readonly variableName: string,
    whereToGetIt: string,
  ) {
    super(
      `Missing required environment variable ${variableName}. ` +
        `It belongs in .env.local at the repo root (gitignored — never committed). ` +
        `${whereToGetIt}`,
    );
    this.name = "MissingEnvVarError";
  }
}

function required(name: string, whereToGetIt: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new MissingEnvVarError(name, whereToGetIt);
  }
  return value;
}

/**
 * Kinde's issuer URL, e.g. `https://smartcardsolutionsllc.kinde.com`.
 *
 * This is the same variable `@kinde-oss/kinde-auth-nextjs` reads for the
 * sign-in flow (§5.1), and we deliberately reuse it rather than deriving the
 * issuer from `KINDE_DOMAIN` separately: the value we verify tokens *against*
 * must be the same value we obtained them *from*, or a token from an unrelated
 * Kinde business could pass verification.
 */
export function kindeIssuerUrl(): string {
  return required(
    "KINDE_ISSUER_URL",
    "It is the Kinde business URL, e.g. https://<your-business>.kinde.com.",
  ).replace(/\/+$/, "");
}

/**
 * This app's own public origin, e.g. `https://smartcard.tech`.
 *
 * The same variable `@kinde-oss/kinde-auth-nextjs` builds its redirect URI
 * from, reused here for the same reason `kindeIssuerUrl()` is reused rather
 * than re-derived: a second source for "where this app lives" is a second thing
 * that can disagree with the first.
 *
 * Read by the Settings screen to build an absolute `returnUrl` for the account
 * portal. That has to be absolute — the SDK's portal handler rejects a relative
 * one and then silently redirects home — so this is not somewhere a relative
 * path can be substituted.
 */
export function kindeSiteUrl(): string {
  return required(
    "KINDE_SITE_URL",
    "It is this app's own public origin, e.g. https://smartcard.tech — the same value the Kinde SDK builds its redirect URI from.",
  ).replace(/\/+$/, "");
}

/**
 * Every Kinde client id this backend will accept a token from.
 *
 * Kinde puts the id of the application a token was minted for in the `azp`
 * ("authorized party") claim. Both SmartCard apps authenticate against the same
 * Kinde business, so the issuer alone does not distinguish them — this list is
 * what says "a token from the SmartCard Web app or the SmartCard Mobile app,
 * and nothing else in the business". The mobile id is included now, even though
 * mobile auth is not built yet (§7.2 needs an EAS dev build first), because the
 * mobile PKCE flow will send its tokens to this same API and would otherwise be
 * rejected for a reason nobody would guess.
 */
export function kindeAllowedClientIds(): readonly string[] {
  const web = required(
    "KINDE_CLIENT_ID",
    "Kinde dashboard -> Applications -> SmartCard Web -> Client ID.",
  );
  // Optional: the mobile app may not be configured in every environment yet.
  const mobile = process.env.KINDE_MOBILE_CLIENT_ID?.trim();
  return mobile ? [web, mobile] : [web];
}

export function supabaseUrl(): string {
  return required(
    "SUPABASE_URL",
    "Supabase dashboard -> Project Settings -> API -> Project URL.",
  ).replace(/\/+$/, "");
}

/**
 * The publishable (formerly "anon") API key. Public by design — it identifies
 * the project to the API gateway and grants nothing on its own, because every
 * table in this schema is default-deny with no `anon` grant anywhere (§3.1).
 * Authorization comes from the JWT we mint, never from this key.
 */
export function supabasePublishableKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "Supabase dashboard -> Project Settings -> API keys -> publishable key (sb_publishable_...).",
  );
}

/**
 * The service-role key. Bypasses RLS entirely.
 *
 * Used by exactly one code path in this app — `ensureUser()` — for the reason
 * given in `20260809211100_rls_policies_identity_and_cards.sql`: there is no
 * client-facing INSERT policy on `users`, because a client able to insert its
 * own row could choose its own `kinde_user_id`, i.e. choose which account it
 * is. Everything else on the request path goes through the RLS-bound client.
 */
export function supabaseServiceRoleKey(): string {
  return required(
    "SUPABASE_SERVICE_ROLE_KEY",
    "Supabase dashboard -> Project Settings -> API keys -> service_role secret key. " +
      "Server-side only — it bypasses every RLS policy in the database.",
  );
}

/**
 * The private JWT signing key the token exchange signs with — an ES256 (NIST
 * P-256) key **we** generated and imported into the Supabase project's JWT
 * Signing Keys, so that the project trusts tokens we mint (§5.4, and the second
 * 2026-08-13 amendment recording Q27).
 *
 * WHY THIS EXISTS RATHER THAN JUST USING THE PROJECT'S CURRENT KEY. Supabase's
 * own current signing key is generated and held by Supabase: "Once you've moved
 * to using the JWT signing keys feature extracting of the private key or shared
 * secret from Supabase is not possible." Only Supabase Auth can sign with it. A
 * third-party minter like us therefore has exactly one supported route — import
 * a key we control and let the project trust it — which is the route this
 * variable is for.
 *
 * FORMAT. The full **private** JWK as compact JSON, exactly as
 * `supabase gen signing-key --algorithm ES256` emits it and exactly as it was
 * pasted into the dashboard: `{"kty":"EC","kid":"…","d":"…","crv":"P-256",…}`.
 * The `d` member is the private scalar — this value is as sensitive as the old
 * shared secret was, and is why this is read here and never anywhere near a
 * `NEXT_PUBLIC_` name.
 *
 * REQUIRED as of 2026-08-14, and there is no second signing path. It was
 * briefly optional — unset meant falling back to the legacy HS256 shared
 * secret — only to cover the window between the code shipping and the key being
 * imported *and rotated to in-use* in the dashboard, a manual step no code here
 * can perform. That rotation is done and confirmed in production, so the
 * fallback is deleted: missing, malformed or not-actually-private all throw
 * here, and the app cannot sign with the deprecated secret even by accident.
 *
 * Failing closed is the point. The deprecated secret is the project's previous
 * key and Supabase may revoke it without warning; a typo'd or truncated value
 * quietly demoting the app back onto it is precisely the failure Q27 exists to
 * prevent, and it is one nobody would notice until every request failed at once.
 */
export interface SupabaseJwtSigningKey {
  /**
   * The key id. Goes in the JWT's `kid` header, which is how Supabase picks
   * which trusted public key to verify the signature with — a token minted
   * without it cannot be verified even when the key itself is trusted.
   */
  kid: string;
  /** The private JWK, parsed. Passed to `jose`'s `importJWK`. */
  jwk: Record<string, unknown>;
}

export function supabaseJwtSigningKey(): SupabaseJwtSigningKey {
  const raw = required(
    "SUPABASE_JWT_SIGNING_KEY",
    "It is the private ES256 JWK this app signs Supabase access tokens with, as one line of JSON. " +
      "Generate one with `supabase gen signing-key --algorithm ES256`, then Supabase dashboard -> " +
      "Project Settings -> JWT Keys -> add a standby key -> Import private key, wait ~20 minutes, " +
      "and click Rotate keys so the project accepts signatures from it. " +
      "Server-side only — anyone holding it can mint a token for any user.",
  ).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "SUPABASE_JWT_SIGNING_KEY is set but is not valid JSON. It must be the whole private JWK " +
        'on one line, e.g. {"kty":"EC","kid":"…","d":"…","crv":"P-256","x":"…","y":"…"} — the exact ' +
        "output of `supabase gen signing-key --algorithm ES256`.",
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      "SUPABASE_JWT_SIGNING_KEY must be a single JWK object, not an array or scalar.",
    );
  }

  const jwk = parsed as Record<string, unknown>;
  const kid = jwk.kid;

  // Each of these three is checked because getting it wrong produces a token
  // Supabase rejects with an opaque 401, and an opaque 401 on this path reads
  // like "auth is broken" rather than "the key is misconfigured".
  if (typeof kid !== "string" || kid === "") {
    throw new Error(
      "SUPABASE_JWT_SIGNING_KEY has no `kid`. Supabase identifies the verifying key by `kid`, and " +
        "the value must match the key imported in the dashboard exactly.",
    );
  }
  if (jwk.alg !== undefined && jwk.alg !== "ES256") {
    throw new Error(
      `SUPABASE_JWT_SIGNING_KEY declares alg "${String(jwk.alg)}"; this app signs ES256 only. ` +
        "Generate one with `supabase gen signing-key --algorithm ES256`.",
    );
  }
  if (typeof jwk.d !== "string" || jwk.d === "") {
    throw new Error(
      "SUPABASE_JWT_SIGNING_KEY is a public key, not a private one — it has no `d` member, so it " +
        "cannot sign anything. Use the full private JWK (the same JSON pasted into the dashboard).",
    );
  }

  return { kid, jwk };
}

/**
 * The HMAC key the QR tokens are signed with (§4.2 step 2, §7.4).
 *
 * A client holding this can mint a valid token for any session id and any
 * nonce, which is the first of the nine checks in §4.2 step 5 — so it is
 * server-side only and must never be given a `NEXT_PUBLIC_` prefix. It is not
 * derived from any other secret in this file, deliberately: one key, one
 * purpose, so that rotating or leaking it has a bounded blast radius.
 *
 * Generate with `openssl rand -base64 48`, or any 32+ bytes of real randomness.
 */
export function qrSigningSecret(): string {
  return required(
    "QR_SIGNING_SECRET",
    "Generate one: `openssl rand -base64 48`. Server-side only — anyone holding it can mint a QR token for any session.",
  );
}

/**
 * The salt for hashing IP addresses before they are stored (§4.6, and the
 * `ip_hash` columns on `connection_attempts` and `rate_limit_events`).
 *
 * WHY THIS IS REQUIRED RATHER THAN OPTIONAL, EVEN THOUGH A MISSING SALT WOULD
 * "ONLY" WEAKEN THE HASH. Without it there are two bad options and no good one:
 * hash the IP unsalted, which is trivially reversible because the entire IPv4
 * space is 4 billion values a laptop can enumerate in seconds — i.e. store raw
 * IPs while believing you did not — or skip the per-IP rate limit, which
 * removes a §4.6 control silently. Failing closed at startup is the honest
 * third option, and it matches the posture the rest of this file takes.
 *
 * Deliberately NOT the same value as `CONTACT_HASH_SALT` (§2.7): reusing one
 * salt across two datasets means one leak compromises both.
 */
export function connectIpHashSalt(): string {
  return required(
    "CONNECT_IP_HASH_SALT",
    "Generate one: `openssl rand -base64 32`. Server-side only. Must differ from CONTACT_HASH_SALT.",
  );
}

/**
 * The Mapbox access token used to reverse-geocode a meeting's GPS fix into
 * `meeting_locations.place_label` (§2.4, Q25).
 *
 * OPTIONAL, for the same reason `expoAccessToken()` is: §2.4's amendment is
 * explicit that a failed or missing geocode must leave `place_label` null and
 * show the meeting without a place name, never fail or delay the connection
 * that already committed by the time this runs. "A missing label is a
 * cosmetic loss, not a security one."
 *
 * WHY MAPBOX. Checked against each candidate's terms of service before
 * picking one, because this project *retains* the label rather than
 * displaying and discarding it: Google's Geocoding API terms only allow
 * indefinite storage of `place_id`, not the formatted result — storing
 * `place_label` as designed would not be compliant. OSM Nominatim's usage
 * policy doesn't address storage either way, and its public instance expects
 * self-hosting past casual volume. Mapbox has an explicit `permanent=true`
 * storage tier built for exactly this. Recorded as Q25's resolution in the
 * architecture doc.
 *
 * Returns null when unset. `geocode.ts` treats null the same as any other
 * geocoding failure: log and move on.
 */
export function geocodingApiKey(): string | null {
  const value = process.env.GEOCODING_API_KEY?.trim();
  return value === undefined || value === "" ? null : value;
}

/**
 * The credential our server presents to Expo's push API (§7.5).
 *
 * OPTIONAL, and that is a deliberate difference from every other secret here.
 * §4.5's amendment is explicit that a failed or absent notification must never
 * block, delay or reverse a connection: physical possession of the card is the
 * proof, and it is already complete by the time we try to notify. Making this
 * required would mean a missing environment variable stops people connecting —
 * failing closed on the one part of this path where failing closed is the wrong
 * answer, because there is nothing left to verify.
 *
 * Returns null when unset. The send path logs loudly and carries on, which is
 * also correct: §4.5 warns that the failure mode to avoid is SILENT breakage —
 * a notification pipeline dead for a week is a security regression even though
 * no single connection was affected.
 */
export function expoAccessToken(): string | null {
  const value = process.env.EXPO_ACCESS_TOKEN?.trim();
  return value === undefined || value === "" ? null : value;
}

/**
 * The Resend API key `apps/web/src/server/email/send.ts` sends with (§5 of
 * the attendee-import design, `docs/architecture/2026-09-02-event-invite-email.md`).
 *
 * OPTIONAL, following `expoAccessToken()`'s own precedent and for the same
 * reason: a claim link is written to `event_attendee_imports` the moment a
 * host imports a guest, independent of whether anything can mail it. Missing
 * mail must degrade to "nobody got emailed yet, use the copy-link screen",
 * never to a failed import — the import already succeeded at the one thing
 * it structurally cannot retry (writing the row), and email is a delivery
 * mechanism for a link that already exists, not a precondition for it.
 *
 * Returns null when unset. The send module logs loudly and leaves every row
 * unsent rather than throwing, which is the same "log and move on" posture
 * `geocodingApiKey()`'s caller takes.
 */
export function resendApiKey(): string | null {
  const value = process.env.RESEND_API_KEY?.trim();
  return value === undefined || value === "" ? null : value;
}

/**
 * The signing secret Resend hands out when a webhook endpoint is created in
 * its dashboard, used to verify `/api/webhooks/resend` requests actually came
 * from Resend (via Svix — see that route's own header).
 *
 * REQUIRED, unlike `resendApiKey()` above, and deliberately asymmetric: a
 * missing API key degrades a feature (nobody gets emailed); a missing webhook
 * secret would degrade a SECURITY CHECK (anybody could POST a fake "this
 * address bounced" and nothing would catch it, or — the sharper case — a fake
 * "delivered" that suppresses nothing while a real complaint sits unprocessed
 * because the route never verifies anything and was written to no-op instead
 * of failing closed). Reading this with `required()` means the route throws a
 * loud 500 on every request until the secret is set, rather than silently
 * accepting unverified bodies — the correct direction to fail before this
 * pipeline is trusted with a domain's sending reputation.
 */
export function resendWebhookSecret(): string {
  return required(
    "RESEND_WEBHOOK_SECRET",
    "Resend dashboard -> Webhooks -> the endpoint for this app -> Signing Secret (starts with whsec_).",
  );
}

/**
 * HMAC key for the unsubscribe link every invite email carries
 * (`apps/web/src/server/email/unsubscribe-token.ts`).
 *
 * REQUIRED, and deliberately its own secret rather than reusing
 * `qrSigningSecret()` or `connectIpHashSalt()` — `connectIpHashSalt()`'s own
 * header gives the reason this pattern already follows: "reusing one salt
 * across two datasets means one leak compromises both." A leaked unsubscribe
 * key lets someone forge a link that unsubscribes an address they do not
 * own; that blast radius has nothing to do with QR tokens or IP hashing and
 * must not share a key with either.
 */
export function emailUnsubscribeSecret(): string {
  return required(
    "EMAIL_UNSUBSCRIBE_SECRET",
    "Generate one: `openssl rand -base64 32`. Server-side only — anyone holding it can forge an unsubscribe link for any address.",
  );
}

/**
 * The physical mailing address CAN-SPAM requires in every commercial email
 * (`apps/web/src/server/email/claim-email.ts`'s footer). A business address,
 * a registered agent address, or a PO box all satisfy the requirement — this
 * module has no opinion on which, only that ONE is present.
 *
 * REQUIRED, and deliberately not defaulted to a placeholder string. A
 * plausible-looking fake address would make `pnpm build` pass while shipping
 * a real legal violation the moment the send module (a later slice) sends
 * its first message — the kind of failure `required()`'s own module header
 * exists to convert into "a missing variable fails closed, immediately and
 * legibly" instead.
 */
export function emailMailingAddress(): string {
  return required(
    "EMAIL_MAILING_ADDRESS",
    "The physical address CAN-SPAM requires in every commercial email's footer — a business address, " +
      "registered agent address, or PO box. One line, e.g. \"123 Main St, Suite 100, Springfield, ST 00000\".",
  );
}
