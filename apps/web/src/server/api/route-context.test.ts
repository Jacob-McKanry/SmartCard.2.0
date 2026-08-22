import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserFacingError } from "@/server/errors";

/**
 * The shared plumbing every `/api/v1/*` route stands on. Three properties
 * matter more than the rest, because a regression in any of them is a
 * security bug wearing the costume of a refactor:
 *
 *  1. The same-origin check runs, and runs BEFORE authentication is even
 *     attempted — matching `connect/route-helpers.ts`'s ordering for the
 *     identical reason: a forged cross-site request carries a real session,
 *     so checking who is signed in first proves nothing about who asked.
 *  2. A database error never reaches the response verbatim. Only
 *     `ApiHttpError`, `ZodError` and `UserFacingError` may cross; everything
 *     else collapses to one generic sentence, mirroring `errors.ts`'s rule
 *     for Server Actions.
 *  3. Auth failure status codes are preserved end to end (401 vs 503) so a
 *     mobile client can tell "sign in again" from "retry in a moment" —
 *     `api-context.ts` already tests where the split is decided; this suite
 *     tests that `requireApiContext` does not flatten it on the way out.
 */

const { getApiAuthenticatedContext, checkSameOrigin } = vi.hoisted(() => ({
  getApiAuthenticatedContext: vi.fn(),
  checkSameOrigin: vi.fn(() => ({ ok: true }) as { ok: true } | { ok: false; reason: string }),
}));

vi.mock("@/server/auth/api-context", () => ({ getApiAuthenticatedContext }));
vi.mock("@/server/connect/same-origin", () => ({ checkSameOrigin }));

const {
  ApiHttpError,
  apiErrorResponse,
  readJsonBody,
  requireApiContext,
  requireSameOrigin,
} = await import("./route-context");

const fakeContext = { userId: "u1", kindeUserId: "k1", supabase: {} as never };

beforeEach(() => {
  vi.clearAllMocks();
  checkSameOrigin.mockReturnValue({ ok: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("requireSameOrigin", () => {
  it("passes silently when the origin check approves", () => {
    checkSameOrigin.mockReturnValue({ ok: true });
    expect(() => requireSameOrigin(new Request("https://smartcard.tech/api/v1/profile"))).not.toThrow();
  });

  it("throws a 403 ApiHttpError, never a bare Error, on refusal", () => {
    checkSameOrigin.mockReturnValue({ ok: false, reason: "cross_site_fetch" });

    expect(() => requireSameOrigin(new Request("https://smartcard.tech/api/v1/profile"))).toThrow(
      ApiHttpError,
    );
    try {
      requireSameOrigin(new Request("https://smartcard.tech/api/v1/profile"));
    } catch (error) {
      expect(error).toBeInstanceOf(ApiHttpError);
      expect((error as InstanceType<typeof ApiHttpError>).status).toBe(403);
      // Refuses reasonlessly to the caller, same as the connect routes — the
      // specific reason is for the server log, never the response.
      expect((error as Error).message).not.toContain("cross_site_fetch");
    }
  });
});

describe("requireApiContext", () => {
  it("returns the context on success", async () => {
    getApiAuthenticatedContext.mockResolvedValue({ ok: true, context: fakeContext });

    await expect(requireApiContext(new Request("https://x/y"))).resolves.toBe(fakeContext);
  });

  it("throws 401 as an ApiHttpError, not a bare rejection", async () => {
    getApiAuthenticatedContext.mockResolvedValue({ ok: false, status: 401 });

    await expect(requireApiContext(new Request("https://x/y"))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("preserves 503 rather than collapsing every failure to 401", async () => {
    getApiAuthenticatedContext.mockResolvedValue({ ok: false, status: 503 });

    await expect(requireApiContext(new Request("https://x/y"))).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe("readJsonBody", () => {
  it("returns {} for an empty body, so an all-optional route needs no special case", async () => {
    await expect(readJsonBody(new Request("https://x/y", { method: "POST", body: "" }))).resolves.toEqual(
      {},
    );
  });

  it("parses a real JSON body", async () => {
    await expect(
      readJsonBody(new Request("https://x/y", { method: "POST", body: '{"a":1}' })),
    ).resolves.toEqual({ a: 1 });
  });

  it("400s malformed JSON as an ApiHttpError rather than an uncaught SyntaxError", async () => {
    await expect(
      readJsonBody(new Request("https://x/y", { method: "POST", body: "{not json" })),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("apiErrorResponse — what may and may not reach the caller", () => {
  it("passes an ApiHttpError's own status and message through", async () => {
    const response = apiErrorResponse(new ApiHttpError(403, "That request wasn't valid."), "t");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, message: "That request wasn't valid." });
  });

  it("passes a UserFacingError's message through as a 400", async () => {
    const response = apiErrorResponse(new UserFacingError("You may not do that."), "t");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, message: "You may not do that." });
  });

  it("renders a ZodError as its own first issue, not the generic sentence", async () => {
    const schema = z.object({ username: z.string().max(3, "Too long.") });
    const result = schema.safeParse({ username: "way too long" });
    expect(result.success).toBe(false);

    const response = apiErrorResponse(result.error, "t");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, message: "Too long." });
  });

  /**
   * The one that matters most. A service function's plain `Error` wraps a
   * PostgREST message that can name a table, a column or a constraint
   * (`errors.ts`'s own header gives real examples) — none of it may reach an
   * HTTP response.
   */
  it("collapses an ordinary Error to the generic sentence, and logs the real one", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = apiErrorResponse(
      new Error('new row violates row-level security policy for table "cards"'),
      "GET /api/v1/profile",
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.message).not.toMatch(/row-level security|table|cards/i);
    expect(spy).toHaveBeenCalledWith(
      "[api] unhandled error in GET /api/v1/profile",
      expect.objectContaining({ error: expect.stringContaining("row-level security") }),
    );

    spy.mockRestore();
  });

  it("collapses a non-Error throw the same way, without crashing on it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = apiErrorResponse("a bare string throw", "t");

    expect(response.status).toBe(500);
    spy.mockRestore();
  });
});
