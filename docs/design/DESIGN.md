# SmartCard 2.0 — Design specification

The visual and interaction spec for the web app. Anything new — a screen, a
state, a component — should be buildable from this document alone. It pairs with
`docs/architecture/` (what the system does) and `uploads/designlabreference.md`
(what each screen may honestly show); where this document and an access rule
disagree, the access rule wins.

Reference implementation: the interactive prototype in Design Lab
(`SmartCard 2.0.dc.html`), plus the exploration files for alternatives that were
considered and rejected.

---

## 1. Direction in one line

Glass and light: a premium, liquid-feeling app. Confident, uncluttered, never
dark, never busy. Every screen is a record of something that actually happened,
so the design's job is to make real facts feel valuable — never to inflate them.

---

## 2. Tokens

### Colour

| Token | Value | Use |
| --- | --- | --- |
| `--text` | `#0d1220` | Primary text, dark buttons, event ticks |
| `--text-muted` | `#5b6478` | Secondary text, and **any caveat that states a rule** |
| `--text-subtle` | `#8b93a5` | Field labels, timestamps, decorative meta only |
| `--accent` | `#0a84ff` | Primary actions, connection ticks, active nav |
| `--accent-deep` | `#0847c4` | Accent text on light surfaces, gradient end |
| `--accent-tint` | `rgba(10,132,255,.10)` | Accent chip backgrounds |
| `--ink-deep` | `#0a3fb0` | Cities ticks, third-level accent |
| `--danger` | `#b42318` | Destructive actions only |
| `--pending` | `#7a5c00` | The waiting/pending state, text only |
| `--canvas` | `#f1f4fa` | App background base |

Canvas is never flat: `radial-gradient(700px 500px at 15% -5%, rgba(10,132,255,.13), transparent 60%)`,
a violet bloom at `95% 6%`, and a third at `50% 108%`, over `#f1f4fa`. The
blooms exist so glass has something to refract.

**Rules.** Accent blue is for the primary action and the connection ring, and a
full blue field is reserved for two moments only: the Connect CTA and the
"you're connected" payoff. `--pending` means *waiting on someone*; never use it
for a success. Red appears only on destructive actions. One hue never means two
things.

### Type

- **Instrument Sans** — everything. 400 / 500 / 600 / 700.
- **Geist Mono** — card codes, timestamps in record contexts, small caps labels,
  and any value a user would copy (phone, email). 400 / 500.

| Role | Spec |
| --- | --- |
| Screen title | 600 · 30/34 · `-.03em` |
| Section title | 600 · 15/20 · `-.01em` |
| Card title | 600 · 16–17/21–22 · `-.02em` |
| Body | 400 · 14–15/21–23 |
| Secondary | 400 · 13/18–19 |
| Label / meta | 400–500 · 11–12/15–17 |
| Mono label | 500 · 9.5–11 · `letter-spacing:.14em` · uppercase |

Minimum text size is 11px, and only for decorative meta. Anything carrying a
rule is 12px+ at `--text-muted` or darker. `text-wrap: pretty` on paragraphs.

### Shape

Pills (`999px`) for buttons, chips, tags and toggles. Cards `22–26px`. Inputs
and inner panels `16–20px`. Sheets `28–32px` top corners. Phone frame `52px`.
No sharp corners anywhere.

### Glass

```css
background: rgba(255,255,255,.72);
backdrop-filter: blur(22px) saturate(1.6);
border: 1px solid rgba(255,255,255,.78);
box-shadow: 0 10px 30px rgba(16,24,40,.08);
```

Three intensities exist — subtle (`.9` / `8px`), standard (above), liquid
(`.52` / `34px` + inset highlight). Standard is the default. **Activity is
deliberately flatter** than the rest of the app: opaque `rgba(255,255,255,.82)`,
`14px` radius, hairline border, no blur — it must read as a security log, not a
celebration.

### Motion

| Purpose | Curve | Duration |
| --- | --- | --- |
| Glide / settle | `cubic-bezier(.32,.72,0,1)` | 300–560ms |
| Spring / overshoot | `cubic-bezier(.34,1.56,.64,1)` | 300–750ms |
| Ring rotation | `linear` | 60–240s |

Springs are for arrivals and selections (nav pill, entrance, checkmark). Glides
are for cross-fades and dismissals. Connect and Feed get the liquid treatment;
Profile and Activity are noticeably calmer. Photos **blur up** from `blur(14px)`
rather than showing a spinner, because the URL is a short-lived signed link.

**Never animate a positioning transform in the same property as an entrance
animation** — wrap it: outer element positions, inner element animates.

---

## 3. The ring diagram

The identity motif. Three concentric bands of tick marks, no filled rings:

1. **Connections** — innermost, `--accent`, 2–2.5px × 9px
2. **Events attended** — middle, `--text`, 2.5px × 12px
3. **Cities met people in** — outermost, `--ink-deep`, 3px × 15–16px

Counts are stated in a caption line beneath the diagram ("12 connections ·
6 events · 2 cities"), never as labels inside the rings.

**Non-negotiable geometry rules** (each was a real bug):

- Bands need **≥8px edge-to-edge** clearance, measured tick-tip to tick-tip.
- Adjacent bands must use **staggered start angles** — touching edges on a shared
  angle draw as one longer tick and make the band undercount.
- If a label must sit on a ring, reserve a gap of `2·atan(labelWidth/2 / radius)`
  **and** confirm the label's corners stay inside its own band. Prefer a caption.
- One tick = one record. Above ~40 records, state a ratio in the caption or drop
  to a summary — never let ticks merge into texture unlabelled.

Sizes: hero 220px box (r 62/84/106), profile 256px box (r 62/88/112), crest
150px box (r 32/48/66). Rotation is optional and slow, opposite directions per
band, only where the screen is a moment rather than a form.

### Implementation notes (2026-08-15)

Recorded here rather than only in code, per CLAUDE.md: where building this found
a reason to depart from the section above, the deviation sits next to the
decision it departs from. Built as `apps/web/src/components/ring-diagram.tsx`,
with the arithmetic in `ring-geometry.ts` and `ring-geometry.test.ts`.

- **The crest's radii above are unbuildable and the prototype's are used
  instead.** `r 32/48/66` fails this section's own ≥8px clearance rule with the
  tick lengths specified above: a 9px tick at r32 ends at 36.5, a 12px tick at
  r48 begins at 42 — 5.5px apart. The prototype's actual crest is two bands at
  r52/r70 with 8px and 11px ticks, which clears by 8.5px. The rule wins over the
  number.
- **The staggering rule is derived, not a constant.** Two bands share a tick
  angle exactly when the difference between their start angles is a multiple of
  `360 / lcm(ticksA, ticksB)`, so any fixed offset re-aligns the bands for
  whichever record counts happen to land on that multiple — the same undercount
  bug, appearing for some users only. Each band now starts half that value past
  the one inside it, which is provably the furthest apart the arithmetic allows.
  A fixed 7° constant was written first and the exhaustive test rejected it.
- **Profile ships two bands, not three.** The outermost band — "cities met
  people in" — has no data behind it. `meeting_locations` stores a lat/lng and a
  `place_label`, and that label is a venue name or a neighbourhood, not a city
  (`server/connect/geocode.ts` requests `poi,neighborhood,place` and prefers the
  POI). Counting distinct labels and captioning them "cities" would be a number
  the app cannot stand behind, so the band is omitted rather than approximated.
  Adding it needs a city recorded on the meeting, not a cleverer query.
- **Above 40 records a band compresses to a whole-number ratio** and the caption
  states it ("1 tick = 3 connections"), so the diagram never silently
  undercounts.

---

## 4. Navigation

Bottom dock on phone, top bar on desktop (`≥640px`), from one list.

Order — **Home is always the centre slot**:
`Feed · Connect · Events · HOME · People · Activity · Profile`

The dock is a floating glass bar inset 14px from the screen edges, `26px`
radius, `6px` padding. Selection is a **sliding glass pill** one slot wide
(`calc((100% - 12px) / 7)`), moved with `translateX(n * 100%)`:

- Tap a slot → pill springs to it (`.44s` spring).
- Press and drag along the bar → pill tracks the finger (`.18s` glide), the slot
  under it lifts (`scale(1.18) translateY(-3px)`, icon 20→23px), and release
  navigates. `touch-action: none` on the bar; slot index comes from the bar's
  measured rect, never a hardcoded width.

Icons are **Lucide** (matching `lucide-react` in the app). Social brand marks are
**Simple Icons**. Never hand-draw an icon.

---

## 5. Components

**Buttons.** Primary: accent gradient `linear-gradient(150deg, --accent, --accent-deep)`,
white, `999px`, `14px` padding, shadow `0 14px 30px -10px rgba(10,132,255,.55)`.
Neutral primary: `#0d1220` solid. Secondary: white `.7` + `1px` hairline.
Tertiary: transparent, `--text-muted`. Destructive: `--danger` text on
`rgba(180,35,24,.05)` with a `.4` alpha border.

**Link tiles.** Brand mark in a `32px` tinted plate + platform name + handle,
two-up grid. **Past four links the row scrolls horizontally** with
`scroll-snap-type: x mandatory` and `184px` tiles — never wrap to a third row.
Brand colour goes on the mark only.

**Status pills.** `going` is the only solid accent pill. `interested` is an
outline accent pill; `not going` neutral; `pending` white glass with the
`--pending` label; `waitlist` accent-tinted with a position; `denied` neutral
with an "ask again" path. Never invent a sixth treatment.

**Rows vs cards.** Lists of people are quiet divided rows inside one glass
container. Feed items are individual cards. Activity rows are flat and dense.

**Toggles.** 40×24 pill, `18px` knob, accent when on, `rgba(13,18,32,.14)` off.

**Empty states.** Dashed `26px` panel, `44px` icon plate, a title naming the
context, one sentence explaining why empty is expected, one action. Never a bare
list — a list with zero rows and no explanation reads as broken.

**Placeholders.** Missing imagery is `repeating-linear-gradient(115deg, #dfe5f0 0 10px, #e9edf5 10px 20px)`
with a mono label of what belongs there. Never a hand-drawn illustration.

---

## 6. Screen specs

**Home** — greeting, one big accent Connect card (with a slow shimmer sweep),
next two events, latest meeting. Nothing algorithmic.

**Feed** — reverse-chronological cards. Photo posts are full-bleed with a glass
caption panel floating over the image; meta-only posts are spacious editorial
cards with no forced placeholder. Both share the same rounded glass container so
a mixed feed reads as one system. Participant rows link to their meeting record;
mutual ("A met B") rows link nowhere and say why.

**Connect** — glass segmented toggle, QR in a white plate inside a glass card
with a breathing halo. Rotation is a **soft cross-fade** (opacity to `.12` +
`blur(7px)`, swap, back) — never a hard cut. Success is the biggest flourish in
the app: the two people's rings slide in from opposite sides and settle, a
checkmark springs in on the seam with the stroke drawing, then name, `VERIFIED
IN PERSON`, place · time, and See the meeting record / Connect again / Continue.
Failure is deliberately quiet and generic — no distance, no reason, one line.

**Meeting record** — their ring diagram as the hero, name + role + counts, then
one glass panel: Who / When / How / Where, a divider, then the three location
controls (meeting-level visibility, your own consent, mark private) with the
derived state shown as a mono label. Continue (dark) + Remove connection (red).
NFC records differ only in the How row.

**Connection removed** — history stays, rings go dashed and greyed, copy states
plainly that nothing restores it, and the button opens Connect ("Connect again in
person") with a line saying that's all it does.

**People** — quiet rows, method chip, no location by default. That absence is
normal and gets no empty-state treatment.

**Profile** — ring diagram, name, bio, contact sheet (phone/email in mono),
scrolling link tiles, floating Edit pill bottom-right above the dock. Calm: no
rotation, one blur-up.

**Profile as a visitor sees it** — identical fields (one identity, shown the same
to everyone), no edit affordance anywhere, contact details become Call / Email
actions, and a provenance card explains why the page is reachable at all.

**Events** — browse with city pills + upcoming/past segmented control; cards with
cover, date chip, counts, seats left, "you know N going", plus Hosting/Private
badges. Detail: immersive cover with a glass panel overlapping it, host row,
four-stat row, description, RSVP block. Host-only management sits on a dark
panel so it can never be mistaken for the public view. Create is a stacked glass
form; the approval queue puts "admit past capacity" in a visually distinct
dashed danger style, since it's a recorded exception.

### Implementation notes — Home, Feed, Profile (2026-08-15)

Where the built screen departs from the spec above, and why. In every case the
cause is the same: the design named a fact the schema does not hold, and §7
forbids showing one anyway.

- **Home's events block is "Coming up", not the prototype's "Happening near
  you".** Nothing in the schema knows where a user is — `users` has no city, and
  `cities` is a curated list only *events* reference — so proximity is a claim
  the app cannot back. It lists the viewer's own answered upcoming events, which
  is also the only version of the list that can carry the RSVP status pill the
  design draws, since that pill needs the viewer's own row.
- **Home's latest-meeting row shows the verification method where the prototype
  shows a place name.** `listOwnConnections` does not return the origin meeting's
  id, so the page has no route to `meeting_locations`. The place name is one tap
  away on the meeting record, and §7 already says a missing location is normal
  and gets no remark.
- **Event times name their zone when none is stored.** `events.timezone` is
  nullable and `starts_at` alone only pins an instant, so a missing zone renders
  in UTC and is labelled UTC rather than passed off as a local time.
- **Feed builds only the editorial card, not the photo card.** A meeting carries
  no photo in this schema and an open photo feed is out of scope, so there is
  nothing to be full-bleed of. The prototype's striped placeholder block is
  exactly the "forced placeholder" this section rules out. Both variants share
  one glass container already, so adding the photo card later changes nothing
  else.
- **Feed cards now show the event a meeting happened at.** Real data
  (`meetings.event_id`, RLS-gated) that nothing had been rendering.
- **Profile's Edit pill goes to `/profile/edit`.** The forms that used to be the
  profile page moved there unchanged — same components, same Server Actions,
  same validation — because a viewing screen with an Edit pill needs somewhere
  for the pill to go.
- **Profile's `email_opt_in` toggle is a reading, not a control.** On a viewing
  screen it reports stored state, so it renders with an explicit "On"/"Off" word
  beside it and no interactivity. Changing it happens on the edit screen.
- **Profile's ring diagram has two bands.** See §3's implementation notes.

### Implementation notes — Events (2026-08-15)

The six Events screens, built to §6 above from the prototype's "Events browse",
"Event detail", "Host approval queue", "Create event" and "RSVP states" blocks.
Where the built screen departs from the spec, the departure and its reason are
here rather than only in a commit message.

**One departure is an access rule beating a design detail, and it is the one to
read first.**

- **The host approval queue shows only people awaiting a decision — not who is
  going.** §6, `docs/design-lab-reference.md` and `public.event_rsvp_queue`
  itself all describe the queue as listing everyone `pending`, `waitlist` *and*
  `going`, with names and photos. §7's "the attendee list is nobody's" has no
  host exception, and a list of names of people attending an event is an
  attendee list whoever is reading it. The `going` rows are filtered out in
  `events/lib/access-rules.ts`. **It costs the host nothing:**
  `public.decide_event_rsvp` refuses any row that is not `pending` or `waitlist`
  with `not_decidable` — approving an approved person is a no-op and denying
  them would be an *eject*, which this product deliberately does not have — so
  those rows could only ever have been looked at. The host still sees how many
  are going, in the same four-stat row everybody else sees.

**Where the design named a fact the backend does not hold.**

- **The waitlist pill carries no position on a person's own answer.** §5 draws it
  "accent-tinted with a position". Computing a position needs every other
  waiting person's `responded_at`, and the `event_rsvps` select policy returns
  only your own row and your connections' — that set *is* an attendee list, so
  the absence is the rule working. A number derived from the readable fragment
  would be confidently wrong. The host's queue does show positions, because a
  host legitimately holds the whole waiting list through `event_rsvp_queue`.
- **The host's name is frequently not renderable, and the row says so.**
  `users`'s read policy admits you, your connections, and people you are both
  `going` with; hosting creates no RSVP row, so for most viewers of most public
  events the host is unreadable. The row then reads "Host not shown" with the
  rule beneath it, rather than guessing or vanishing.
- **Create has no cover-photo control.** `uploadEventCover` keys the object as
  `{event_id}/cover.{ext}`, so a cover cannot exist before the event does, and
  no Server Action uploads one afterwards; `createEventAction` sends
  `cover_image_path: null`. The prototype's dropzone would be a control that
  cannot work, which §7 rules out. Cards and the detail hero therefore render
  §5's striped placeholder with a mono label, never a stand-in image.
- **Create has no map pin.** `latitude`/`longitude` exist and the action accepts
  them, but nothing geocodes an event address, so the control would store
  nothing.
- **There is no "RSVP states" route.** That prototype block is a design
  catalogue of the six pills with example copy — building it as a screen would
  mean shipping a page of invented data. All six treatments are implemented once
  in `events/lib/rsvp-pill.tsx` and appear wherever real data produces them.

**Judgment calls.**

- **Browse is a union, not just `browseEvents`.** The public directory plus the
  viewer's own hosted, answered and *invited* events, deduplicated. The badge in
  §6 needs it, but the real reason is that a private event somebody was invited
  to was reachable from nowhere in the app: it is not public, they do not host
  it, and an invite creates no RSVP row. `listInvitedEvents` was added to the
  service layer for this.
- **"Admit past capacity" appears whenever the event is full**, not only on
  waitlist rows as the prototype draws it. At a full event a plain approve of a
  `pending` row stores `waitlist`, not `going` — hiding the override there would
  leave a host pressing Approve and watching nothing happen, which is the silent
  failure §7 rules out.
- **The pending count appears only on the dark host panel.** Not on the host's
  own browse card, not in the stat row. §6 makes the dark ground mean
  "host-only", and the one number on the page nobody else can see is the number
  that most needs it.
- **Withdrawing an RSVP uses the app's confirm panel.** §7's "destructive = two
  steps, one way" — it removes an answer rather than changing it, it can promote
  somebody off the waitlist in the same transaction, and on a private event it
  can end the viewer's own access to the page. Each consequence is named
  separately, as §7 requires.
- **The footnote lines are `--text-muted`, not the prototype's `#a4abbb`.** They
  state access rules, and §8 puts rule-bearing text at `--text-muted` or darker.
  Same call `/connections` made for its own footnote.
- **The approval toggle is a real checkbox**, not the prototype's painted pill:
  the Server Action reads it by name, it is keyboard-reachable, and a screen
  reader announces its state without any ARIA. §8's floor beats a 40×24 knob.
- **Event date/time formatting and the status pills moved into
  `events/lib/`** and Home now imports them. The unknown-timezone fallback
  (render UTC, *label* UTC) and "`going` is the only solid accent pill" are
  rules; four copies of a rule is four chances for one of them to drift.

### Implementation note — "Profile as a visitor sees it" (2026-08-15)

The signed-out card preview (`components/non-user-preview.tsx`, reached from
`/card/<code>` and `/c/<token>`) is the only built instance of this screen, and
it now draws the same three blocks Profile does, from the same components rather
than lookalikes of them: §3's ring diagram (`RingDiagram` at the `profile`
preset, the same two bands), §5's link tiles (`LinkTiles`, which moved from
`app/(app)/profile/` into `components/` so both screens render one
implementation), and the contact sheet.

- **Two of Profile's parts are deliberately absent, and both are absences this
  section asks for.** No Edit pill — "no edit affordance anywhere", and the
  visitor has no account to edit with. No `email_opt_in` row: it is a setting
  rather than an identity field, and whether somebody wants occasional email from
  SmartCard is between them and SmartCard.
- **The sign-in blurb is this section's "provenance card".** §6 asks for
  something explaining why the page is reachable at all. Each route passes its
  own sentence rather than sharing one, because the honest answer differs: a card
  is permanent and somebody physically handed it to you, a QR code is live and
  goes stale in seconds.
- **Every block degrades to absent, never to empty or to zero.** No links renders
  no link block at all (`emptyState="omit"`) rather than a "Links" heading over
  empty space. Counts that could not be computed render the medallion with no
  rings, never a diagram of zeroes — §7's rule against implying more than is
  known cuts both ways, and "0 connections" is a claim rather than an absence.
  The service deliberately returns the same value whether the person genuinely
  has none or the read failed, so the page cannot become a way to tell those two
  apart.
- **The visitor's ring has the same two bands as Profile's**, for the reason §3's
  notes give. Not three. A "cities" band on a stranger-facing page would be a
  number the owner's own profile refuses to show them.

---

## 7. Copy and honesty rules

These are design constraints, not tone preferences.

- **Render stored state, not the tapped intent.** Tapping "going" may store
  pending or waitlist; the screen shows what was stored, and says so when the
  two differ.
- **Never invent a capability.** No reconnect, no un-invite, no undo on
  destructive actions — copy must not imply otherwise.
- **Destructive = two steps, one way.** Second panel names the consequences
  individually. No system alerts; use the app's own glass.
- **Absence is often normal.** "No location shown" gets no error styling and no
  nudge.
- **Never build a directory.** No profile URLs, no username search, no guest
  lists, no mutual-connection browsing, no share-profile link.
- **Failures reveal nothing.** One generic message; never a distance, a reason
  code, or anything that confirms a record exists.
- **Counts are public, names are not.** Going / interested / waitlist counts and
  seats remaining are visible to anyone who can see an event; pending count is
  host-only; the attendee list is nobody's.

---

## 8. Accessibility floor

Body text ≥4.5:1. Any text stating a rule uses `--text-muted` (~4.9:1) or
darker — `--text-subtle` is for decoration only. Status colour is never the only
signal: pair it with a label, and with shape in diagrams (circle = person,
square/tick length = event). Touch targets ≥44px. Icon-only controls carry a
label or `aria-label`.
