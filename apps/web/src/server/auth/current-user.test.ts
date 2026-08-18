import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KindeTokenVerificationError } from "./kinde-identity";

/**
 * Regression tests for the one distinction `getAuthenticatedContext` draws
 * inside token verification: EXPIRED is a signed-out state, everything else is
 * an incident.
 *
 * The bug these pin down shipped to production as its most frequent error
 * (digest 2293090557, 28 occurrences across 6 users in one weekend): a browser
 * that sat idle past the Kinde access token's lifetime still holds the session
 * cookie, `getAccessTokenRaw()` hands the stale token back without checking
 * it, and `verifyKindeAccessToken` threw `ERR_JWT_EXPIRED` straight through
 * the auth gate — so the person who did nothing but come back tomorrow got a
 * 500 instead of the sign-in screen.
 *
 * The boundary matters in both directions, so both directions are asserted:
 * an expired token quietly becoming "signed out" is correct, but a FORGED
 * token quietly becoming "signed out" would hide an attack in progress from
 * the logs. Only the one jose code may take the quiet path.
 *
 * The collaborators are mocked at their module boundaries — this suite is
 * about the decision in `getAuthenticatedContext`, not about JWKS mechanics
 * (which `verifyKindeAccessToken`'s own header documents) or the database.
 */

// `vi.hoisted` because `vi.mock` factories are hoisted above ordinary
// declarations — a plain `const` here would not exist yet when the factory runs.
const { getAccessTokenRaw, getUser, verifyKindeAccessToken, ensureUser, mintSupabaseAccessToken, rlsClient } =
  vi.hoisted(() => ({
    getAccessTokenRaw: vi.fn<() => Promise<string | null>>(),
    getUser: vi.fn(() => Promise.resolve(null)),
    verifyKindeAccessToken: vi.fn(),
    ensureUser: vi.fn(() => Promise.resolve("11111111-2222-3333-4444-555555555555")),
    mintSupabaseAccessToken: vi.fn(() => Promise.resolve("minted-token")),
    rlsClient: vi.fn(() => ({ marker: "rls-client" })),
  }));

vi.mock("@kinde-oss/kinde-auth-nextjs/server", () => ({
  getKindeServerSession: () => ({ getAccessTokenRaw, getUser }),
}));

vi.mock("@/server/auth/kinde-identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./kinde-identity")>();
  return { ...actual, verifyKindeAccessToken };
});

vi.mock("@/server/auth/ensure-user", () => ({ ensureUser }));

vi.mock("@/server/auth/supabase-token", () => ({ mintSupabaseAccessToken }));

vi.mock("@/server/supabase/rls-client", () => ({ rlsClient }));

// Imported AFTER the mocks are declared so the module under test binds to them.
const { getAuthenticatedContext } = await import("./current-user");

beforeEach(() => {
  getAccessTokenRaw.mockResolvedValue("a-raw-token-from-the-cookie");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getAuthenticatedContext — expired session vs. bad token", () => {
  it("treats an EXPIRED Kinde token as signed out, not as a server error", async () => {
    verifyKindeAccessToken.mockRejectedValue(
      new KindeTokenVerificationError("ERR_JWT_EXPIRED", { code: "ERR_JWT_EXPIRED" }),
    );

    await expect(getAuthenticatedContext()).resolves.toBeNull();

    // Fail-closed means NOTHING downstream ran: no users-row lookup, no minted
    // Supabase token, no client. Null must mean "you get nothing", not "you
    // get a guest session".
    expect(ensureUser).not.toHaveBeenCalled();
    expect(mintSupabaseAccessToken).not.toHaveBeenCalled();
    expect(rlsClient).not.toHaveBeenCalled();
  });

  it("still throws for every other verification failure — a forged token is an incident, not a sign-out", async () => {
    for (const code of [
      "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
      "ERR_JWT_CLAIM_VALIDATION_FAILED",
      "ERR_JWKS_NO_MATCHING_KEY",
    ]) {
      verifyKindeAccessToken.mockRejectedValue(new KindeTokenVerificationError(code, { code }));

      await expect(getAuthenticatedContext()).rejects.toThrow(KindeTokenVerificationError);
    }
  });

  it("still throws when the rejection carries no jose code at all (this module's own claim checks)", async () => {
    verifyKindeAccessToken.mockRejectedValue(
      new KindeTokenVerificationError("token has no `sub` claim"),
    );

    await expect(getAuthenticatedContext()).rejects.toThrow(KindeTokenVerificationError);
  });

  it("returns null when there is no token, exactly as before", async () => {
    getAccessTokenRaw.mockResolvedValue(null);

    await expect(getAuthenticatedContext()).resolves.toBeNull();
    expect(verifyKindeAccessToken).not.toHaveBeenCalled();
  });
});
