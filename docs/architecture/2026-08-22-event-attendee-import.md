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

Two consequences. First, the gate must read `identity.emailVerified` from the freshly verified token (what `api-context.ts` already resolves per request), never the stored column. Second, and more urgent: **Kinde is not currently asserting `email_verified` for real signups**, so this feature would refuse every genuine user until that is configured. See Q-E.

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
- `get_claimable_import(lookup_token)` — returns prefill only when §3.2/§3.2.1's conditions hold (verified email, or a pre-existing account), else null
- `claim_event_import(lookup_token, approved_fields)` — writes, then destroys per §2.2
- `own_attended_events()` — the caller's own claimed rows

The host uploaded the CSV, so letting them read it back discloses nothing new *today* — but a direct grant means the PII travels with whoever holds the host role later, and survives any future change to event ownership. A counts-only function costs nothing and removes that.

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
| **Q-E** | **Narrowed 2026-08-27 by the grandfather clause (§3.2.1), not closed.** All 341 existing accounts can already claim regardless of Kinde's verification setting, since their `created_at` predates any import. What still needs confirming: "require email verification" mandatory on the Email+Password and Username+Password connections enabled 2026-08-26 (see §10) — this only gates **brand-new signups going forward**, which is a narrower and lower-urgency blocker than the original framing. |

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
- **Not yet confirmed:** whether "require email verification" is turned on for the two new password connections. This is the one setting §3.2's entire gate depends on, and it is a different toggle from the ones changed above. Q-E stays open until this is confirmed and re-measured against the live database, the same way §3.2's original finding was — assumption is exactly what produced the wrong gate the first time.

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
| Service | `apps/web/src/server/events/attendee-import-service.ts` | 27 tests, five mutations confirmed red |
| Server Action | `apps/web/src/app/(app)/events/[eventId]/import/actions.ts` | — |

Not built yet: the four host screens (upload, map columns, review-and-attest, status), the host application form and admin review screens (§9.2/§9.3), the claim flow (§4.2), the roster (`docs/architecture/2026-08-27-event-attendee-roster.md`), email (§5), retroactive attendance history, and the purge job for expired unclaimed rows.

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
