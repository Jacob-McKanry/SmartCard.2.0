# Event-invite email — Resend integration

**Date:** 2026-09-02
**Status:** Owner-approved plan (chat sign-off, 2026-09-02) for the three decisions §0 below records; Phase 1 in progress.
**Scope:** `2026-08-22-event-attendee-import.md` §5 scoped email as its own phase and did not schedule it. This document is that phase: sending the claim-link email a CSV import writes a `lookup_token` for but currently has no way to deliver, per §11.5's "interim, pending §5" note on `list_own_import_links`.

---

## 0. Decisions made before any code was written

Per CLAUDE.md's "Plan before building," these were put to the owner as multiple-choice questions rather than assumed:

1. **Send trigger: automatic, immediately after the host's attestation succeeds** (not a separate explicit "send now" step). `importEventAttendees` finishing successfully is what starts delivery.
2. **Sending subdomain: `invites.smartcard.tech`**, not the bare root — isolates bulk-mail reputation from `smartcard.tech` itself, same reasoning §5 of the import doc already gives for SPF/DKIM/DMARC mattering.
3. **The roster** (`2026-08-27-event-attendee-roster.md`, "viewing other attendees") **is explicitly out of scope here** and stays a separate follow-on after this phase ships and is tested. Nothing in this document touches it.

---

## 1. Phases

1. **Deliverability foundation** (this document's build log, in progress) — Resend account/API key, `invites.smartcard.tech` domain verification (SPF/DKIM/DMARC), a do-not-mail list, a bounce/complaint webhook, one-click unsubscribe. §5 of the import doc lists all of this as required *before* any bulk send, not optional hardening.
2. **Schema** — `emailed_at`/`email_error` on `event_attendee_imports`, checked against the suppression list before a send.
3. **Send module** — one function, send one claim email, called from `importEventAttendees` right after attestation succeeds (decision 1 above).
4. **Queued delivery** — `event_import_max_rows` is 5,000 (`app_config`), so sending cannot happen synchronously inside the Server Action that imports a file. A "pending send" queue drained by a scheduled job against Resend's batch endpoint, rather than blocking the host's request on up to 5,000 individual sends with no resumability if it fails partway.
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

## 3. What Phase 1 does NOT include yet

- Domain verification of `invites.smartcard.tech` in Resend's dashboard, and the SPF/DKIM/DMARC DNS records that follow from it — this needs the owner's own Resend account and DNS access, tracked outside this repo.
- `emailed_at`/`email_error` on `event_attendee_imports` (Phase 2).
- The send module itself, and its trigger point inside `importEventAttendees` (Phase 3).
- The queued-delivery job (Phase 4).
- Any change to the interim `/events/[eventId]/import/links` screen — it stays the fallback for a failed send, per the original interim-screen decision (§11.5 of the import doc), not removed by this phase.

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

Not yet done: Resend domain verification (owner action, outside this repo), Phases 2-5.
