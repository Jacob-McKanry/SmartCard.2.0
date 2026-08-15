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
  it("emits exactly the six permitted properties and the three structural lines", () => {
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

  it("never emits PHOTO or URL, whatever it is given", () => {
    // The two properties the brief rules out. PHOTO would put private-bucket
    // bytes into a forwardable file; URL is how `social_links` would sneak in,
    // and 20260809211100 is explicit that exposing those makes a searchable
    // directory of off-platform handles.
    const vcard = buildVCard(SAM);
    expect(vcard).not.toMatch(/^PHOTO/m);
    expect(vcard).not.toMatch(/^URL/m);
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
