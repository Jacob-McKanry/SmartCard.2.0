import { describe, expect, it } from "vitest";

import {
  buildVCard,
  escapeVCardValue,
  vCardDisplayName,
  vCardFileName,
  vCardRefusalResponse,
  vCardResponse,
} from "./vcard";

/**
 * The vCard is the one artefact of the non-user preview that leaves the browser
 * as a file somebody keeps, so the two things worth testing hard are what it
 * contains (exactly the six properties, never a seventh) and whether hostile
 * or merely awkward field values can break out of it.
 */

const EMPTY = {
  firstName: null,
  lastName: null,
  companyName: null,
  companyRole: null,
  bio: null,
  phoneNumber: null,
  email: null,
};

const SAM = {
  firstName: "Sam",
  lastName: "Rivera",
  companyName: "Northwind",
  companyRole: "Head of Partnerships",
  bio: "Coffee, cycling, and long conversations about supply chains.",
  phoneNumber: "+1 415 555 0132",
  email: "sam@northwind.example",
};

/** A short, valid embedded image — the WebP magic bytes, base64'd. */
const PHOTO = { vCardType: "WEBP", base64: Buffer.from("RIFF....WEBP").toString("base64") };

describe("escaping", () => {
  it("escapes the backslash first, so later escapes are not double-escaped", () => {
    // `a\;b` must become `a\\\;b`: one escaped backslash, then one escaped
    // semicolon. Getting the order wrong yields `a\\\\;b` — a literal backslash
    // followed by an UNESCAPED separator, which changes how many values a
    // parser sees.
    expect(escapeVCardValue("a\\;b")).toBe("a\\\\\\;b");
  });

  it("escapes the three separator characters vCard reserves", () => {
    expect(escapeVCardValue("Smith; John, Jr")).toBe("Smith\\; John\\, Jr");
  });

  it("turns real newlines into the two-character sequence, so a bio cannot end a property early", () => {
    expect(escapeVCardValue("line one\nline two")).toBe("line one\\nline two");
    expect(escapeVCardValue("crlf\r\nhere")).toBe("crlf\\nhere");
    expect(escapeVCardValue("bare cr\rhere")).toBe("bare cr\\nhere");
  });

  it("a bio containing a raw newline does not truncate the file", () => {
    const vcard = buildVCard({ ...EMPTY, firstName: "Sam", bio: "First para.\n\nSecond para." });
    // Exactly five physical lines: BEGIN, VERSION, FN, NOTE, END.
    expect(vcard.split("\r\n").filter((line) => line !== "")).toHaveLength(5);
    expect(vcard).toContain("NOTE:First para.\\n\\nSecond para.");
  });
});

describe("field list", () => {
  it("emits exactly the six text properties and the three structural lines when there is no photo", () => {
    const properties = buildVCard(SAM)
      .split("\r\n")
      .filter((line) => line !== "")
      .map((line) => line.split(/[;:]/)[0]);

    expect(properties).toEqual([
      "BEGIN",
      "VERSION",
      "FN",
      "ORG",
      "TITLE",
      "NOTE",
      "TEL",
      "EMAIL",
      "END",
    ]);
  });

  it("never emits URL, whatever it is given", () => {
    // `social_links` does reach this feature now, and the preview page renders
    // it as tiles — but the FILE still carries no links. `vcard.ts`'s header
    // states the invariant this protects and it is one-directional: the file
    // may say less than the page, never more. So this assertion stays, with a
    // different reason behind it than the one it was written for.
    const vcard = buildVCard({ ...SAM, photo: PHOTO });
    expect(vcard).not.toMatch(/^URL/m);
    expect(vcard).not.toContain("instagram");
  });

  it("emits no PHOTO when there is no photo, and the file is still valid without one", () => {
    const vcard = buildVCard(SAM);
    expect(vcard).not.toMatch(/^PHOTO/m);
    expect(vcard.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
    expect(vcard.endsWith("END:VCARD\r\n")).toBe(true);
  });

  it("omits a property rather than emitting an empty one", () => {
    const vcard = buildVCard({ ...EMPTY, firstName: "Sam", companyName: "   ", email: "" });
    expect(vcard).not.toContain("ORG:");
    expect(vcard).not.toContain("EMAIL");
  });

  it("uses CRLF and terminates the final line", () => {
    expect(buildVCard(SAM).endsWith("END:VCARD\r\n")).toBe(true);
    expect(buildVCard(SAM)).not.toMatch(/[^\r]\n/);
  });
});

/**
 * The embedded photo, added 2026-08-15.
 *
 * The interesting cases are not "does it appear" — they are the two ways an
 * embedded binary breaks a text format: a value that terminates its own
 * property, and a line long enough that parsers stop agreeing about it.
 */
describe("the embedded PHOTO property", () => {
  it("emits PHOTO last, base64-encoded, with the type it was given", () => {
    const properties = buildVCard({ ...SAM, photo: PHOTO })
      .split("\r\n")
      .filter((line) => line !== "" && !line.startsWith(" "))
      .map((line) => line.split(/[;:]/)[0]);

    // Immediately before END, so a parser that gives up on a property it does
    // not understand has already read every text field.
    expect(properties).toEqual([
      "BEGIN",
      "VERSION",
      "FN",
      "ORG",
      "TITLE",
      "NOTE",
      "TEL",
      "EMAIL",
      "PHOTO",
      "END",
    ]);
    expect(buildVCard({ ...SAM, photo: PHOTO })).toContain(
      `PHOTO;ENCODING=b;TYPE=WEBP:${PHOTO.base64}`,
    );
  });

  it("survives a round trip: unfolding the file returns the exact bytes", () => {
    // The test that would actually catch a folding off-by-one. A continuation
    // line carries 74 payload characters, not 75, because the leading space is
    // structure — get that wrong and the base64 decodes to a different image or
    // to nothing, silently.
    const base64 = Buffer.from(
      Uint8Array.from({ length: 4096 }, (_, i) => (i * 7 + 13) % 256),
    ).toString("base64");
    const vcard = buildVCard({ ...SAM, photo: { vCardType: "WEBP", base64 } });

    const unfolded = vcard.replace(/\r\n /g, "");
    const line = unfolded.split("\r\n").find((l) => l.startsWith("PHOTO"));
    expect(line).toBe(`PHOTO;ENCODING=b;TYPE=WEBP:${base64}`);
    expect(Buffer.from(line!.split(":")[1]!, "base64").byteLength).toBe(4096);
  });

  it("folds at 75 octets, and every continuation is a single leading space", () => {
    const base64 = Buffer.alloc(2048, 7).toString("base64");
    const lines = buildVCard({ ...SAM, photo: { vCardType: "WEBP", base64 } }).split("\r\n");

    const photoStart = lines.findIndex((line) => line.startsWith("PHOTO"));
    const photoLines = [lines[photoStart]!];
    for (let i = photoStart + 1; i < lines.length && lines[i]!.startsWith(" "); i++) {
      photoLines.push(lines[i]!);
    }

    expect(photoLines.length).toBeGreaterThan(1);
    for (const line of photoLines) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
    for (const line of photoLines.slice(1)) {
      expect(line.startsWith(" ")).toBe(true);
      expect(line.startsWith("  ")).toBe(false);
    }
  });

  it("refuses a photo whose value could break out of its own property", () => {
    // The whole reason `usablePhoto` validates rather than trusts. A CRLF in
    // the value would end the PHOTO property and let whatever follows be parsed
    // as new vCard properties — an injection into the file's structure.
    const hostile = [
      { vCardType: "WEBP", base64: "AAAA\r\nEMAIL;TYPE=INTERNET:attacker@example.test" },
      { vCardType: "WEBP\r\nX-EVIL", base64: "AAAA" },
      { vCardType: "WEBP", base64: "AA AA" },
      { vCardType: "WEBP", base64: "" },
      { vCardType: "", base64: "AAAA" },
    ];

    for (const photo of hostile) {
      const vcard = buildVCard({ ...SAM, photo });
      expect(vcard).not.toMatch(/^PHOTO/m);
      expect(vcard).not.toContain("attacker@example.test");
      expect(vcard).not.toContain("X-EVIL");
      // Still a well-formed card — a rejected photo omits one property, it does
      // not produce a broken file.
      expect(vcard.endsWith("END:VCARD\r\n")).toBe(true);
    }
  });

  it("treats an absent, null and undefined photo as the same file", () => {
    // `photo` is optional so that every caller and fixture predating it keeps
    // meaning "no photo" — this pins that the three spellings agree.
    expect(buildVCard(SAM)).toBe(buildVCard({ ...SAM, photo: null }));
    expect(buildVCard(SAM)).toBe(buildVCard({ ...SAM, photo: undefined }));
  });

  it("still serves the file over HTTP with the same headers", () => {
    const response = vCardResponse({ ...SAM, photo: PHOTO });
    expect(response.headers.get("content-type")).toBe("text/vcard; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Sam-Rivera.vcf"',
    );
  });
});

describe("the display name fallback chain", () => {
  it("prefers the full name", () => {
    expect(vCardDisplayName(SAM)).toBe("Sam Rivera");
  });

  it("accepts a first name alone, which the migrated data really contains", () => {
    expect(vCardDisplayName({ ...EMPTY, firstName: "Sam" })).toBe("Sam");
    expect(vCardDisplayName({ ...EMPTY, lastName: "Rivera" })).toBe("Rivera");
  });

  it("falls back to the company before giving up", () => {
    expect(vCardDisplayName({ ...EMPTY, companyName: "Northwind" })).toBe("Northwind");
  });

  it("never falls back to the email address", () => {
    // Deliberate: it would put the address in a second place in the file and
    // read as a bug to whoever imported it.
    expect(vCardDisplayName({ ...EMPTY, email: "sam@northwind.example" })).toBe(
      "SmartCard contact",
    );
  });
});

describe("the Content-Disposition filename", () => {
  it("reduces a name to a safe alphabet", () => {
    expect(vCardFileName(SAM)).toBe("Sam-Rivera.vcf");
  });

  it("cannot carry a quote, a newline or a header separator out of a user-controlled name", () => {
    // This is the actual reason the function exists: `first_name` is free text
    // a user controls and it is interpolated into an HTTP response header.
    const injected = vCardFileName({
      ...EMPTY,
      firstName: 'evil"\r\nSet-Cookie: a=b',
    });
    expect(injected).not.toMatch(/["\r\n:;]/);
    expect(injected.endsWith(".vcf")).toBe(true);
  });

  it("still produces a usable name when nothing survives the filter", () => {
    expect(vCardFileName({ ...EMPTY, firstName: "。。。" })).toBe("smartcard-contact.vcf");
  });
});

describe("the two HTTP responses", () => {
  it("serves the file as text/vcard, as an attachment, and never cached", () => {
    const response = vCardResponse(SAM);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/vcard; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Sam-Rivera.vcf"',
    );
    // A cached copy would keep answering after the owner revoked the card,
    // which is the one thing their kill switch exists to stop.
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });

  it("refuses with one fixed response that carries no reason", async () => {
    const a = vCardRefusalResponse();
    const b = vCardRefusalResponse();
    expect(a.status).toBe(404);
    expect(await a.text()).toBe(await b.text());
    expect([...a.headers.entries()].sort()).toEqual([...b.headers.entries()].sort());
  });
});
