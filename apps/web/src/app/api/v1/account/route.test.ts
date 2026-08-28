import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiContext, requireSameOrigin, softDeleteOwnAccount } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  requireSameOrigin: vi.fn(),
  softDeleteOwnAccount: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext, requireSameOrigin };
});
vi.mock("@/server/account/account-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/account/account-service")>();
  return { ...actual, softDeleteOwnAccount };
});

const { DELETE } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE };

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
  requireSameOrigin.mockReset();
});

afterEach(() => vi.clearAllMocks());

it("deletes through the caller's own client and logs the outcome, not the response", async () => {
  softDeleteOwnAccount.mockResolvedValue({
    alreadyDeleted: false,
    cardsRevoked: 2,
    eventsCancelled: 1,
    sessionsRevoked: 0,
  });
  const spy = vi.spyOn(console, "info").mockImplementation(() => {});

  const response = await DELETE(new Request("https://x/y", { method: "DELETE" }));
  const body = await response.json();

  expect(softDeleteOwnAccount).toHaveBeenCalledWith(FAKE_SUPABASE);
  expect(body).toEqual({ ok: true });
  expect(spy).toHaveBeenCalledWith(
    "[account] soft delete committed",
    expect.objectContaining({ userId: "u1", cardsRevoked: 2 }),
  );

  spy.mockRestore();
});

it("never reports success when the RPC refuses, and never invents a partial-success shape", async () => {
  const { AccountDeletionRefusedError } = await import("@/server/account/account-service");
  softDeleteOwnAccount.mockRejectedValue(new AccountDeletionRefusedError("account_not_active"));
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await DELETE(new Request("https://x/y", { method: "DELETE" }));

  expect(response.status).toBe(500);
  expect((await response.json()).ok).toBe(false);

  spy.mockRestore();
});

it("never reports success on a transport failure", async () => {
  softDeleteOwnAccount.mockRejectedValue(new Error("Failed to delete the account: connection reset"));
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await DELETE(new Request("https://x/y", { method: "DELETE" }));
  const body = await response.json();

  expect(response.status).toBe(500);
  expect(body.ok).toBe(false);
  expect(body.message).not.toMatch(/connection reset/);

  spy.mockRestore();
});

describe("cross-site refusal", () => {
  it("happens before authenticating or touching the account", async () => {
    const { ApiHttpError } = await import("@/server/api/route-context");
    requireSameOrigin.mockImplementation(() => {
      throw new ApiHttpError(403, "That request wasn't valid.");
    });

    const response = await DELETE(new Request("https://x/y", { method: "DELETE" }));

    expect(response.status).toBe(403);
    expect(requireApiContext).not.toHaveBeenCalled();
    expect(softDeleteOwnAccount).not.toHaveBeenCalled();
  });
});
