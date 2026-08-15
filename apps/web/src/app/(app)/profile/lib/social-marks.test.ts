import { describe, expect, it } from "vitest";

import { handleFromUrl, markFor } from "./social-marks";

/**
 * `social_links` has a URL and a free-text platform name and nothing else, so
 * both halves of a link tile are derived at render time. These tests pin the
 * derivations, particularly the ones that have to survive the malformed values
 * §6.4 records the legacy import writing into this column.
 */

describe("markFor", () => {
  it("matches regardless of case and punctuation", () => {
    expect(markFor("Instagram").name).toBe("Instagram");
    expect(markFor("instagram").name).toBe("Instagram");
    expect(markFor("  GitHub ").name).toBe("GitHub");
  });

  it("maps the old name of a renamed platform onto its current mark", () => {
    expect(markFor("Twitter").name).toBe("X");
    expect(markFor("X").name).toBe("X");
  });

  it("gives an unknown platform a neutral tile rather than a guessed mark", () => {
    const unknown = markFor("Bandcamp");
    expect(unknown.path).toBeNull();
    // Shown as typed — the app has no basis for correcting a name it does not
    // recognise.
    expect(unknown.name).toBe("Bandcamp");
  });
});

describe("handleFromUrl", () => {
  it("takes the last path segment", () => {
    expect(handleFromUrl("https://github.com/jacob-mckanry", false)).toBe("jacob-mckanry");
    expect(handleFromUrl("https://instagram.com/jacob", true)).toBe("@jacob");
  });

  it("does not double the @ when the URL already carries one", () => {
    expect(handleFromUrl("https://threads.net/@jacob", true)).toBe("@jacob");
  });

  it("ignores a trailing slash", () => {
    expect(handleFromUrl("https://instagram.com/jacob/", true)).toBe("@jacob");
  });

  it("falls back to the hostname for a bare domain", () => {
    expect(handleFromUrl("https://www.example.com", false)).toBe("example.com");
    expect(handleFromUrl("https://example.com/", false)).toBe("example.com");
  });

  it("survives the malformed values the legacy import left in this column", () => {
    // Not a URL at all: show what is stored rather than throwing mid-render and
    // taking the whole profile down.
    expect(handleFromUrl("not a url", false)).toBe("not a url");
    // A stray percent sign is what makes decodeURIComponent throw.
    expect(handleFromUrl("https://example.com/100%", false)).toBe("100%");
  });

  it("decodes an escaped segment", () => {
    expect(handleFromUrl("https://example.com/first%20last", false)).toBe("first last");
  });
});
