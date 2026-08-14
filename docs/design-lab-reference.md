# SmartCard 2.0 — Frontend design reference

What each built feature actually exposes: fields, actions, states, and the access rules that shape what a screen can honestly show. Written for designing in Claude Design Lab, so mockups match what the backend can really do rather than needing renegotiation later. Not an architecture doc — see `docs/architecture/2026-08-09-initial-architecture-proposal.md` for the why; this is the what.

Every screen already has a persistent nav shell (`Home / Feed / Connect / Connections / Activity / Profile`) and a single sign-in gate — nothing below needs its own auth screen.

---

## Profile

**One identity, shown identically to everyone who can see it at all** — no persona split, no "public vs private" profile modes.

**Fields:** first name, last name, username, phone number, bio, company name, company role, photo, email, email-opt-in toggle. Photo is a signed URL minted per render (never a raw public link) — treat it as expiring, don't cache it long-term in a design system.

**Social links:** ordered list, each with a platform + URL. Add / edit / delete / reorder (`display_order`) — full CRUD on your own links only.

**Who can see whose profile at all** (this is the thing to design around, not just a detail): a stranger's profile is never reachable. You can see someone's profile only if: it's your own, you have an active connection with them, or you're both `going` to the same event. There is **no profile URL, no username search, no "view profile" from anywhere but one of those three contexts.** Don't design a share-profile-link feature or a lookup-by-username box — both are explicitly out of scope.

**Actions:** edit own fields, upload/remove photo, add/edit/remove/reorder social links.

---

## Connect (QR + NFC) — already has screens, reference only

One screen at `/connect` with a toggle between "show my code" and "scan a code."

**Presenting (your own QR):** a session starts, a QR renders, and it silently rotates every ~30s in the background — nothing for the user to do or notice except the code changing. Requires location permission (used only to prove you're physically present, never shown to you or anyone else). States: setting up → active → expired/ended. No manual "refresh" action — rotation is automatic.

**Scanning:** camera view, scans a QR, then either succeeds (redirect to the new connection) or fails with **one deliberately generic message** — never "wrong location," never a distance, never anything that would help someone guess how close they need to stand. Don't design a richer failure state than "that didn't work, try again" — the vagueness is intentional (§4.2).

**NFC:** no screen at all — tapping a physical card opens a URL directly (`/card/[code]`) and either completes instantly (if signed in) or routes through sign-in first, then completes. There's no "waiting for tap" UI to design.

**On success (either method):** the connection is created instantly, no confirmation step from either side, and the card owner gets a push notification ("X just tapped your card") deep-linked to Activity.

---

## Connections

**List:** every active connection, newest first. Each row: photo, name, how you connected (QR/location or NFC tap), when.

**No browsing, no directory** — this list only ever shows *your own* connections, and there's no way to see anyone else's. Don't design a "mutual connections" browse or a connection-count badge visible to others.

**Detail (meeting record) per connection:**
- Who, when, verification method.
- Location — only present for QR meetings, and only if both of you are already mutual connections AND both consented to share it (`participants_only` vs `mutuals` toggle, each person's own consent flag). Absence of a location is the normal case for most meetings, not an error state — design the "no location shown" state as unremarkable, not broken.
- Place name (`place_label`) fills in automatically via reverse geocoding a little after the meeting — may briefly be blank right after connecting, then populate. Either a venue name ("Blue Bottle Coffee") or a generalized area ("Mission District, San Francisco") — never a street address.
- "Mark this meeting private" — a personal, one-directional veto (each person's own flag; you can't see or override the other person's).
- Remove connection — one-way, two-step confirm, no undo, no "reconnect" button (reconnecting requires meeting again in person).

---

## Feed

One reverse-chronological list, capped at 50 items, two post shapes:
- **"You met X"** — a meeting you were personally in. Links to that connection's detail page.
- **"[A] met B"** — a meeting between two of your mutual connections (you're connected to both, they're not connected to you as a pair in this post, and neither marked it private). No link to a connection detail page for this shape — you're not a party to that edge.

Same location/place-name rules as Connections detail apply per-post.

No infinite scroll / pagination UI needed yet — the cap is a deliberate, revisit-later choice, not a missing feature.

---

## Activity — new tonight, needs your own testing pass

Two sections on one page:

**"Your cards"** — every card assigned to you, each with a **Revoke card** button (two-step confirm, no restore button exists yet — frame it as permanent in the copy).

**"Recent taps"** — every time one of your cards was tapped: tapper's name/photo, when, and (if the resulting connection is still active) a **Remove connection** button inline. This exists specifically so a card-tap you *didn't* expect is catchable even if you missed the push notification — design it to read as "security log," not "notifications inbox."

---

## Events — backend only, this is the one to design fresh

Nothing exists yet on any platform. Full data model below.

### Event fields
Title, description, start time, end time (optional), timezone, venue name, venue address, lat/lng, cover image, city (from a fixed, curated list — not free text), capacity (a number, or unlimited), whether it requires host approval, visibility (`public` or `private`).

### Visibility — the thing that shapes everything else
- **Public**: any signed-in user can already find it (browse) and RSVP — no invite, no link needed, nothing to build for "joining." Public events are the browsable directory.
- **Private**: invisible to everyone except the host, until they're either (a) invited, or (b) already have an RSVP row. There is **no browse for private events** and no way to guess your way in.

### RSVP — three things a person can say, six things the system can record
A person expresses: **going**, **interested**, or **not going**. What actually gets *stored* can differ from what was asked, and the UI must render the stored value, not the button that was tapped:
- Asked `going`, event requires approval → stored **pending** (host hasn't decided).
- Asked `going`, event is at capacity → stored **waitlist**.
- Asked `going`, otherwise → stored **going**.
- A host can later turn `pending`/`waitlist` into **going** or **denied**.
- **Waitlist auto-promotes** the instant a seat frees (withdrawal, capacity raise) — no manual "next in line" action exists or is needed.
- Re-asking after a denial is allowed (goes back to pending/waitlist, host decides again) — don't design `denied` as a permanent dead end.

Design implication: an RSVP button needs at least these rendered states: not answered / going / interested / not going / pending (waiting on host) / waitlisted / denied.

### What counts are visible to whom
- **Going, interested, and waitlist counts, plus seats remaining**: visible to **anyone who can see the event** (not just the host). Design attendance numbers for every viewer, not a host-only stat.
- **Pending count**: host-only (their own queue depth).
- **The actual attendee list**: never exposed to anyone except a computed count. There is no "see who's going" screen showing names, for anyone but the host's own approval queue (below). "You know 4 people going" is answerable (your own connections only), a full guest list is not.

### Host approval queue (host-only screen)
Everyone `pending`, `waitlisted`, or `going`, each with name/photo, so the host can approve/deny (with an explicit "admit past capacity" override that's visually distinct from a normal approve — it's a recorded exception, not the default path). `interested` and `not_going` people never appear here.

### Invites (private events only)
Who can send one: the host, or anyone currently `going`. Who it can reach: **only an existing SmartCard connection of the person sending it** — there's no "invite by link" or "invite by search" for private events (that's deliberately public-events-only territory, and public events don't need an invite UI at all). Sending an invite doesn't RSVP anyone — the invited person still has to answer for themselves once they can see the event. Design it as "give someone access to see this," not "add them to the guest list." No un-invite exists yet.

### What doesn't exist yet, don't design for it
Un-inviting, editing who already RSVP'd on their behalf, recurring events (each occurrence is its own separate event), any kind of public search across all events beyond city + upcoming/past browse.

---

## Cross-cutting things worth designing around

- **Nothing here has a "share this profile/event externally" link that bypasses the access rules above.** If a design wants a shareable link, check which of the two patterns it actually is: a public event's own detail URL (fine, that's already open) vs. anything touching a profile or a private event (not fine, flag it).
- **Every destructive action (revoke card, remove connection) is two-step-confirm, one-way, no undo.** Match that pattern for anything new in the same family rather than inventing a new confirmation style per screen.
- **Waitlist, pending, and denied are system-computed, never something a button directly sets.** A button always expresses an *intent* (going/interested/not going, invite/don't); the resulting state is the backend's answer, which may not match what was tapped.
