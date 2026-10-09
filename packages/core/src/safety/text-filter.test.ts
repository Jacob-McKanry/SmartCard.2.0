import { describe, expect, it } from "vitest";

import { containsBlockedTerm, normalizeForTextFilter, type BlockedTerm } from "./text-filter";

/**
 * This is the client-side hint only — see the module header. The tests here
 * exist to keep the hint from giving a false "looks fine" on the exact shapes
 * the SQL function (`private.text_violation`) is designed to catch, and a
 * false "flagged" on ordinary text, not to re-prove the SQL function's own
 * correctness.
 */
describe("normalizeForTextFilter", () => {
  it("lower-cases and collapses punctuation/whitespace runs to one space", () => {
    expect(normalizeForTextFilter("Kill-Yourself!!")).toBe("kill yourself");
    expect(normalizeForTextFilter("kill   yourself")).toBe("kill yourself");
  });

  it("trims leading and trailing non-alphanumeric runs", () => {
    expect(normalizeForTextFilter("  hello!  ")).toBe("hello");
  });
});

describe("containsBlockedTerm", () => {
  const terms: BlockedTerm[] = [
    { term: "kys", matchKind: "word" },
    { term: "kill yourself", matchKind: "word" },
    { term: "ass", matchKind: "substring" },
  ];

  it("matches a word-kind term as a whole word, punctuation and case aside", () => {
    expect(containsBlockedTerm("please just KYS already", terms)).toBe(true);
    expect(containsBlockedTerm("Kill-Yourself!!", terms)).toBe(true);
  });

  it("does not match a word-kind term inside a longer word", () => {
    // "kys" must not match e.g. "donkeys" — a loose-enough term is why
    // match_kind exists at all.
    expect(containsBlockedTerm("I have two donkeys", terms)).toBe(false);
  });

  it("matches a substring-kind term even inside a longer word", () => {
    expect(containsBlockedTerm("classy move", terms)).toBe(true);
  });

  it("returns false for ordinary text", () => {
    expect(containsBlockedTerm("this person was rude to me at the event", terms)).toBe(false);
  });

  it("returns false for empty text or an empty term list", () => {
    expect(containsBlockedTerm("", terms)).toBe(false);
    expect(containsBlockedTerm("kys", [])).toBe(false);
  });

  it("returns false for whitespace/punctuation-only text", () => {
    expect(containsBlockedTerm("   !!!   ", terms)).toBe(false);
  });
});
