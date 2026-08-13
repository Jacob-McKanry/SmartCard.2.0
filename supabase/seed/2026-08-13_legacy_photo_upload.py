#!/usr/bin/env python3
"""
Uploader for the 2026-08-13 legacy photo migration follow-up (see the
"Deviation (2026-08-13) -- photos were NOT part of the production import
pass" note in docs/architecture/2026-08-09-initial-architecture-proposal.md
section 6.5, and the follow-up-run note appended below it).

WHAT THIS DOES
    Reads 2026-08-13_legacy_photo_paths.csv (committed, no personal data --
    just legacy_user_id / new user_id / legacy path / presence / byte size)
    and, for every row with file_present_in_export = yes:
      1. uploads the corresponding local .webp file to Supabase Storage at
         {user_id}/{original-filename} in the private `profile-photos`
         bucket, using the Storage HTTP API directly (see WHY BY HTTP below);
      2. records a local manifest (uploaded path, bytes sent, sha256) so the
         SQL step that backfills public.users.photo_path has an exact,
         reviewable list to work from, and so a spot-check can compare
         "bytes we sent" against "bytes Storage says it has" without
         re-reading the source files.

WHY BY HTTP, NOT execute_sql
    Storage object *bytes* live in the backing object store, not in
    Postgres -- execute_sql (and apply_migration) can create the bucket row
    and RLS policies, both of which are Postgres state, but cannot put file
    content anywhere. The only way to write actual bytes is the Storage
    HTTP API (equivalent to what storage-js does under the hood).

WHY THE ANON KEY, AND WHY THAT IS SAFE HERE
    This environment has no service_role key (deliberately -- see
    .env.local) and no Supabase management access token, so the anon
    (publishable) key is the only credential available to call the Storage
    API. That key has no special privilege by itself: every write it makes
    is still gated by RLS policies on storage.objects, which were opened
    *only* for the profile-photos bucket, *only* for INSERT/SELECT, by
    migration 20260813180402_temp_photo_migration_upload_policy.sql, and
    closed again immediately after this script (and its verification pass)
    finish, by 20260813180755_revoke_temp_photo_migration_upload_policy.sql.
    Run this script only in that window -- it will fail closed (HTTP 403)
    outside it, which is the correct behaviour, not a bug to work around.

USAGE
    python3 2026-08-13_legacy_photo_upload.py
        reads:  2026-08-13_legacy_photo_paths.csv (this directory)
                <repo>/.env.local (for SUPABASE_URL + the anon key)
                the local file tree passed via --photos-dir
        writes: 2026-08-13_legacy_photo_upload_manifest.json (this directory)

    Idempotent: re-running skips rows already present in the manifest with
    matching sha256, and uses x-upsert so a retried upload overwrites rather
    than erroring.
"""

import argparse
import csv
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
CSV_PATH = HERE / "2026-08-13_legacy_photo_paths.csv"
MANIFEST_PATH = HERE / "2026-08-13_legacy_photo_upload_manifest.json"
ENV_LOCAL = REPO_ROOT / ".env.local"
BUCKET = "profile-photos"


def load_env_local():
    env = {}
    if ENV_LOCAL.exists():
        for line in ENV_LOCAL.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def upload_object(base_url, api_key, object_path, data, content_type):
    url = f"{base_url}/storage/v1/object/{BUCKET}/{object_path}"
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("apikey", api_key)
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("Content-Type", content_type)
    req.add_header("x-upsert", "true")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--photos-dir", required=True,
                     help="Local root that legacy_photo_path is relative to")
    ap.add_argument("--limit", type=int, default=None,
                     help="Only process the first N eligible rows (testing)")
    args = ap.parse_args()

    photos_dir = Path(args.photos_dir)
    env = load_env_local()
    base_url = env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
    api_key = None
    # Prefer the legacy JWT-format anon key if present in the environment;
    # falls back to the sb_publishable_ key. Both are the same "anon" role
    # as far as storage.objects RLS is concerned.
    api_key = env.get("SUPABASE_ANON_KEY") or env.get(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    if not base_url or not api_key:
        print("Missing SUPABASE_URL or an anon/publishable key in .env.local "
              "(or SUPABASE_ANON_KEY override) -- aborting.", file=sys.stderr)
        sys.exit(1)

    manifest = {}
    if MANIFEST_PATH.exists():
        manifest = json.loads(MANIFEST_PATH.read_text())

    rows = []
    with open(CSV_PATH, newline="") as f:
        for row in csv.DictReader(f):
            if row["file_present_in_export"] == "yes":
                rows.append(row)

    if args.limit:
        rows = rows[: args.limit]

    n_ok, n_fail, n_skip = 0, 0, 0
    for row in rows:
        legacy_path = row["legacy_photo_path"]
        user_id = row["user_id"]
        expected_bytes = int(row["file_bytes"])
        filename = legacy_path.rsplit("/", 1)[-1]
        object_path = f"{user_id}/{filename}"
        local_path = photos_dir / legacy_path

        if not local_path.exists():
            print(f"MISSING local file for legacy_user_id={row['legacy_user_id']}: "
                  f"{local_path}", file=sys.stderr)
            n_fail += 1
            continue

        actual_bytes = local_path.stat().st_size
        digest = sha256_of(local_path)

        prior = manifest.get(object_path)
        if prior and prior.get("sha256") == digest and prior.get("status") == "uploaded":
            n_skip += 1
            continue

        if actual_bytes != expected_bytes:
            print(f"SIZE MISMATCH legacy_user_id={row['legacy_user_id']}: "
                  f"csv says {expected_bytes}, file is {actual_bytes}",
                  file=sys.stderr)

        data = local_path.read_bytes()
        status, body = upload_object(base_url, api_key, object_path, data,
                                      "image/webp")
        ok = status in (200, 201)
        manifest[object_path] = {
            "legacy_user_id": row["legacy_user_id"],
            "user_id": user_id,
            "bytes": actual_bytes,
            "sha256": digest,
            "status": "uploaded" if ok else f"failed:{status}",
        }
        if ok:
            n_ok += 1
        else:
            n_fail += 1
            print(f"UPLOAD FAILED legacy_user_id={row['legacy_user_id']} "
                  f"status={status} body={body[:200]}", file=sys.stderr)

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, sort_keys=True))
    print(f"uploaded={n_ok} skipped_already_done={n_skip} failed={n_fail} "
          f"total_eligible_rows={len(rows)}")
    sys.exit(1 if n_fail else 0)


if __name__ == "__main__":
    main()
