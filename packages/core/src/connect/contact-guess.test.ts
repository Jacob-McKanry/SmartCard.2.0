import { describe, expect, it } from "vitest";

import { extractContactGuess } from "./contact-guess";

/**
 * `extractContactGuess` is shared by OCR (`apps/web/src/server/connect/card-ocr.ts`,
 * a real Tesseract worker over real image bytes, not exercised here), a
 * decoded badge QR/barcode payload, and a scanned NFC badge's text/URL
 * record. Only the pure text-in/guess-out function lives here and is worth
 * unit-testing — matching this codebase's established posture for
 * untestable I/O (see e.g. `barcode-decoder.ts`'s header on why
 * frame-decoding itself isn't unit-tested either).
 */
describe("extractContactGuess", () => {
  it("finds an email address anywhere in the text", () => {
    const guess = extractContactGuess("Jane Smith\nAcme Inc\njane.smith@acme.example\n555-0100");
    expect(guess.email).toBe("jane.smith@acme.example");
  });

  it("finds a phone number in a few common printed formats", () => {
    for (const text of ["(555) 010-0100", "555-010-0100", "+1 555 010 0100", "555.010.0100"]) {
      expect(extractContactGuess(text).phoneNumber).not.toBeNull();
    }
  });

  it("guesses a name from a line that looks like Firstname Lastname", () => {
    const guess = extractContactGuess("Acme Inc\nJane Smith\nVP of Sales\njane@acme.example");
    expect(guess.name).toBe("Jane Smith");
  });

  it("does not mistake an email or phone line for a name", () => {
    const guess = extractContactGuess("jane.smith@acme.example\n555-010-0100");
    expect(guess.name).toBeNull();
  });

  it("does not mistake a single word or a long company name for a person's name", () => {
    const guess = extractContactGuess("ACME\nAcme Global Logistics Solutions Group");
    expect(guess.name).toBeNull();
  });

  it("returns all nulls when nothing recognizable is present", () => {
    expect(extractContactGuess("")).toEqual({ email: null, phoneNumber: null, name: null });
    expect(extractContactGuess("qwerty asdf zxcv")).toEqual({
      email: null,
      phoneNumber: null,
      name: null,
    });
  });
});
