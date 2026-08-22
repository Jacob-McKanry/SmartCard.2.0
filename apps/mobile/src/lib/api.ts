/**
 * The seam between the Kinde session on this device and the typed wrappers in
 * `@smartcard/api-client`.
 *
 * Every `/api/v1/*` wrapper takes an `ApiV1Options` as its last argument. On
 * web that argument is usually empty: the browser is on the same origin and
 * attaches the session cookie itself. The phone has neither, so it has to
 * supply both halves — where the API lives, and who is calling — and this is
 * the one place that assembles them.
 *
 * WHY THE TOKENS ARE PASSED AS FUNCTIONS AND NOT AS VALUES
 *
 * `ApiV1Options.getToken`'s own header explains the race in full. The short
 * version: a Kinde access token expires, and a screen that reads one into a
 * variable and then makes a call has no way to close the gap between the two.
 * Handing over `getAccessToken` itself means the token is resolved at the
 * moment the request is built, and `@kinde/expo` refreshes internally, so no
 * screen in this app ever deals with a refresh by hand.
 */
import type { ApiV1Options } from "@smartcard/api-client";

/**
 * The part of `useKindeAuth()` this module actually needs. Declared here
 * rather than imported so the builder below can be tested without a React
 * renderer or a Kinde provider — the SDK's own hook throws outside its
 * context, which would make an otherwise pure function untestable.
 */
export interface TokenSource {
  getAccessToken: () => Promise<string | null>;
  getIdToken: () => Promise<string | null>;
}

/**
 * Pure: given where the API lives and something that can produce tokens,
 * produce the options every wrapper call needs.
 *
 * The two providers are wrapped in fresh arrows rather than passed straight
 * through, so `this` binding inside the SDK's methods survives being detached
 * from the hook object.
 */
export function buildApiOptions(baseUrl: string, tokens: TokenSource): ApiV1Options {
  return {
    baseUrl,
    getToken: () => tokens.getAccessToken(),
    getIdToken: () => tokens.getIdToken(),
  };
}
