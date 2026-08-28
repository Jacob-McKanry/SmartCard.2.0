import { describe, expect, it } from "vitest";

import {
  IGNORE_COLUMN,
  classifyStatusValue,
  detectColumnMapping,
  normaliseImportRows,
  normaliseSocialHandle,
  summariseStatusValues,
} from "./attendee-import";

/**
 * The real header row from the Luma export supplied 2026-08-27
 * (`Private_Black_Tie_Networking_Mixer__Guests…csv`). Kept verbatim, including
 * the question-shaped custom columns, because the whole point of the mapping
 * layer is that a real file does not use tidy column names.
 */
const LUMA_HEADERS = [
  "guest_id", "name", "first_name", "last_name", "email", "phone_number",
  "created_at", "approval_status", "checked_in_at", "utm_source", "referrer",
  "referred_by", "qr_code_url", "amount", "amount_tax", "amount_discount",
  "currency", "coupon_code", "eth_address", "solana_address",
  "survey_response_rating", "survey_response_feedback", "ticket_type_id",
  "ticket_name", "What company do you work for/with?", "What is your job title?",
  "What industry do you work in?", "What are you looking to get out of this event?",
  "What is your Instagram username?", "What is your LinkedIn?",
];

describe("detectColumnMapping against a real Luma export", () => {
  const mapping = detectColumnMapping(LUMA_HEADERS);

  it("finds the fields that matter", () => {
    expect(mapping["email"]).toBe("email");
    expect(mapping["first_name"]).toBe("first_name");
    expect(mapping["last_name"]).toBe("last_name");
    expect(mapping["phone_number"]).toBe("phone_number");
    expect(mapping["approval_status"]).toBe("status");
  });

  it("reads the question-shaped custom columns", () => {
    expect(mapping["What company do you work for/with?"]).toBe("company_name");
    expect(mapping["What is your job title?"]).toBe("company_role");
    expect(mapping["What is your Instagram username?"]).toBe("instagram");
    expect(mapping["What is your LinkedIn?"]).toBe("linkedin");
  });

  it("ignores the columns that are none of our business", () => {
    for (const header of [
      "guest_id", "created_at", "qr_code_url", "amount", "currency",
      "eth_address", "solana_address", "ticket_name", "utm_source",
      "What are you looking to get out of this event?",
    ]) {
      expect(mapping[header]).toBe(IGNORE_COLUMN);
    }
  });

  it("does not mistake `name` for a first name — first_name already took it", () => {
    // `name` is the full-name column. Nothing maps to it, because first_name
    // and last_name are present and more specific.
    expect(mapping["name"]).toBe(IGNORE_COLUMN);
  });
});

describe("detectColumnMapping", () => {
  it("never assigns one field to two columns", () => {
    const mapping = detectColumnMapping(["Email", "email_address", "Guest Email"]);
    const emails = Object.values(mapping).filter((a) => a === "email");
    expect(emails).toHaveLength(1);
  });

  it("copes with other platforms' spellings", () => {
    const mapping = detectColumnMapping([
      "E-Mail", "Given Name", "Surname", "Mobile", "Order Status", "Organisation",
    ]);
    expect(mapping["E-Mail"]).toBe("email");
    expect(mapping["Given Name"]).toBe("first_name");
    expect(mapping["Surname"]).toBe("last_name");
    expect(mapping["Mobile"]).toBe("phone_number");
    expect(mapping["Order Status"]).toBe("status");
    expect(mapping["Organisation"]).toBe("company_name");
  });

  it("leaves an unrecognised column alone rather than guessing", () => {
    const mapping = detectColumnMapping(["Dietary requirements", "T-shirt size"]);
    expect(mapping["Dietary requirements"]).toBe(IGNORE_COLUMN);
    expect(mapping["T-shirt size"]).toBe(IGNORE_COLUMN);
  });
});

describe("classifyStatusValue", () => {
  it("treats the three values a real Luma file contains correctly", () => {
    expect(classifyStatusValue("approved")).toBe("approvedLike");
    expect(classifyStatusValue("declined")).toBe("excluded");
    expect(classifyStatusValue("invited")).toBe("excluded");
  });

  it("recognises other platforms' words for the same thing", () => {
    for (const yes of ["Going", "confirmed", "YES", "attending", "checked in", "accepted"]) {
      expect(classifyStatusValue(yes)).toBe("approvedLike");
    }
    for (const maybe of ["waitlist", "Wait-listed", "pending", "requested"]) {
      expect(classifyStatusValue(maybe)).toBe("waitlistLike");
    }
  });

  it("does NOT let `not_going` match `going`", () => {
    // Substring matching here would import everyone who declined.
    expect(classifyStatusValue("not_going")).toBe("excluded");
    expect(classifyStatusValue("not going")).toBe("excluded");
  });

  it("treats an absent status as approved — a plain list is a list of attendees", () => {
    expect(classifyStatusValue(null)).toBe("approvedLike");
    expect(classifyStatusValue("")).toBe("approvedLike");
    expect(classifyStatusValue("   ")).toBe("approvedLike");
  });

  it("fails closed on a status nobody has seen before", () => {
    expect(classifyStatusValue("refunded")).toBe("excluded");
    expect(classifyStatusValue("banned")).toBe("excluded");
  });
});

describe("summariseStatusValues", () => {
  it("reports each distinct value, its meaning and its count, commonest first", () => {
    const mapping = detectColumnMapping(["email", "approval_status"]);
    const rows = [
      { email: "a@x.co", approval_status: "approved" },
      { email: "b@x.co", approval_status: "approved" },
      { email: "c@x.co", approval_status: "declined" },
    ];

    expect(summariseStatusValues(rows, mapping)).toEqual([
      { value: "approved", classification: "approvedLike", count: 2 },
      { value: "declined", classification: "excluded", count: 1 },
    ]);
  });

  it("returns nothing when the file has no status column", () => {
    expect(summariseStatusValues([{ email: "a@x.co" }], detectColumnMapping(["email"]))).toEqual([]);
  });
});

describe("normaliseSocialHandle", () => {
  it("keeps a handle or a URL", () => {
    expect(normaliseSocialHandle("instagram", "@jacob")).toEqual({ platform: "instagram", url: "@jacob" });
    expect(normaliseSocialHandle("linkedin", "https://linkedin.com/in/x")).toEqual({
      platform: "linkedin",
      url: "https://linkedin.com/in/x",
    });
  });

  it("drops the non-answers a real file is full of", () => {
    // Every one of these appeared in the supplied export.
    for (const junk of ["N/A", "n/a", "None", "TBD", "don't use", "-"]) {
      expect(normaliseSocialHandle("linkedin", junk)).toBeNull();
    }
  });

  it("drops a sentence, because it will be shown back as the person's own link", () => {
    expect(normaliseSocialHandle("linkedin", "I'm currently banned :/")).toBeNull();
    expect(normaliseSocialHandle("linkedin", "Caviar Med Spa")).toBeNull();
  });

  it("drops empty and null", () => {
    expect(normaliseSocialHandle("instagram", "")).toBeNull();
    expect(normaliseSocialHandle("instagram", null)).toBeNull();
  });
});

describe("normaliseImportRows", () => {
  const mapping = detectColumnMapping([
    "email", "first_name", "last_name", "approval_status",
    "What company do you work for/with?", "What is your Instagram username?",
  ]);

  const row = (over: Record<string, string>) => ({
    email: "", first_name: "", last_name: "", approval_status: "approved",
    "What company do you work for/with?": "", "What is your Instagram username?": "",
    ...over,
  });

  it("imports approved rows and drops declined and invited ones", () => {
    const result = normaliseImportRows(
      [
        row({ email: "yes@x.co", approval_status: "approved" }),
        row({ email: "no@x.co", approval_status: "declined" }),
        row({ email: "never@x.co", approval_status: "invited" }),
      ],
      mapping,
    );

    expect(result.rows.map((r) => r.email)).toEqual(["yes@x.co"]);
    expect(result.skipped.excludedStatus).toBe(2);
  });

  it("excludes waitlisted by default and includes them when the host asks", () => {
    const rows = [
      row({ email: "a@x.co", approval_status: "approved" }),
      row({ email: "w@x.co", approval_status: "waitlist" }),
    ];

    expect(normaliseImportRows(rows, mapping).rows).toHaveLength(1);
    expect(normaliseImportRows(rows, mapping).skipped.waitlistNotIncluded).toBe(1);

    const withWaitlist = normaliseImportRows(rows, mapping, { includeWaitlisted: true });
    expect(withWaitlist.rows.map((r) => r.email).sort()).toEqual(["a@x.co", "w@x.co"]);
  });

  it("lets a host import ONLY the waitlist", () => {
    const result = normaliseImportRows(
      [
        row({ email: "a@x.co", approval_status: "approved" }),
        row({ email: "w@x.co", approval_status: "waitlist" }),
      ],
      mapping,
      { includeApproved: false, includeWaitlisted: true },
    );

    expect(result.rows.map((r) => r.email)).toEqual(["w@x.co"]);
    expect(result.skipped.approvedNotIncluded).toBe(1);
  });

  it("skips a row with no usable email", () => {
    const result = normaliseImportRows(
      [row({ email: "" }), row({ email: "not-an-email" }), row({ email: "ok@x.co" })],
      mapping,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.skipped.noEmail).toBe(2);
  });

  it("merges the several rows a real export gives one guest, keeping the first", () => {
    const result = normaliseImportRows(
      [
        row({ email: "Sarah@Acme.com", first_name: "Sarah", "What company do you work for/with?": "Acme" }),
        row({ email: "sarah@acme.com", first_name: "Sarah", last_name: "Chen" }),
      ],
      mapping,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.skipped.duplicate).toBe(1);
    // First occurrence wins on the address as typed, and its blanks get filled.
    expect(result.rows[0]).toMatchObject({
      email: "Sarah@Acme.com",
      first_name: "Sarah",
      last_name: "Chen",
      company_name: "Acme",
    });
  });

  it("does NOT let a later blank erase what the first row said", () => {
    const result = normaliseImportRows(
      [
        row({ email: "a@x.co", first_name: "Real", "What company do you work for/with?": "Acme" }),
        row({ email: "a@x.co", first_name: "", "What company do you work for/with?": "" }),
      ],
      mapping,
    );

    expect(result.rows[0]).toMatchObject({ first_name: "Real", company_name: "Acme" });
  });

  it("trims whitespace, which a real export has plenty of", () => {
    const result = normaliseImportRows(
      [row({ email: "  a@x.co  ", first_name: "  Kim  " })],
      mapping,
    );

    expect(result.rows[0]).toMatchObject({ email: "a@x.co", first_name: "Kim" });
  });

  it("keeps a usable social handle and drops the junk one", () => {
    const result = normaliseImportRows(
      [
        row({ email: "a@x.co", "What is your Instagram username?": "@kim" }),
        row({ email: "b@x.co", "What is your Instagram username?": "N/A" }),
      ],
      mapping,
    );

    expect(result.rows[0]?.social_links).toEqual([{ platform: "instagram", url: "@kim" }]);
    expect(result.rows[1]?.social_links).toEqual([]);
  });

  it("imports a file with no status column at all", () => {
    const plain = detectColumnMapping(["email", "first_name"]);
    const result = normaliseImportRows(
      [{ email: "a@x.co", first_name: "Kim" }, { email: "b@x.co", first_name: "Jo" }],
      plain,
    );

    expect(result.rows).toHaveLength(2);
    expect(result.skipped.excludedStatus).toBe(0);
  });

  it("accounts for every input row exactly once", () => {
    const rows = [
      row({ email: "a@x.co", approval_status: "approved" }),
      row({ email: "b@x.co", approval_status: "declined" }),
      row({ email: "c@x.co", approval_status: "waitlist" }),
      row({ email: "", approval_status: "approved" }),
      row({ email: "a@x.co", approval_status: "approved" }),
    ];

    const result = normaliseImportRows(rows, mapping);
    const totalSkipped = Object.values(result.skipped).reduce((a, b) => a + b, 0);

    expect(result.rows.length + totalSkipped).toBe(rows.length);
  });
});
