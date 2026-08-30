import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { UserFacingError } from "@/server/errors";

import {
  adminListHostApplications,
  decideHostApplication,
  getOwnHostApplication,
  isAdmin,
  submitHostApplication,
} from "./host-application-service";

/**
 * THE HOST-APPLICATION SERVICE, TESTED AS THE TRANSLATION LAYER IT IS.
 *
 * As with the CSV import's own service tests, the interesting half of this
 * feature is not in this file. Whether the caller may apply, whether they
 * are an admin, and whether a decision id is real are all decided inside
 * `submit_host_application`, `admin_list_host_applications` and
 * `decide_host_application` themselves (20260827120000, 20260830120000) —
 * verified against the live database in rolled-back transactions before
 * being applied. A Vitest run has no database and a mock that "checked" a
 * gate would only be checking the mock.
 */

interface RpcCall {
  fn: string;
  args: unknown;
}

function fakeRpcClient(answer: {
  data?: unknown;
  error?: { code?: string; message: string };
}): { client: SupabaseClient; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const client = {
    async rpc(fn: string, args?: unknown) {
      calls.push({ fn, args });
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

// ---------------------------------------------------------------------------
// submitHostApplication
// ---------------------------------------------------------------------------

describe("submitHostApplication", () => {
  it("sends the five named parameters, nulling absent optional fields", async () => {
    const { client, calls } = fakeRpcClient({ data: null });

    await submitHostApplication(client, {
      organizationName: "Acme",
      applicantRole: "Founder",
      pastEventLink: "https://luma.com/e",
    });

    expect(calls).toEqual([
      {
        fn: "submit_host_application",
        args: {
          p_organization_name: "Acme",
          p_applicant_role: "Founder",
          p_past_event_link: "https://luma.com/e",
          p_expected_event_size: null,
          p_hosting_frequency: null,
        },
      },
    ]);
  });

  it("passes the optional fields through when present", async () => {
    const { client, calls } = fakeRpcClient({ data: null });

    await submitHostApplication(client, {
      organizationName: "Acme",
      applicantRole: "Founder",
      pastEventLink: "https://luma.com/e",
      expectedEventSize: "40-60",
      hostingFrequency: "monthly",
    });

    expect((calls[0]?.args as { p_expected_event_size: string }).p_expected_event_size).toBe(
      "40-60",
    );
  });

  it("turns 42501 into a signed-in-required sentence", async () => {
    const { client } = fakeRpcClient({ error: { code: "42501", message: "not authenticated" } });

    const error = await submitHostApplication(client, {
      organizationName: "A",
      applicantRole: "B",
      pastEventLink: "C",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toMatch(/signed in/i);
  });

  it("turns 22023 into a required-fields sentence, not the database's own words", async () => {
    const { client } = fakeRpcClient({
      error: { code: "22023", message: "organization, role and a past event link are all required" },
    });

    const error = await submitHostApplication(client, {
      organizationName: "A",
      applicantRole: "B",
      pastEventLink: "C",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UserFacingError);
  });

  it("gives an unrecognised refusal the generic sentence", async () => {
    const { client } = fakeRpcClient({
      error: { code: "55000", message: 'relation "public.host_applications" broke' },
    });

    const error = await submitHostApplication(client, {
      organizationName: "A",
      applicantRole: "B",
      pastEventLink: "C",
    }).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(UserFacingError);
  });
});

// ---------------------------------------------------------------------------
// getOwnHostApplication
// ---------------------------------------------------------------------------

describe("getOwnHostApplication", () => {
  function fakeSelectClient(answer: { data?: unknown; error?: { message: string } }): SupabaseClient {
    return {
      from() {
        return {
          select() {
            return {
              async maybeSingle() {
                return { data: answer.data ?? null, error: answer.error ?? null };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;
  }

  const ROW = {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    organization_name: "Acme",
    applicant_role: "Founder",
    past_event_link: "https://luma.com/e",
    expected_event_size: null,
    hosting_frequency: null,
    status: "pending",
    submitted_at: "2026-08-30T00:00:00.000Z",
    decided_at: null,
    decided_by_user_id: null,
    rejection_note: null,
  };

  it("returns null when the caller has never applied", async () => {
    const client = fakeSelectClient({ data: null });
    await expect(getOwnHostApplication(client)).resolves.toBeNull();
  });

  it("returns the parsed row when one exists", async () => {
    const client = fakeSelectClient({ data: ROW });
    await expect(getOwnHostApplication(client)).resolves.toEqual(ROW);
  });

  it("throws rather than returning null on a database error — never masks a real failure as 'never applied'", async () => {
    const client = fakeSelectClient({ error: { message: "connection reset" } });
    await expect(getOwnHostApplication(client)).rejects.toThrow(/Failed to load/);
  });

  it("throws on a response that is not the expected shape", async () => {
    const client = fakeSelectClient({ data: { organization_name: "Acme" } });
    await expect(getOwnHostApplication(client)).rejects.toThrow(/unexpected shape/);
  });
});

// ---------------------------------------------------------------------------
// isAdmin — for drawing a screen, never for deciding one
// ---------------------------------------------------------------------------

describe("isAdmin", () => {
  it("returns true only for an explicit true", async () => {
    const { client } = fakeRpcClient({ data: true });
    await expect(isAdmin(client)).resolves.toBe(true);
  });

  it("fails closed to false on any error", async () => {
    const { client } = fakeRpcClient({ error: { message: "down" } });
    await expect(isAdmin(client)).resolves.toBe(false);
  });

  it("fails closed to false on an unexpected data shape", async () => {
    const { client } = fakeRpcClient({ data: "yes" });
    await expect(isAdmin(client)).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// adminListHostApplications — fails closed to [], mirroring the RPC
// ---------------------------------------------------------------------------

describe("adminListHostApplications", () => {
  it("sends the requested status filter", async () => {
    const { client, calls } = fakeRpcClient({ data: [] });
    await adminListHostApplications(client, "approved");
    expect(calls).toEqual([{ fn: "admin_list_host_applications", args: { p_status: "approved" } }]);
  });

  it("defaults to pending", async () => {
    const { client, calls } = fakeRpcClient({ data: [] });
    await adminListHostApplications(client);
    expect((calls[0]?.args as { p_status: string }).p_status).toBe("pending");
  });

  it("parses a real row, including the joined name/photo fields", async () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      user_id: "22222222-2222-4222-8222-222222222222",
      first_name: "Kim",
      last_name: "Alvarez",
      photo_path: "22222222-2222-4222-8222-222222222222/photo.jpg",
      organization_name: "Acme",
      applicant_role: "Founder",
      past_event_link: "https://luma.com/e",
      expected_event_size: null,
      hosting_frequency: null,
      status: "pending",
      submitted_at: "2026-08-30T00:00:00.000Z",
      decided_at: null,
      rejection_note: null,
    };
    const { client } = fakeRpcClient({ data: [row] });

    await expect(adminListHostApplications(client)).resolves.toEqual([row]);
  });

  it("fails closed to an empty array on a transport error, matching the RPC's own non-admin shape", async () => {
    const { client } = fakeRpcClient({ error: { message: "down" } });
    await expect(adminListHostApplications(client)).resolves.toEqual([]);
  });

  it("fails closed to an empty array on an unexpected shape", async () => {
    const { client } = fakeRpcClient({ data: { not: "an array" } });
    await expect(adminListHostApplications(client)).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// decideHostApplication
// ---------------------------------------------------------------------------

describe("decideHostApplication", () => {
  it("sends approve with no note", async () => {
    const { client, calls } = fakeRpcClient({ data: null });
    await decideHostApplication(client, "app-1", true);
    expect(calls).toEqual([
      {
        fn: "decide_host_application",
        args: { p_application_id: "app-1", p_approve: true, p_rejection_note: null },
      },
    ]);
  });

  it("sends reject with the note", async () => {
    const { client, calls } = fakeRpcClient({ data: null });
    await decideHostApplication(client, "app-1", false, "no past event link");
    expect((calls[0]?.args as { p_rejection_note: string }).p_rejection_note).toBe(
      "no past event link",
    );
  });

  it("keeps 42501 merged across not-admin and unknown-id, per the RPC's own §3.6 posture", async () => {
    const { client } = fakeRpcClient({ error: { code: "42501", message: "not authorized" } });

    const error = await decideHostApplication(client, "app-1", true).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toMatch(/active admin account and a real application id/);
  });

  it("gives an unrecognised refusal the generic sentence", async () => {
    const { client } = fakeRpcClient({ error: { code: "55000", message: "internal detail" } });
    const error = await decideHostApplication(client, "app-1", true).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(UserFacingError);
  });
});
