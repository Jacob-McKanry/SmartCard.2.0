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
    // Exactly six physical lines: BEGIN, VERSION, N, FN, NOTE, END.
    expect(vcard.split("\r\n").filter((line) => line !== "")).toHaveLength(6);
    expect(vcard).toContain("NOTE:First para.\\n\\nSecond para.");
  });
});

describe("field list", () => {
  it("emits exactly the seven text properties and the three structural lines when there is no photo", () => {
    const properties = buildVCard(SAM)
      .split("\r\n")
      .filter((line) => line !== "")
      .map((line) => line.split(/[;:]/)[0]);

    expect(properties).toEqual([
      "BEGIN",
      "VERSION",
      "N",
      "FN",
      "ORG",
      "TITLE",
      "NOTE",
      "TEL",
      "EMAIL",
      "END",
    ]);
  });

  it("emits no URL when there are no social links", () => {
    const vcard = buildVCard({ ...SAM, photo: PHOTO });
    expect(vcard).not.toMatch(/^URL/m);
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
 * THE STRUCTURED NAME. This block is the regression guard for the bug that
 * made every saved contact nameless: with no `N`, iOS Contacts has no person
 * name to file the card under, so it renders the card as an ORGANISATION and
 * shows `ORG` where the name belongs — reported as "the name saves as
 * 'SmartCard' for each person", because that owner's `company_name` is the
 * literal string "SmartCard".
 *
 * Measured on the live database at the time of the fix: of 315 active
 * cardholders, 135 would have imported showing their company, 180 with no
 * name at all, and 4 as the word "SmartCard".
 *
 * The property is mandatory in vCard 3.0 (RFC 2426 §3.1.2), so the first
 * test here is the one that must never go green by accident.
 */
describe("the structured name (N)", () => {
  function nLineOf(fields: Parameters<typeof buildVCard>[0]): string {
    const line = buildVCard(fields)
      .split("\r\n")
      .find((l) => l.startsWith("N:"));
    if (line === undefined) throw new Error("no N property in the vCard");
    return line;
  }

  it("is always present — its absence is the whole bug", () => {
    // Deliberately checked for the emptiest possible card as well as a full
    // one: N is required unconditionally, not "when we happen to have a name".
    expect(buildVCard(SAM)).toMatch(/^N:/m);
    expect(buildVCard(EMPTY)).toMatch(/^N:/m);
    expect(buildVCard({ ...EMPTY, companyName: "Northwind" })).toMatch(/^N:/m);
  });

  it("puts family and given names in the right slots, in that order", () => {
    // vCard 3.0 orders N as Family;Given;Additional;Prefixes;Suffixes.
    // Reversing the first two is the obvious mistake and would file everyone
    // under their first name.
    expect(nLineOf(SAM)).toBe("N:Rivera;Sam;;;");
  });

  it("always writes all four separators, even when every component is empty", () => {
    // A five-component property with components missing is malformed rather
    // than short, and a parser counting fields would mis-assign what it finds.
    expect(nLineOf(EMPTY)).toBe("N:;;;;");
  });

  it("keeps the slot empty rather than inventing a surname from the company", () => {
    // `vCardDisplayName` falls back to the company and then to a placeholder.
    // Neither is a NAME, and putting one in the family slot would assert that
    // "Northwind" is somebody's surname. The empty N plus ORG is exactly how
    // vCard represents an organisational contact.
    const orgOnly = { ...EMPTY, companyName: "Northwind" };
    expect(nLineOf(orgOnly)).toBe("N:;;;;");
    expect(buildVCard(orgOnly)).toContain("FN:Northwind");
    expect(buildVCard(orgOnly)).toContain("ORG:Northwind");
  });

  it("handles a first name alone and a last name alone, which the migrated data really contains", () => {
    expect(nLineOf({ ...EMPTY, firstName: "Sam" })).toBe("N:;Sam;;;");
    expect(nLineOf({ ...EMPTY, lastName: "Rivera" })).toBe("N:Rivera;;;;");
  });

  it("treats a whitespace-only name as absent, not as a name made of spaces", () => {
    expect(nLineOf({ ...EMPTY, firstName: "   ", lastName: "\t" })).toBe("N:;;;;");
  });

  it("escapes the values without escaping the structural separators", () => {
    // The separators must stay literal or the property collapses to fewer
    // components; the values must be escaped or a name can ADD components.
    // Both directions are wrong in a way that silently mis-imports.
    const line = nLineOf({ ...EMPTY, lastName: "Smith;Jones", firstName: "Sam,Jr" });
    expect(line).toBe("N:Smith\\;Jones;Sam\\,Jr;;;");
    // Still exactly five components once the escaped ones are discounted.
    expect(line.slice(2).replace(/\\./g, "").split(";")).toHaveLength(5);
  });

  it("cannot be used to inject another property through a newline", () => {
    const hostile = { ...EMPTY, lastName: "Evil\r\nEMAIL;TYPE=INTERNET:attacker@example.test" };
    const vcard = buildVCard(hostile);

    // The newline survives only as the two-character escape, so it never ends
    // the property.
    expect(nLineOf(hostile)).toContain("\\n");

    // The address DOES appear in the file — as escaped text inside N and FN,
    // which is the honest rendering of a name somebody typed. What must not
    // exist is a real LINE that a parser would read as a new property, so the
    // assertion is about the file's line structure rather than its substrings.
    // (Asserting `not.toContain("attacker@example.test")` would fail here for
    // a card that is perfectly safe, and asserting on a trailing CRLF fails
    // for the same reason: FN legitimately ends with that text.)
    const lines = vcard.split("\r\n");
    expect(lines.some((l) => l.startsWith("EMAIL"))).toBe(false);
    expect(lines.filter((l) => l.startsWith("N:"))).toHaveLength(1);
  });

  it("agrees with FN for an ordinary person, so the two never describe different people", () => {
    expect(nLineOf(SAM)).toBe("N:Rivera;Sam;;;");
    expect(buildVCard(SAM)).toContain("FN:Sam Rivera");
  });
});

/**
 * The URL properties, added 2026-08-28 — see the file header for the
 * reversal this records. `CardPreview.socialLinks` (`id`, `platform`, `url`)
 * is handed to `buildVCard` unchanged; only `url` is read.
 */
describe("the URL properties (social links)", () => {
  const LINKS = [
    { id: "1", platform: "instagram", url: "https://instagram.com/samrivera" },
    { id: "2", platform: "linkedin", url: "https://linkedin.com/in/samrivera" },
  ];

  it("emits one URL per link, in the order given", () => {
    const vcard = buildVCard({ ...SAM, socialLinks: LINKS });
    const urlLines = vcard.split("\r\n").filter((line) => line.startsWith("URL:"));
    expect(urlLines).toEqual([
      "URL:https://instagram.com/samrivera",
      "URL:https://linkedin.com/in/samrivera",
    ]);
  });

  it("sits between EMAIL and PHOTO, so a parser that stops at the first field it dislikes has already read every text property", () => {
    const properties = buildVCard({ ...SAM, socialLinks: LINKS, photo: PHOTO })
      .split("\r\n")
      .filter((line) => line !== "" && !line.startsWith(" "))
      .map((line) => line.split(/[;:]/)[0]);

    expect(properties).toEqual([
      "BEGIN",
      "VERSION",
      "N",
      "FN",
      "ORG",
      "TITLE",
      "NOTE",
      "TEL",
      "EMAIL",
      "URL",
      "URL",
      "PHOTO",
      "END",
    ]);
  });

  it("omits a link whose url is blank rather than emitting an empty URL", () => {
    const vcard = buildVCard({ ...SAM, socialLinks: [{ url: "   " }] });
    expect(vcard).not.toMatch(/^URL/m);
  });

  it("escapes a url the same way every other free-text field is escaped", () => {
    // A url is something a user typed into a link field, not a value this app
    // generated — it gets no less scrutiny than the bio does.
    const vcard = buildVCard({
      ...SAM,
      socialLinks: [{ url: "https://example.com/a;b,c\nd" }],
    });
    expect(vcard).toContain("URL:https://example.com/a\\;b\\,c\\nd");
  });

  it("treats absent, undefined and empty the same as no social links", () => {
    expect(buildVCard(SAM)).toBe(buildVCard({ ...SAM, socialLinks: undefined }));
    expect(buildVCard(SAM)).toBe(buildVCard({ ...SAM, socialLinks: [] }));
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
      "N",
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
