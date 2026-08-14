import { describe, expect, it } from "vitest";

import { classifyFeedMeeting } from "./classify";

const VIEWER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const THIRD = "33333333-3333-3333-3333-333333333333";
const FOURTH = "44444444-4444-4444-4444-444444444444";

describe("classifyFeedMeeting", () => {
  it("is participant when the viewer is the first-listed participant", () => {
    expect(classifyFeedMeeting([VIEWER, OTHER], VIEWER)).toBe("participant");
  });

  it("is participant when the viewer is the second-listed participant — order must not matter", () => {
    expect(classifyFeedMeeting([OTHER, VIEWER], VIEWER)).toBe("participant");
  });

  it("is mutual when the viewer is neither participant", () => {
    expect(classifyFeedMeeting([THIRD, FOURTH], VIEWER)).toBe("mutual");
  });

  it("is null when there are fewer than two participants — a malformed row must not render either post type", () => {
    expect(classifyFeedMeeting([VIEWER], VIEWER)).toBeNull();
    expect(classifyFeedMeeting([], VIEWER)).toBeNull();
  });

  it("is null when there are more than two participants — meetings are pairwise by construction, so this is corruption, not a group meeting to render", () => {
    expect(classifyFeedMeeting([VIEWER, OTHER, THIRD], VIEWER)).toBeNull();
  });
});
