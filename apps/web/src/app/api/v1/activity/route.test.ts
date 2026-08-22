import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { requireApiContext, listCardTapActivity, listCardPreviewActivity, listOwnAssignedCards } = vi.hoisted(
  () => ({
    requireApiContext: vi.fn(),
    listCardTapActivity: vi.fn(),
    listCardPreviewActivity: vi.fn(),
    listOwnAssignedCards: vi.fn(),
  }),
);

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext };
});
vi.mock("@/server/activity/activity-service", () => ({
  listCardTapActivity,
  listCardPreviewActivity,
  listOwnAssignedCards,
}));

const { GET } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue({ userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE });
});

afterEach(() => vi.clearAllMocks());

it("assembles all three lists the web activity page renders", async () => {
  listCardTapActivity.mockResolvedValue([{ sessionId: "s1" }]);
  listCardPreviewActivity.mockResolvedValue([{ id: 1 }]);
  listOwnAssignedCards.mockResolvedValue([{ id: "c1", card_code: "CUSTOM-abc" }]);

  const response = await GET(new Request("https://x/api/v1/activity"));
  const body = await response.json();

  expect(listCardTapActivity).toHaveBeenCalledWith(FAKE_SUPABASE, "u1");
  expect(listCardPreviewActivity).toHaveBeenCalledWith(FAKE_SUPABASE, "u1");
  expect(listOwnAssignedCards).toHaveBeenCalledWith(FAKE_SUPABASE, "u1");
  expect(body).toEqual({
    ok: true,
    taps: [{ sessionId: "s1" }],
    previews: [{ id: 1 }],
    cards: [{ id: "c1", card_code: "CUSTOM-abc" }],
  });
});
