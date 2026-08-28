import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `removeConnectionAction`, tested as the rule that regressed: EVERY page
 * that renders a connection count has to be told the write happened, or
 * Next's Router Cache keeps serving whatever count it last rendered —
 * indefinitely, since nothing else revalidates it. Reported 2026-08-28: a
 * removed connection kept counting on `/profile`'s ring and on Home's "N
 * connections" line, because `removeConnectionAction` only ever revalidated
 * `/connections` and the connection's own detail page. The write itself was
 * always correct (`status` really did flip); this pins the read side.
 *
 * `next/cache`, `@/server/auth/current-user` and
 * `@/server/connections/connections-service` are mocked because this action
 * is a `"use server"` module whose real imports reach Kinde and a live
 * Supabase client — this test is about which paths get told to revalidate,
 * not about re-proving the RLS transition `connections-service.test.ts`
 * (if one exists) or the migration's own verification already covers.
 */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const getAuthenticatedContext = vi.fn();
vi.mock("@/server/auth/current-user", () => ({ getAuthenticatedContext }));

const removeConnection = vi.fn();
vi.mock("@/server/connections/connections-service", () => ({
  removeConnection,
  setMeetingLocationVisibility: vi.fn(),
  setOwnParticipantFlags: vi.fn(),
}));

describe("removeConnectionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revalidates every page that renders a connection count, not just the ones the user was looking at", async () => {
    getAuthenticatedContext.mockResolvedValue({ supabase: {}, userId: "u1" });
    removeConnection.mockResolvedValue(undefined);

    const { removeConnectionAction } = await import("./actions");
    await removeConnectionAction("conn-1");

    const revalidated = revalidatePath.mock.calls.map((call) => call[0]);
    expect(revalidated).toContain("/connections");
    expect(revalidated).toContain("/connections/conn-1");
    // The two that regressed: the profile ring and Home's connection line
    // both read the exact same `listOwnConnections` query this write
    // affects, and neither is reachable from `/connections` itself.
    expect(revalidated).toContain("/profile");
    expect(revalidated).toContain("/");
  });

  it("never revalidates before the write actually lands", async () => {
    getAuthenticatedContext.mockResolvedValue({ supabase: {}, userId: "u1" });
    let removedBeforeRevalidate = false;
    removeConnection.mockImplementation(async () => {
      removedBeforeRevalidate = revalidatePath.mock.calls.length === 0;
    });

    const { removeConnectionAction } = await import("./actions");
    await removeConnectionAction("conn-1");

    expect(removedBeforeRevalidate).toBe(true);
  });
});
