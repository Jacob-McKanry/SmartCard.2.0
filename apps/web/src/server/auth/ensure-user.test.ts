import { describe, expect, it, vi } from "vitest";

import type { KindeIdentity } from "./kinde-identity";

/**
 * `ensureUser()`'s placeholder-claim step (2026-09-26,
 * docs/architecture/2026-09-26-unverified-connections.md): a real signup
 * whose email matches a `status = 'placeholder'` row (created earlier by
 * `create_manual_connection` when someone scanned/typed them in as a
 * connection before they ever had an account) claims that row IN PLACE via
 * `claim_placeholder_user` (20260926140000) rather than inserting a second
 * one.
 *
 * What this suite asserts, at the TypeScript layer: the CONTROL FLOW — which
 * query runs, in what order, with what values, and which branch a given
 * response drives. Whether the RPC itself behaves as the fakes assume (the
 * atomic lock, the coalesce semantics, the partial index on `kinde_user_id`)
 * is `20260926120000`/`20260926140000`'s own job, verified live in a
 * rolled-back transaction per those migrations' headers — a Vitest run has
 * no database, so a mock that "checks" that would only be checking itself.
 */

const { serviceRoleClient } = vi.hoisted(() => ({ serviceRoleClient: vi.fn() }));
vi.mock("@/server/supabase/service-role-client", () => ({ serviceRoleClient }));

const {
  ensureUser,
  EmailAlreadyBoundToAnotherIdentityError,
  MissingEmailClaimError,
  UserNotActiveError,
} = await import("./ensure-user");

function identity(overrides: Partial<KindeIdentity> = {}): KindeIdentity {
  return {
    kindeUserId: "kinde|new-user",
    email: "new@example.com",
    emailVerified: true,
    firstName: "Jamie",
    lastName: "Rivera",
    ...overrides,
  };
}

interface UserRow {
  id: string;
  status: string;
}
type FromAnswer =
  | { data: UserRow | null; error: null }
  | { data: null; error: { code?: string; message: string } };
type RpcAnswer =
  | { data: { claimed: boolean; id?: string; status?: string } | null; error: null }
  | { data: null; error: { message: string } };

/**
 * Drives the exact call sequence `ensureUser()` makes, one step per
 * `.from("users")` or `.rpc("claim_placeholder_user")` call, in order.
 */
function fakeUsersClient(
  steps: Array<
    | { op: "findByKinde"; answer: FromAnswer }
    | { op: "claimRpc"; answer: RpcAnswer; captureArgs?: (args: unknown) => void }
    | { op: "insert"; answer: FromAnswer; captureInsert?: (row: unknown) => void }
  >,
) {
  let i = 0;
  const opsSeen: string[] = [];
  const nextStep = (op: string) => {
    const step = steps[i];
    i += 1;
    if (!step) throw new Error(`fakeUsersClient: no step configured for call #${i} (${op})`);
    opsSeen.push(step.op);
    return step;
  };

  const client = {
    from: vi.fn(() => {
      const step = nextStep("from");
      if (step.op === "findByKinde") {
        // .select("id, status").eq("kinde_user_id", x).maybeSingle()
        return { select: () => ({ eq: () => ({ maybeSingle: async () => step.answer }) }) };
      }
      if (step.op === "insert") {
        // .insert({...}).select(...).single()
        return {
          insert: (row: unknown) => {
            step.captureInsert?.(row);
            return { select: () => ({ single: async () => step.answer }) };
          },
        };
      }
      throw new Error(`fakeUsersClient: unexpected .from() call for step ${step.op}`);
    }),
    rpc: vi.fn(async (_fn: string, args: unknown) => {
      const step = nextStep("rpc");
      if (step.op !== "claimRpc") {
        throw new Error(`fakeUsersClient: unexpected .rpc() call for step ${step.op}`);
      }
      step.captureArgs?.(args);
      return step.answer;
    }),
  };
  return { client, opsSeen };
}

describe("ensureUser — existing kinde_user_id (unchanged fast path)", () => {
  it("returns the existing row's id without touching placeholders or inserting", async () => {
    const { client, opsSeen } = fakeUsersClient([
      { op: "findByKinde", answer: { data: { id: "u1", status: "active" }, error: null } },
    ]);
    serviceRoleClient.mockReturnValue(client);

    await expect(ensureUser(identity())).resolves.toBe("u1");
    expect(opsSeen).toEqual(["findByKinde"]);
  });

  it("rejects a non-active existing account", async () => {
    const { client } = fakeUsersClient([
      { op: "findByKinde", answer: { data: { id: "u1", status: "suspended" }, error: null } },
    ]);
    serviceRoleClient.mockReturnValue(client);

    await expect(ensureUser(identity())).rejects.toThrow(UserNotActiveError);
  });
});

describe("ensureUser — no email claim at all", () => {
  it("throws MissingEmailClaimError before ever attempting a placeholder claim", async () => {
    const { client, opsSeen } = fakeUsersClient([
      { op: "findByKinde", answer: { data: null, error: null } },
    ]);
    serviceRoleClient.mockReturnValue(client);

    await expect(ensureUser(identity({ email: null }))).rejects.toThrow(MissingEmailClaimError);
    // Only the kinde_user_id lookup ran — the claim RPC never fires for an
    // identity with no email to claim a placeholder by.
    expect(opsSeen).toEqual(["findByKinde"]);
  });
});

describe("ensureUser — claiming a placeholder created by create_manual_connection", () => {
  it("claims the placeholder via claim_placeholder_user, passing the identity's own fields", async () => {
    let rpcArgs: unknown;
    const { client, opsSeen } = fakeUsersClient([
      { op: "findByKinde", answer: { data: null, error: null } },
      {
        op: "claimRpc",
        answer: { data: { claimed: true, id: "placeholder-1", status: "active" }, error: null },
        captureArgs: (args) => {
          rpcArgs = args;
        },
      },
    ]);
    serviceRoleClient.mockReturnValue(client);

    await expect(ensureUser(identity())).resolves.toBe("placeholder-1");
    expect(opsSeen).toEqual(["findByKinde", "claimRpc"]);
    expect(rpcArgs).toEqual({
      p_email: "new@example.com",
      p_kinde_user_id: "kinde|new-user",
      p_email_verified: true,
      p_first_name: "Jamie",
      p_last_name: "Rivera",
    });
  });

  it("rejects if the RPC somehow claims into a non-active status", async () => {
    const { client } = fakeUsersClient([
      { op: "findByKinde", answer: { data: null, error: null } },
      {
        op: "claimRpc",
        answer: { data: { claimed: true, id: "placeholder-1", status: "suspended" }, error: null },
      },
    ]);
    serviceRoleClient.mockReturnValue(client);

    await expect(ensureUser(identity())).rejects.toThrow(UserNotActiveError);
  });

  it("does not insert a second row when a placeholder was claimed", async () => {
    const { client, opsSeen } = fakeUsersClient([
      { op: "findByKinde", answer: { data: null, error: null } },
      {
        op: "claimRpc",
        answer: { data: { claimed: true, id: "placeholder-3", status: "active" }, error: null },
      },
    ]);
    serviceRoleClient.mockReturnValue(client);

    await ensureUser(identity());
    expect(opsSeen).not.toContain("insert");
  });

  it("throws if the RPC transport itself fails, rather than silently falling through to insert", async () => {
    const { client, opsSeen } = fakeUsersClient([
      { op: "findByKinde", answer: { data: null, error: null } },
      { op: "claimRpc", answer: { data: null, error: { message: "db unavailable" } } },
    ]);
    serviceRoleClient.mockReturnValue(client);

    await expect(ensureUser(identity())).rejects.toThrow(/Failed to claim placeholder/);
    expect(opsSeen).toEqual(["findByKinde", "claimRpc"]);
  });
});

describe("ensureUser — brand-new signup, no placeholder to claim", () => {
  it("falls through to the ordinary insert path unchanged", async () => {
    const { client, opsSeen } = fakeUsersClient([
      { op: "findByKinde", answer: { data: null, error: null } },
      { op: "claimRpc", answer: { data: { claimed: false }, error: null } },
      { op: "insert", answer: { data: { id: "brand-new", status: "active" }, error: null } },
    ]);
    serviceRoleClient.mockReturnValue(client);

    await expect(ensureUser(identity())).resolves.toBe("brand-new");
    expect(opsSeen).toEqual(["findByKinde", "claimRpc", "insert"]);
  });

  it("still surfaces EmailAlreadyBoundToAnotherIdentityError on a real (non-placeholder) email collision", async () => {
    const { client } = fakeUsersClient([
      { op: "findByKinde", answer: { data: null, error: null } },
      { op: "claimRpc", answer: { data: { claimed: false }, error: null } },
      { op: "insert", answer: { data: null, error: { code: "23505", message: "duplicate" } } },
      // The unique-violation race check re-looks-up by kinde_user_id and
      // still finds nothing — so this really is a different identity's email.
      { op: "findByKinde", answer: { data: null, error: null } },
    ]);
    serviceRoleClient.mockReturnValue(client);

    await expect(ensureUser(identity())).rejects.toThrow(EmailAlreadyBoundToAnotherIdentityError);
  });
});
