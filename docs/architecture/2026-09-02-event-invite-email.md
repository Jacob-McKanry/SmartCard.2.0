# Event-invite email — Resend integration

**Date:** 2026-09-02
**Status:** Owner-approved plan (chat sign-off, 2026-09-02) for the three decisions §0 below records; Phases 1-4 built (§4). Phase 5 (a real live send) next.
**Scope:** `2026-08-22-event-attendee-import.md` §5 scoped email as its own phase and did not schedule it. This document is that phase: sending the claim-link email a CSV import writes a `lookup_token` for but currently has no way to deliver, per §11.5's "interim, pending §5" note on `list_own_import_links`.

---

## 0. Decisions made before any code was written

Per CLAUDE.md's "Plan before building," these were put to the owner as multiple-choice questions rather than assumed:

1. **Send trigger: automatic, immediately after the host's attestation succeeds** (not a separate explicit "send now" step). `importEventAttendees` finishing successfully is what starts delivery.
2. **Sending subdomain: `invites.smartcard.tech`**, not the bare root — isolates bulk-mail reputation from `smartcard.tech` itself, same reasoning §5 of the import doc already gives for SPF/DKIM/DMARC mattering.
3. **The roster** (`2026-08-27-event-attendee-roster.md`, "viewing other attendees") **is explicitly out of scope here** and stays a separate follow-on after this phase ships and is tested. Nothing in this document touches it.

---

## 1. Phases

1. **Deliverability foundation** (§4, done) — Resend account/API key, `invites.smartcard.tech` domain verification (SPF/DKIM/DMARC), a do-not-mail list, a bounce/complaint webhook, one-click unsubscribe. §5 of the import doc lists all of this as required *before* any bulk send, not optional hardening.
2. **Schema** (§4, done) — `emailed_at`/`email_error` on `event_attendee_imports`, checked against the suppression list before a send.
3. **Send module** (§4, done) — one function, send one claim email. Its content builder and Resend call are the reusable unit; see §4.2 for why the trigger itself moved to Phase 4 rather than being wired into `importEventAttendees` here as originally planned.
4. **Queued delivery** (§4, done) — `event_import_max_rows` is 5,000 (`app_config`), so sending cannot happen synchronously inside the Server Action that imports a file. A "pending send" queue drained by a scheduled job, calling Phase 3's send function in concurrent chunks, rather than blocking the host's request on up to 5,000 individual sends with no resumability if it fails partway. This phase also owns the trigger itself — see §4.2. See §4.3 for a real constraint (the Vercel plan) found while building this, and what it means for actual send speed.
5. **Live test** — a real send to an address under our control, confirming DKIM/SPF pass and inbox delivery, then a click-through of claim → signup → the attendance note.

---

## 2. Phase 1 — why each piece exists, and the shape it took

### 2.1 `public.email_suppressions` — a do-not-mail list with no RLS policy, on purpose

Every other table this project has added recently (`event_attendee_imports`, `host_applications`, …) is gated by a `security definer` RPC keyed on `private.current_user_id()`, because each answers "what may THIS signed-in person do." This table answers a different kind of question — "should ANY mail go to this address, regardless of who is asking" — and none of its three real callers (the Resend webhook, the public unsubscribe link, the send job) run with a Supabase user session at all. There is no `current_user_id()` to key a policy on, for the same structural reason `ensureUser()` reaches for the service role (`service-role-client.ts`'s own header: "the identity that would key an RLS policy does not exist at the point this runs").

So the table is RLS-enabled, forced, with zero policies and zero grants — identical posture to `event_attendee_imports`, but for a different reason, recorded here rather than left to look like a copy-paste: `service-role-client.ts` warns "adding a second caller is a decision, not a convenience," and this is that decision made explicitly for a third and fourth caller (the webhook and the unsubscribe route; the send job in Phase 3 will be a fifth), each reasoned about on its own rather than assumed safe by precedent.

**Schema:** `email` (citext, primary key — no `user_id` column; most rows belong to people who never signed up), `reason` (`bounced` | `complained` | `unsubscribed`, whichever happened first — this is a boolean gate, not an event log, so a second bounce for an already-suppressed address is a no-op), `suppressed_at`, `source_event_id` (Resend's event id, for tracing a suppression back to what caused it; null for an unsubscribe-link row, which has no Resend event behind it).

**Verified live** in a rolled-back transaction before applying: zero grants to `authenticated`/`anon`; a signed-in caller's own `SELECT` against the table errors outright (forced RLS, zero policy) rather than returning empty; a citext-case-insensitive duplicate insert is a no-op under the service layer's 23505-swallow (§2.3 below), keeping whichever reason was recorded first; an invalid `reason` value is refused by the CHECK constraint. Re-verified against the deployed table after applying: zero grants, `relforcerowsecurity = true`, zero policies. Migration: `20260902130000_table_email_suppressions.sql`.

### 2.2 `apps/web/src/server/email/suppressions.ts` — takes a client, doesn't construct one

`isEmailSuppressed` and `recordSuppression` both take a `SupabaseClient` as their first argument, the same shape every other service function in this codebase uses (`importEventAttendees(supabase, …)`, `cancelEvent(supabase, …)`), rather than calling `serviceRoleClient()` internally. Two reasons, not one: it keeps the "adding a caller is a decision" call visible at each of the three call sites instead of hidden inside this file, and it is what makes the module testable at all — a function that constructs its own client is a function a Vitest run cannot hand a fake to.

`isEmailSuppressed` fails CLOSED: a read error answers `true` (suppressed). The wrong direction to be wrong in for a do-not-mail list is `false` — a transient database error becoming silent permission to mail someone who unsubscribed is the one failure mode this table exists to prevent, the identical fail-closed posture CLAUDE.md requires for anything connection/verification-related, applied here to a different kind of gate.

`recordSuppression` swallows a `23505` (already suppressed) as success — the end state the caller wanted is already true — same posture `inviteToEvent`'s duplicate-invite handling already takes for the identical reason.

### 2.3 `/api/webhooks/resend` — signature first, never interpret unverified data

Resend delivers webhooks through Svix, which HMAC-SHA256-signs the raw request body. The route reads `req.text()` once and hands it to `svix`'s `Webhook.verify()` before parsing a single field — the same rule `qr-token.ts`'s own header states for its own token ("HMAC signature first, reject immediately on failure, never interpret unverified data"), applied here to a request instead of a QR code. A body re-serialized from parsed JSON would be signed-over different bytes than Resend actually signed and fail verification for real requests; skipping verification and parsing first would accept a forged body wholesale.

Handles only `email.bounced` and `email.complained` — the two events that change whether we may send. Everything else Resend reports (`email.delivered`, `email.opened`, …) is telemetry nothing reads yet; adding a case here is cheap when something needs it, and keeping the route narrow until then is the point.

`RESEND_WEBHOOK_SECRET` is REQUIRED (`env.ts`, unlike `RESEND_API_KEY` which is optional) — deliberately asymmetric. A missing API key degrades a feature (nobody gets emailed, the interim copy-link screen stays the fallback). A missing webhook secret would degrade a *security check*: the route would either have to accept unverified bodies or never run, and accepting a forged "this address bounced" (or worse, never processing a real complaint because the check was skipped) is not a degradation this pipeline can absorb before it is trusted with the domain's sending reputation. Reading it with `required()` means the route 500s on every request until the secret is set, rather than silently trusting an unverified body.

### 2.4 `/api/unsubscribe` — both GET and POST do the same thing, no sign-in required

RFC 8058 one-click unsubscribe has a mail client POST here with no user interaction; a person can also just click the link, an ordinary browser GET. Both mean the identical thing and both are handled identically.

No sign-in gate, and that is the point — most addresses this exists for have never signed up (`event_attendee_imports`'s own header: "personal data about people who have not signed up"), so an unsubscribe mechanism requiring an account would be useless to exactly the people §5's compliance requirement is about. Authorization is the HMAC-signed token in the link (`unsubscribe-token.ts`), not a session.

**The token has no expiry, unlike the QR token.** A QR token authorizes an action and has to expire — that is the entire attack surface §4.2 exists to close. An unsubscribe link authorizes nothing but its own single purpose (stop mail to one address), the recipient may not open the email for months, and CAN-SPAM's "honor every unsubscribe request" expects a link to keep working. There is no attacker upside to a long-lived one: forged or not, the worst it can ever do is stop mail to an address.

**An invalid signature does NOT get the same response as success, unlike §3.6's claim-flow refusals elsewhere in this codebase.** Those collapse every refusal into one answer because distinguishing them would let a caller enumerate a fact about a real person. Suppression status carries no such fact worth hiding — the recipient already knows their own address and whether mail keeps arriving. What matters instead is not telling someone "you're unsubscribed" when nothing was recorded, which would be actively false for anyone reaching the route with a truncated or corrupted URL (a real failure mode for long query strings in some mail clients) who then keeps receiving mail while believing they opted out. So a bad signature gets an honest "couldn't verify this link, nothing changed," and only a verified signature gets the confirmation — collapsing "just unsubscribed" and "already was" into that same confirmation, since there is no difference worth communicating there.

### 2.5 Secrets — `RESEND_API_KEY` optional, two new REQUIRED secrets, all three added to `turbo.json`

`resendApiKey()` follows `expoAccessToken()`/`geocodingApiKey()`'s existing optional-integration shape: returns `null` when unset, and the send module (Phase 3) must log and leave rows unsent rather than throw, so a missing key degrades to "nobody got emailed yet" rather than failing an import that already succeeded at the one thing it cannot retry (writing the row).

`resendWebhookSecret()` and `emailUnsubscribeSecret()` are both REQUIRED, and `emailUnsubscribeSecret()` is deliberately its OWN secret rather than reusing `qrSigningSecret()` or `connectIpHashSalt()` — `connectIpHashSalt()`'s own header already states the reason this follows: "reusing one salt across two datasets means one leak compromises both." A leaked unsubscribe key lets someone forge a link that unsubscribes an address they do not own, a blast radius unrelated to QR tokens or IP hashing.

All three (`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_UNSUBSCRIBE_SECRET`) were added to `turbo.json`'s build `env` allowlist in the same change — `turbo.json`'s own comment explains why this matters more for the two REQUIRED ones than it sounds: a variable stripped by Turbo but set on Vercel fails the build loudly (the `KINDE_ISSUER_URL` incident that comment already records) rather than degrading silently, but only if it is actually forwarded to `next build` at all; missing from this list, the loud failure happens live on Vercel instead of being caught in review.

---

## 3. What is still NOT built after Phase 4

- Phase 5's live send test — nobody has yet confirmed a real email actually lands in a real inbox with DKIM/SPF passing.
- Any change to the interim `/events/[eventId]/import/links` screen — it stays the fallback for a failed send, per the original interim-screen decision (§11.5 of the import doc), not removed by this phase.
- A manual-trigger UI for the cron route — §4.3 notes the route is safely callable at any time with `CRON_SECRET`, but nothing in the app exposes that to a host yet; today it is an operator action (curl, or a request from wherever `CRON_SECRET` is available), not a button.

Domain verification, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and `EMAIL_UNSUBSCRIBE_SECRET` are all owner-confirmed set. `EMAIL_MAILING_ADDRESS` and `CRON_SECRET` still need to be generated/set before anything in Phase 4 can run for real — see §4 for exactly which.

---

## 4. Build log

| Piece | Where | State |
|---|---|---|
| `email_suppressions` table | `20260902130000_table_email_suppressions.sql` | Applied and verified live |
| Suppression read/write service | `apps/web/src/server/email/suppressions.ts` | Built, tested (fails closed on read error; 23505 swallowed on write) |
| Unsubscribe token sign/verify | `apps/web/src/server/email/unsubscribe-token.ts` | Built, tested (round-trip, tamper, cross-address, secret rotation) |
| Resend bounce/complaint webhook | `apps/web/src/app/api/webhooks/resend/route.ts` | Built |
| Public unsubscribe endpoint | `apps/web/src/app/api/unsubscribe/route.ts` | Built |
| `RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET` / `EMAIL_UNSUBSCRIBE_SECRET` | `env.ts`, `.env.example`, `turbo.json` | Built |
| `emailed_at`/`email_error` on `event_attendee_imports`, `claim_event_import` widened | `20260902140000_event_attendee_imports_email_send_state.sql` | Applied and verified live — both columns persist a written value; claiming a row nulls both, re-read and confirmed after |
| Claim-email content builder | `apps/web/src/server/email/claim-email.ts` | Built, tested — including a copy-rule test asserting "attended" never appears, matching `claim-review.test.tsx`'s own rule |
| Per-row send + write-back | `apps/web/src/server/email/send-claim-email.ts` | Built, tested; suppression-skip path mutation-tested (confirmed red before restoring) |
| `EMAIL_MAILING_ADDRESS` (CAN-SPAM) | `env.ts`, `.env.example`, `turbo.json` | Built — required, no placeholder default; owner still needs to set the real value in Vercel |
| `claim_pending_claim_emails` (atomic batch claim) | `20260903120000_fn_claim_pending_claim_emails.sql` | Applied and verified live — 7 scenarios including FIFO ordering, lease-based reclaim after 10 minutes, a real `email_error` never reclaimed, `authenticated`/`anon` refused execution |
| Batch runner (concurrent chunks) | `apps/web/src/server/email/pending-claim-emails.ts` | Built, tested; concurrency-bound mutation-tested (an unbounded-`Promise.all` mutation confirmed red before restoring) |
| Cron route | `apps/web/src/app/api/cron/send-claim-emails/route.ts`, `apps/web/vercel.json` | Built — see §4.3 for the schedule and `maxDuration` choices |
| `email_send_batch_size` correction + `email_send_concurrency` | `20260903130000_email_send_batch_size_hobby_correction.sql` | Applied and verified live |
| `CRON_SECRET` | `env.ts`, `.env.example`, `turbo.json` | Built |

Not yet done: Phase 5's live send test. Domain verification, `RESEND_API_KEY`/`RESEND_WEBHOOK_SECRET`/`EMAIL_UNSUBSCRIBE_SECRET`/`EMAIL_MAILING_ADDRESS` are all owner-confirmed set; `CRON_SECRET` still needs to be generated and set in Vercel before the cron route will authorize any request.

### 4.1 Phase 2 — the schema, and why it changed nothing about §2.2's own logic

Two nullable columns on `event_attendee_imports` (`emailed_at`, `email_error`) and one widened destruction list inside `claim_event_import` — see the migration's own header for what each column means and, as importantly, what it deliberately does not (`emailed_at` is not a delivery or open receipt; `email_error` is a send-attempt failure, never a bounce or complaint, which stay in `email_suppressions` instead). No RLS or grant changed: both columns are exactly as unreadable through any client role as the rest of this table already was, and the only future writer is the send job (Phase 3), using the service role.

**Verified live** in a rolled-back transaction before applying: a row written with both columns set persists them on read-back; claiming that row (as the real matching, email-verified caller) nulls both alongside the rest of §2.2's list, confirmed by re-reading the row after the claim call returned `{claimed: true}`.

### 4.2 Phase 3 — the send module, and why its trigger moved to Phase 4

**What got built.** Two pieces, deliberately kept apart: `claim-email.ts` is a pure function (no I/O, no secrets) turning `{recipient, host, event, links}` into a subject/html/text triple, so its one real rule — §2.3.1's "never claim attendance, always say guest list" — can be asserted with a plain string test rather than a mocked Resend client. `send-claim-email.ts` is the one function §1's Phase 3 line promised: given a Resend client and one import row, check the suppression list, build the email, send it, and write `emailed_at`/`email_error` back — never throwing, because a batch of these run in a loop over hundreds of rows and one bad address must not abort the rest.

**What did NOT get built here, despite §1's original Phase 3 wording ("called from `importEventAttendees` right after attestation succeeds"): the trigger.** Recorded as a deliberate deviation from the original phase split, per CLAUDE.md, rather than built quietly around. The reason surfaced while designing the wiring, not before: `event_import_max_rows` is 5,000, and there is no version of "call `sendClaimEmail` in a loop from inside the Server Action that just imported the file" that is both non-blocking (the host's request must return quickly) and resumable (a function killed at row 3,000 of 5,000 must not silently leave the remaining 2,000 rows never attempted and never retried, with nothing anywhere recording that). Building a half-considered version of that mechanism now, only to redesign it for Phase 4's queue anyway, would cost more than doing it once — Phase 4's own line already says this is a scheduled job draining a queue, which is one design problem, not two. So Phase 4 now owns both "how sending is queued" and "what actually calls `sendClaimEmail` and when" as a single piece of work, and this phase delivers the unit that work will call.

**One new required secret: `EMAIL_MAILING_ADDRESS`.** CAN-SPAM requires a real physical address in every commercial email, and nothing in this codebase had one configured anywhere — not something to fabricate, so it was asked of the owner directly (in chat, not through `AskUserQuestion`, since a free-text address has no second meaningful choice to present). `env.ts`'s `emailMailingAddress()` follows the same `required()` shape as `resendWebhookSecret()`: no placeholder default, because a plausible-looking fake address would make the build pass while shipping a real legal violation the moment the send module sends its first message.

**Verified with tests, not a rolled-back transaction — this phase touches no schema or RLS.** `claim-email.test.ts` asserts the subject line matches §2.3.1's own example phrasing exactly, that neither the subject nor either body ever contains "attended," and that an event title containing HTML is entity-escaped rather than injected into the message. `send-claim-email.test.ts` covers: a suppressed address never reaches Resend at all; a successful send records `emailed_at` and clears `email_error`; a Resend-side failure records the error message and returns `failed` rather than throwing; a write-back failure is logged and swallowed rather than thrown, because the send already happened by that point and aborting would be the wrong direction to fail; and the `List-Unsubscribe`/`List-Unsubscribe-Post` headers point at the same signed link the email body uses. The suppression-skip check was additionally mutation-tested — commented out, confirmed the test suite went red, restored — since it is the one line standing between this module and mailing an address that already asked to be left alone.

### 4.3 Phase 4 — the trigger and the queue, and a real constraint found building it

**What got built.** `claim_pending_claim_emails(p_limit)` (migration) atomically claims a batch of pending rows — `FOR UPDATE SKIP LOCKED` inside a CTE feeding an `UPDATE ... RETURNING`, so two overlapping cron runs can never claim the same row, matching the race-safety this codebase already applies to `claim_event_import` and `cancel_event`. `pending-claim-emails.ts`'s `runPendingClaimEmailBatch` claims a batch, loads each distinct event's title/host once, and calls Phase 3's `sendClaimEmail` in concurrent chunks. `/api/cron/send-claim-emails` is the thin HTTP shell: verify `Authorization: Bearer <CRON_SECRET>`, construct a Resend client if `resendApiKey()` is set, call the batch runner, report counts.

**A real constraint, found wiring the cron route rather than assumed in §1's plan: this project's Vercel team is on the Hobby plan.** Confirmed via `list_teams` while building this phase, not something the original plan anticipated. Two Hobby limits mattered immediately:

- **A function (cron included) is capped at 10 seconds**, full stop — `export const maxDuration` in the route cannot raise this on Hobby, it only documents the ceiling for when the plan changes.
- **Cron frequency is capped at once per day**, and Hobby may fire anywhere within the scheduled hour rather than at the exact minute.

The original Phase 3 write-up (and 20260903120000's own first draft of `email_send_batch_size`, seeded at 50) reasoned only about Resend's rate limit and never checked the actual time budget. Two changes followed directly from finding this:

1. **`runPendingClaimEmailBatch` sends in concurrent chunks (`Promise.all`), not one row at a time.** Each row's send is I/O-bound — a suppression-check read, a Resend call, a write-back, three round trips — so sequential awaits would have blown through 10 seconds on network latency alone even for a modest batch. `email_send_concurrency` (new `app_config` row, 5) bounds the chunk size: enough to fit inside 10 seconds, low enough to stay clear of Resend's 10 req/sec team-wide limit even with the extra Supabase calls layered on top. Tested by tracking the actual number of concurrent `emails.send` calls in flight, not just the eventual totals — a test that only checked totals passed against a version with the concurrency bound removed entirely, which the mutation-testing pass caught and is why the stronger assertion exists.
2. **`email_send_batch_size` was corrected from 50 to 15** (`20260903130000`), matching what 5-way concurrency can realistically clear inside 10 seconds (three sequential chunks), with the reasoning and the correction itself recorded in that migration's own header rather than silently overwriting the first number.

**What this means for the product, stated plainly rather than left for someone to discover later.** At most `email_send_batch_size` sends per day, once per day, on the current plan — roughly 15/day at today's settings. §2.3.1 of the import design calls a real guest list "hundreds"; at 15/day, a 200-person list takes on the order of two weeks to fully email automatically. This is not something Phase 4 works around silently:

- The cron route is safely callable manually at any time with `CRON_SECRET` (it is not restricted to Vercel's own scheduler), so a host who wants faster delivery right after an import can be given that as a manual trigger while the daily cron remains the automatic safety net.
- The interim `/events/[eventId]/import/links` copy-link screen (§11.5 of the import doc) is still there and still works today, independent of any of this.
- Moving the Vercel team to a paid plan raises both the 10-second ceiling and the once-a-day cron limit together, which is the actual fix if faster automatic delivery matters — an infrastructure/cost decision for the owner, not one this migration or this phase makes on their behalf.

**Verified live** in a rolled-back transaction before applying `20260903120000`: `authenticated` and `anon` are both refused execution of `claim_pending_claim_emails` outright; claiming 2 of 3 pending rows returns the two oldest by `imported_at` and stamps `email_send_claimed_at` on exactly those two; an immediate second claim does not re-claim the freshly-leased rows and returns the one left; a third call with nothing pending returns zero rows; a lease manually backdated past 10 minutes becomes reclaimable; a row carrying a real `email_error` is never reclaimed regardless of lease state; `claim_event_import`'s own definition was confirmed to null `email_send_claimed_at` in its destruction UPDATE. Re-verified against the deployed function and grants after applying. `20260903130000`'s config correction was verified the same way before being applied for real.
