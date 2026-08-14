import { describe, expect, it } from "vitest";

import { chooseLabel } from "./geocode";

/**
 * §2.4's generalization rule: store a POI/venue name when Mapbox returns one
 * near the exact fix; otherwise fall back to a coarser neighborhood+city
 * label rather than anything street-level. `chooseLabel` is the only decision
 * in `geocode.ts` worth testing without a real HTTP call — everything else is
 * plumbing around a fetch.
 */

describe("chooseLabel", () => {
  it("prefers a POI name over a generalized label when both are present", () => {
    const label = chooseLabel([
      { text: "Blue Bottle Coffee", place_type: ["poi"] },
      { text: "Mission District", place_type: ["neighborhood"] },
      { text: "San Francisco", place_type: ["place"] },
    ]);
    expect(label).toBe("Blue Bottle Coffee");
  });

  it("falls back to neighborhood + city when there is no POI match", () => {
    const label = chooseLabel([
      { text: "Mission District", place_type: ["neighborhood"] },
      { text: "San Francisco", place_type: ["place"] },
    ]);
    expect(label).toBe("Mission District, San Francisco");
  });

  it("falls back to just the city when there is no neighborhood either", () => {
    const label = chooseLabel([{ text: "San Francisco", place_type: ["place"] }]);
    expect(label).toBe("San Francisco");
  });

  it("returns null rather than a street-level guess when nothing generalized is available", () => {
    expect(chooseLabel([])).toBeNull();
    // Even if the response somehow carried an address-level feature, this
    // function never asks Mapbox for `types=address` in the first place, and
    // it must not treat one as usable if it ever appeared.
    expect(chooseLabel([{ text: "123 Main St", place_type: ["address"] }])).toBeNull();
  });

  it("ignores a POI feature with no name rather than crashing", () => {
    const label = chooseLabel([
      { place_type: ["poi"] },
      { text: "San Francisco", place_type: ["place"] },
    ]);
    expect(label).toBe("San Francisco");
  });
});
