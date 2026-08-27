# Event attendee roster — amending the no-directory rule, deliberately

**Date:** 2026-08-27
**Status:** Signed-off product decision (owner, 2026-08-27, recorded in the session transcript after two explicit flag-and-confirm rounds). Design proposal below still requires sign-off on its open questions (§8) before implementation.
**What this amends:** CLAUDE.md's non-negotiable product rule, `docs/design-lab-reference.md`'s "attendee list" rule, `docs/design/DESIGN.md` §7, and the initial architecture proposal's "permanently unreadable" statement. Each carries a dated pointer here; this document is the single place the reasoning lives.
**Related:** `2026-08-22-event-attendee-import.md` (the CSV import this grew out of). Its §0 refusal of the directory is superseded by this document — recorded there too.

---

## 0. The decision, in the owner's terms

Attendees of an event can open that event's page and see the other attendees. Tapping one opens their profile at the disclosure level the card-tap preview already uses — name, company, role, bio, phone, email, photo, social links, whatever that person has not made private — with a **Save to Contacts** button. What they can never do from there is connect: the screen says *"To add this person on SmartCard, please connect in person."* A SmartCard connection is still created only by an NFC tap or a live GPS-verified QR scan. People who arrived via the CSV import and claimed their profile are indistinguishable on this surface from people who signed up and RSVP'd organically.

This was flagged twice as conflicting with the non-negotiable rule, per CLAUDE.md's own instruction, and the owner confirmed with the concrete design in front of them. This is therefore a deliberate amendment, not a workaround.

## 1. What the old rule was actually protecting — a finding, not an opinion

Writing this amendment forced a close read of what the codebase actually enforces, and the result reframes what is being changed:

**Pairwise co-attendee profile visibility has existed at the RLS layer since the schema was written.** `private.shares_event_with` (20260809210900) is a branch of the `users` read policy, documented in its own migration as *"you may see the profile of someone who is going to the same event as you, because that is a context you are both already in and it is how you look up the person you just met at a pilot event."* And the column-scoped SELECT grant (20260814230000) includes `phone_number` and `email`. So **today, before this amendment, anyone `going` to the same event as you can already read your phone number and email** through a direct PostgREST query — with no opt-in, no logging, and no UI.

What the four documents refused was never that visibility — they coexisted with it from day one. What they refused was **enumeration**: a screen that *lists names*, turning "you can look up the person you met" into "you can browse everyone who was there."

Two consequences for how to think about this amendment:

- **It is smaller than it looks.** The roster UI exposes an access grant the database already makes. The genuinely new grants are: enumeration itself, the extension of "attendee" to claimed import rows, and the event-scoped profile RPC that serves preview-depth fields without widening any base-table grant.
- **It tightens as it widens.** The amendment adds the opt-in control the existing grant never had (§3), and applies it to `shares_event_with` itself — so a person who chooses *hidden* becomes invisible to co-attendees **including through the pre-existing policy branch**, which is a strictly stronger privacy position than today's for anyone who opts out.

## 2. What does not change — the connection wall

The first sentence of the non-negotiable rule is untouched and this surface must never erode it:

1. **No write path exists from the roster.** No RPC, route, or button reachable from this surface creates a `connections`, `meetings`, or `connection_sessions` row. The connect wall is the absence of code, not a disabled button.
2. **No global search.** The roster is scoped to one event and readable only by that event's own attendees. There is still no query anywhere that takes a name, handle, or email and finds a person across events.
3. **No shareable URL grants anything.** The roster route requires an authenticated attendee of that event; a forwarded link renders nothing for anyone else.
4. **The thesis, restated honestly:** the *graph* stays verified — every connection still proves an in-person meeting. What widens is the *lens*: attendees of a shared event can now see each other before deciding to meet. "Everyone in your circle is someone you actually met" remains literally true; "the app never shows you a stranger" no longer is, and pretending otherwise would be the dishonest version of this change.

## 3. The design

### 3.1 Who is on a roster

Union of, for one event: users with a `going` RSVP, and users with a claimed `event_attendee_imports` row. Origin is not rendered — CSV claimants and organic RSVPs are indistinguishable (owner's explicit requirement). `interested` does not count (the `shares_event_with` migration already records why: intention is not attendance). **Unclaimed import rows never appear anywhere** — they are not users, never consented, and their PII renders on no surface; the import doc's §2.2 destroy-on-claim design is unaffected.

### 3.2 Who can read a roster

Only someone on it (host included — hosting an event you ran counts as having been there, via their own `going` row or a host branch). Not "anyone who can see the event": a public event's browse page still shows counts, never names. Recommended: the roster renders only from the event's `starts_at` onward, so this never becomes a pre-event "see who's going" browsing surface — that adjacent feature was refused separately and stays refused.

### 3.3 Appearing is opt-in, and the default is hidden

New column on `users` (e.g. `roster_visibility text check (visible|hidden)`, **nullable, null = hidden**), plus `roster_visibility_chosen_at`. Excluded from nothing — unlike `is_admin` this IS user-settable, through the ordinary profile-update grant; it is the person's own choice about their own exposure.

- **CSV claimants** choose during the claim flow (a step in the existing prefill review screen).
- **Existing users** get a one-time prompt on next sign-in (same gate pattern as `has_completed_signup`; a `roster_visibility_chosen_at is null` check).
- **New signups** choose during onboarding.
- **Unanswered = hidden.** Fail closed, per house rule. Nobody appears anywhere because they ignored a pop-up. This also resolves the retroactivity problem: everyone who RSVP'd `going` before this feature existed stays invisible until they explicitly opt in.

**The invariant that makes the whole amendment safe: no one can be exposed by anyone else's action.** A host uploading your email exposes nothing. Claiming requires *your* mailbox (or pre-existing account, per the import doc's §3.2.1). Appearing requires *your* opt-in on top of that. Two of your own actions stand between a CSV and your name on a screen.

**Behavior change to the existing policy, done deliberately:** `shares_event_with` (and therefore the `users` read-policy branch it powers) gains the same gate — a `hidden` (or unanswered) subject is not visible to co-attendees even pairwise. This narrows an eight-year-old-in-spirit grant and must be called out in the migration as exactly that.

### 3.4 The profile, opened from a roster

Served by a `security definer` RPC (`event_attendee_profile(event_id, user_id)`) that checks: caller is an attendee, subject is an attendee, subject opted in — then returns the card-preview field set. An RPC rather than widening the base `users` policy, so the column exposure is scoped to this one checked context and the base grants stay untouched. Refusals indistinguishable, as always. **Save to Contacts** reuses `vcard.ts` behind the same checks (the user-facing label is never "vCard"). In place of any connect action: *"To add this person on SmartCard, please connect in person."*

### 3.5 Views are logged and visible to the person viewed

An `event_roster_views` table (viewer, subject, event, timestamp), surfaced on the subject's `/activity` — the same §4.5 detection posture as `card_preview_views`, but **named**: *"Maya Rodriguez viewed your profile · Founders Dinner."* Recommended over anonymous counts because the viewer here is a verified co-attendee, visibility is symmetric (they can only see you if you can see them), and named logging is the cheapest real deterrent against quiet bulk harvesting. Owner may flip to anonymous (§8-1). Contact saves log too.

### 3.6 Rate limits

`app_config` pattern, as everywhere: roster page size cap, per-viewer profile-read and contact-save budgets per event per day. Named logging deters; limits enforce.

## 4. Threat model deltas, stated plainly

- **Event-scoped contact harvesting** is now a feature with a consent gate rather than a policy accident without one. Bounded by: opt-in, attendee-only reading, named logs, rate caps.
- **Malicious verified host** (fake event + CSV of targets): exposes nobody (§3.3 invariant); what they gain is an email channel to targets, which is the import doc §9 host-verification control's job, unchanged.
- **The correlation-aid residual** the card-preview amendment accepted one-card-at-a-time now applies N-people-per-screen, to opted-in attendees, visible to co-attendees. Accepted cost, written here so nobody rediscovers it.
- **Forged attendance** buys roster access, not connections — and requires beating host verification *and* the claim gate *and* still shows only opted-in people.

## 5. Interactions with the import design

Unchanged: §2.2 destroy-on-claim, §3's claim gate, §3.9's aggregates-only host summary (the roster shows the host only opted-in people, which is consent, not a leak of claim status — hidden claimants remain invisible to the host too), §9 host verification. Superseded: import doc §0's "build everything except the directory" and its §4.3 "No attendee list" — pointers added there.

## 6. Effort

Visibility column + three choice surfaces (claim step, sign-in prompt, onboarding) ~1–2 sessions; roster + profile RPCs, `shares_event_with` retrofit, RLS, logging table ~1–2 sessions (Opus/xhigh — §4-adjacent); roster/profile/wall UI web ~1–2 sessions; mobile later with the rest of Phase 3. On top of the import doc's 6–8.

## 7. Invariants (test these, in the §4-mutation sense)

1. No code path from roster surfaces writes to `connections`/`meetings`/`connection_sessions`.
2. `roster_visibility` null or `hidden` ⇒ absent from roster, `event_attendee_profile` refuses, `shares_event_with` false.
3. Non-attendee caller ⇒ roster and profile RPCs refuse, indistinguishably.
4. Unclaimed import rows appear on no surface.
5. Every profile open and contact save from a roster writes a view row.
6. No cross-event query by name/handle/email exists.

## 8. Open questions (owner)

1. Named vs anonymous view logging (§3.5 — recommended named).
2. Roster live from `starts_at` vs only after `ends_at` (recommended `starts_at`).
3. Prompt copy, and whether the choice UI pre-selects either option (recommended: no pre-selection, two equal buttons).
