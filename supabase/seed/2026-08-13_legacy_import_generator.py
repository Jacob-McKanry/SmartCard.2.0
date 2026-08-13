#!/usr/bin/env python3
"""
Generator for the 2026-08-13 one-time legacy import.

Reads the legacy Postgres COPY dump (`core-data-export.sql`) and emits batched
SQL chunk files that are then executed against Supabase, plus the expected
content checksums used to prove the load was byte-faithful.

READ 2026-08-13_legacy_import.sql FIRST. That file documents *why* each
transformation is what it is — the judgement calls, the rows deliberately
skipped, the values deliberately left alone. This file is the executable
version of those rules; the reasoning lives there, not here.

WHY THIS SCRIPT IS IN THE REPO BUT THE DATA IS NOT
    The dump contains real personal data (337 people's emails, phone numbers and
    bios, 1,813 captured contact records, and legacy bcrypt password hashes).
    None of that may be committed. This script contains transformation logic
    only — zero rows, zero personal data — so it can be reviewed, argued with,
    and re-run against the export if the import ever has to be reproduced or
    audited. Point SRC at a local copy of the export to run it.

OUTPUT DISCIPLINE
    Everything this script prints is an aggregate, a byte count, or a legacy
    integer id. It never prints a row, a field value, or anything that could
    reconstruct a person's record. That constraint is why the skip/normalise
    reports below name rows by *id and reason* rather than showing the offending
    value: a reviewer can look it up in the source if they need to, but running
    this script does not spray contact data into a terminal or a log.

    `loginpassword` is never read, never written, never printed. It is not in
    any emitted statement and not in any checksum.

USAGE
    python3 2026-08-13_legacy_import_generator.py
        -> ./chunks/*.sql, ./uuid_map.json, ./expected_checksums.json,
           ./photo_paths.csv
"""

import re
import os
import csv
import json
import uuid
import hashlib
import datetime
import collections

HERE = os.path.dirname(os.path.abspath(__file__))

# Point this at a local copy of the legacy export. Never commit the export.
SRC = os.environ.get("LEGACY_EXPORT", os.path.join(HERE, "core-data-export.sql"))
# Directory holding the extracted legacy profile photos, if present. Only used
# to record file presence in the reference CSV — nothing is uploaded.
PHOTO_BASE = os.environ.get("LEGACY_PHOTO_DIR", os.path.join(HERE, "profile-photos"))

OUT = os.path.join(HERE, "chunks")


# ---------------------------------------------------------------------------
# Parsing the COPY dump
# ---------------------------------------------------------------------------

def unescape(v):
    r"""Postgres COPY text-format unescaping. `\N` is SQL NULL.

    Written out rather than reached for via a library because getting this
    subtly wrong is silent: a mishandled `\n` inside a bio produces a row that
    inserts cleanly and is simply *different* from the source. The checksum step
    at the bottom exists to catch exactly that class of error.
    """
    if v == r"\N":
        return None
    mapping = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\",
               "b": "\b", "f": "\f", "v": "\v"}
    out, i = [], 0
    while i < len(v):
        c = v[i]
        if c == "\\" and i + 1 < len(v):
            n = v[i + 1]
            out.append(mapping.get(n, n))
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def load():
    """Returns {table_name: {"cols": [...], "rows": [{col: value}, ...]}}."""
    tables = {}
    with open(SRC, encoding="utf-8") as f:
        lines = f.read().split("\n")
    i = 0
    while i < len(lines):
        m = re.match(r"^COPY public\.(\w+) \(([^)]*)\) FROM stdin;$", lines[i])
        if m:
            name = m.group(1)
            cols = [c.strip() for c in m.group(2).split(",")]
            rows = []
            i += 1
            while lines[i] != r"\.":
                parts = lines[i].split("\t")
                # A field-count mismatch means an embedded newline was
                # mis-split. Fail loudly here rather than import a shifted row.
                assert len(parts) == len(cols), \
                    f"{name} line {i + 1}: {len(parts)} fields vs {len(cols)} cols"
                rows.append({c: unescape(p) for c, p in zip(cols, parts)})
                i += 1
            tables[name] = {"cols": cols, "rows": rows}
        i += 1
    return tables


t = load()
U = t["users"]["rows"]
C = t["card"]["rows"]
S = t["sociallink"]["rows"]
X = t["contactexchange"]["rows"]

assert (len(U), len(C), len(S), len(X)) == (337, 7142, 466, 1813), \
    "export row counts do not match the signed-off migration plan (§6)"


# ---------------------------------------------------------------------------
# Deterministic UUID assignment
# ---------------------------------------------------------------------------
# Random per row (uuid4), per §6.2. Deliberately NOT derived from the legacy id:
# a derivable UUID would leak the legacy id — and therefore signup order — into
# every public identifier.
#
# Generated once and frozen to uuid_map.json so that every downstream artifact
# (cards, social_links, the photo CSV) references the same UUID, and so a re-run
# of this generator cannot silently produce a second, conflicting set.
MAPF = os.path.join(HERE, "uuid_map.json")
if os.path.exists(MAPF):
    umap = json.load(open(MAPF))
else:
    umap = {r["id"]: str(uuid.uuid4()) for r in U}
    json.dump(umap, open(MAPF, "w"), indent=0)
assert len(umap) == 337 and len(set(umap.values())) == 337


def q(v):
    """SQL literal. None -> NULL. Empty string is preserved as ''."""
    if v is None:
        return "null"
    return "'" + v.replace("\\", "\\\\").replace("'", "''") + "'"


def qn(v):
    """Nullable text where '' and NULL mean the same thing -> NULL."""
    if v is None or v == "":
        return "null"
    return q(v)


def qb(v):
    return "true" if v == "t" else "false"


# ---------------------------------------------------------------------------
# users
# ---------------------------------------------------------------------------
# userstatus: the export contains exactly one distinct value ('1') across all
# 337 rows -> 'active'. The assert is the point: if a future export introduces a
# second value, this fails instead of quietly mapping it to 'active'. Nothing is
# ever inferred into 'suspended'/'deleted', both of which remove access.
STATUS_MAP = {"1": "active"}
assert set(r["userstatus"] for r in U) == {"1"}, \
    "unexpected userstatus value — do not guess a mapping, see §6.2"

user_rows = []
for r in U:
    user_rows.append("(" + ",".join([
        r["id"],
        q(r["kindeuserid"]),
        q(r["emailaddress"]),
        qn(r["firstname"]), qn(r["lastname"]), qn(r["username"]),
        qn(r["phonenumber"]), qn(r["personalbio"]),
        qn(r["companyname"]), qn(r["companyrole"]),
        q(STATUS_MAP[r["userstatus"]]),
        qb(r["isadminuser"]), qb(r["isemailverified"]),
        qb(r["hascompletedsignup"]), qb(r["emailoptin"]),
        q(r["createddatetime"]), q(r["updateddatetime"]),
    ]) + ")")

# `photo_path` is absent from the column list on purpose: it stays NULL for
# every row in this pass (see 2026-08-13_legacy_photo_paths.csv).
#
# `users` resolves its own id through the map, exactly like every other table.
# That is what makes it impossible for users.id and the map to disagree, so
# cards and social_links cannot point at a user id that was never inserted.
USERS_HEADER = """insert into public.users (
  id, kinde_user_id, email, first_name, last_name, username, phone_number, bio,
  company_name, company_role, status, is_admin, email_verified,
  has_completed_signup, email_opt_in, legacy_user_id, created_at, updated_at)
select m.new_user_id, v.kinde, v.email::extensions.citext, v.fname, v.lname,
       v.uname::extensions.citext, v.phone, v.bio, v.cname, v.crole, v.status,
       v.is_admin, v.email_verified, v.signup, v.opt_in,
       v.legacy_id, v.created::timestamptz, v.updated::timestamptz
from (values"""
USERS_FOOTER = """
) as v(legacy_id, kinde, email, fname, lname, uname, phone, bio, cname, crole,
       status, is_admin, email_verified, signup, opt_in, created, updated)
join legacy_staging.user_id_map m on m.legacy_user_id = v.legacy_id"""


# ---------------------------------------------------------------------------
# cards
# ---------------------------------------------------------------------------
CARD_STATUS = {"0": "unassigned", "1": "assigned"}
assert set(r["cardstatus"] for r in C) == {"0", "1"}

# The 0/1 -> unassigned/assigned mapping is NOT taken on faith from the column
# name. It is verified against the data: cardstatus = '1' iff ownerid is set,
# for all 7,142 rows. That is also a proof the import cannot violate the
# `cards_assigned_requires_owner` CHECK.
for r in C:
    assert (r["cardstatus"] == "1") == (r["ownerid"] is not None), \
        f"legacy card id {r['id']}: cardstatus and ownerid disagree"

# card_code is copied unchanged (§2.2 / Q1: the 48-bit hex suffix IS the card
# secret, and regenerating would invalidate physical inventory). Re-verify the
# property that decision rested on before relying on it.
suffixes = [r["cardid"].rsplit("-", 1)[-1] for r in C]
assert all(re.fullmatch(r"[0-9a-f]{12}", s) for s in suffixes), \
    "a card code suffix is not 12 hex chars — §2.2's security claim does not hold"
assert len(set(suffixes)) == len(C), "card code suffixes are not unique"

assigned = [r for r in C if r["cardstatus"] == "1"]
unassigned = [r for r in C if r["cardstatus"] == "0"]
assert len(assigned) == 333 and len(unassigned) == 6809

assigned_rows = ["(" + ",".join([
    q(r["cardid"]), r["ownerid"],
    q(r["assigneddatetime"]), q(r["createddatetime"]), r["id"]]) + ")"
    for r in assigned]

ASSIGNED_HEADER = """insert into public.cards
  (card_code, status, owner_user_id, assigned_at, created_at, legacy_card_id)
select v.code, 'assigned', m.new_user_id,
       v.assigned::timestamptz, v.created::timestamptz, v.legacy_id
from (values"""
ASSIGNED_FOOTER = """
) as v(code, owner_legacy_id, assigned, created, legacy_id)
join legacy_staging.user_id_map m on m.legacy_user_id = v.owner_legacy_id"""

# Unassigned: `status` takes its 'unassigned' default and owner_user_id /
# assigned_at are NULL for all 6,809 rows, so they are omitted from the column
# list rather than emitted 6,809 times as literals. No user reference, so no
# join is needed either.
unassigned_rows = ["(" + ",".join([q(r["cardid"]), q(r["createddatetime"]), r["id"]]) + ")"
                   for r in unassigned]


# ---------------------------------------------------------------------------
# social_links — URL normalisation and the `-infinity` sentinel
# ---------------------------------------------------------------------------

def normalise_url(raw):
    """Returns (url, action, reason). See §6.4 and the seed script's STEP 3.

    - Already a single well-formed http(s) URL with no whitespace -> take as is,
      with the scheme lowercased. URI schemes are case-insensitive (RFC 3986
      §3.1) and lowercase is the specified normal form, so `Https://` ->
      `https://` cannot change which resource is addressed.
    - Contains whitespace, and exactly ONE http(s) token -> take that token.
      Whitespace terminates a URL in every parser, so the trailing words were
      never part of the link; nothing that was ever part of it is discarded.
    - Contains whitespace and MORE THAN ONE http(s) token -> ambiguous free
      text. Skipped rather than guessed at: picking one would publish a link to
      a real person's account on a coin flip, and a wrong link looks correct
      while pointing strangers at somebody else.

    `http://` is deliberately NOT upgraded to `https://`. That would change
    which resource is requested on the strength of an assumption about a remote
    host we do not control — a guess, not a normalisation.
    """
    def lower_scheme(x):
        return re.sub(r"^(https?)://",
                      lambda m: m.group(1).lower() + "://", x, flags=re.I)

    s = raw.strip()
    if re.fullmatch(r"https?://\S+", s, re.I):
        out = lower_scheme(s)
        if out == raw:
            return out, "import", "clean"
        return out, "normalised", ("scheme lowercased" if s == raw else "trimmed")

    toks = [lower_scheme(x) for x in re.findall(r"https?://\S+", s, re.I)]
    if len(toks) == 1 and re.fullmatch(r"https?://[^/\s]+\.[^/\s]+(/\S*)?", toks[0]):
        return toks[0], "normalised", "stray trailing text after a single valid URL"
    return None, "skip", \
        f"{len(toks)} http(s) tokens in free text; no unambiguous profile URL"


link_rows, skipped_links, normalised_links = [], [], []
inf_fixed = 0
for r in S:
    url, action, reason = normalise_url(r["url"])
    if action == "skip":
        skipped_links.append((r["id"], r["userid"], r["platform"], reason))
        continue
    if action == "normalised":
        normalised_links.append((r["id"], r["platform"], reason))

    # `-infinity` is a Postgres sentinel, not a time. It survives the column
    # type but breaks JS `Date` parsing and cannot be rendered, so it would
    # surface as a client-side crash on a profile page. created_at is the only
    # defensible substitute: the row demonstrably existed then.
    #
    # The 132 ordinary rows where updated < created are NOT touched. Those are
    # real timestamps that merely look odd, and rewriting them would destroy
    # true data to satisfy an expectation.
    upd = r["updateddatetime"]
    if upd == "-infinity":
        upd = r["createddatetime"]
        inf_fixed += 1

    link_rows.append("(" + ",".join([
        r["userid"], q(r["platform"]), q(url), r["displayorder"],
        q(r["createddatetime"]), q(upd)]) + ")")

LINKS_HEADER = """insert into public.social_links
  (user_id, platform, url, display_order, created_at, updated_at)
select m.new_user_id, v.platform, v.url, v.display_order,
       v.created::timestamptz, v.updated::timestamptz
from (values"""
LINKS_FOOTER = """
) as v(user_legacy_id, platform, url, display_order, created, updated)
join legacy_staging.user_id_map m on m.legacy_user_id = v.user_legacy_id"""

# Exact duplicate (user, platform, url) rows are imported faithfully rather than
# de-duplicated: there is no unique constraint on that triple, so the legacy
# state is representable, and silently dropping rows during a migration hides
# data the owner may want to clean up deliberately.
dupe_links = sum(v - 1 for v in collections.Counter(
    (r["userid"], r["platform"], r["url"]) for r in S).values() if v > 1)


# ---------------------------------------------------------------------------
# legacy.contactexchange — faithful mirror, no transformation at all
# ---------------------------------------------------------------------------
# NOT mapped into connections/meetings (§6.7). Legacy integer user ids are
# preserved verbatim with no UUID remapping and no FK, and empty-string notes
# stay empty strings rather than collapsing to NULL as they do for `users` —
# here the goal is to record exactly what the old system stored.
cx_rows = ["(" + ",".join([
    r["id"], r["cardownerid"], r["senderuserid"] or "null",
    q(r["sendername"]), q(r["senderemail"]), q(r["senderphone"]), q(r["notes"]),
    q(r["createddatetime"])]) + ")" for r in X]


# ---------------------------------------------------------------------------
# Emit chunk files
# ---------------------------------------------------------------------------
# Chunked rather than emitted as one enormous statement so that an interrupted
# run leaves visible, verifiable partial progress in the database instead of an
# all-or-nothing unknown.

def emit(name, header, rows, per, footer=""):
    n = 0
    for i in range(0, len(rows), per):
        n += 1
        body = header + "\n" + ",\n".join(rows[i:i + per]) + footer + ";\n"
        open(os.path.join(OUT, f"{name}_{n:02d}.sql"), "w").write(body)
    return n


os.makedirs(OUT, exist_ok=True)

stage_rows = [f"({k},'{v}')" for k, v in sorted(umap.items(), key=lambda kv: int(kv[0]))]

nb = {}
nb["stage"] = emit(
    "stage",
    "insert into legacy_staging.user_id_map (legacy_user_id, new_user_id) values",
    stage_rows, 120)
nb["users"] = emit("users", USERS_HEADER, user_rows, 50, USERS_FOOTER)
nb["cards_assigned"] = emit("cards_assigned", ASSIGNED_HEADER, assigned_rows, 170,
                            ASSIGNED_FOOTER)
nb["cards_unassigned"] = emit(
    "cards_unassigned",
    "insert into public.cards (card_code, created_at, legacy_card_id) values",
    unassigned_rows, 400)
nb["links"] = emit("links", LINKS_HEADER, link_rows, 240, LINKS_FOOTER)
nb["contactexchange"] = emit(
    "contactexchange",
    "insert into legacy.contactexchange (legacy_id, card_owner_legacy_user_id,"
    " sender_legacy_user_id, sender_name, sender_email, sender_phone, notes,"
    " created_at) values",
    cx_rows, 300)

print("chunk counts:", nb)
total = 0
for f in sorted(os.listdir(OUT)):
    sz = os.path.getsize(os.path.join(OUT, f))
    total += sz
    print(f"  {f:28s} {sz:>8,} bytes")
print(f"TOTAL {total:,} bytes")

print("\nsocial_links: import=%d skip=%d normalised=%d -infinity_fixed=%d duplicates_kept=%d"
      % (len(link_rows), len(skipped_links), len(normalised_links), inf_fixed, dupe_links))
for s in skipped_links:
    print("  SKIP legacy sociallink id=%s (legacy user %s, %s): %s" % s)
for s in normalised_links:
    print("  NORMALISED legacy sociallink id=%s (%s): %s" % s)


# ---------------------------------------------------------------------------
# Expected content checksums
# ---------------------------------------------------------------------------
# The rows are hand-transmitted as SQL text, so a correct row count proves
# nothing about a mangled character inside a bio. These digests are computed
# from the source here and recomputed identically in SQL after loading (see the
# seed script, STEP 5c); they must match exactly. This is what caught the single
# real transcription error in this import — one bio in which 10 of 11
# consecutive newlines survived.
#
# Order-independent: hash each row, sort the hashes, hash the concatenation.
# NULL gets an explicit sentinel because ''||NULL is NULL in SQL, which would
# make an all-NULL row indistinguishable from another. Timestamps are
# canonicalised to UTC with 6-digit microseconds so that the dump's
# '…10.585+00' and Postgres's '…10.585000' are the same string on both sides.

SEP, NUL = "|~|", "<<NULL>>"


def canon_ts(s):
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})"
                 r"(?:\.(\d{1,6}))?([+-]\d{2})(?::(\d{2}))?$", s)
    assert m, f"unparseable timestamp shape: {len(s)} chars"
    y, mo, d, h, mi, se = (int(m.group(i)) for i in range(1, 7))
    micro = int((m.group(7) or "").ljust(6, "0"))
    oh, om = int(m.group(8)), int(m.group(9) or 0)
    off = datetime.timedelta(hours=abs(oh), minutes=om)
    if oh < 0:
        off = -off
    dt = datetime.datetime(y, mo, d, h, mi, se, micro) - off
    return dt.strftime("%Y-%m-%d %H:%M:%S.") + "%06d" % dt.microsecond


def digest(rows):
    hs = sorted(hashlib.md5(SEP.join(r).encode()).hexdigest() for r in rows)
    return hashlib.md5("".join(hs).encode()).hexdigest()


def f(v):
    return NUL if v is None else v


expected = {
    "contactexchange": digest([
        [r["id"], r["cardownerid"], f(r["senderuserid"]), f(r["sendername"]),
         f(r["senderemail"]), f(r["senderphone"]), f(r["notes"]),
         canon_ts(r["createddatetime"])]
        for r in X]),
}
json.dump(expected, open(os.path.join(HERE, "expected_checksums.json"), "w"), indent=1)
print("\nexpected checksums:", json.dumps(expected, indent=1))


# ---------------------------------------------------------------------------
# Photo path reference CSV
# ---------------------------------------------------------------------------
# `photo_path` is left NULL for every user in this pass. This CSV preserves the
# legacy path alongside the new UUID so a follow-up pass can upload the files
# and backfill without re-reading the legacy database.
#
# Scope is deliberately narrow — legacy id, new id, path, presence, size. No
# email, phone or bio, because unlike the row data this file IS committed.
rows = []
for r in U:
    if not r["profilephoto"]:
        continue
    p = r["profilephoto"]
    full = os.path.join(PHOTO_BASE, p)
    present = os.path.isfile(full)
    rows.append([r["id"], umap[r["id"]], p,
                 "yes" if present else "no",
                 os.path.getsize(full) if present else ""])
rows.sort(key=lambda x: int(x[0]))

csvp = os.path.join(HERE, "photo_paths.csv")
with open(csvp, "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["legacy_user_id", "user_id", "legacy_photo_path",
                "file_present_in_export", "file_bytes"])
    w.writerows(rows)
print(f"\nphoto CSV: {len(rows)} rows ({sum(1 for r in rows if r[3] == 'no')} missing files)"
      f" -> {csvp}")
