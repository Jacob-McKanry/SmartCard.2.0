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
