# Unverified connections — removing the in-person-verification requirement, deliberately

**Date:** 2026-09-26
**Status:** Signed-off product decision (owner, 2026-09-26, recorded in the session transcript across four rounds of explicit flag-and-confirm multiple-choice questions). Schema, RPCs, and the `ensureUser()` placeholder-merge step are built and verified live. The scan/manual-entry UI and the qr-verifier gate-removal are built in the same change. See §7 for exactly what is and is not shipped as of this document.
**What this amends:** CLAUDE.md's single non-negotiable product rule — *"A connection can only be created through NFC or a live, GPS-verified QR scan — no exceptions."* — and everything downstream of it: `docs/architecture/2026-08-09-initial-architecture-proposal.md` §4 (the entire GPS-gate/session/verified-connection design), `create_verified_connection`'s own header ("§4.7 threat 4: never add a second path that writes connections"), and `packages/core/src/connect/verification.ts`'s type-branding rationale. Each of those files carries a dated pointer to this document. **CLAUDE.md itself still states the old rule as non-negotiable and has not been edited by this change** — see §8. Future sessions should treat CLAUDE.md as stale on this one point until the project owner updates it directly.

---

## 0. The decision, in the owner's terms

Two things, asked for together and built together:

1. **Scan a business card or tradeshow badge and pull the info in as a contact.** OCR on a photographed card/badge, decoding a QR/barcode on a badge, and tapping an NFC-enabled badge are all supported input methods, alongside plain manual entry.
2. **The in-person-verification requirement is removed, project-wide, as a REQUIREMENT — not just for scanning.** The owner's own words: *"we are going to overhaul the standard, and remove the 'having to meet in person and verify' aspects of the app. I still want it to log location they met the person but that as a hard requirement is going to be pulled."*

What was actually confirmed, across four rounds of multiple-choice questions, in order:

- A card scan or manual entry produces a **full `connections`-graph edge** — the same table, same shape, as a verified connection today. Not a separate address-book/CRM concept.
- **No device evidence is required at all.** Typing a name and email in, with nothing scanned or photographed, is sufficient by itself to create the edge.
- If the other party has **no SmartCard account**, a **placeholder `users` row is created immediately**, and the connection is live right away, pointing at that placeholder.
- If the other party **already has a real account** (matched by email or phone), the connection is live **instantly, with full mutual profile access** — the same access level `private.are_connected()` grants a verified connection — with **no action or notice on the matched person's side**.
- **No confirmation step, no notification, no rate limit, no removal/block UI beyond what already existed** (the existing one-way `active -> removed` transition on `connections.status`). v1 is exactly this simple, by explicit choice.
- The existing NFC-tap and QR-scan screens **stay pixel-identical on the frontend**. What changes is underneath: those flows stop *rejecting* a scan that fails the GPS/proximity check. The tap/scan interaction is preserved as one input method among several; only its role as a *gate* is removed.

This was flagged, plainly, before any planning started — CLAUDE.md's own instruction ("if a feature request conflicts with any of this, flag it — don't build a workaround") was followed to the letter, including a direct statement of the concrete new attack this opens (§2). The owner then confirmed the same specific, highest-risk behavior twice, independently, across two different rounds of questions. This is a deliberate amendment, recorded here per that same instruction — not a workaround, and not something arrived at by drift.

## 1. What actually changes, precisely

**Before this change:** seeing anyone's phone number, email, bio, or company info required `private.are_connected()` to be true (20260809210900), which required a real, physically-verified meeting — an NFC tap (a few centimetres of read range as the proof) or a GPS-gated QR scan (two independently-reported device positions, compared server-side, per `docs/architecture/2026-08-09-initial-architecture-proposal.md` §4.3). `create_verified_connection` (20260813210300) was the single, deliberately narrow, `service_role`-only writer of that graph, and its own header — together with `no-second-write-path.test.ts` — treated a second writer as the thing to structurally prevent.

**After this change:**
- A **second writer**, `create_manual_connection` (20260926130000), exists, deliberately. It is not an accident this project's own tests failed to catch — see §3.
- `qr_gps` connections still go through `create_verified_connection` and the GPS gate is still evaluated, but a failed gate **no longer rejects the connection** (`qr-verifier.ts` step 8). `nfc_card` connections are unaffected — NFC never had a GPS gate.
- `users` admits a fourth status, `'placeholder'`, and `kinde_user_id` is now nullable — the schema shape needed for "this person has no account yet, but a real graph edge points at them right now."

## 2. The concrete new risk, stated plainly, not softened

This is the load-bearing fact of this whole amendment, and CLAUDE.md requires it be spelled out as an attack, not filed away as a caveat:

**Anyone signed in can type in (or scan) a name and email that happens to match a real SmartCard user, and that instantly and silently creates a live, mutual connection.** The typer immediately sees that real person's full private profile — phone, email, bio, company, social links — exactly as if they had tapped NFC cards together in person. The matched person is never notified. There is no rate limit on how many times this can be done. There is no confirmation step on either side. The only recourse the matched person has is noticing an unfamiliar name in their own connections list at some later point and removing it — which does not undo the fact that their information was already visible for however long that took.

This is, functionally, the exact capability `create_verified_connection`'s own header calls "the second path §4.7 threat 4 forbids," built on purpose. It is also, functionally, a way to add anyone in the product as a "connection" purely by asserting who they are — the thing a verified-meeting requirement existed specifically to make impossible. Both of those sentences are true at the same time as this being exactly what was asked for, four times, in increasingly specific and unambiguous terms. Recorded here so that "how did this happen" always has a real answer.

**What is NOT changed, and remains a genuine limit on the above:** a placeholder row (someone with no account yet) cannot be logged into by anyone — `assertActive()` in `ensure-user.ts` refuses any non-`'active'` status, unchanged. The exposure above is specifically about matching an *existing, real, active* account by email or phone — it does not let anyone create a working login for someone else, or read data belonging to an account that does not already grant that data through the ordinary `are_connected` policy branch once the edge exists.

## 3. The schema and RPCs

Three migrations, in order:

1. **`20260926120000_users_placeholder_accounts.sql`** — `users.kinde_user_id` becomes nullable (replacing its plain `UNIQUE` with a partial unique index, `where kinde_user_id is not null`, so any number of placeholders can share a null identity without colliding); `users.status`'s CHECK gains `'placeholder'`; a new nullable `placeholder_source` column records how a placeholder row was created; `meetings.verification_method` and `connection_sessions.method` both gain four new values — `card_scan_ocr`, `badge_qr`, `badge_nfc`, `manual_entry` — alongside the untouched `qr_gps`/`nfc_card`.

2. **`20260926130000_fn_create_manual_connection.sql`** — `public.create_manual_connection(...)`, `security invoker`, `service_role`-only (identical posture to `create_verified_connection`, identical reasoning: a mis-grant to `authenticated` hits the absent INSERT policies rather than bypassing them). Resolves the other party — by an id the caller already matched, or by an email/phone lookup against every existing `users` row regardless of status — and either connects to the real match (refusing cleanly, `other_party_unavailable`, if the match is suspended/deleted, since a second insert would collide on `users.email`'s uniqueness) or creates a placeholder. Writes a born-`consumed` `connection_sessions` row (mirroring the existing `nfc_card` technique for "no real session to redeem"), then `meetings`/`meeting_participants`/optional `meeting_locations`/`connections`, reusing `create_verified_connection`'s own ordered-pair and reconnect logic rather than reinventing it. No GPS gate, no session redemption — this function's entire job is writing the graph edge and its evidence, not deciding whether to.

3. **`20260926140000_fn_claim_placeholder_user.sql`** — `public.claim_placeholder_user(...)`, called only by `ensureUser()` on a real Kinde signup. Added because `no-second-write-path.test.ts` (a repo-wide static test asserting `users.status` is written from exactly one atomic place) caught the first draft of `ensureUser()`'s placeholder-merge step writing `status` directly via a supabase-js `.update()` — which the test's own header explains is refused for a real reason, not just style: an application-level select-then-update can race itself under concurrent signups. This RPC does the lookup-and-claim atomically (`for update` locked) instead, matching the discipline every other status transition in this schema already follows (`soft_delete_own_account()`).

`create_manual_connection` is deliberately **not** a change to `create_verified_connection` — merging them would blur a function whose entire design point, per its own header, is narrowness. The two now coexist as siblings: one verified (evaluates a gate that no longer blocks), one openly unverified (evaluates nothing).

## 4. `ensureUser()` — claiming a placeholder on real signup

When a genuinely new Kinde identity signs up, `ensureUser()` (`apps/web/src/server/auth/ensure-user.ts`) now calls `claim_placeholder_user` with the identity's email before falling through to its ordinary insert. If a `status = 'placeholder'` row already exists with that email — created earlier by someone scanning or manually adding this person before they ever signed up — it is claimed **in place**: same `id`, `kinde_user_id` set, `status` flips to `'active'`, and `first_name`/`last_name` are filled in only where the placeholder had none (never overwriting what a scan or manual entry already recorded, the same "fill blanks, never overwrite" posture `claim_event_import` already uses). Keeping the same `id` is what keeps every `connections`/`meetings` row already pointing at that placeholder valid after the real person signs up — a second, brand-new row would leave those edges pointing at an account nobody could ever reach.

Matching is **email-only**, not phone, at this step specifically — `KindeIdentity` (`kinde-identity.ts`) has no phone claim at all, so there is nothing to match by. `create_manual_connection` itself does match by phone as well when resolving an "already has an account" contact (the owner's explicit choice) — that is a different moment with different inputs available, not an inconsistency.

## 5. What deliberately did not change

- **`packages/core/src/connect/gps-gate.ts` (`evaluateGpsGate`) is untouched** — the pure distance/accuracy/freshness computation is exactly as before, still fully unit-tested (`gps-gate.test.ts`). What changed is only that `qr-verifier.ts` stops treating a failed verdict as a rejection; the verdict is still computed and still lands in `connection_attempts` for whatever future use the audit trail has.
- **The NFC/QR frontend screens are pixel-identical.** No component, route, or interaction changed for those two flows. A host still displays a rotating QR; a scanner still scans it; a card still gets tapped. The only user-visible difference is that a scan which would previously have been refused for being too far away now succeeds.
- **`create_verified_connection` has zero code changes.** It did not need any — the gate lived entirely in the calling service (`qr-verifier.ts`), and `create_manual_connection` is an entirely separate function, not a modification of this one.
- **The branded `VerifiedOutcome`/`sealVerified` type system (`verification.ts`) is untouched and still means what it always meant**: a value only `qr-verifier.ts` or `nfc-verifier.ts` can produce. `create_manual_connection` does not participate in that system at all — it never claims to be verified, and nothing about it weakens the guarantee that a `VerifiedOutcome` could only have come from a real verifier. Two structurally different kinds of "connection was created" now coexist honestly, rather than one pretending to be the other.

## 6. Tests changed, and why each one is a legitimate change rather than a hole being patched over

- **`threats.test.ts`**: the "Threat 2 — live video relay" block and the relaxation-bookkeeping ("Threat 6") block previously asserted that specific relay/spoofing scenarios were *refused*. They now assert those same scenarios are *accepted*, with a comment explaining the defence was deliberately removed and pointing here. Every other threat in that file (screenshot-and-forward via session single-use, mass fake-account farming, injection-shaped input, lost/stolen cards, rate limiting) is completely unaffected and unchanged, because none of those defences relied on the GPS gate.
- **`event-tagging.test.ts`**: the parameterized "refuses with `$reason` identically in all three event worlds" table dropped its four GPS-gate-specific rows (`too_far`, `scanner_accuracy_too_low`, `scanner_location_stale`, `presenter_location_missing`), since none of them are refusals anymore; the remaining rows (self-connect, blocked, already-connected, session lifecycle, rate limiting) are untouched.
- **`no-second-write-path.test.ts`**: `create_manual_connection`'s single caller (`manual-connect-service.ts`) was added to the service-role-importer allowlist, with the same style of written justification every other entry in that list already carries — explaining that this is a deliberate second write path, per this document, not an oversight the list failed to catch.

## 7. Status as of this document — what is built, and what is not yet

**Built and verified live** (rolled-back-transaction verification before and after applying, against project `crpsbnbegeoqtlgshltt`, `get_advisors` clean): all three migrations in §3, the `ensureUser()` placeholder-merge in §4, and the `qr-verifier.ts` gate change in §5, plus the full `packages/types` schemas (`packages/types/src/connect/manual.ts`, widened enums) and the `manual-connect-service.ts` server-side service layer wrapping `create_manual_connection`.

**Not yet built as of this document:** the actual "add a contact" UI — the manual-entry form and the three scan modes (OCR, QR/barcode, NFC badge tap) — described in the original implementation plan. Until that UI ships, `create_manual_connection` exists and is reachable from server-side code but has no user-facing entry point.

## 8. Follow-up this document deliberately does not do

**CLAUDE.md itself is not edited by this change.** It still states, verbatim, "A connection can only be created through NFC or a live, GPS-verified QR scan — no exceptions." That sentence is now false as a description of the code, and this document is the record of why — but rewriting CLAUDE.md is a decision for the project owner to make directly, not something a single feature change should do to the file that governs how every future session reads this codebase's own rules. Whoever picks this up next: check whether CLAUDE.md has been updated before trusting its "non-negotiable" language on this point, and if not, this document is the thing to point at.

> **Closed 2026-10-09.** The owner explicitly asked, as part of `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`, for CLAUDE.md to finally be rewritten to reflect this amendment and that one cumulatively — see that document's §13. CLAUDE.md's non-negotiable rule now names `create_manual_connection` as path 2 of three and points back here for the reasoning. This paragraph is left as originally written, per this project's own "history is not rewritten" convention (§9 of the 2026-08-09 document's open-questions tracker establishes that convention elsewhere in this repo).

**Also not done here, and worth naming so it is a decision rather than an oversight:** a "who has added me" visibility surface, any notification, any rate limit, and any confirmation step. All four were explicitly declined by the owner for v1 (§0). Candidates for a later amendment, not gaps in this one.
