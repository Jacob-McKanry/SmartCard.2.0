/**
 * The mobile app's environment variables, read once and refused loudly when
 * they are missing or unsafe. Mirrors `apps/web/src/server/env.ts` in posture
 * — named accessor per variable, a `MissingEnvVarError` that says where to get
 * the value — but differs from it in two ways that matter.
 *
 * ============================================================================
 * WHY EVERY VARIABLE IS SPELLED OUT INSTEAD OF LOOKED UP BY NAME
 * ============================================================================
 *
 * The web version can write `process.env[name]` because Node has a real
 * `process.env` at runtime. Expo does not: there is no environment on a phone.
 * Its Babel transform substitutes each `EXPO_PUBLIC_*` read for a string
 * literal at BUILD time, and it can only do that when the KEY IS STATICALLY
 * KNOWN. A computed key has nothing to substitute, so it survives into the
 * bundle as a lookup against an object that does not exist and evaluates to
 * `undefined` — while working perfectly in tests and in dev, where a real
 * `process.env` is present.
 *
 * Measured against an actual `expo export` bundle for SDK 57 rather than
 * assumed, because the boundary is narrower than "avoid brackets":
 *
 *   process.env.EXPO_PUBLIC_X        -> inlined
 *   process.env["EXPO_PUBLIC_X"]     -> inlined (a literal key is still static)
 *   const k = "EXPO_PUBLIC_X";
 *   process.env[k]                   -> NOT inlined, silently undefined
 *
 * So the rule that matters is: never compute the key. Do not refactor the
 * accessors below into a loop, a lookup table, or a shared helper that takes
 * the variable name as a parameter — each one would break in a release build
 * and pass every test.
 *
 * ============================================================================
 * WHY IT IS SAFE FOR ALL THREE TO BE PUBLIC
 * ============================================================================
 *
 * `EXPO_PUBLIC_*` values are embedded in the app bundle and extractable by
 * anyone who downloads the app. All three here are public by design: a Kinde
 * domain and our own API URL are addresses, not credentials, and a native
 * PKCE client id is deliberately not a secret — proving possession is what the
 * code challenge does, which is the entire reason PKCE exists for clients that
 * cannot keep a secret. The mobile scoping doc's §5 rule 2 lists exactly which
 * variables mobile may have; nothing that grants anything belongs here.
 */

export class MissingEnvVarError extends Error {
  constructor(
    readonly variableName: string,
    whereToGetIt: string,
  ) {
    super(`${variableName} is required. ${whereToGetIt}`);
    this.name = "MissingEnvVarError";
  }
}

export class UnsafeEnvVarError extends Error {
  constructor(
    readonly variableName: string,
    reason: string,
  ) {
    super(`${variableName} is unsafe: ${reason}`);
    this.name = "UnsafeEnvVarError";
  }
}

export function requireValue(
  value: string | undefined,
  variableName: string,
  whereToGetIt: string,
): string {
  if (value === undefined || value.trim() === "") {
    throw new MissingEnvVarError(variableName, whereToGetIt);
  }
  return value.trim();
}

/**
 * Hosts we accept over cleartext `http://`. Everything else must be `https://`.
 *
 * This is a fail-closed check, not a style rule. Every request this app makes
 * carries a Kinde access token in an `Authorization` header; over cleartext to
 * a routable host that token is readable by anything on the path, and a stolen
 * access token is a signed-in session. A developer pointing the app at a
 * laptop on the same Wi-Fi is the one case where cleartext is both normal and
 * contained, so loopback and the three RFC 1918 private ranges are allowed and
 * nothing else is.
 */
function isLocalOnlyHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "::1") return true;

  // Both ends anchored, and only an exact dotted quad is considered at all.
  // A prefix test would be a hole rather than a shortcut: `10.0.0.1.evil.com`
  // begins with private-looking digits but is an ordinary routable DNS name
  // that somebody else controls, so a `/^10\./` check would hand them our
  // access tokens over cleartext. Caught by this module's own test.
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (octets === null) return false;

  const first = Number(octets[1]);
  const second = Number(octets[2]);
  if (first === 127) return true; // loopback is the whole /8, not just .0.0.1
  if (first === 10) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  return false;
}

export function requireHttpsUrl(
  value: string | undefined,
  variableName: string,
  whereToGetIt: string,
  { allowLocalCleartext = false }: { allowLocalCleartext?: boolean } = {},
): string {
  const raw = requireValue(value, variableName, whereToGetIt);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeEnvVarError(variableName, `${raw} is not a valid URL.`);
  }

  if (url.protocol === "https:") {
    // Trailing slashes make every path built from this read `//api/v1/...`.
    return raw.replace(/\/+$/, "");
  }

  if (url.protocol === "http:" && allowLocalCleartext && isLocalOnlyHost(url.hostname)) {
    return raw.replace(/\/+$/, "");
  }

  throw new UnsafeEnvVarError(
    variableName,
    `${raw} is not https. An access token sent over cleartext to a routable host is readable in transit, and a stolen access token is a signed-in session.`,
  );
}

export interface MobileConfig {
  kindeDomain: string;
  kindeClientId: string;
  apiUrl: string;
}

export type ConfigResult = { ok: true; config: MobileConfig } | { ok: false; message: string };

/**
 * Every variable at once, as a result rather than a throw.
 *
 * The accessors below are deliberately loud, but a misconfigured build
 * crashing on the first render gives a beginner developer a red screen and a
 * stack trace pointing at React internals. The root layout calls this instead
 * and renders the message — which already names the variable and where to get
 * its value — so the answer is on the phone rather than in a log.
 */
export function readConfig(): ConfigResult {
  try {
    return {
      ok: true,
      config: { kindeDomain: kindeDomain(), kindeClientId: kindeClientId(), apiUrl: apiUrl() },
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof MissingEnvVarError || error instanceof UnsafeEnvVarError
          ? error.message
          : "The app's configuration could not be read.",
    };
  }
}

/** The Kinde business, e.g. `https://smartcardsolutionsllc.kinde.com`. Never cleartext — always a public host. */
export function kindeDomain(): string {
  return requireHttpsUrl(
    process.env.EXPO_PUBLIC_KINDE_DOMAIN,
    "EXPO_PUBLIC_KINDE_DOMAIN",
    "Kinde dashboard -> Settings -> Business -> your Kinde domain.",
  );
}

/**
 * The `SmartCard Mobile` Kinde application's client id — the NATIVE one, not
 * the web app's. It must match `KINDE_MOBILE_CLIENT_ID` on the server, because
 * that is the value `kindeAllowedClientIds()` checks a token's `azp` against;
 * a mismatch is refused server-side with a 401 that names nothing useful.
 */
export function kindeClientId(): string {
  return requireValue(
    process.env.EXPO_PUBLIC_KINDE_CLIENT_ID,
    "EXPO_PUBLIC_KINDE_CLIENT_ID",
    "Kinde dashboard -> Applications -> SmartCard Mobile -> Client ID. Must equal KINDE_MOBILE_CLIENT_ID on the server.",
  );
}

/**
 * Where `/api/v1/*` lives. Unlike the web app, which fetches relative paths on
 * its own origin, the phone has no origin and needs an absolute URL.
 */
export function apiUrl(): string {
  return requireHttpsUrl(
    process.env.EXPO_PUBLIC_API_URL,
    "EXPO_PUBLIC_API_URL",
    "The deployed web app's origin, e.g. https://smartcard.tech (no trailing slash).",
    { allowLocalCleartext: true },
  );
}
