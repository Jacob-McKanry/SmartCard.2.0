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
 * The symmetric secret the Supabase project uses to verify JWTs.
 *
 * This is the key the token exchange signs with (§5.4, and the 2026-08-13
 * amendment recording why the exchange is still necessary). Holding it means
 * being able to mint a token for any user, so it lives server-side only and is
 * never sent to a browser or a phone.
 */
export function supabaseJwtSecret(): string {
  return required(
    "SUPABASE_JWT_SECRET",
    "Supabase dashboard -> Project Settings -> JWT Keys (JWT Settings) -> JWT secret / legacy shared secret. " +
      "Server-side only — anyone holding it can mint a token for any user.",
  );
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
