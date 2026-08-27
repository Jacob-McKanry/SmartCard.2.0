import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";

describe("parseCsv basics", () => {
  it("reads headers and rows", () => {
    const result = parseCsv("a,b\n1,2\n3,4");
    expect(result.headers).toEqual(["a", "b"]);
    expect(result.rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });

  it("returns headers and no rows for a header-only file", () => {
    expect(parseCsv("a,b\n")).toEqual({ headers: ["a", "b"], rows: [] });
  });
});

describe("parseCsv quoting, per RFC 4180", () => {
  it("keeps a comma inside a quoted field", () => {
    // Straight from the real Luma export: "Real Estate, Personal Injury..."
    const result = parseCsv('name,industry\nMatty,"Real Estate, Personal Injury"');
    expect(result.rows[0]).toEqual({ name: "Matty", industry: "Real Estate, Personal Injury" });
  });

  it("keeps a newline inside a quoted field", () => {
    const result = parseCsv('a,b\n"line one\nline two",x');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.a).toBe("line one\nline two");
  });

  it("turns a doubled quote into one quote", () => {
    const result = parseCsv('a\n"she said ""hi"""');
    expect(result.rows[0]?.a).toBe('she said "hi"');
  });

  it("handles a quoted empty field", () => {
    const result = parseCsv('a,b\n"",x');
    expect(result.rows[0]).toEqual({ a: "", b: "x" });
  });

  it("does not treat a quote in the middle of a bare field as quoting", () => {
    const result = parseCsv("a\n5\" tall");
    expect(result.rows[0]?.a).toBe('5" tall');
  });

  it("does not let one unbalanced quote swallow the rest of the file", () => {
    // The failure this guards against is not a garbled cell, it is a destroyed
    // import: if a mid-field quote opened quoting, every subsequent row would
    // be absorbed into one field and the host would import a single guest.
    const result = parseCsv('email,note\na@x.co,say "hi\nb@x.co,fine\nc@x.co,also fine');

    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.email)).toEqual(["a@x.co", "b@x.co", "c@x.co"]);
  });
});

describe("parseCsv line endings and stray bytes", () => {
  it("treats CRLF as one line ending, not two", () => {
    const result = parseCsv("a,b\r\n1,2\r\n3,4");
    expect(result.rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("handles a lone CR", () => {
    expect(parseCsv("a\r1\r2").rows).toEqual([{ a: "1" }, { a: "2" }]);
  });

  it("strips a UTF-8 BOM so the first header still matches", () => {
    // Escaped rather than pasted: a literal BOM in source is invisible, and
    // the point of the test is that this exact byte does not survive.
    const result = parseCsv("\uFEFFemail,name\na@x.co,Kim");
    expect(result.headers[0]).toBe("email");
    expect(result.rows[0]).toEqual({ email: "a@x.co", name: "Kim" });
  });

  it("ignores a trailing newline rather than emitting a blank row", () => {
    expect(parseCsv("a\n1\n").rows).toEqual([{ a: "1" }]);
  });

  it("skips entirely blank lines in the middle of a file", () => {
    expect(parseCsv("a\n1\n\n2\n").rows).toEqual([{ a: "1" }, { a: "2" }]);
  });
});

describe("parseCsv ragged rows", () => {
  it("fills missing trailing columns with empty strings", () => {
    const result = parseCsv("a,b,c\n1,2");
    expect(result.rows[0]).toEqual({ a: "1", b: "2", c: "" });
  });

  it("drops cells beyond the header row", () => {
    const result = parseCsv("a,b\n1,2,3,4");
    expect(result.rows[0]).toEqual({ a: "1", b: "2" });
  });

  it("skips a column with a blank header rather than keying on an empty string", () => {
    const result = parseCsv("a,,c\n1,2,3");
    expect(result.rows[0]).toEqual({ a: "1", c: "3" });
  });
});

describe("parseCsv does not touch values", () => {
  it("preserves internal and surrounding whitespace verbatim", () => {
    // Trimming belongs to attendee-import.ts, which knows which fields are
    // identifiers. Doing it here would change a value the preview then shows
    // as if it came from the file.
    const result = parseCsv("a,b\n  padded  ,  x  ");
    expect(result.rows[0]).toEqual({ a: "  padded  ", b: "  x  " });
  });

  it("trims header names only, since those are matched against patterns", () => {
    expect(parseCsv(" email , name \na@x.co,Kim").headers).toEqual(["email", "name"]);
  });
});

describe("parseCsv on a realistic Luma fragment", () => {
  const CSV = [
    "guest_id,name,first_name,last_name,email,approval_status,What company do you work for/with?,What is your LinkedIn?",
    'gst-1,Matty Moverz,Matty,Moverz,matt@moverzgroup.com,approved,"Matty Moverz LLC / Master of Visuals",https://www.linkedin.com/in/matthew',
    'gst-1,Matty Moverz,Matty,Moverz,matt@moverzgroup.com,approved,"Matty Moverz LLC / Master of Visuals",https://www.linkedin.com/in/matthew',
    "gst-2,Sulema Valencia,Sulema,Valencia,sulema@valora.com,declined,Valora Bookkeeping,",
    'gst-3,Marlah K,Marlah,K,hello@caviar.com,approved,"Caviar Med Spa ","Caviar Med Spa "',
  ].join("\n");

  it("reads every row and keeps the quoted company names intact", () => {
    const result = parseCsv(CSV);
    expect(result.rows).toHaveLength(4);
    expect(result.rows[0]?.["What company do you work for/with?"]).toBe(
      "Matty Moverz LLC / Master of Visuals",
    );
    expect(result.rows[3]?.["What company do you work for/with?"]).toBe("Caviar Med Spa ");
  });

  it("keeps the declined row present — dropping it is a later decision, not the parser's", () => {
    const result = parseCsv(CSV);
    expect(result.rows.map((r) => r.approval_status)).toEqual([
      "approved",
      "approved",
      "declined",
      "approved",
    ]);
  });

  it("leaves an empty trailing cell as an empty string", () => {
    expect(parseCsv(CSV).rows[2]?.["What is your LinkedIn?"]).toBe("");
  });
});
