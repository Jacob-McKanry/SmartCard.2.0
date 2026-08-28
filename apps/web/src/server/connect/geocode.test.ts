import { describe, expect, it } from "vitest";

import { chooseCity, chooseLabel } from "./geocode";

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

/**
 * `chooseCity`, added 2026-08-28 for `meeting_locations.city_label` and
 * `DESIGN.md` §3's cities band.
 *
 * The rule that matters is that this is NOT a substring of `chooseLabel`'s
 * answer. The first test below is the whole reason the column exists: at a
 * venue, `chooseLabel` returns a bare POI name with no city in it at all, so
 * any attempt to parse a city back out of it would yield nothing precisely
 * for the venues the feature is most wanted for.
 */
describe("chooseCity", () => {
  it("returns the city even when the label is a bare venue name with no city in it", () => {
    const features = [
      { text: "Moscone Center", place_type: ["poi"] },
      { text: "San Francisco", place_type: ["place"] },
    ];
    expect(chooseLabel(features)).toBe("Moscone Center");
    expect(chooseCity(features)).toBe("San Francisco");
  });

  it("returns the city rather than the neighborhood when both are present", () => {
    // `chooseLabel`'s fallback is "Mission District, San Francisco"; counting
    // distinct values of THAT would count neighbourhoods as cities.
    const features = [
      { text: "Mission District", place_type: ["neighborhood"] },
      { text: "San Francisco", place_type: ["place"] },
    ];
    expect(chooseCity(features)).toBe("San Francisco");
  });

  it("never accepts a region or a country as a city", () => {
    // Three meetings in three parts of one state must not read as three
    // cities. `place` is Mapbox's own type for a city or town; nothing
    // coarser is a city.
    expect(
      chooseCity([
        { text: "California", place_type: ["region"] },
        { text: "United States", place_type: ["country"] },
      ]),
    ).toBeNull();
  });

  it("returns null rather than an empty or whitespace-only name", () => {
    // An empty string would be counted by `count(distinct)` as a city of its
    // own, which is the one wrong answer this column must never produce.
    expect(chooseCity([])).toBeNull();
    expect(chooseCity([{ place_type: ["place"] }])).toBeNull();
    expect(chooseCity([{ text: "   ", place_type: ["place"] }])).toBeNull();
  });
});
