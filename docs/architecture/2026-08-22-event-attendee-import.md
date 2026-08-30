# Event attendee import — CSV to claimed profile

**Date:** 2026-08-22, updated 2026-08-27
**Status:** Proposal. Nothing here is built. Requires sign-off before implementation, per CLAUDE.md's "Plan before building."
**Scope:** A host uploads an attendee CSV (Luma, Eventbrite, Partiful, or similar) to one of their events; the people on it are emailed and can claim a pre-filled SmartCard profile they control. Extended 2026-08-27 to add host verification (§9) after the owner raised spam risk, and corrected §3.2's authorization gate against the live database.
**Visual mockups:** published separately as an artifact (linked in the sign-off thread) covering both flows screen by screen.

---

## 0. What this is, and the one thing it deliberately is not

**The ask.** A host finishes an event, exports the attendee list from Luma, uploads it here. Everyone on the list gets an email. They sign up, find their profile already filled in from the CSV, edit it and choose what to share, and land on the event.

**The one part not built.** The original ask ended "…and give them the opportunity to get the contact info and social media info of everyone who attended." That is an attendee directory, and this codebase refuses it in four places:

- `docs/design-lab-reference.md`: *"The actual attendee list: never exposed to anyone except a computed count. There is no 'see who's going' screen showing names."*
- `docs/design/DESIGN.md` §6: *"host-only; the attendee list is nobody's."*
- The initial architecture proposal: *"the attendee list, which stays permanently unreadable per §3.3."*
- On 2026-08-15 the host's own approval queue was changed to **filter out** `going` rows the backend still returns, because the rule *"has no host exception."*

Even "your own connections who are going" was considered and rejected, on the grounds that that set *is* an attendee list.

**Why it stays refused, beyond precedent.** It is not an addition to the §4 verification layer, it is a bypass of it. §4 spends its entire design budget making connections expensive to forge — QR rotation, GPS gating, nonce replay defence, relay resistance. If a spreadsheet yields 200 connections, none of that matters: an attacker does not need to spoof GPS when a CSV works. And co-presence is not meeting. A 500-person event does not mean 499 people met each other.

**Decision (owner, 2026-08-22):** build everything except the directory. Connections continue to require NFC or a live GPS-verified QR scan. This document assumes that and does not revisit it.

> **Superseded in part, 2026-08-27.** The owner, after two flag-and-confirm rounds, amended the non-negotiable rule: an **opt-in, attendee-only, post-event roster** now exists — see `2026-08-27-event-attendee-roster.md` for the decision, the design, and the finding that pairwise co-attendee visibility (phone and email included) had existed in the RLS layer all along. What that amendment does **not** change is this paragraph's second sentence: connections still require NFC or a live GPS-verified scan, and the roster has no connect action. §4.3 below and §8's roster bullet are superseded accordingly; everything else in this document stands.

---

## 1. What already exists, and what does not

Read from the repo, not inferred.

| Thing | State |
|---|---|
| `event_invites` | Exists — but `invited_user_id` is `not null references public.users(id)`. It **structurally cannot** hold someone who has not signed up. Not reusable here. |
| `users.email` | `extensions.citext not null unique` — case-insensitive, one account per address. Good for matching. |
| `users.email_verified` | Exists, `not null default false`, populated by `ensureUser` from the verified Kinde identity. |
| `ensureUser` | **Explicitly refuses email-based account linking.** See §3 — this is the single most important constraint on this feature. |
| Email infrastructure | **None.** No provider, no key, nothing in `.env.example`. Entirely new. |
| `smartcard.tech` DNS | **Live as of 2026-08-22** (owner-confirmed). Q15 is complete, so SPF/DKIM/DMARC are now possible. |
| Rate limiting | Precedent exists — `app_config` card-preview limits, and `claim_unassigned_card`'s two internal limits. |
| Indistinguishable refusal | Precedent exists — `CardClaimResult` answers `{claimed: boolean}` and nothing else, on purpose. |
| Storage buckets + RLS | Precedent exists — `profile-photos`, `event-covers`. |

---

## 2. Schema

### 2.1 `public.event_attendee_imports`

One row per (event, email) from an upload. This table is the most sensitive in the codebase: it holds **personal data about people who have not signed up and never consented to us holding it**. Every decision below follows from that.

```
id                    uuid pk
event_id              uuid not null -> events(id) on delete cascade
email                 citext not null            -- the identity key
first_name            text                       -- everything below is nullable:
last_name             text                       -- a Luma export may carry only an email
phone_number          text
company_name          text
company_role          text
social_links          jsonb not null default '[]'
lookup_token          text not null unique       -- random; the emailed link carries this
imported_by_user_id   uuid -> users(id) on delete set null
imported_at           timestamptz not null default now()
attested_at           timestamptz not null       -- host asserted they may share these contacts
source                text not null default 'csv'
claimed_by_user_id    uuid -> users(id) on delete set null
claimed_at            timestamptz
expires_at            timestamptz not null       -- see 2.3
unique (event_id, email)
```

### 2.2 On claim, the personal data is destroyed

When somebody claims their row, the fields they approved are copied into `users` / `social_links` — their own record, under their own control. The import row's copy is then **redundant**, and keeping redundant unconsented PII is the thing that turns a feature into a liability.

So the claim RPC **nulls out** `email`, `first_name`, `last_name`, `phone_number`, `company_name`, `company_role`, `social_links` and `lookup_token`, leaving only `(event_id, claimed_by_user_id, claimed_at)`. That residue is the attendance fact, it is about a consenting user, and it is what powers "events you have attended."

This is not tidiness. It means a breach of this table exposes only *unclaimed* rows, and the table shrinks toward harmlessness as the feature succeeds.

### 2.3 Unclaimed rows expire

`expires_at` defaults to **180 days** from import, with a scheduled purge. The tension is explicit and worth the owner's attention:

- Longer retention makes retroactive history work better — somebody who signs up a year later gets credited for the event.
- Longer retention means a growing database of contact details for people who never signed up, accumulating across every host who ever uploads.

180 days is a proposal, not a finding. **Open question Q-A below.**

### 2.3.1 What a real export actually contains — checked against a live Luma file

A real Luma guest-list export was supplied 2026-08-27 (`Private_Black_Tie_Networking_Mixer__Guests…csv`, 100 rows). Two findings change what "import" is allowed to mean, found by reading the file rather than assuming its shape:

**`approval_status` is not attendance — it is the host's RSVP decision, and it has three values.** The file has rows marked `approved`, `declined`, and `invited`. Several `declined` rows are people the host explicitly refused entry; several `invited` rows never responded at all. Importing a `declined` row would mark someone the host turned away as having attended their event — the opposite of what happened.

**Decided 2026-08-27: two independently-toggleable buckets, not one filter.** The mapping screen (§4.1 step 3) shows every distinct value found in the detected status column, grouped:

- **Approved** — checked by default, always offered.
- **Waitlisted** — unchecked by default, offered when the platform's export has a distinct waitlist status. Genuinely ambiguous (a waitlisted person may or may not have gotten in later), so it is the host's call per event rather than a hardcoded rule.
- **Everything else** (`declined`, `invited`, `cancelled`, `rejected`, and any value not recognized as approved- or waitlist-like) — shown for transparency, **never offered as a toggle**. These are the values where the platform itself is recording that the person either was refused or never responded, and no host-side judgment call belongs there.

This is a value *category* match, not a fixed string match — Eventbrite and Partiful will not spell these the same way Luma does, so the importer classifies by a small keyword heuristic (`approve`, `confirm`, `going`, `yes` → approved-like; `waitlist`, `pending` → waitlist-like) and lets the host recategorize a value the heuristic gets wrong, rather than hardcoding Luma's exact three strings.

**`checked_in_at` is blank on every row, including every `approved` one.** Luma has a real check-in feature and this host never used it. So even the strongest signal a mainstream ticketing platform offers is absent here, which means **this system has no path to "verified attended" from CSV data at all — only "the host says this person was on the list."** That is a weaker claim than the phrase "attendee import" suggests, and it should be reflected everywhere the product says so out loud:

- Email subject/body: not *"You attended Founders Dinner"* — *"Jacob added you to the guest list for Founders Dinner"*.
- Claim screen: not *"You attended"* — *"You were on the guest list"* or *"Jacob says you were there"*.
- The event page afterwards (§4.3): the same softening applies to any "you attended" chip.

This does not weaken §3's security argument — that argument was never about whether the host told the truth, only about whether the *claiming person* controls the email address. But it does mean the product must not claim more certainty than a spreadsheet can support, and the mockups (§4) need this copy pass before anything ships.

**Column names differ by platform, and that is already handled, not a new problem.** The Luma file's headers (`email`, `first_name`, `last_name`, `phone_number`, custom question columns like `"What company do you work for/with?"`) will not match Eventbrite's or Partiful's own export headers. §4.1 step 3's column-mapping screen — proposing a match, letting the host confirm or repoint each column, requiring only email — already handles any CSV shape without a per-platform parser. Confirmed against this real file rather than assumed: nothing here needed a Luma-specific importer.

**Duplicate rows exist per person.** Several guests appear on more than one row with the same email (multiple ticket registrations under one `guest_id`). The schema's `unique (event_id, email)` constraint already makes this safe — the import upserts on that key rather than erroring, and the second row for the same person is a no-op.

### 2.4 Attendance is not an RSVP

Deliberately not adding an `attended` value to the RSVP status enum. That enum is load-bearing across `event_attendance_counts`, `decide_event_rsvp` and the queue logic, and a new value would need every one of those re-reasoned. "Events I attended" is answered from the claimed import rows instead, which touches nothing existing.

---

## 3. The security argument this feature lives or dies on

### 3.1 `ensureUser` already refuses to do this, and says why

From `apps/web/src/server/auth/ensure-user.ts`:

> **WHY LOOKUP IS BY `kinde_user_id` AND NEVER BY EMAIL** — `kinde_user_id` is the sole link to Kinde (§2.1, §5.3). Falling back to "no row with that Kinde id, but there is one with that email, so it must be [them]" […] anyone who can persuade Kinde to issue them a token carrying somebody else's email address inherits that person's SmartCard account, their cards and their graph.

This feature matches an imported row to a signup **by email**. A reviewer will immediately ask why that is acceptable here. It needs an answer in the migration itself, not in a chat log.

### 3.2 The answer, and its limits

Two things differ.

**The blast radius is bounded.** `ensureUser`'s dangerous case is account takeover — cards, connections, the whole graph, permanently. Here the worst case is that an attacker reads one CSV row: a name, a phone number, a company, some social handles. Real harm, but bounded, one-shot, and containing nothing that grants access to anything.

**Verification is required, and it is not required in `ensureUser`'s dangerous case.** The claim demands a verified email — meaning Kinde or an upstream IdP has proven mailbox control. The attack `ensureUser` describes works precisely because it needs *no* such proof.

**Read the live token claim, NOT `users.email_verified`.** An earlier draft of this document said to gate on the column. That is wrong, and checking the live database is what caught it:

- `ensureUser` writes `email_verified` **only on INSERT**. An existing row returns early and the column is never updated again, so it is frozen at whatever was true the moment the account was created. Somebody who verifies their email a day later still reads `false` here, forever.
- Nothing in the app reads that column today — it is write-only, so the staleness has never mattered and never surfaced.
- Measured 2026-08-26 on the production project: of 341 live users, 337 came from the legacy import and 4 signed up through the app. **All four real signups have `email_verified = false`.** The 305 `true` values are legacy-import data, not anything Kinde asserted. No migration sets the column, so those values came in with the seed.

Two consequences. First, the gate must read `identity.emailVerified` from the freshly verified token (what `api-context.ts` already resolves per request), never the stored column. Second, and more urgent at the time: **Kinde was not asserting `email_verified` for real signups on the connections then enabled** (Email Code, Google, Apple), so this feature would have refused every genuine user until that changed. The urgency is resolved, not the measurement rewritten: the four accounts measured here predate the Email+Password and Username+Password connections added 2026-08-26, and Q-E (§7) records that those two now assert it, confirmed by a real signup.

So the rule is: **a matching email address is a lookup key and never an authorization.** Authorization is `email_verified = true` on the matching address — **or the grandfather clause below.**

### 3.2.1 The grandfather clause — added 2026-08-27, and why it is a better rule, not a weaker one

The owner asked whether existing accounts could simply be marked verified in bulk to sidestep Q-E. The literal version of that does nothing — §3.2 already established that `users.email_verified` is not what the gate reads, so writing `true` into a column nothing checks changes nothing.

But the question pointed at something real: **the actual threat this gate defends against is a brand-new account, created in the last few minutes, specifically to claim someone else's row.** `email_verified` was always a *proxy* for "this account isn't that" — checking mailbox control at the moment of claim. An account that existed before the import happened obviously was not created for it, independent of what its live verification claim says today.

**The gate becomes:** allow the claim when EITHER

1. the caller's `users.created_at` predates the import's `imported_at`, **or**
2. the caller's live token asserts `email_verified = true`.

This is strictly better than the single-condition version, not a carve-out from it:

- It covers all 341 existing accounts with **no data migration and no bulk write** — `created_at` already exists and is already accurate.
- It still stops the actual attack for brand-new signups, which is the case Kinde's verification setting (Q-E) has to be correct for.
- It is a closer match to the real threat model than "verified email" ever was. A ten-year-old account with a stale verification claim is obviously not a drive-by attacker; a two-minute-old account with a technically-true verification claim from a misconfigured connection (§3.3's residual risk) still could be. Condition 1 is immune to §3.3's concern entirely; condition 2 is the fallback for accounts that don't have the luxury of already existing.

One sharp edge: this makes an existing account's **join date** load-bearing for a security decision, which nothing in the codebase currently treats as sensitive. `created_at` must be read from the row itself inside the `security definer` function, never accepted as a client-supplied value — the same posture every other check in this document already takes, stated explicitly here because it is easy to get backwards (a client-supplied "I've had this account for years" claim would defeat the whole point).

This also changes what §9's host-verification gate protects, in a way worth naming: a malicious *verified host* uploading a list of real people's emails still cannot make an attacker succeed at claiming someone else's row, because condition 1/2 is evaluated per *claiming account*, not per import. The two gates are independent and both have to hold.

### 3.3 The residual risk, stated plainly

`email_verified` is only as strong as whatever asserted it. A password signup means Kinde sent a code. Google or Apple SSO means a serious IdP verified it. A misconfigured enterprise OIDC connection could assert `email_verified: true` having verified nothing at all.

**The set of enabled Kinde connections is therefore a security dependency of this feature**, which is not obvious and will not show up in any test. If a connection type is added later that self-asserts verification, this feature silently weakens. That belongs in the migration comment and in the Kinde runbook.

### 3.4 The emailed link is not a credential

The link carries `lookup_token`, which identifies *which* invitation. It does not authorize claiming it. Email is forwarded, quoted, archived, and read on shared machines; a link that auto-claims is a link that lets anyone who ever sees the message take somebody's data.

Both are required: possession of the token **and** a verified matching address.

### 3.5 Nothing personal renders before verification

The claim page shows the **event name and the host's name and nothing else** until the email is verified. If it rendered "Sarah Chen · 555-0134 · Acme" on load, the emailed link would itself be the leak — one forward and her phone number is in someone else's inbox.

### 3.6 Refusals are indistinguishable

"No such import", "already claimed", "expired", and "your verified email does not match" return one identical answer. Otherwise the endpoint is an oracle for *whether a given email address attended a given event*, which is exactly the kind of question this product exists not to answer. Same posture and same reasoning as `CardClaimResult`.

### 3.7 Rate limits

Per-caller and per-token limits on the claim RPC, following the `app_config` pattern already used by card preview and `claim_unassigned_card`. Without them, §3.6's indistinguishable refusal is still brute-forceable.

### 3.8 RLS: nobody reads this table directly

Deny-all, no exceptions, including the host. All access is through `security definer` functions:

- `import_event_attendees(...)` — host-only, writes rows, records attestation
- `event_import_summary(event_id)` — host-only, returns **counts only**
- `list_own_import_links(event_id, …)` — **added 2026-08-29, and a deviation from the paragraph below.** Returns pending claim links for rows *this caller imported*. See §11.5.
- `get_claimable_import(lookup_token)` — returns prefill only when §3.2/§3.2.1's conditions hold (verified email, or a pre-existing account), else null
- `claim_event_import(lookup_token, approved_fields)` — writes, then destroys per §2.2
- `own_attended_events()` — the caller's own claimed rows

The host uploaded the CSV, so letting them read it back discloses nothing new *today* — but a direct grant means the PII travels with whoever holds the host role later, and survives any future change to event ownership. A counts-only function costs nothing and removes that.

> **Partially deviated from, 2026-08-29 — see §11.5.** One read path now exists, and it is gated on `imported_by_user_id` rather than on holding the host role, which closes this paragraph's exact objection by construction. No grant on the table itself was added; RLS is still forced with zero policies.

### 3.9 What the host learns back

`event_import_summary` returns **aggregates**: `142 imported · 138 emailed · 94 opened · 51 claimed`. Not a per-person list of who joined.

The host already knows who was on their CSV. They do **not** currently know which of those people hold SmartCard accounts, and a per-row "claimed ✓" would tell them — disclosing one person's membership to another without asking. Aggregates answer the host's real question ("is this working?") without that.

---

## 4. The flows

Visual mockups accompany this document. In summary:

### 4.1 Host

1. **Event page (host view)** → "Import attendees"
2. **Upload** — drop the CSV. Size cap, UTF-8/BOM handling, row cap.
3. **Map columns** — Luma's headers are detected and proposed; the host confirms which column is the email. Email is the only required mapping.
4. **Review and attest** — "138 of 142 rows usable. 4 skipped (no email address)." Plus the attestation checkbox, which is stored as `attested_at`.
5. **Status** — aggregates only, per §3.9.

### 4.2 Recipient

1. **Email** — from the host's name, about the event they actually attended. Not a SmartCard advertisement.
2. **Claim page, unverified** — event and host only. Nothing personal. (§3.5)
3. **Verify** — Kinde signup/sign-in with that address.
4. **Review prefill** — every field the CSV offered, each individually keepable or discardable, with the existing profile visibility controls applied. Default is *filled in but nothing shared beyond what the normal profile defaults share.*
5. **Land on the event.**

### 4.3 What the recipient sees on the event afterwards

The event page as it exists today, plus "You attended this." Counts, the `connections_made` number, and "N of your connections were here" — all of which already exist and already name nobody outside the viewer's own graph.

**No attendee list.** A profile is reachable from an event only if that person is already a connection, through the ordinary connection route. That is the boundary this whole document is organised around, and it is the thing to check hardest in the mockups.

> **Superseded 2026-08-27** by the roster amendment (`2026-08-27-event-attendee-roster.md`): opted-in attendees are now also reachable from the event page, view-and-save only, with the connect wall in place. The mockups' C1/C2 screens were updated the same day.

---

## 5. Email, as its own phase

Decided separately: email is scoped as its own phase and does not block the import work.

**Two different kinds of mail, with very different risk:**

| | Verification codes | Invitation blast |
|---|---|---|
| Volume | One, on request | Hundreds, unsolicited |
| Recipient expectation | Asked for it seconds ago | Never heard of us |
| Spam risk | Low | High |
| Legal exposure | Minimal | CAN-SPAM framing; GDPR lawful basis for any EU/UK attendee |

The second is what can poison the domain's reputation and take the first down with it. Required before any bulk send: SPF/DKIM/DMARC on `smartcard.tech` (now possible — DNS is live), a suppression list, one-click unsubscribe with `List-Unsubscribe` headers, and bounce/complaint webhooks that auto-suppress.

**Framing matters more than anything technical here.** "Jacob invited you to claim your profile from Founders Dinner" is a message from someone the recipient met. "Join SmartCard" is spam. The first is also the honest description of what happened.

---

## 6. Effort

| Piece | Effort | Model/effort per CLAUDE.md |
|---|---|---|
| Migration: table, RLS deny-all, five RPCs | 1 focused session | Opus / xhigh — RLS and a PII table |
| CSV parse, upload, column mapping, preview | 1–2 sessions | Sonnet or Opus / high |
| Claim + prefill flow | 1–2 sessions | Opus / xhigh — §3 lives here |
| Retroactive attendance history | ~½ session | Sonnet / high — same lookup, run over all rows |
| Host verification: application, `is_verified_host`, admin review queue (§9) | 1–2 sessions | Opus / high — a new privilege boundary |
| Email (separate phase) | 2–3 sessions + DNS/deliverability + ongoing ops | Opus / high |

**~6–8 focused sessions excluding email**, up from ~4–6 with host verification added.

The CSV parsing is the easy 5%. The cost is in §3 and in the RLS.

---

## 7. Open questions

| | Question | Why it needs the owner |
|---|---|---|
| **Q-A** | Retention for unclaimed rows — 180 days proposed. | Directly trades retroactive-history usefulness against how long we hold contact details for people who never signed up. A product and legal call, not a technical one. |
| **Q-B** | Row cap per import, and per-host rate limit. | Nothing yet stops a host uploading 50,000 addresses. Needs a number. |
| **Q-C** | Does the person get told *which host* uploaded them, and can they refuse and be purged? | A "remove me and don't ask again" path is close to mandatory under GDPR/CCPA and is the right thing regardless. Needs a suppression list that survives future imports. |
| **Q-D** | ~~Exact Luma export columns.~~ **Resolved 2026-08-27** — a real export was supplied and read; see §2.3.1. Eventbrite's and Partiful's own headers are still unseen, but the mapping screen does not require them in advance (§2.3.1's third finding). |
| **Q-E** | ~~Whether Kinde asserts `email_verified` for real signups.~~ **Resolved 2026-08-27 — confirmed empirically, not assumed.** There is no dashboard toggle for this: per Kinde's own docs, a one-time-code email verification is mandatory on first sign-up for both the Email+Password and Username+Password connections, with no way to disable it. That is not what was tested — docs describe intent, not this project's configuration. The owner confirmed by signing up fresh, incognito, through the password connection: Kinde required the one-time code before the account was usable. Condition 2 of §3.2.1's gate (`email_verified = true` on the live token) therefore holds for brand-new signups exactly as designed, on top of condition 1 already covering all 341 pre-existing accounts. Both halves of the gate now stand on a measured fact rather than an assumption — the same discipline §3.2's original correction and §3.2.1's grandfather clause both insisted on. |

---

## 8. What this document does not decide

- Whether to build it at all, or when.
- The attendee directory. Refused above; reopening it means amending the non-negotiable product rule in CLAUDE.md and the four documents in §0, as a deliberate decision with its own write-up.
- Whether attendance should ever become a *connection* by any route. It should not, under the current thesis.
- The email provider.
- ~~Whether an event roster should exist in any form.~~ **Resolved 2026-08-27: it does.** The separate write-up this bullet asked for is `2026-08-27-event-attendee-roster.md`, including the `users` visibility column §9.4 said would be needed.

---

## 9. Host verification — added 2026-08-27

**Why this exists.** Anyone who can create an event today could otherwise upload a CSV to it. That is a spam and abuse surface with no gate at all: a bad actor creates a throwaway event and imports a purchased or scraped list, and every one of those addresses gets an email that looks legitimate because it comes from `smartcard.tech`. The owner raised this unprompted, correctly — it is a real gap in §2/§3 as written, which assumed a trustworthy host without ever establishing what makes a host trustworthy.

**The mechanism: a flat, account-level flag, not a per-event approval.** Owner's decision, 2026-08-27: once approved, a host may import to *any* of their events, not just the one they applied against. This is deliberately the same shape `is_admin` already uses — a boolean the client can never set, flipped only by an admin action — reusing a privilege pattern this codebase already has rather than inventing a parallel one.

### 9.1 Schema

```
public.host_applications
  id                    uuid pk
  user_id               uuid not null references users(id) on delete cascade
  organization_name     text not null
  applicant_role        text not null        -- "your role" at the organization
  past_event_link       text not null        -- a Luma/Eventbrite/Partiful page or social post
  expected_event_size    text                 -- free text bucket, not a hard number
  hosting_frequency      text                 -- e.g. "one-off", "monthly series"
  status                text not null default 'pending'
                          check (status in ('pending', 'approved', 'rejected')),
  submitted_at          timestamptz not null default now(),
  decided_at            timestamptz,
  decided_by_user_id    uuid references users(id) on delete set null,
  rejection_note        text                 -- shown to the applicant; see 9.3
  unique (user_id) -- one live application per user; re-applying after rejection replaces it
```

```
public.users
  + is_verified_host    boolean not null default false
```

`is_verified_host` follows `is_admin`'s existing exclusion pattern exactly: absent from `userProfileUpdateSchema` and from the column-level UPDATE grant, so a client cannot set it on itself by any route, including a raw PostgREST call. The only writer is `decide_host_application`, a `security definer` function, mirroring how `has_completed_signup` is set only by server code that observed the real event, never claimed by the row itself.

### 9.2 The application fields, and why these four

Decided with the owner 2026-08-27, multi-select:

- **Organization name + the applicant's role** — bare minimum identity.
- **A link to a past event** (a Luma/Eventbrite/Partiful page, a social post) — cheap to fabricate, but it filters out the zero-effort case, which is most spam.
- **Expected event size / hosting frequency** — lets an admin judge risk at a glance ("500-person recurring series" reads differently from "one dinner party"); free text, not a hard cap, since this is input to human judgment, not a machine gate.

Not asked: government ID, business registration, or anything that would make the form itself a data-collection liability disproportionate to what it protects.

### 9.3 The admin review screen

Gated on `is_admin = true` — the same column every other privileged check in this codebase already uses, and the **first UI surface that actually reads it**; today `is_admin` exists only as a thing every grant excludes.

- **Queue**: pending applications, oldest first, showing the four fields plus the applicant's existing profile (name, photo — an admin reviewing this is not a stranger to the applicant's other data).
- **Approve**: sets `is_verified_host = true`, `status = 'approved'`. No note required.
- **Reject**: sets `status = 'rejected'`. `rejection_note` is optional free text; if present, it is what the applicant sees, so it should read as a reason to a person, not an internal flag (e.g. *"We couldn't verify a past event — feel free to reapply with a link."*), never a copy-paste of internal suspicion.
- **Re-application**: a rejected applicant can submit again; the `unique(user_id)` means a new submission replaces the old row rather than accumulating a history an admin has to page through.

### 9.4 What this does and does not solve

**Solves:** a stranger cannot spin up an event and blast a purchased list through a domain with SmartCard's name on it, without a human having looked at who they are first.

**Does not solve:** a verified host acting in bad faith on a real list — uploading people who were invited but never actually attended (§2.3.1's `approval_status` finding is the relevant control there, not this one), or reusing verified status across many low-quality events. `is_verified_host` is a **floor**, not a guarantee; it raises the cost of abuse from "click a button" to "convince a human once," which is the level of friction most of this codebase's other defenses (rate limits, indistinguishable refusals) are calibrated to as well.

**Not the same question as the roster.** §8 lists an event-roster visibility feature as raised but unresolved. Host verification and a roster are independent: this section gates *who may import a list at all*; a roster (if ever built) would additionally gate *who among a verified list may see each other*, and would need its own visibility column on `users` that does not exist today. Do not conflate "this host is trustworthy enough to import" with "this attendee agreed to be seen."

---

## 10. Build log — Kinde configuration changes made 2026-08-26/27

Recorded here because they are inputs to §3's security argument, even though they happened in the Kinde dashboard rather than in this repo.

- **Refresh token expiry** raised from 15 days to 365 days on the Mobile application, and **session inactivity timeout** raised, to fix "asks for a code every sign-in" — a UX complaint unrelated to this feature, but relevant background for why the owner then asked about adding a password connection.
- **Email + Password** and **Username + Password** connections enabled on the Web application (2026-08-26), alongside the pre-existing Email Code, Google, and Apple connections. Username + Code was deliberately left off — a bare username has no channel to receive a code on.
- **Confirmed 2026-08-27 (Q-E): there is no separate toggle, because there is nothing to toggle.** The owner went looking for a "require email verification" setting on each password connection and found none — Kinde's own docs explain why: a one-time-code email verification is mandatory on first sign-up for both Email+Password and Username+Password, with no way to disable it. Confirmed empirically rather than taken from the docs alone: the owner signed up fresh, incognito, through the password connection and was required to enter a one-time code before the account worked. §3.2's gate depends on Kinde asserting `email_verified` for real signups, and this is that assertion, observed rather than assumed.

---

## 11. Build log — what is implemented, and the decisions the build made

### 11.1 What exists as of 2026-08-27

| Layer | Where | State |
|---|---|---|
| Host verification | `20260827120000_table_host_applications_and_verified_host.sql` | Applied and verified live (§9.1) |
| Import table + write RPC | `20260827130000_table_event_attendee_imports.sql` | Applied and verified live |
| CSV reader (RFC 4180) | `packages/core/src/events/csv.ts` | 22 tests |
| Column mapping, status classification, normalisation | `packages/core/src/events/attendee-import.ts` | 28 tests, against the real Luma headers from §2.3.1 |
| Payload / summary schemas | `packages/types/src/db/event-attendee-imports.ts` | — |
| Service | `apps/web/src/server/events/attendee-import-service.ts` | 29 tests, six mutations confirmed red |
| Server Action | `apps/web/src/app/(app)/events/[eventId]/import/actions.ts` | — |
| The four host screens (§4.1) | `apps/web/src/app/(app)/events/[eventId]/import/` | 15 tests, seven mutations confirmed red |

| `get_claimable_import` (§3.8, C2 of the claim flow) | `20260828120000_fn_get_claimable_import.sql` | 11 scenarios verified live in a rolled-back transaction; applied and re-verified against the deployed function |
| `claim_event_import` (§3.8, C3 of the claim flow) | `20260828130000_fn_claim_event_import.sql` | 8 scenarios verified live in a rolled-back transaction; applied and re-verified against the deployed function |

| The claim screens (§4.2, C4) | `apps/web/src/app/claim/[token]/`, `apps/web/src/server/events/claim-service.ts` | Built and verified 2026-08-28; migration verified live in a rolled-back transaction, applied |

| `own_attended_events` (§3.8/§4.3, C5) | `20260828150000_fn_own_attended_events.sql` | Verified live in a rolled-back transaction (own rows only, ordering, another claimant's and an unclaimed row both absent, `anon` refused execution); applied |
| The event-page "guest list" note (§4.3, C5) | `apps/web/src/app/(app)/events/[eventId]/page.tsx` (`AttendedNote`), `apps/web/src/server/events/attended-events-service.ts` | Built and verified 2026-08-28 |

| `list_own_import_links` + the links screen (§11.5) | `20260829120000_fn_list_own_import_links.sql`, `apps/web/src/app/(app)/events/[eventId]/import/links/` | 12 scenarios verified live in a rolled-back transaction; applied and re-verified against the deployed function. **Interim, pending §5.** |
| The host application form (§9.2) | `apps/web/src/app/(app)/host/apply/`, `apps/web/src/server/hosting/host-application-service.ts` | Built 2026-08-30, against the RPCs `20260827120000` already shipped. Linked from `import/page.tsx`'s `NotVerifiedYet` and from a new banner on `/events` — see §11.6. |
| The admin review queue (§9.3) | `20260830120000_fn_admin_list_host_applications.sql`, `20260830130000_storage_admin_read_applicant_photos.sql`, `20260830140000_fn_is_admin_reader.sql`, `apps/web/src/app/(app)/admin/host-applications/` | Built 2026-08-30. Two new narrow reads (an applicant's name+photo, an applicant's photo object) rather than widening `users`' grant or policy — see §11.6. |

Not built yet: the roster's remaining pieces (`docs/architecture/2026-08-27-event-attendee-roster.md`), email (§5), retroactive attendance history, and the purge job for expired unclaimed rows.

### 11.5 Deviation: a host CAN now read back the claim links for guests they imported — 2026-08-29

**This reverses §3.8's "nobody reads it directly, the host is not exempt", and §3.8's own paragraph has been annotated to point here.** Recorded as a deviation with its reasoning, per CLAUDE.md, rather than built quietly around.

**Why.** §5's email phase is not built and was never scheduled against this work. The consequence had not been stated out loud until the owner asked what was left before testing: a `lookup_token` is written into a table with no read path, so **nothing can deliver a claim link to the guest it belongs to**, and the entire claim flow — C2 through C5, all built, all verified live — cannot be exercised by a real person at all. The only way to reach `/claim/[token]` today is to query the database by hand with the service role, outside the app. A feature that only its own developers can trigger is not a feature yet.

**Owner decision, 2026-08-29:** build a narrow interim surface so a host can hand one guest their own link by whatever channel they already use, and build the email phase in parallel. Explicitly temporary — it is expected to be removed, not extended, once mail is sent for the host.

**How §3.8's objection is answered rather than overruled.** The objection was never "the host must not see this data" — they uploaded it. It was precisely that a grant would make the PII **travel with the host role**, outliving the person who supplied it. So the gate is `imported_by_user_id = private.current_user_id()`, evaluated per row, not "are you the host of this event":

- A host who inherits an event later reads **nothing** from an import somebody else ran — verified live, and it is the scenario the original paragraph describes.
- Co-hosts, admins and the service role are equally shut out; there is no "but they are a host now" argument available.
- `imported_by_user_id` is `on delete set null`, so if the importer's account is deleted the rows become unreadable to everybody, permanently.
- Verified-host standing is re-derived on every call, so revoking verification for abuse also stops the tokens for lists already uploaded — not just future uploads.

**What it still refuses, which is the part to check hardest in review.** Only **unclaimed, unexpired** rows, and only `first_name`, `last_name`, `email`, `lookup_token`. There is no per-person claim status and no way to derive one, so §3.9's line has not moved: the host still cannot learn which of their guests hold SmartCard accounts. Phone numbers, employers and social handles are not returned at all — they are in the host's own spreadsheet already and nothing about sending a link needs them, which is the half of §3.8's argument that still stands. Paging is clamped server-side, so a hand-written `p_limit` returns a page rather than the table, and the call is rate-limited per host.

**Verified live** in a rolled-back transaction across 12 scenarios before applying: the importer's own live rows with correct tokens and email ordering; no field beyond the four; claimed and expired rows absent from both the list *and* the count; another importer's row in the same event invisible; no cross-event leak; **the successor-host case above**; a former host refused outright even for rows they imported; an unverified host refused; an unknown event id refused identically (no existence oracle); page-size clamping and coercion of negative arguments; non-overlapping paging; and the table itself still carrying zero policies, no SELECT grant to any role, and no `anon` grant on the new function.

**What this does not change.** No connection is created by any of it, the roster amendment is untouched, and the attendee directory stays refused.

### 11.6 §9.2/§9.3 built — the application form and the admin review queue — 2026-08-30

The two screens §11.1's build log had listed as not built yet. Both RPCs
(`submit_host_application`, `decide_host_application`) had existed since
20260827120000 with no UI ever calling them; a host who wanted to become
verified had no way to ask.

**`/host/apply`** (`apps/web/src/app/(app)/host/apply/`). No gate beyond
sign-in — anyone may apply, since §9.1 does not require already hosting
anything first. Reads `isVerifiedHost` (not just the application's own
`status`) because the two can disagree in both directions: §9.4's revocation
can flip `is_verified_host` to `false` while a `status = 'approved'` row sits
untouched, and the happier case (already verified) has no reason to see a
form. A rejected applicant's fields prefill the form on re-application, with
the rejection note shown as read-only context above it — never resubmitted,
since `submit_host_application` clears it on any new submission regardless of
what the form sends.

**`/admin/host-applications`** (`apps/web/src/app/(app)/admin/host-applications/`).
Same three-gate shape `/events/[eventId]/queue` already uses: the RPC is the
real enforcement (refuses a non-admin outright), a page-level `isAdmin()`
check decides routing (`notFound()` for anybody else), and nothing below that
re-checks, because — unlike the RSVP queue — no second role reaches this
route at all.

**Two new narrow reads, not one widened grant, to make the queue show what
§9.3 asks for ("the applicant's existing profile — name, photo").** Both
follow the same shape §11.5 used for `list_own_import_links`: solve the
specific disclosure the screen needs, in the database, rather than opening a
grant that would let an admin read every user's phone number and bio from any
future direct-PostgREST path.

- `admin_list_host_applications` (20260830120000) — `host_applications`
  already lets an admin `SELECT` every row (20260827120000's own policy), but
  `users`' SELECT grant (20260814230000) has no admin branch, so the join
  happens inside one `security definer` function instead. Fails closed to an
  empty array for a non-admin, matching `private.is_admin()`'s own shape,
  rather than an exception — there is no screen that shows this refusal to
  anybody.
- The storage policy in `20260830130000` — Storage enforces its own RLS at
  signing time, so an admin's ordinary client could not mint a signed URL for
  an applicant's photo even after the row-level join above. Rejected: routing
  around it with the service role (`photo-url.ts`'s own header explains why
  that "would silently bypass the exact check this module exists to
  respect"). Instead, a second permissive SELECT policy on
  `storage.objects` — Postgres combines same-command permissive policies with
  OR, so the existing self-only policy is untouched — admits a path only when
  the caller is an active admin AND the path's owner has a `host_applications`
  row of any status (not narrowed to `pending`, so an admin reviewing
  decision history still sees the photo).
- `public.is_admin()` (20260830140000) — a thin public wrapper around
  `private.is_admin()`, mirroring `is_verified_host()`'s own existing shape,
  because `private.is_admin()` lives outside PostgREST's exposed schema and
  cannot be called from the app at all. FOR DRAWING A SCREEN, NEVER FOR
  DECIDING ONE, exactly as `is_verified_host()`'s own TypeScript wrapper
  warns — every RPC the admin screens call re-derives admin status itself.

**Also new: a "Apply to become a host" banner on `/events`** (`host-apply-banner.tsx`).
`/host/apply` existed with no link to it visible before a host had already
tried to import and hit the wall — this is the front door. Hidden for anyone
already verified or with a pending application; shows a "reapply" variant for
a rejected one. Reads `getOwnHostApplication` soft-failed to `null` on this
page (`.catch(() => null)`), a deliberate departure from `/host/apply`'s own
fail-closed contract for the same function: on `/host/apply`, masking a read
failure risks a duplicate application, so it throws; on the browse page, the
worst a stale `null` does is show or hide one banner, and failing the whole
events list over that would be the worse outcome.

**Verified live** in rolled-back transactions before each migration was
applied: `admin_list_host_applications` across 5 scenarios (non-admin gets
`[]`; admin sees pending oldest-first with the joined name/photo; a decided
application drops out of the pending list and appears in its own status list;
an unknown status filter is refused rather than silently empty; no field
beyond the documented set is returned); the storage policy across 4 (admin
reads an applicant's photo; admin is refused a non-applicant stranger's photo;
a non-admin is refused the applicant's photo; the pre-existing self-read policy
is unaffected); `is_admin()` across 3 (admin reads true, non-admin reads
false, `anon` is refused execution outright). Two mutations of the new
TypeScript service confirmed red before the tests were trusted.

### 11.1.7 C5 — `own_attended_events()` and the event-page note — built 2026-08-28

The last of §3.8's five RPCs, and the read that finally uses the fact §2.2
deliberately kept: `(event_id, claimed_by_user_id, claimed_at)`, left behind
on every claimed row specifically so "events I attended" could someday be
answered from it.

**No rate limit, unlike its four siblings — and that is a property of the
function's own shape, not a relaxed standard.** `get_claimable_import` and
`claim_event_import` both take a caller-supplied token and can be pointed at
somebody else's row, which is exactly what §3.6/§3.7 exist to bound.
`own_attended_events()` takes no argument at all — the only input is
`private.current_user_id()`, resolved from the caller's own verified
session — so there is no other identity to probe for. Recorded in the
migration's own header so a future reader does not read the absence of a
rate limit here as an oversight copied from the wrong sibling.

**Verified live in a rolled-back transaction, not assumed from the query's
shape.** A claimant with two claimed rows across two events saw exactly
those two, most-recent-claim-first; an unrelated user with one claimed row
saw exactly that one; a second host's unclaimed row (a live, unexpired
import nobody had claimed) appeared for nobody; and a caller with no
session (`anon`) was refused *execution* outright rather than returning zero
rows through a filter — the grant, not just the `WHERE` clause, is what a
reader should trust here, and the test checks the grant.

**The event-page note is deliberately not "You attended", contradicting
§4.3's own heading.** §2.3.1's copy pass — "this system has no path to
'verified attended' from CSV data, only 'the host says this person was on
the list'" — names the event-page chip explicitly as covered by the same
softening the claim screens already got. `AttendedNote` says "You were on
the guest list for this event," the identical phrasing `claim-review.tsx`
and `claim-teaser.tsx` use, rather than a third independently-worded variant
of the same claim.

**Deliberately disconnected from `ownRsvp` and the RSVP status enum**,
exactly as §2.4 specifies. `listOwnAttendedEventIds` is read and rendered
independently of `getOwnRsvp` on the event page — a claimed guest can hold
any RSVP status, including none at all, and the note's visibility does not
consult it.

**`listOwnAttendedEventIds` fails closed to an empty set on every error
mode, including a thrown one** — `attended-events-service.test.ts` asserts
this for an RPC error, a malformed response, and a thrown transport failure.
This is not a §3.6 oracle concern (there is nothing to probe; every failure
already answers only about the caller's own data) — it is CLAUDE.md's
fail-closed rule applied to which DIRECTION a failure should lean: an
unreadable result must never show a claim of attendance the app could not
actually verify. The event page itself must not go down over this either,
matching the posture `getEventHostProfile` and `getConnectionsAttending`
already take on the same page.

### 11.1.6 C4, the claim screens — built 2026-08-28

Four components rendered from one route (`/claim/[token]`), splitting not by
§4.2's literal step numbers but by disclosure level — see the route's own
header for the full mapping. The decisions worth recording here are the ones
not already implied by C2/C3:

**`/claim/[token]` sits outside `(app)`, and outside `/events/`.** The
`(app)` layout redirects every signed-out visitor to `/`, which would lose
the token — the same failure `/card/[code]`'s header describes for a lost
NFC tap, and the same fix: its own self-contained gate,
`postLoginRedirectURL` pointed at itself. `/events/claim/[token]` was
considered and rejected: `(app)/events/[eventId]` is a single dynamic
segment one level below `/events`, so a second, differently-gated route tree
sharing that prefix invites exactly the kind of collision this codebase
avoids elsewhere. `/claim/[token]` matches the shape already established by
`/card/[code]` and `/c/[token]` — short, token-driven, pre-auth — rather than
inventing a fourth pattern.

**A gap found building this screen, not anticipated building C2/C3:
`get_claimable_import` never returned `event_id`.** §4.2 step 5 is "land on
the event", and nothing in either RPC's response said which one — C2 and C3
both predate there being a screen that needed to route anywhere.
`20260828140000_fn_get_claimable_import_event_id.sql` adds it to
`get_claimable_import`'s jsonb only; `claim_event_import` still answers
exactly `{claimed: boolean}` and was not touched, because the caller already
has `event_id` from the read that happens before the review screen ever
renders. Disclosing it is not a wider grant than `event_name` already makes
at the identical level (§11.1.4): an id is not a narrower secret than a
title once a caller already holds the 244-bit token. Verified live in a
rolled-back transaction — matching caller sees `event_id` and the prefill,
an unrelated real account sees `event_id`/`event_name` but no prefill, an
unknown token stays the bare `{available: false}` — then re-verified against
the deployed function before this file was updated.

**Signed out is not `/card/[code]`'s "show a preview anyway".** That route's
preview works signed-out because `card-preview-service.ts` runs with the
service role for its own bounded reason (a real client IP to rate-limit on).
`get_claimable_import` deliberately does not do that (20260828120000's
header) — no per-caller rate-limit key exists for `anon` — so a signed-out
visitor here sees a generic "you've been added to a guest list" screen with
no event or host name at all, never a teaser. This is §4.2's "unverified"
reinterpreted exactly as C2's own migration already reinterpreted it:
signed-in-but-unproven, not signed-out.

**The teaser (`available: true, can_claim: false`) and the refusal
(`available: false`) are two different components, not one parameterised by
a reason.** The teaser discloses event and host name — already knowable from
holding the token — with one fixed sentence that names no specific cause
(wrong account, unverified, already claimed). The refusal discloses nothing
at all. Collapsing them into one component with an `available` prop would
have been harmless today, but it would invite a future edit to thread a real
reason through both branches "since they're basically the same screen" —
exactly the drift §3.6 exists to prevent. Two components with no shared prop
surface make that mistake structurally harder to make.

**Every prefilled field defaults to checked, unlike the host's attestation
checkbox.** The host's checkbox (`review-and-attest.tsx`) cannot start
ticked because it is a claim of authority over someone else's contacts. The
claim screen's checkboxes are the opposite kind of choice — a person keeping
or discarding their OWN data — matching §4.2's own "default is filled in".
A field with no value in the row renders no checkbox at all, both because
there is nothing to keep or discard and because an unfixable trap ("check
this box to keep a value that doesn't exist") is worse than an absence.

**The copy pass from §2.3.1 is enforced by a test, not just written once.**
`claim-review.test.tsx` asserts the word "attended" never appears on the
review screen under any prefill shape, and that "guest list" does — the same
category of test `import-screens.test.tsx` already runs for the host side's
own rules, so the sentence this document insists on cannot regress silently
through an unrelated copy edit.

**`getClaimableImport` fails closed to `{available: false}` on every error,
including a thrown one — never just on a graceful `{available: false}`
answer.** `get_claimable_import` itself raises (`55000`) rather than
answering gracefully when its own rate-limit config is missing
(20260828120000). If the TypeScript wrapper let that surface as a thrown
error while every other refusal renders `ClaimNotAvailable`, a misconfigured
deploy would be visibly distinguishable from a bad token — the exact oracle
§3.6 rules out, moved one layer up instead of fixed. `claim-service.test.ts`
asserts this explicitly, including for a raw transport failure and an
unrecognised response shape. `claimEventImport` (the write) does not follow
this pattern and throws on a transport failure — a claim is an action a
caller expects to have worked or not, and that distinction is what lets the
Server Action offer a retry rather than silently equating "we could not ask"
with "the answer was no".

### 11.1.4 `get_claimable_import` — the first read path into the table, and why it requires `authenticated`

Built and verified 2026-08-28. §3.8 named this function but didn't settle how a caller reaches it before signing in; building it surfaced a real fork, resolved here rather than left implicit.

**The gate needs a caller.** §3.7 requires per-caller AND per-token rate limits. A per-caller limit needs a stable identity to key `rate_limit_consume` on — and a `security definer` SQL function reachable by `anon` has no such identity available: no client IP, no session, nothing but caller-supplied arguments, which are worthless as a rate-limit key (an attacker just supplies a fresh one every call). `card_preview_views` solves the equivalent problem for its own anonymous surface with the service role in TypeScript, where the real client IP is visible. That option was rejected here: `event_attendee_imports`'s own header commits to "nobody reads it directly... the only way in is a `security definer` function," and reopening that for a service-role caller is not a decision to make by default for the most sensitive table in the schema.

**So `get_claimable_import` requires `authenticated`, and §4.2's "claim page, unverified" is reinterpreted accordingly.** "Unverified" now means "signed in, but not yet proven to be the person this row is about," not "not signed in at all." A recipient who isn't already signed in hits Kinde's ordinary sign-in/sign-up screen first — which, per Q-E, already forces one-time-code email verification on the password connections regardless of this feature. `anon` holds no grant on the function at all; verified live (`has_function_privilege('anon', ..., 'EXECUTE') = false`).

**Two disclosure levels, gated differently, and deliberately so:**
- Event name and host name are returned whenever the token resolves to a live, unclaimed, unexpired row — **not** gated behind `can_claim`. A caller who already possesses the unguessable 244-bit token already knows this much from the claim email itself (§4.2 step 1 names the event); gating it would only make "who is this link even for?" unanswerable before sign-in, without protecting anyone who doesn't have the token.
- The prefill (name, phone, employer, socials) is gated behind `can_claim`: the caller's live token must assert an email matching the row, AND (that email is verified OR the account predates the import, per §3.2.1). Every way `can_claim` can be false — wrong account, unverified, and every §3.6 refusal reason — collapses to the identical `{available: true, can_claim: false, prefill: null}` shape or the identical `{available: false}` shape. Telling a caller *which* check failed would be the oracle §3.6 rules out, one bit at a time, across repeated sign-ins with different addresses.

**The match is against the live `auth.email()` claim, never `users.email`** — same reasoning as §3.2's original correction, now reusable: Supabase's own `auth.email()` builtin (the `auth.uid()` sibling) reads the same per-request claim `mintSupabaseAccessToken` signs. The grandfather check reads `users.created_at` instead, deliberately the opposite choice — that clause's whole premise is that a join date is a fact about the past a two-minute-old account cannot retroactively acquire, which is the one thing the live token can never assert.

**A schema change surfaced by the rate limit itself.** `rate_limit_events.subject_kind` is a closed CHECK (`user`, `ip`, `card`, `session`) specifically so a typo can't silently create a dead counter. The per-row limit needed a fifth kind — `user` was already spoken for by this function's *other* limit (the per-caller one), and reusing it for the row would be exactly the silent-collision bug the CHECK exists to catch. Added `'import'`, matching the name that table's own original header had already anticipated ("contacts import is already on the list, and is not built").

**Verification.** 11 scenarios run in a rolled-back transaction as real users with real policies in force: verified match (`can_claim: true`, correct prefill), unverified match (teaser only), the grandfather clause covering an unverified pre-existing account, a verified-but-wrong-email caller (verification does not override a mismatch), all four refusal shapes returning identically, the `anon` grant boundary, a missing-config fail-closed path, and both rate limits' exact boundary behavior (the Nth call allowed, the N+1th refused, independent of which caller made it). One test-writing bug caught along the way and fixed before the assertions were trusted: `jsonb -> 'key' IS NULL` does not detect a JSON `null` value — Postgres's `->` returns the JSONB `null` literal, which is not itself SQL `NULL`; `->> 'key' IS NULL` (or comparing against `'null'::jsonb`) is required. The function's actual output was correct throughout; only the test's assertion syntax was wrong.

### 11.1.5 `claim_event_import` — the write that commits a claim and destroys the row's PII in one statement

Built and verified 2026-08-28. This is C3 of the claim flow: `get_claimable_import` (C2) can only look; this is the function that actually copies fields into a profile and, per §2.2, is also the last moment this table ever holds this person's contact details.

**The gate is now a shared function, not a second copy.** `get_claimable_import` computed `can_claim` as three inline lines: does the live `auth.email()` match the row, and (is it verified OR does the caller's account predate the import, §3.2.1). This function needs the identical question, re-derived from scratch rather than trusted from an earlier call to `get_claimable_import` — a caller can reach this RPC directly, with a different session than whatever checked availability first. Writing the formula twice would be the drift this repo's own `private.can_see_event()` / `private.is_event_host()` precedent exists to prevent, so it was pulled out into `private.import_claim_authorized(row)`, and `get_claimable_import` was `create or replace`'d in the same migration to call it instead of computing it inline. Behaviour did not change; only where the formula lives did.

**Two real schema gaps, found by a rolled-back verification run rather than assumed away.** §2.2 requires nulling `email` and `lookup_token` on claim, but `20260827130000`'s table left both `not null` — correct for that migration's own scope, which never wrote a claim, but wrong for this one. The first verification run failed on `email` (`23502`); fixing that column and re-running failed the identical way on `lookup_token` immediately after. Both are gaps in the original migration, not a reason to pick a different destruction shape (a sentinel value, say) — §2.2's text is unambiguous that both columns are nulled. This migration drops `NOT NULL` on both. That costs nothing against either column's `unique` constraint: Postgres treats every `NULL` as distinct from every other `NULL`, so any number of claimed rows can coexist without conflict, and both constraints keep doing their real job against rows that still have a value.

**The claim and the destruction are one `UPDATE`, not two statements.** Splitting them would lose two things at once. First, the race: `claimed_by_user_id is null` in the `WHERE` clause is what `claim_unassigned_card`'s `status = 'unassigned'` already does for cards — two concurrent calls for the same row (realistically the same person in two tabs, since `users.email` is unique) produce one `UPDATE` that matches and one that matches nothing, decided by the database rather than by whichever request read first. Second, and more load-bearing here: §2.2's actual promise — "a breach of this table exposes only unclaimed rows" — is only true if there is no instant where a row is claimed but not yet destroyed. A second statement is a second thing that can fail between the two, silently leaving a row claimed-but-not-destroyed forever with nothing to notice. One `UPDATE` cannot be half-applied.

**An approved field fills a blank; it never overwrites one.** §4.2 step 4 says every prefilled field is individually keepable, but is silent on what "keep" means for someone who already has a value there — which matters most for exactly the accounts §3.2.1 exists to admit: a pre-existing account is the one case where real, deliberately-typed profile data can already be sitting in that column. Decided here, not stated in the design doc before this build: every write is `coalesce(existing, csv_value)`. A host's guest-list guess must never silently clobber a person's own words about themselves — "prefill" is the word the whole design uses for this data, and a prefill that overwrites is not a prefill. Social links follow the same rule at row granularity: a platform the caller already has any link for is left alone, and only a platform they don't yet have gets a new row from the import.

**Its own rate limit, separate from the lookup's.** `rate_limit_event_claim_per_user_hour` (20) and `rate_limit_event_claim_per_import_hour` (10), new `app_config` rows, consumed before the row is even resolved — same posture as `claim_unassigned_card` and as C2's own limits, so a refused or rate-limited attempt still spends its budget and probing stays non-free.

**The return shape says nothing beyond `{claimed: boolean}`**, deliberately matching `CardClaimResult` (`card-claim-service.ts`) for the identical §3.6 reason: wrong token, already claimed, expired, wrong email, rate-limited, and a lost race all return the same shape. Telling a caller which check failed would be the oracle this design refuses to be.

**Verification.** 8 scenarios run in a rolled-back transaction as real users with real policies in force: the happy path (full field and social-link copy, full PII destruction confirmed by re-reading the row after), the grandfather-clause path with only some fields approved, the fill-blanks-only case (an existing `first_name` and an existing `instagram` link both survive untouched; a new `linkedin` link is added), wrong-email refusal, expired-row refusal, bad-token refusal, and a regression check confirming `get_claimable_import` still returns identical results after being re-pointed at the new shared gate. All 8 passed before the migration was applied for real.

### 11.1.2 How the database learns the caller's verified email — decided 2026-08-27

§3.2 says the gate must read the live token claim, never the stored column. Reading the code showed the claim could not reach the database at all:

- `mintSupabaseAccessToken(userId)` signed only `{ role: "authenticated" }` and `sub`. No `email`, no `email_verified`.
- `getAuthenticatedContext()` built a JWKS-verified `KindeIdentity` carrying `emailVerified` and then discarded it, returning only `{ userId, kindeUserId, supabase }`.

**Decided: both claims travel in the minted Supabase token.** `mintSupabaseAccessToken(userId, { email, emailVerified })` signs `email` (omitted when unknown) and `email_verified` (always, always a boolean). The RPC will read them from `request.jwt.claims`.

The provenance is identical to `sub`'s: derived server-side from a Kinde token this process just verified against Kinde's JWKS, then signed with a key only this server holds. Nothing about the email claim is weaker than the claim the whole RLS model already rests on.

**Rejected: passing them as RPC arguments.** A Server Action is a POST endpoint anybody can call, so an argument is client-supplied — §3.2.1 is explicit that a client-asserted "I am verified" defeats the gate.

**Considered and not taken: refreshing `users.email`/`email_verified` on each sign-in.** Simpler SQL, but it adds a write to every authenticated request and §3.2's "never the stored column" exists for a reason.

**The cost, stated rather than glossed:** an email address now appears in `request.jwt.claims`, so anything logging that setting logs an address. Accepted — the token is per-request, lives five minutes, and never reaches a browser.

### 11.1.3 `email_verified` is read from the ID token, by one implementation on both platforms

Kinde puts `email_verified` in the ID token, not the access token, on the default configuration. Both auth paths therefore now consult the ID token when the access token has no verification claim — a widening of a guard that previously fired only when the access token carried no *email*, because these claims used to be needed solely to seed a new `users` row and an email was a complete identity for that purpose. It no longer is.

On the web this is `session.getIdTokenRaw()` handed to the same `verifyKindeIdToken` the mobile path uses. The obvious alternative, `session.getClaim("email_verified", "id_token")`, was written first and does not type-check — and the reason it does not is a reason not to use it: **the SDK declares the returned `value` as `string`, while `email_verified` is a JSON boolean in every token Kinde issues.** Code written against that declaration must either coerce (turning the string `"false"` into `true`, since it is non-empty) or cast through an assumption that the SDK's own type is wrong. Neither belongs under a security gate. Re-verifying the raw token gives a real boolean, re-checks the JWKS signature rather than trusting the SDK's check, enforces the `sub` equality invariant, and leaves one implementation of this question instead of two — which is what §5.3 asked for.

**A bad ID token is fatal only when it was load-bearing.** With no email on the access token it is required to seed a row, and a forged or mismatched one is refused exactly as before. With an email already in hand it was only going to *upgrade* `emailVerified`, so a failure degrades to unverified rather than to a 401 — a stale ID token beside a fresh access token is an ordinary client state, since `@kinde/expo` refreshes the two independently, and widening the guard must not turn working requests into refusals. The degradation grants nothing: `emailVerified` stays whatever the access token said.

Every failure path answers `false`. That does not refuse anybody outright — the grandfather clause still admits accounts predating the import — it costs a genuinely-verified *new* signup their claim. Visible and annoying, versus a false positive letting somebody read a stranger's phone number.

### 11.1.1 The four screens are four steps of one route, not four routes

`/events/[eventId]/import` renders one client component (`import-wizard.tsx`) holding one parse, stepping through choose → map → review → done. Four routes would mean handing the parsed rows between them — re-parsing per step, session storage, or a server round trip — and every one of those reintroduces §11.2's problem: the preview and the write becoming two interpretations of the same bytes. The host attests to a list, so the list they looked at has to be the array that gets sent.

The entry point is a link on the host panel of `/events/[eventId]`. It is shown to **every** host rather than only verified ones: whether the caller may import is a question for the database, and hiding the door would either mean the panel reading a flag it has no business holding, or the door vanishing for the wrong reason during an outage. The page behind it explains itself to a host who cannot use it yet.

`public.is_verified_host()` decides which of two screens that page draws. It is a drawing decision and never a gate — the RPC re-derives verification from the JWT, and the Server Action is reachable without ever loading the page. It fails closed: any error answers `false`, which shows a real verified host an explanation during an outage rather than letting them map thirty columns and attest before the database refuses them.

There is no "apply to be a verified host" button on the unverified screen, because that form is a later slice. §7's rule against inventing a capability covers a link as much as a button.

### 11.2 Decision: the browser sends parsed rows, not the uploaded file

Not stated either way in §2, so it is recorded here. The CSV is read, mapped and reviewed **in the browser**; what crosses to the Server Action is the array the host actually confirmed, as JSON.

The reason that matters is not size. It is that this feature's entire lawful basis is a host looking at a list and attesting to it (§2, decision 3). Re-parsing server-side would make the preview and the write two separate interpretations of the same bytes — one different guess about a quoted field, one column mapped differently — and a disagreement between them would import something nobody reviewed. Sending the reviewed rows makes "what the host saw is what got imported" true by construction rather than by two parsers agreeing.

It costs nothing in trust, because the rows were host-supplied either way: a host can already call the RPC with a hand-written list, which the migration header says in as many words, and none of the five gates ever looked at row content. It is also smaller — a real Luma export has thirty columns and lists a guest once per ticket, while the confirmed payload keeps seven fields and one row per person — so the existing 6MB `serverActions.bodySizeLimit` in `next.config.ts` covers a full 5,000-row import several times over with no config change.

### 11.3 Decision: a missing attestation and an empty list are refused before the RPC, not by it

The RPC refuses an unattested import (`22023`), so a second check in the service looks redundant. It is not: the RPC consumes one of the host's ten daily imports **before** doing the work, deliberately, so that probing is not free (§3.7). Letting an un-ticked checkbox reach the database would spend a real host's budget on a bug of ours. The service therefore checks the attestation first — before the payload shape, too, so that a host who forgot the checkbox is told about the checkbox rather than sent looking for a problem in their file.

The empty list is the same argument one step along, and it is a real case rather than a defensive one: a host whose status column excluded every row has a file that maps to nothing. The RPC would accept it, loop over nothing, report four zeroes and charge an import for the privilege. The service refuses it with a message naming the two things worth checking — which column is mapped to the email address, and which statuses were chosen — because the host cannot see why the list came out empty from the outcome alone. The check lives in the service rather than the Server Action so that every future caller gets it, including the mobile route when it lands.

### 11.4 The refusal messages name no thresholds, on purpose

`app_config` is unreadable to `authenticated` (§3.8), which is the right posture — but it means the row cap and the daily limit cannot be read on this side. The user-facing messages therefore say "too big to import in one go" and "today's import limit" without a number. A figure written into the TypeScript would be a copy that goes stale the moment the real one is raised, which is precisely what would happen on the night of a pilot event. Both messages stay actionable without one: split the file, or come back tomorrow.

No message carries the database's own words. `42501` in particular stays merged across "not signed in", "not a verified host" and "not the host of this event", because the RPC answers identically for all three so that a guessed event id cannot be used to discover whether it exists (§3.6) — splitting it into three friendlier sentences would rebuild that probe one layer up. There is a test that fails if it ever does.
