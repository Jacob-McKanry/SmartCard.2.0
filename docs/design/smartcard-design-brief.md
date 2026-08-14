# SmartCard 2.0 — Visual design brief

Pairs with `designlabreference.md` (what each screen can honestly show, per the backend). This doc is the *how it should feel* layer — read them together in Design Lab.

## Direction, in one line

Glass and light: a premium, liquid-feeling app in the spirit of Airbnb's warmth, Luma's clean event polish, and an Apple product-reveal commercial. Confident, uncluttered, never dark, never busy.

## Core visual tokens

- **Mode:** light-first.
- **Surface treatment:** glass/frosted panels — translucent white cards over soft blur, thin borders, gentle elevation rather than hard drop shadows.
- **Motion:** liquid, spring-based. Cards glide and settle rather than snap in. Button presses and card entrances get a touch of overshoot/ease, not linear motion.
- **Shape language:** very rounded — pill buttons and tags, generous corner radius on cards (20px+), soft everywhere. No sharp corners anywhere in the system.
- **Accent color:** blue — saturated, confident, Apple-coded (think cobalt/sky, not neon and not pastel). Reserve it for primary actions (Connect, RSVP "going," main CTA) and keep it sparing against mostly neutral/white surfaces — that restraint is what keeps it feeling premium instead of loud.
- **Typography:** a distinctive, branded sans — not a generic system font. Wants personality in headlines while staying legible at small UI sizes (body/labels down to ~12-13px).
- **Imagery** *(my assumption — flag if wrong)*: real photography over illustration. Profile photos, event covers, and meeting-moment cards should lean on real photos, with soft blur/vignette on any glass overlay rather than flat icon illustration.
- **Iconography** *(my assumption — flag if wrong)*: simple outline icons, not filled or skeuomorphic — keeps the glass surfaces feeling light.

## Feed card style (flagship screen)

Sits between "adaptive to photo" and "editorial/magazine":

- **Post has a photo:** large/full-bleed image, generous padding, a glass caption panel floating over or beneath it.
- **Post is meta-only** (e.g. "Alex & Jacob met" with no shared location yet): a clean, spacious editorial card — no forced placeholder image, let whitespace carry it instead of looking empty.
- Both shapes share the same rounded glass-container language so a mixed feed of dense and sparse cards still reads as one system.

## Screen-by-screen notes

**Profile** — the calm, static anchor of the app; less motion here than Feed. Photo is a signed/expiring URL, so design a graceful blur-up loading state, not just a spinner. Social links read as a row of pill tags, matching the shape language.

**Connect (QR + NFC)** — this is the "wow" screen; lean hardest into liquid motion here. The ~30s QR rotation should cross-fade/morph softly, not hard-cut. A successful scan/tap deserves the biggest Apple-commercial flourish in the app (glass shimmer, spring-in checkmark) — it's the emotional payoff moment. Scan failure stays deliberately quiet and generic per the backend rule; don't let the visual design oversell what the copy is intentionally withholding.

**Connections** — list rows (photo, name, method, when) get a quiet glass-row treatment rather than full cards, to stay scannable at a longer list length. "No location shown" is the normal case, not an error — design it as fully unremarkable, no empty-state graphic or nudge to add one.

**Feed** — covered above.

**Activity** — explicitly meant to read as a security log, not a notifications inbox. Pull back the glass/liquid treatment relative to Feed; more utilitarian and dense, so it feels trustworthy rather than celebratory.

**Events** — RSVP states (going / interested / pending / waitlisted / denied) need distinct pill treatments in the same rounded shape language, but reserve solid accent blue for "going" only — lighter or outline pills for pending/waitlisted/interested keeps the hierarchy legible at a glance. Host-only views (approval queue, pending count) deserve a subtle "hosting" badge so a host never confuses their management view with the public event page everyone else sees.

## Cross-cutting

- Every destructive action (revoke card, remove connection) is two-step, one-way, no undo — keep the confirm pattern consistent and match the glass/rounded language rather than falling back to a generic system alert.
- Waitlist, pending, and denied states are backend-computed, never button-set — the UI should always render the *stored* state, even when it differs from what was tapped.

## Open assumptions to confirm

- Photography over illustration for imagery
- Simple outline iconography
- Accent blue as a single saturated cobalt, used sparingly rather than as a dominant field color
- Motion intensity: liquid/spring on Connect and Feed, noticeably calmer on Profile and Activity
