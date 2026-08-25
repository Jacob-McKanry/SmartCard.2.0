# Event attendee import — CSV to claimed profile

**Date:** 2026-08-22
**Status:** Proposal. Nothing here is built. Requires sign-off before implementation, per CLAUDE.md's "Plan before building."
**Scope:** A host uploads an attendee CSV (Luma export) to one of their events; the people on it are emailed and can claim a pre-filled SmartCard profile they control.
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

**Verification is required, and it is not required in `ensureUser`'s dangerous case.** The claim demands `users.email_verified = true` — meaning Kinde or an upstream IdP has proven mailbox control. The attack `ensureUser` describes works precisely because it needs *no* such proof.

So the rule is: **a matching email address is a lookup key and never an authorization.** Authorization is `email_verified = true` on the matching address.

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
- `get_claimable_import(lookup_token)` — returns prefill only when §3.2's conditions hold, else null
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
| Email (separate phase) | 2–3 sessions + DNS/deliverability + ongoing ops | Opus / high |

**~4–6 focused sessions excluding email.**

The CSV parsing is the easy 5%. The cost is in §3 and in the RLS.

---

## 7. Open questions

| | Question | Why it needs the owner |
|---|---|---|
| **Q-A** | Retention for unclaimed rows — 180 days proposed. | Directly trades retroactive-history usefulness against how long we hold contact details for people who never signed up. A product and legal call, not a technical one. |
| **Q-B** | Row cap per import, and per-host rate limit. | Nothing yet stops a host uploading 50,000 addresses. Needs a number. |
| **Q-C** | Does the person get told *which host* uploaded them, and can they refuse and be purged? | A "remove me and don't ask again" path is close to mandatory under GDPR/CCPA and is the right thing regardless. Needs a suppression list that survives future imports. |
| **Q-D** | Exact Luma export columns. | Column mapping cannot be finalised without a real template. The owner is providing one. |
| **Q-E** | Which Kinde connections are enabled, per §3.3. | Determines whether `email_verified` is a strong claim or a weak one, and therefore whether a separate emailed code is needed on top. |

---

## 8. What this document does not decide

- Whether to build it at all, or when.
- The attendee directory. Refused above; reopening it means amending the non-negotiable product rule in CLAUDE.md and the four documents in §0, as a deliberate decision with its own write-up.
- Whether attendance should ever become a *connection* by any route. It should not, under the current thesis.
- The email provider.
