import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiContext, requireSameOrigin, updateOwnProfile, assertSignupCompleted } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  requireSameOrigin: vi.fn(),
  updateOwnProfile: vi.fn(),
  assertSignupCompleted: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext, requireSameOrigin };
});
vi.mock("@/server/profile/profile-service", () => ({ updateOwnProfile }));
vi.mock("@/server/onboarding/onboarding-service", () => ({ assertSignupCompleted }));

const { POST } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE };

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
  requireSameOrigin.mockReset();
  updateOwnProfile.mockResolvedValue(undefined);
  assertSignupCompleted.mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

it("writes the profile, then completes, in that order", async () => {
  const order: string[] = [];
  updateOwnProfile.mockImplementation(async () => {
    order.push("profile");
  });
  assertSignupCompleted.mockImplementation(async () => {
    order.push("flag");
  });

  const response = await POST(
    new Request("https://x/y", {
      method: "POST",
      body: JSON.stringify({ first_name: "Ada", bio: "Hi" }),
    }),
  );

  expect(response.status).toBe(200);
  expect(updateOwnProfile).toHaveBeenCalledWith(FAKE_SUPABASE, "u1", { first_name: "Ada", bio: "Hi" });
  expect(assertSignupCompleted).toHaveBeenCalledWith("u1");
  expect(order).toEqual(["profile", "flag"]);
});

it("accepts an empty body — every field is optional, and this still completes", async () => {
  const response = await POST(new Request("https://x/y", { method: "POST", body: "{}" }));

  expect(response.status).toBe(200);
  expect(updateOwnProfile).toHaveBeenCalledWith(FAKE_SUPABASE, "u1", {});
  expect(assertSignupCompleted).toHaveBeenCalled();
});

describe("the deliberately excluded fields", () => {
  it("400s a body naming username, which onboarding must not set", async () => {
    const response = await POST(
      new Request("https://x/y", { method: "POST", body: JSON.stringify({ username: "ada" }) }),
    );

    expect(response.status).toBe(400);
    expect(updateOwnProfile).not.toHaveBeenCalled();
  });

  it("400s a body naming photo_path", async () => {
    const response = await POST(
      new Request("https://x/y", { method: "POST", body: JSON.stringify({ photo_path: "u1/x.jpg" }) }),
    );

    expect(response.status).toBe(400);
    expect(updateOwnProfile).not.toHaveBeenCalled();
  });
});

it("does NOT complete onboarding if the profile write fails", async () => {
  updateOwnProfile.mockRejectedValue(new Error("permission denied for table users"));
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await POST(new Request("https://x/y", { method: "POST", body: "{}" }));

  expect(response.status).toBe(500);
  expect(assertSignupCompleted).not.toHaveBeenCalled();

  spy.mockRestore();
});

it("refuses a cross-site request before authenticating or writing anything", async () => {
  const { ApiHttpError } = await import("@/server/api/route-context");
  requireSameOrigin.mockImplementation(() => {
    throw new ApiHttpError(403, "That request wasn't valid.");
  });

  const response = await POST(new Request("https://x/y", { method: "POST", body: "{}" }));

  expect(response.status).toBe(403);
  expect(requireApiContext).not.toHaveBeenCalled();
  expect(updateOwnProfile).not.toHaveBeenCalled();
});
