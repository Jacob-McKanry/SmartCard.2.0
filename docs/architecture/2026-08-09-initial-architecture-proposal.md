# SmartCard 2.0 — Technical Architecture Proposal

**Status (updated 2026-08-14):** **§6.5's deferred photo backfill is complete** (see the §6.5 "Completed (2026-08-14)" note and the matching §6.6 outcome below) — all 148 legacy photos uploaded and `photo_path` backfilled, closing the last item that section's "Attempted follow-up run" left outstanding. The web app is also now deployed and live (`https://smart-card-2-0-web-smart-card1.vercel.app`) with a persistent nav shell and the QR-toggle Connect screen; see the README for that work's own notes, since it did not change anything in this document's design.

**Status (updated 2026-08-13, meeting feed pass):** §2.9 (the feed — no feed table, both post types computed on read) **is now built on web** (`apps/web/src/app/feed/`), completing README build order item 4 and the core Phase 1 pilot feature set. No migration, no policy change, and no line of §4's connection-verification code touched — the feed reads the existing `meetings`/`meeting_participants`/`meeting_locations`/`connections`/`users` RLS exactly as §3.2/§3.3/§3.4 already specified it. See the README's "Meeting feed landed" entry for the build's own notes, and the §2.9 amendment below for what, if anything, this pass found worth recording about the design as built.

**Status (updated 2026-08-13, Connect Flow pass):** §4 — the connection-verification layer, the most security-critical part of the product — **is now built on web** and its four new migrations are applied (`supabase/migrations/`, 24 files). Each subsection of §4 carries a "built" amendment recording the decisions the design left open; §2.5's amendment is applied and extended with the rate-limiting mechanism §4.6 needed. The threat model in §4.7 is now an automated Vitest suite (193 tests) that attempts each attack, and the suite was verified capable of failing before being called done. Not built in this pass, on purpose: the QR-display and camera-scan screens on either platform, mobile Kinde auth, push-token registration, and the reverse-geocoding job that would fill `place_label` (blocked on Q25).

**Status (updated 2026-08-13):** Schema and RLS for the tables in §2/§3 are implemented and applied to the live Supabase project (`supabase/migrations/`, originally 15 files) — do not redesign what is already built. §1.4 (no shared UI components between web/mobile) confirmed 2026-08-09. Q1, Q2, Q6, Q11, Q12, Q13, Q15 resolved 2026-08-09; Q16–Q24 recorded resolved 2026-08-13 (see §9). **Q7 resolved 2026-08-13** and the §5 auth bridge is built on web (§5.4 amendment); the last outstanding line of §6.6 has been run and passes. **Profile (README build order item 1) is built on web, also 2026-08-13** (§6.5 amendment below) — the `profile-photos` bucket now has its first real Storage RLS policy, and `/auth-check` is retired now that `/profile` exercises the same auth-bridge chain on every real load.

This revision adds **§8, the Friend Proximity design (Phase 3, post-pilot)** — designed now, deliberately, because it is the highest-sensitivity feature in the product and its constraints need to be settled while they can still shape the schema rather than fight it. Nothing in §8 is built or applied.

**The legacy data migration (§6) ran on 2026-08-13** — users, cards, social_links and the `contactexchange` archive are loaded and checksum-verified; photos alone were deferred to a follow-up pass (see the §6.5 deviation) **and that follow-up pass completed 2026-08-14** (see §6.5's "Completed" note).

**Q7 was answered later the same day and the auth bridge is written** (§5.4 amendment): Supabase Third-Party Auth still cannot take Kinde, the §5.4 token exchange is confirmed as the design, and it is implemented in `apps/web` — Kinde sign-in (§5.1), JWKS verification, `ensureUser()` (§5.3), the short-lived Supabase JWT, and an RLS-bound `supabase-js` client. With that, **§6.6's "spot-check RLS as a real migrated user" has been run against a real migrated user and passes** (see the §6.6 outcome) — the one line of the migration checklist that had been genuinely unverified. Two secrets are still outstanding before the flow can be exercised over real HTTP; see the §5.4 amendment and `.env.local`. **Still to build on top of the applied schema:** the Phase 1 features in the README's build order — Profile, then Connect Flow (§4), which is where most of §4's design finally becomes code.

**Full rendered version:** https://claude.ai/code/artifact/b00877ac-2992-48bc-a511-f8ed1d3940c8
**Prepared:** 2026-08-09, by an Opus pass at xhigh reasoning effort per the project's model/effort guidance for architecture-and-security-critical design work.
**Amended:** 2026-08-13, same model/effort tier, for the decisions recorded as Q16–Q24 and the §8 Friend Proximity design.

---

## 0. How to read this document

The most important section is **§4 (Connection Verification)**. That is the section that makes SmartCard actually SmartCard — everything else is standard app plumbing that many teams could build. **§8 (Friend Proximity)** is the second: it is not built yet, but it is the only feature in the product that broadcasts a person's real-time position to another person, and it is designed to the same standard for that reason. If you only carefully review three parts, review §4, §8, and §9 (open questions).

### Contents

| § | Section | Status |
|---|---|---|
| 1 | Recommended stack | Confirmed; monorepo scaffolded |
| 2 | Database schema | **Implemented and applied.** §2.4/§2.5/§2.6 amended 2026-08-13 (design notes only — no new migration). §2.9 (feed) amended 2026-08-13 — built on web exactly as designed, no schema change |
| 3 | Row Level Security strategy | **Implemented and applied.** §3.6 records the judgment calls made while building it |
| 4 | Connection verification design | **Built on web 2026-08-13** (`packages/core/src/connect/`, `apps/web/src/app/api/connect/`, `apps/web/src/server/connect/`). §4.1–§4.7 each carry a "built" amendment recording what was decided along the way. No QR-display or camera-scan UI on either platform yet — this pass is the verification logic and the API surface |
| 5 | Auth flow | **Built on web** (§5.1/§5.3/§5.4); mobile (§5.2) not started. §5.4 amended 2026-08-13 with Q7's answer |
| 6 | Migration plan | **Complete, including photos.** §6.6's two originally-deferred checks (RLS spot-check, photo verification) are both now run and passing. §6.5's photo backfill finished 2026-08-14 — 148/148 uploaded, `photo_path` set |
| 7 | Deployment | Designed; amended 2026-08-13 with push infrastructure |
| 8 | **Friend Proximity (Phase 3, post-pilot)** | **New 2026-08-13.** Design only — no schema, no migration, nothing applied |
| 9 | Open questions | Live tracker; Q16–Q24 added and resolved 2026-08-13 |
| 10 | The security posture, in one paragraph | — |

### How amendments are marked

Sections amended after the original 2026-08-09 sign-off carry an inline **"Amendment (date)"** heading rather than being rewritten in place, so the original decision and the change to it are both readable — per the documentation standard's rule that no decision silently diverges. Where an amendment required a judgment call the project owner did not specify, it is labelled **Judgment call** and reasoned out in the open, in the same style as §3.6.

Two conventions used throughout:

- **Fail closed** means: when something is uncertain or broken, refuse the action. The opposite ("fail open") means letting it through when we're unsure. We fail closed everywhere on connection creation.
- **Server-side** means the check happens on our computers, not on the user's phone. A phone can be modified by its owner; our server can't. Any check that only happens on the phone is decoration, not security.

### What was verified before writing this

| Claim | Verified? |
|---|---|
| Repo empty except `.gitignore` + gitignored `.env.local` | Yes — single commit `522e477` |
| Both Kinde client IDs recorded in `.env.local` | Yes — `KINDE_CLIENT_ID` + secret, and `KINDE_MOBILE_CLIENT_ID` |
| Supabase org `SmartCard.2.0`, zero projects | Yes — org id `xanznwmpptzuqffacexq`, project list empty |
| Vercel team `SmartCard`, zero projects | Partially — team already contains one project, `front-end-playground` (see Q12) |

---

## 1. Recommended stack

### 1.1 Confirmed as-is

| Piece | Decision | Note |
|---|---|---|
| Repo | Single monorepo `jacob-mckanry/smartcard.2.0` | Shared types across web/mobile only pay off in one repo. |
| Web | Next.js (App Router) | |
| Mobile | React Native + Expo | One constraint noted in §1.5 (native EAS build required for NFC). |
| Auth | Kinde, existing business, two new apps | See §5. |
| Database | Supabase Postgres | |
| Hosting | Vercel (web) + EAS (mobile) | |

### 1.2 Monorepo tooling — pnpm workspaces + Turborepo

**pnpm** for installing packages, **Turborepo** for running builds, so deploys don't rebuild everything every time.

**Gotcha to record:** Expo's bundler (Metro) historically does not cope with pnpm's default disk layout. A `.npmrc` containing `node-linker=hoisted` is required.

### 1.3 Shared package structure

```
apps/
  web/                 Next.js app
  mobile/              Expo app
packages/
  core/                Pure logic. No network, no React, no database.
  types/               Zod schemas + the TypeScript types derived from them
  api-client/          Typed functions for calling our API
```

`packages/types` is the single source of truth for data shapes — one Zod schema definition drives both runtime validation and compile-time types.

`packages/core` holds rules that must not differ between platforms: distance calculation between GPS points, the connection-verification interface (§4.1), feed visibility rules, meeting location-sharing rules. Kept as plain functions, unit-testable without a database, browser, or phone.

### 1.4 Confirmed: do not share UI components between web and mobile

**Signed off 2026-08-09.** No cross-platform UI layer (React Native Web, Tamagui, a shared `packages/ui`). Screens are written twice per platform; logic and types are shared aggressively. Rationale: a shared UI layer roughly doubles debugging cost for a ~15-screen pilot app, since every component becomes a compromise between two rendering models.

### 1.5 UI and state

| Concern | Web (Next.js) | Mobile (Expo) |
|---|---|---|
| Styling | Tailwind CSS + shadcn/ui | NativeWind |
| Navigation | App Router (built in) | Expo Router |
| Server data | TanStack Query | TanStack Query |
| Local UI state | Zustand (sparingly) | Zustand (sparingly) |
| Validation | Zod (from `packages/types`) | Zod (from `packages/types`) |

NativeWind gives React Native the same Tailwind class syntax as the web app — components are written twice, but the styling language is identical. Most "state management" problems here are "data from the server" problems, handled by TanStack Query; Redux is not warranted.

#### Amendment (2026-08-13) — shadcn/ui initialized for the Profile build, by hand rather than by the CLI

The monorepo scaffold deliberately skipped `shadcn@latest init`, deferring it to a real design pass; the Profile build (README build order item 1) is that pass. `npx shadcn@latest init` itself failed: `ui.shadcn.com` is blocked by this environment's egress policy (`connect_rejected`, 403 to CONNECT — confirmed via the proxy status endpoint, the same class of restriction §6.5 already recorded against the Storage API, on a different host). `npm`/`registry.npmjs.org` was reachable, so the primitive **packages** (`@radix-ui/react-*`, `class-variance-authority`, `tailwind-merge`, `clsx`, `lucide-react`) installed fine — only the CLI's own template-fetch step from `ui.shadcn.com` was unreachable.

`apps/web/components.json` and the primitives in `apps/web/src/components/ui/` (`button`, `input`, `textarea`, `label`, `avatar`) were therefore hand-authored to match the CLI's standard `zinc`/`new-york` output rather than generated by it — same component shape, same CSS variable convention, same Tailwind v4 `@theme inline` wiring already established in `globals.css`. A base color of zinc with a single near-black primary accent was chosen deliberately restrained, matching the product's own framing ("Instagram, but everyone in it is someone you've actually met in person" — private and intimate, not a marketing site), not a default nobody considered.

One further call, recorded rather than left implicit: the CLI's current default wires dark mode to a `.dark` class for use with a theme-toggle library (`next-themes`), which this pass does not add — no toggle was asked for, and wiring the class-based variant with nothing to ever add the class would have silently turned off the OS-driven dark mode `globals.css` already had. The theme tokens instead stay on a `prefers-color-scheme` media query, preserving the pre-existing automatic behavior; switching to a real light/dark toggle is a UI decision for whoever needs one, not a default to smuggle in here.

### 1.6 Database access and migrations

Supabase CLI migrations (plain `.sql` files, committed to the repo) are the source of truth for schema *and* all RLS policies — security rules belong in version control and code review, never clicked into a dashboard. `supabase-js` for queries. No Drizzle/Prisma for now — one SQL source of truth is simpler given the security model already lives in SQL policies.

### 1.7 One API, one service layer

All business logic lives in service functions in `packages/core` / a server services module. Mobile calls them over HTTP via Next.js Route Handlers; web calls the same functions directly from Server Components/Actions where convenient, and via the same Route Handlers for anything the browser triggers. There is exactly one implementation of "create a verified connection," reached by both platforms — no duplicated authorization logic.

### 1.8 Supporting services

| Need | Recommendation |
|---|---|
| Error tracking | Sentry (web + Expo) — decide before pilot |
| Rate limiting | Upstash Redis or a Postgres table (see Q11) |
| Image handling | Supabase Storage, private bucket, signed URLs |

---

## 2. Database schema

Conventions: primary keys are **UUIDs, not sequential integers** (guards against "just try id+1" IDOR attempts — see §4.7 threat 5). All timestamps are `timestamptz`. 🔒 marks sensitive columns.

### 2.1 Identity

**`users`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `kinde_user_id` | text | unique, not null — join key to Kinde |
| `email` | citext | unique |
| `first_name`, `last_name` | text | |
| `username` | citext | unique, nullable — see Q3 |
| `phone_number` | text | 🔒 |
| `bio`, `company_name`, `company_role` | text | |
| `photo_path` | text | path into Storage, not a public URL |
| `status` | text | `active` / `suspended` / `deleted` |
| `is_admin` | boolean | |
| `email_verified`, `has_completed_signup`, `email_opt_in` | boolean | |
| `legacy_user_id` | bigint | nullable; migration traceability only |
| `created_at`, `updated_at` | timestamptz | |

One row per human — no personas, no alternate profiles.

> **Amendment 2026-08-15 — `has_completed_signup` has no writer, and that is what blocks the designed onboarding flow.** Recorded next to the column because it was found while building the auth screens and is invisible from the schema alone.
>
> The column exists and defaults to false. `ensureUser()` deliberately leaves it false ("onboarding is a thing the server observes finishing, not a thing a fresh row claims") and `20260809211100` deliberately excludes it from the column-level UPDATE grant ("the server asserts onboarding finished, not the client claiming it did"). Both decisions are right. The gap is that **no server path asserts it either** — nothing in this codebase has ever written the column, so it is false on every account that has ever signed in and can only ever be false.
>
> The consequence is concrete. The three onboarding screens in `docs/design/prototypes/Auth flow.dc.html` collect nothing the shipped profile actions and photo uploader cannot already write, so the screens themselves need no new backend — but a gate reading this flag is a wizard that re-runs on every sign-in, forever, which is why they were not built. Unblocking it is a decision about *which* server code is entitled to assert completion (a service-role write at the end of the flow is the obvious candidate, precisely because the client is correctly forbidden from claiming it), not a UI task. The 337 migrated accounts are the other half of that decision: they already carry their identity and their rows also read false, so whatever asserts completion has to treat an account that already has a name as already done — otherwise every migrated user is sent through setup on their first sign-in, which §5.1's pilot notes explicitly want to feel like a return rather than a signup.

> **Resolved 2026-08-15 (same day) — the column has a writer, and the flow is built.** The amendment above stands as the record of the gap; this is how it was closed. Both halves of the answer it asked for were decided by the project owner.
>
> **Which server code asserts completion:** a service-role UPDATE in `apps/web/src/server/onboarding/onboarding-service.ts`, called at the end of the flow. The obvious alternative — a `security definer` RPC granted to `authenticated`, the pattern `public.request_event_rsvp` uses — was weighed and rejected, and the reason is worth keeping because it is not the usual one. Those RPCs are safe to hand to a client because the client's request is an *input to a computation the database performs*: you ask to be `going` and the database decides whether that is `going`, `pending` or `waitlist` from facts you do not control. There is no such computation here. A `complete_signup()` RPC would take no evidence, weigh nothing, and write `true` — which is the client claiming onboarding finished, spelled as a function call. So the column keeps having no client-reachable path at all: no grant, no policy, no RPC. Enforced rather than asserted, by `no-second-write-path.test.ts`, which now fails if any file other than the service and the row's own Zod schema names the column in code.
>
> **The 337 migrated accounts:** solved by making the question not arise. `20260815130000` backfills `has_completed_signup = true` for **every row that existed when it ran**, not for the ones that "look finished". The owner chose the blunt rule deliberately: every field onboarding collects is optional, so a blank profile is a legitimate finished state and there is no property of a row that distinguishes "never asked" from "asked and skipped" — and a conditional backfill would ambush somebody mid-pilot with a setup wizard for an account they already have. Onboarding is therefore a thing that happens to accounts created after that migration and to nobody else, which is one sentence and is checkable against a `created_at`.
>
> **What the flow is:** `/onboarding`, outside the `(app)` route group so the gate in that group's layout needs no "except this page" branch (a layout is never told the pathname — the same limitation `sign-in/page.tsx` records). Two steps, the prototype's `isOnbPhoto` then `isOnbDetails`, reusing the shipped `PhotoUploader` and the shipped `updateOwnProfile` rather than duplicating either. Both exits — "Done" and "Skip for now" — assert completion, and that is a correctness requirement rather than a courtesy: the gate is unconditional, so a path to the end of the flow that did not write the flag would return the person to setup forever with nothing they could type to escape.
>
> **One new column on this table in the same pass:** `deleted_at` (`timestamptz`, nullable), set with `status = 'deleted'` by the soft delete and cleared by the restore, so a restored account is indistinguishable from one that was never deleted. It stays null for `suspended` accounts, whose hold is administrative and has no mechanism here. Not in the column-level UPDATE grant.

**`social_links`** — `id` (PK), `user_id` (FK → users, cascade delete), `platform`, `url`, `display_order`, timestamps.

### 2.2 Cards

**Q1 resolved 2026-08-09 — this section changed from the original proposal.** Tapping a real card shows a fixed URL physically encoded on the chip: `https://smartcard.tech/card/<code>`, where `<code>` is `<cosmetic-prefix>-<12-hex-char-suffix>` (e.g. `CUSTOM-f2a930bcb5fe`). Checked against the full production export: all 7,142 cards have a suffix that is exactly 12 hex characters, unique across every row, with 20 distinct cosmetic prefixes (`StarterCard`, `CUSTOM`, `STANDARD`, `HAT`, `WearTech-SmartHat`, and others — some clearly test/internal labels). The prefix is a vanity label the card owner sets; the suffix is auto-generated and not user-controlled.

That suffix is 48 bits of randomness, unique per card — it already functions as an unguessable token, so **no second secret is needed.** This is a simpler and better design than the original proposal (which planned a separate `card_token`, assuming the visible code was guessable): the existing `card_code` does the job on its own, backed by rate limiting (§4.6) against brute-force guessing. It also means **the full existing inventory — all 6,809 unassigned cards — is usable as-is.** No re-encoding, no dead stock, no fallback plan needed.

**`cards`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `card_code` | text | unique — the exact string in the tag URL after `/card/`, e.g. `CUSTOM-f2a930bcb5fe`. Doubles as both the public label and the security-bearing lookup value. |
| `status` | text | `unassigned` / `assigned` / `revoked` |
| `owner_user_id` | uuid | FK → users, nullable |
| `assigned_at`, `created_at` | timestamptz | |
| `legacy_card_id` | bigint | nullable |

Any future physical card orders should keep generating codes the same way (cosmetic prefix + a securely-random 12-hex-char suffix) for consistency — there's no reason to introduce a second scheme.

**New dependency this creates — domain control.** The physical chips are permanently encoded with `https://smartcard.tech/card/<code>` and can't be changed without literally re-encoding 7,142 pieces of hardware. That means **`smartcard.tech` itself must route to the new backend** for NFC to work at all post-migration — see Q15 in §9 (resolved: the domain is controlled and becomes the production domain).

### 2.3 The social graph

**`connections`** — mutual by construction.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_a_id` | uuid | FK → users |
| `user_b_id` | uuid | FK → users |
| `origin_meeting_id` | uuid | FK → meetings |
| `status` | text | `active` / `removed` |
| `created_at` | timestamptz | |

Constraints: `CHECK (user_a_id < user_b_id)` and `UNIQUE (user_a_id, user_b_id)`. Storing the pair with the smaller UUID first makes a one-directional or duplicate connection structurally impossible — mutuality is enforced by the database, not application logic, so follow/following cannot be reintroduced by accident.

**`blocks`** (recommended addition, see Q4) — `blocker_user_id`, `blocked_user_id` (composite PK), `created_at`, `reason`.

### 2.4 Meetings — split into two tables on purpose

**`meetings`** — non-sensitive metadata.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `occurred_at` | timestamptz | |
| `verification_method` | text | `qr_gps` / `nfc_card` |
| `verification_session_id` | uuid | FK → connection_sessions |
| `event_id` | uuid | FK → events, nullable |
| `is_private` | boolean | true = only the two participants ever see this |
| `location_visibility` | text | `participants_only` (default) / `mutuals` |
| `created_at` | timestamptz | |

**`meeting_locations`** — 🔒 all columns sensitive.

| Column | Type | Notes |
|---|---|---|
| `meeting_id` | uuid | PK, FK → meetings (one-to-one) |
| `latitude`, `longitude` | double precision | 🔒 |
| `accuracy_m` | double precision | 🔒 |
| `place_label` | text | 🔒 |

**Why split:** RLS controls which *rows* are readable, not which *columns*. If latitude lived on `meetings`, any policy letting a mutual see the "A met B" post would also hand them coordinates, relying on every endpoint to remember to strip the field. Splitting means a coding mistake results in *missing* location data, not *leaked* location data — the correct failure direction for sensitive data.

#### Amendment (2026-08-13) — how `place_label` gets populated: automatic reverse geocoding

`place_label` existed as a column from day one with no decision about where its value comes from. **Resolved (Q19):** it is filled automatically by server-side reverse geocoding of the GPS fix that was *already captured for the proximity check* (§4.3). There is no user step, no "name this place" prompt, and no client-supplied label. A meeting therefore always has a human-readable place name if geocoding succeeded — "Blue Bottle Coffee, SF" instead of a coordinate pair nobody can read.

**Why the coordinates are already there, and why that matters.** The proximity gate requires both parties' positions, so accepting a QR connection means the server has already handled the exact data reverse geocoding needs. No new collection, no new permission prompt, no new sensitive field — this decision spends privacy budget that was already spent. That is the reason it is a cheap feature rather than an expensive one.

**Why server-side, not on the phone.** Three reasons, in order of importance:

1. **A client-supplied label is attacker-supplied text.** The label surfaces in the other participant's feed. If the scanner's app sent the string, a user could write anything into another person's timeline — a defamatory "place name", a phishing URL, an impersonation. Deriving it server-side from coordinates the server itself validated means the label is a *consequence* of the verified fix, not an assertion about it.
2. It keeps the geocoding provider's API key server-side, where §7.4's rule ("no secret ever gets a `NEXT_PUBLIC_`/`EXPO_PUBLIC_` prefix") requires it to be.
3. Two clients on two platforms would produce two different labels for the same meeting. One server produces one.

**Why it runs *after* the connection commits, not inside it.** Geocoding calls a third party. §4.2 step 6 commits the connection atomically, and a third-party HTTP call has no business inside that transaction: a slow or down provider would turn "your connection failed" into the user-visible outcome of a vendor's bad afternoon. So the commit happens first, and the label is filled by a follow-up job. **If geocoding fails, `place_label` stays null and the meeting is simply shown without a place name.** This is the one place in the connection path where degrading is correct rather than failing closed, and the distinction is worth stating precisely: failing closed protects the *security* property (was this really an in-person meeting?), which is fully decided before the label exists. A missing label is a cosmetic loss, not a security one. Nothing about the connection depends on it.

**Judgment call — residential coordinates get generalized, not street-addressed.** Reverse geocoding a coordinate that is not a business or landmark returns a street address. A street address in a feed post is somebody's home address, which is categorically more sensitive than "we met somewhere in the Mission". The recommendation is therefore: **store a POI/venue name when the provider returns one; when it only returns a street address, store a coarser label (neighbourhood + city) instead.** This was not specified by the product owner and is recorded here rather than left to whoever writes the geocoding call. It should be revisited if pilot users complain that home meetings show up uselessly vague — the fix then is a deliberate opt-in, not silently storing addresses.

**Why the label is as protected as the coordinates.** `place_label` lives inside `meeting_locations`, so it inherits the §3.2 policy unchanged — the strictest one in the schema. This is deliberate and should not be "optimised" by moving the label onto `meetings` so the feed can render it more cheaply. A readable place name is *more* damaging in a leak than a latitude/longitude pair, because it needs no tooling to interpret. It belongs behind the stronger lock, not the weaker one.

**Built 2026-08-14 (Q25).** The job described above exists now — `apps/web/src/server/connect/geocode.ts`, wired into `redeemQr` right after the commit. The generalization rule above is implemented literally: Mapbox is asked for `poi,neighborhood,place` (never `address`), so a bare street address is not a shape the response can even take — the module either gets a venue name, a generalized neighborhood+city label, or nothing.

**Provider choice is deferred, on purpose (Q25, open).** Google Maps Geocoding, Mapbox, and OpenStreetMap Nominatim all satisfy the architecture; none of them changes any table, policy, or data flow above. Picking one now would be a decision made with less information than the person building Connect Flow will have. The criteria that actually matter when it is picked:

- **Terms of service on *storing* results.** This is the architecturally relevant one, because we retain the label in our own database rather than displaying it and discarding it. Provider terms differ materially on retention and caching, and one of them prohibiting what we do here would be a genuine constraint — check it first, not last.
- POI coverage quality in dense US urban areas (the pilot is NYC), since a provider that returns street addresses where a venue exists defeats the point.
- Rate limits and cost at pilot volume (low — one call per QR connection, not per request).
- **Whether the same provider can also serve §8's approximate-mode area names.** Friend Proximity needs coarse area labels from coordinates too. Choosing a provider that covers both avoids a second vendor, a second key, and a second set of terms to audit.

One environment variable is implied and added to §7.4: `GEOCODING_API_KEY` 🔒, server-side only, name to be finalised with the provider.

**`meeting_participants`** — `meeting_id` + `user_id` (composite PK), `location_share_consent` (boolean, default true as of 2026-08-15 — see amendment below), `marked_private` (boolean, default false).

Rules: mutuals see location only if **every** participant has consented; any participant marking a meeting private hides it from everyone but the two of them; consent defaults to true as of 2026-08-15.

#### Amendment (2026-08-15) — location sharing now defaults ON, reversing the original decision

The table above originally read `location_share_consent` default **false**, and `location_visibility` (above, in the `meetings` table) originally read `participants_only` (default). The reasoning given then was explicit: *"consent defaults to false... sharing a meeting's location with mutuals is an affirmative act by every participant afterwards, and nothing here may pre-consent on their behalf."* That reasoning was sound and is not being disputed — it is being overridden by the project owner's product decision, made 2026-08-15: a verified in-person meeting should show up in both participants' feeds and their mutuals' feeds **by default**, with each person individually retaining the power to opt out, rather than each person individually having to opt in before anything is shared.

**What changed:** the column defaults only — `meetings.location_visibility` now defaults to `'mutuals'`, and `meeting_participants.location_share_consent` now defaults to `true`. See `supabase/migrations/20260815140000_flip_location_sharing_default_to_on.sql` for the exact SQL and its full reasoning.

**What did not change, and this is the half of the decision that matters more than the flip itself:** every existing privacy control is untouched. Either participant can still unilaterally revoke their own consent, or unilaterally mark a meeting private via `marked_private`, at any time — this remains a **one-person action**, never requiring the other participant to agree, matching the one-sided veto `marked_private` already used before this change. §3.2's four-condition RLS policy on `meeting_locations` (visibility, privacy override, unanimous consent, viewer-is-a-mutual) is completely unchanged in code; only which condition is *true on day one* of a new meeting changed. `deriveLocationSharingStatus` (`apps/web/src/app/(app)/connections/[connectionId]/location-sharing.ts`) needed no code change at all, since it derives UI state from whatever the database says rather than assuming a starting state.

**Not backfilled.** The new defaults apply to meetings created from 2026-08-15 forward only. Retroactively flipping an already-recorded meeting's consent to `true` would grant sharing on a real person's behalf without their action — exactly the outcome the original "nothing here may pre-consent on their behalf" rule existed to prevent, applied in the opposite direction. Existing rows keep whatever consent state they already had.

### 2.5 Verification sessions and audit

**`connection_sessions`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK — the `sid` inside the QR code |
| `method` | text | `qr_gps` / `nfc_card` |
| `presenter_user_id` | uuid | FK → users |
| `status` | text | `active` / `consumed` / `expired` / `revoked` |
| `current_nonce` | text | one-time value in the currently displayed QR |
| `nonce_issued_at` | timestamptz | |
| `previous_nonce` | text | grace window during rotation |
| `presenter_latitude`, `presenter_longitude` | double precision | 🔒 |
| `presenter_accuracy_m` | double precision | 🔒 |
| `presenter_location_at` | timestamptz | freshness check |
| `device_id` | text | binds session to one device |
| `expires_at`, `consumed_at` | timestamptz | |
| `consumed_by_user_id` | uuid | FK → users, nullable |

**`connection_attempts`** — 🔒 audit log, no user-facing read policy at all. `id`, `session_id`, `method`, `scanner_user_id`, `presenter_user_id`, `outcome`, `rejection_reason`, `distance_m`, `scanner_accuracy_m`, `presenter_accuracy_m`, `radius_config_used_m`, `ip_hash`, `user_agent`, `created_at`. This is the table the GPS radius gets tuned from post-pilot — every rejection logged with the numbers that caused it, storing computed distance rather than raw coordinates wherever possible.

**`app_config`** — `key` (PK), `value` (jsonb), `description`, `updated_at`, `updated_by`. Seeded values (all server-side tunable, none hardcoded):

| Key | Starting value |
|---|---|
| `qr_max_distance_m` | 150 |
| `qr_max_accuracy_m` | 100 |
| `qr_token_ttl_seconds` | 45 |
| `qr_rotation_seconds` | 30 |
| `presenter_location_max_age_seconds` | 90 |
| `session_max_lifetime_seconds` | 300 |

#### Amendment (2026-08-13) — additions needed by the mechanisms decided this round

**None of the following is applied.** These are the schema and config additions the amendments in §4.3 (automatic radius relaxation), §4.5 (card-tap notification) and §8 (Friend Proximity) will need, written down here so the shape is agreed before anyone writes a migration. They are listed by the phase that will build them.

**(a) `app_config` keys for automatic radius relaxation — Connect Flow phase.** Mechanism and reasoning in §4.3.

| Key | Starting value | What it controls |
|---|---|---|
| `qr_relaxation_enabled` | `true` | Master switch. A single row disables the whole mechanism mid-event if it misbehaves, without a deploy — the same reason every other threshold is a row. |
| `qr_relaxation_failure_threshold` | 2 | How many distance-rejected attempts by the same presenter+scanner pair unlock one relaxed attempt. |
| `qr_relaxation_window_seconds` | 600 | The window those failures must fall inside. Ten minutes ≈ "we are still standing here trying", not "we failed this morning". |
| `qr_relaxed_max_distance_m` | 500 | The relaxed radius. Still a proximity claim — a large venue, not a neighbourhood. |
| `qr_relaxed_max_accuracy_m` | 150 | Relaxed accuracy floor (normal is 100). Loosened only slightly, and deliberately kept far below the relaxed radius — see §4.3 for why that ratio is the safety property. |
| `qr_relaxation_cooldown_seconds` | 3600 | After a pair uses its relaxed attempt, that pair cannot trigger relaxation again for an hour, whatever happens. |

**(b) `connection_attempts` columns for distinguishing relaxed acceptances — Connect Flow phase.**

| Column | Type | Why |
|---|---|---|
| `radius_mode` | text, `normal` \| `relaxed`, not null default `normal` | The explicit marker §4.4's analysis needs. |
| `accuracy_config_used_m` | double precision | The accuracy floor in force, for symmetry with the existing `radius_config_used_m`. Its absence today is an oversight: a rejection caused by the accuracy floor currently does not record what the floor was. |
| `relaxation_source_attempt_id` | uuid, FK → `connection_attempts(id)` ON DELETE SET NULL | On a relaxed attempt, names the earlier failure that unlocked it, so the pilot analysis can read a relaxed success together with the failures that preceded it instead of guessing at the pairing. |

**Why a new column and not a third `outcome` value.** §3.6 constrained `outcome` to `success | rejected` on purpose and called the friction of adding a third value a feature, because the table's whole worth is cross-row comparability. A `relaxed_success` outcome would break every "how many succeeded?" query written before it existed, and would silently under-count successes. `radius_mode` is orthogonal to `outcome` and composes with it: relaxed rejections are as interesting as relaxed successes.

**Why `radius_mode` rather than inferring relaxation from `radius_config_used_m`.** The number alone is ambiguous over time. If the owner tunes `qr_max_distance_m` up to 500 after the first event — exactly the tuning §4.4 anticipates — then a stored `500` no longer distinguishes "the relaxed path fired" from "the normal radius happens to be 500 now". An explicit mode column stays true regardless of what the config did afterwards. Audit data has to survive its own configuration history.

**One index, for the lookup the mechanism performs on every attempt:** `connection_attempts (presenter_user_id, scanner_user_id, created_at desc)`. Deliberately no new table for relaxation state — see §4.3.

**(c) `user_push_tokens` — Connect Flow phase.** Sketched in §4.5, needed by the card-tap notification.

**(d) `app_config` keys for notification coalescing — Connect Flow phase.** `nfc_tap_notification_coalesce_seconds`, starting value `300`; see §4.5.

**(e) Friend Proximity tables and keys — Phase 3.** Sketched in §8. Not to be built alongside anything above.

**Pilot scale note (Q22).** The starting values throughout §2.5 assume a **medium-to-large** event, not a small one — pilot size is not confirmed, and sizing for the small case and being wrong is the expensive direction of the error. Real attendance numbers tune these rows after the first event, exactly as §4.4 already prescribes for the GPS radius; see §9 Q22 for the two places where "medium-to-large" changes an actual design answer rather than just a number.

#### Amendment (2026-08-13, later same day) — everything above is now applied, plus the rate-limiting mechanism §4.6 needed

The Connect Flow build applied (a), (b), (c) and (d) exactly as specified, in four migrations. (e) — the Friend Proximity tables — remains untouched and unbuilt, as §8 requires.

| Migration | What it adds |
|---|---|
| `20260813210000_connect_flow_config_and_attempt_columns.sql` | The six relaxation `app_config` rows (a) and the coalescing row (d), verbatim; the three `connection_attempts` columns (b); the `(presenter_user_id, scanner_user_id, created_at desc)` index; **plus six new `app_config` rows holding the §4.6 rate limits** |
| `20260813210100_table_user_push_tokens.sql` | (c), with RLS |
| `20260813210200_table_rate_limit_events.sql` | The rate-limiting table and its two functions — new, see below |
| `20260813210300_fn_create_verified_connection.sql` | The atomic write behind §4.1's `createVerifiedConnection` — new, see the §4.2 amendment |

**The §4.6 rate limits needed numbers, and §4.6 gives none.** Six values were chosen and are recorded with their reasoning in the migration rather than dropped in as bare constants: session creation 60/user/hour, QR redeem 60/user/hour, 5 failures burns a session (the one number §4.6 does state), NFC redeem 20/card/hour and 60/user/hour, and 600/IP/hour across all connect endpoints. They are `app_config` rows for the same reason every other threshold is. The sizing brief is Q22: assume medium-to-large, and remember that under-sizing is the expensive direction — a limit that bites a real attendee at a real event breaks the product in front of the pilot audience, whereas a generous limit still ends brute force, because a 48-bit card suffix needs billions of guesses rather than hundreds. The per-IP number is deliberately the loosest, per Q22(a).

**A new table, `rate_limit_events`, resolves Q11 into something concrete.** Q11 settled "a Postgres table, not Redis" but did not say what shape. One generic append-only table keyed by `(action, subject_kind, subject_key, occurred_at)` covers every limit in §4.6 and every limit likely to follow, with one index and one function to review — as against a table or a counter column per limit, which would mean a schema change every time a limit is added. RLS enabled and forced with **zero policies** and no grant to `anon`/`authenticated`, matching `connection_attempts` and `app_config` (§3.5): a client that could read it would learn how much budget it has left, and one that could write it could erase its own.

Two details of `rate_limit_consume()` are worth reading before anyone changes it. It **records the event before it counts**, which looks backwards and is not: counting first has a race that lets two concurrent requests both pass at the ceiling, and closing that with a lock would serialise every connect request through one row. Recording first makes concurrent requests err toward *rejecting*, which is the correct direction for a security limit. It also means a **rejected attempt still spends budget**, which matters because §4.2 step 5 evaluates rate limits last — a request that dies at the signature check never reaches the limit test, and must not therefore get its retry back for free.

**Two `user_push_tokens` details differ from §4.5's sketch, both tightening it.** `device_id` is NOT NULL, because the sketch's own stated purpose for the column — "so a re-registered device replaces its own row rather than accumulating" — is delivered by a unique constraint that a NULL silently opts out of (NULLs never conflict in a Postgres unique index), so a device with no id would accumulate a row per launch. And `expo_push_token` is unique across the whole table rather than per user: the same token under two user ids means an installation changed hands, and the previous owner must lose it rather than keep receiving that phone's notifications.

**Verified after applying:** `get_advisors` (security) returns only the pre-existing, intentional `rls_enabled_no_policy` INFO notices — `app_config`, `connection_attempts`, `pending_connections`, `legacy.contactexchange` — plus `rate_limit_events`, which joins that set deliberately and for the same reason. No new class of finding.

### 2.6 Events

**`events`** — `id` (PK), `host_user_id` (FK), `title`, `description`, `starts_at`, `ends_at`, `timezone`, `venue_name`, `venue_address`, `latitude`, `longitude`, `visibility`, `cover_image_path`, `created_at`. Event venue location is *not* sensitive the way meeting location is — a public event at a public venue is meant to be found; meeting location reveals where a specific person physically was. Different data, different policy.

**`event_rsvps`** — `id` (PK), `event_id` (FK), `user_id` (FK), `status` (`going`/`interested`/`not_going`/`waitlist`), `responded_at`. `UNIQUE (event_id, user_id)`. The "you know X people going" hook is the intersection of the viewer's connections with `going` RSVPs — see §3.3.

#### Amendment (2026-08-15) — events can be cancelled, because a deleted host must not leave live events behind

**Three columns on `events`** (`20260815130100`): `status` (`scheduled` | `cancelled`, default `scheduled`), `cancelled_at`, and `cancelled_reason`, with a CHECK forcing the three to agree so a half-applied cancellation cannot exist. None of them is in the column-level UPDATE grant, so no client writes any of them; the sole writer is `public.soft_delete_own_account()`.

**Why the state exists.** Self-serve account deletion had to do something about events the departing member hosts, and neither obvious option works. Deleting them contradicts §2.6's own treatment of an event as shared history (there is no DELETE policy on `events` for anybody, and deleting cascades the attendees' RSVPs away with it). Leaving them alone puts an event with no host and no chance of happening on the browse screen indefinitely, and somebody turns up to it. Cancelling is the third option, and the project owner's rule for it is precise: **keep the event visible to the people who already answered, so it does not silently vanish, and take it out of browse for everybody else.**

**Where that rule is implemented is the part worth reading.** Not in a query — in `private.can_see_event()`, whose branches already distinguish "anybody" from "you have a relationship to this event". `20260815130200` narrows exactly one of them, `visibility = 'public'` to `visibility = 'public' and status <> 'cancelled'`, and leaves the host, RSVP and invite branches untouched. Browse needed no change to stop listing cancelled events, and the attendee list of an event needed no change to keep seeing them. Note the consequence for a **private** event: cancellation changes its visibility not at all, because it was never visible through the public branch — its audience was already defined entirely by RSVP and invite rows.

**The RSVP rows of a cancelled event are deliberately not rewritten.** The tempting move is to resolve the host's pending queue by writing `denied` on every waiting row so nobody is left waiting on a host who no longer exists. That would be a lie in the database: `denied` means "the host decided you may not come", and nobody decided anything. `not_going` would be a worse lie, attributing a choice to the requester. Adding a seventh RSVP status was weighed and rejected too — `event_rsvps.status` feeds `shares_event_with()` and therefore the `users` read policy, so widening that set is an access-control change, made here only to describe a fact already recorded on the event row. Instead the **queue is closed**: a trigger on `event_rsvps` refuses every INSERT and UPDATE whose event is cancelled, so nothing can join it and nothing can be decided in it, while DELETE stays allowed so `withdraw_event_rsvp` keeps working. The screens read the event's status and say "Cancelled" where they would otherwise say "Waiting on the host".

**Why a trigger rather than two more branches in the RSVP RPCs.** `create or replace` on a plpgsql function means restating its whole body — roughly two hundred lines of capacity, approval and waitlist logic re-transcribed to add two `if` statements, in a migration that could not be executed during the build. A transcription slip there would not break cancellation, it would break RSVPs for everyone. The trigger is fifteen additive lines and covers writers that do not exist yet. What it costs is that this one refusal raises instead of returning `{ok:false, reason}` like every other refusal in that file; the UI makes it unreachable, so the caller who hits it went around the UI.

#### Amendment (2026-08-13) — the retention hook shows two counts, and this is not the same question as profile visibility

**Resolved (Q21):** the hook displays **both counts, separately labelled** — "3 going, 2 interested" — over the viewer's *own connections*. Not one combined number.

**Why not combine them.** A single "5 of your connections will be there" is a promise the data does not support: two of those five tapped a button meaning *maybe*. The hook's job is to make someone decide to attend, and a hook that overstates gets checked against reality the moment they walk in and count. Splitting keeps the softer signal — "interested" genuinely is information worth surfacing — without laundering it into attendance. The cost of being precise here is one extra word of UI; the cost of being imprecise is a retention feature people learn to distrust.

**The distinction this must not blur — read this before touching `shares_event_with`.** There are two separate questions in this area of the schema, they have different stakes, and only one of them changed:

| | What it decides | Rule | Changed? |
|---|---|---|---|
| **The display hook** (§3.3, `private.connections_attending`) | How many of *your own connections* are going/interested to an event you are looking at | Now counts `going` and `interested`, reported as two labelled numbers | **Yes — this decision** |
| **`private.shares_event_with()`** (§3.4, a branch of the `users` read policy) | Whether two people who are **not connected** may read each other's **profiles** because they are at the same event | Both sides must be `going`. Unchanged (§3.6) | **No** |

The display hook is low-stakes by construction: every person it counts is someone the viewer is already connected to and can already see. Widening it reveals nothing new about anyone. `shares_event_with()` is the opposite — it is the widest branch of the policy that governs who can read a stranger's profile at all, and §3.6 already names it as the first thing to re-examine if events outgrow the pilot.

**Widening that helper to `interested` would be a real security loosening, and it was not asked for.** It would mean two strangers who each tapped "interested" on a public event — an act requiring no attendance, no commitment, and no in-person contact whatsoever — become mutually readable profiles. At a large public event that is a directory of everyone who was curious, reachable by tapping one button, which is materially close to the global search this product structurally forbids. Anyone implementing the two-count display who finds it convenient to reuse `shares_event_with` should stop: they are one refactor away from converting a display change into a visibility change.

**Implementation consequence, for the events build phase.** `private.connections_attending(event_id)` currently filters `status = 'going'` and returns bare user ids, so it cannot produce two counts. The recommendation is to change it to return `(user_id, status)` rows filtered to `status in ('going','interested')` and let the caller group them — one function, one graph check, no second copy of the authorization logic (§3.6 makes the same argument for `can_see_meeting`). Two facts make this change low-risk and both should be verified again before it is made: **no RLS policy references `connections_attending`** (confirmed — it appears only in comments elsewhere in the migrations), and it derives the viewer from the JWT rather than taking a viewer argument, so it still cannot be asked about anyone else. It also still needs the thin `public` wrapper §3.6's observation (a) describes. **It must never be used as a visibility predicate** — it is an answer for a screen, not a gate.

#### Amendment (2026-08-13) — events are created natively in SmartCard for the pilot

**Resolved (Q20):** no Luma, Eventbrite, or other external event import for the pilot. Every event and every RSVP originates inside SmartCard.

This needs no schema change, but it is recorded rather than assumed because it is load-bearing for a security property. `shares_event_with()` grants profile visibility between co-attendees, so **an event's RSVP list is an input to the `users` read policy.** Importing an external guest list would mean people who never made a SmartCard RSVP — who may never have made any choice about SmartCard at all — are inserted into a table that decides who can read whose profile. Native-only keeps the invariant that every row in `event_rsvps` is a deliberate act by a SmartCard user inside the app. Import is not merely "not built yet"; if it is ever proposed, it has to be evaluated against that policy branch first, not treated as a data-plumbing feature.

#### Completed (2026-08-14) — Events built: cities, capacity, approval, waitlist, and the RSVP write path taken away from clients

**Built** (README build order item 5, backend only — no UI; the project owner is building screens separately). Five migrations, `20260814051000`–`20260814051400`, all applied to `crpsbnbegeoqtlgshltt` and exercised against it as simulated authenticated users. New Zod schemas in `packages/types/src/db/`, pure display-side rules in `packages/core/src/events/rsvp-rules.ts` with 43 tests, a service layer at `apps/web/src/server/events/`, and Server Actions at `apps/web/src/app/(app)/events/actions.ts`.

**Q5 is resolved (any signed-in user may create an event) and Q14 is resolved (no recurrence concept — one row per occurrence).** Both rows in §9 record the outcome.

**The one structural change worth reading even if you skip everything else: `event_rsvps` is no longer client-writable at all.** `20260809211300` granted `insert (event_id, user_id, status)` and `update (status, responded_at)` directly, which was correct when the four statuses were things a person could truthfully declare about themselves. Adding `capacity` and `requires_approval` changed what `going` *means*, and made that grant a privilege escalation: a client that can write `status = 'going'` can approve itself past a host's gate and take a seat at a full event. And because `going` is a branch of the `users` read policy via `shares_event_with()` (§3.4), a client-assertable `going` is a client-assertable grant of profile visibility. The three write policies and all three write grants are dropped; every transition now goes through `public.request_event_rsvp`, `public.withdraw_event_rsvp` or `public.decide_event_rsvp`. This is the same structure `connections`/`meetings`/`meeting_participants`/`meeting_locations` have used since day one, arrived at for the same reason: the value has to be computed by something that cannot be argued with.

**Judgment calls made where §2.6 was silent**, in the §3.6 style:

| Decision | Call taken | Why, and what the narrower option was |
|---|---|---|
| Cities | Curated `public.cities` table, SELECT-only to clients, seeded with ten US metros as an explicit **placeholder** | Free text produces four spellings of one city in a week and breaks the only query browse needs; geocoding buys a vendor and Q25's open terms-of-service question to solve a problem the pilot does not have. The seed is not a decision about where SmartCard operates — the owner is expected to edit it. |
| `events.city_id` delete behaviour | `ON DELETE RESTRICT`, plus `cities.is_active` | CASCADE would make deleting a city destroy every event ever held there *and* their RSVPs — data loss one click deep in an admin tool. Retiring a city is `is_active = false`; the FK refuses the delete outright. |
| `capacity` | Nullable, NULL = unlimited, `CHECK (capacity > 0)` | A sentinel (0/-1) has to be remembered by every caller, and forgetting it reads as either "full" or "unlimited" — both silent. NULL is what SQL already means by "not applicable". |
| `requires_approval` vs `visibility` | Two independent booleans, neither derived from the other | All four combinations are real (a curated public call; a small private thing where the invite *is* the approval). Deriving one from the other silently removes a combination, and the failure shape is a host who believes their public event is curated when it is not. |
| Approving into a full event | Stores `waitlist`, unless the host explicitly overrides; an override that actually exceeded the cap is recorded in `capacity_override` | The cap is not silently broken because the host said yes. Forbidding overrides outright was rejected: the real case is legitimate and would be worked around by editing `capacity`, which destroys the information instead of recording it. Passing the flag when there was room is *not* recorded as an override, so the column answers "was a rule set aside", not "which button was clicked". |
| Waitlist promotion | FIFO by `responded_at`, tie-broken by `id`, in the same transaction that frees the seat; promotes as many as genuinely fit | A seat filled "soon" is a seat that briefly belongs to nobody, which turns a queue into a race won by whoever polls hardest. The tie-break is not cosmetic: without a deterministic second key, two callers can disagree about who is next. A system promotion sets `decided_at` and leaves `decided_by` NULL — nobody decided, and naming a host would be a false audit record. |
| Raising `capacity` | An AFTER UPDATE trigger promotes off the waitlist in the same transaction | A capacity raise creates seats by a different route than a withdrawal, and a host raising 10 → 20 while ten people sit waitlisted is a visible product bug. **Lowering capacity never demotes anybody**: an admission already given is not withdrawn by editing a number. |
| Re-requesting after a denial | Allowed — it re-enters `pending`; `decided_by`/`decided_at` are cleared | Terminal denial makes an ordinary mis-tap unfixable by the person it affects, and circumstances change. The cost is that a denial can be nagged at, which is a moderation problem; a re-request grants nothing until the host acts. The cleared columns describe the row's *current* status — a denial's decider left attached to a fresh `pending` row would read as "a host approved this". |
| Deny on an already-`going` row | Refused (`not_decidable`) | That is an *eject*, not a refusal — different consequences, different notification obligations, not asked for. Useful side effect: no decision path can free a seat, which is why deciding never needs to promote. |
| Approve on a `denied` row | Refused | It would push somebody to `going` — and therefore make their profile readable to co-attendees — with no act of theirs since being told no. The way back from a denial keeps the person's own consent in the loop. |
| Withdrawal | Its own RPC that deletes the row, distinct from answering `not_going` | They are different facts ("forget I said anything" vs. "I was asked and I am not coming"). It is an RPC rather than the DELETE grant it replaces precisely because it can free a seat, and every path that frees a seat has to be a path that can fill it. |

**One deliberate narrowing of an existing exposure, and one deliberate new disclosure.**

*The narrowing:* a **new `going` RSVP to an event that has already ended is refused.** Without it, every public event in the archive is a standing permanent invitation — anyone could RSVP `going` to an event a specific person attended months ago and read their profile through `shares_event_with()`, with no attendance, no contact, and nothing the target could notice or refuse. This does not close §3.6's wider concern about that branch, but it does mean the exposure now requires a live, upcoming event both people are choosing to be at, which is the situation the branch was designed for. `interested`/`not_going` on a past event are still fine (neither grants anything), withdrawal always is, and an approval into a past event is refused for the same reason.

*The disclosure:* `public.event_rsvp_queue(event_id)` returns **profile fields for people the host may not otherwise be able to read** — `pending`, `waitlist` and `going` rows only. A host cannot approve a request from a name they cannot see, so approval genuinely requires it. **The alternative that was considered and rejected was adding a branch to the `users` read policy** ("you may read anyone with an RSVP on an event you host"): §3.4 is the policy that structurally forbids global search, and a branch there applies to every query against `users` from anywhere in the app, forever — a reusable visibility predicate where one screen's worth of names was needed. Containing it in a `security definer` function is §3.3's own pattern (`connections_attending`) applied to a new subject: it answers one question, for one role, about one event, and cannot be composed into anything else. `interested`, `not_going` and `denied` rows are excluded — a curiosity tap must not hand your identity to a stranger who created an event, saying no should not cost more than saying nothing, and a decision against someone is not a reason to keep reading them. Counts for all statuses remain available to the host via `event_attendance_counts`, which discloses no identities.

**`connections_attending()` now returns `(user_id, status)` filtered to `going` and `interested`**, with the thin `public` wrapper and EXECUTE grant §3.6's observation (a) has owed it since the schema phase — implementing Q21's two-count hook exactly as this section's 2026-08-13 amendment specified. Both preconditions that amendment said to re-verify were re-checked against the live database first, not assumed: no RLS policy references it (0 rows from the `pg_policy` scan, re-run *after* this pass's own new policies existed), and it still derives the viewer from the JWT. **`shares_event_with()` is untouched and still requires `going` on both sides.**

**Event covers.** `cover_image_path` had been a bare column with nowhere to point since the first schema migration. There is now a private `event-covers` bucket with the exact path convention `{event_id}/cover.{jpg|jpeg|png|webp}` — write restricted to the event's host, read to anyone who can already see the event (`can_see_event`), so cover visibility tracks event visibility rather than drifting from it. This is a different rule from `profile-photos`, which is owner-prefix-only; the mechanics (private bucket, short-lived signed URLs minted through the RLS-bound client) are the same.

**Known limitation, recorded rather than left to be discovered.** *(Superseded 2026-08-14 — built; see the "Private-event invites" amendment below.)* There is still no invite mechanism for private events. `can_see_event` admits the host plus anyone holding an RSVP row, and clients can no longer create RSVP rows for other people (they never could), so in practice a private event is visible only to its host until an invite flow exists — that flow is a real piece of work, not a gap in this pass. Related: withdrawing from a private event gives up the ability to see it, which is correct but non-obvious and should be said in the UI before the button is pressed.

**Supabase's security linter now reports six `authenticated_security_definer_function_executable` warnings**, one per RPC this pass exposes. They are the intended configuration, for the reason the `20260814051200` header sets out at length: the intended caller *is* `authenticated`, which is why these are `definer` where `create_verified_connection` and `rate_limit_consume` are deliberately `invoker`, and the safety property comes instead from none of them taking an actor as a parameter — every one derives the caller from the JWT, so no argument can make a function act as somebody else. Like the `rls_enabled_no_policy` set on the service-role-only tables, these should not be "fixed".

#### Amendment (2026-08-14) — Private-event invites, and three of the four things asked for turning out to already exist

**Built** (`supabase/migrations/20260814060000_table_event_invites.sql`, `20260814060100_rls_policies_event_invites_and_extend_can_see_event.sql`, `packages/types/src/db/event-invites.ts`, `inviteToEvent`/`listEventInvites` in `apps/web/src/server/events/events-service.ts`, `inviteToEventAction` in `apps/web/src/app/(app)/events/actions.ts`). Backend only, no UI, matching the Events pass. This closes the "known limitation" the previous subsection recorded.

**Read this part first, because it is the most useful thing in this amendment.** Four capabilities were asked for in this pass — private-event invites, open joining of public events, waitlist auto-promotion, and waitlist size visible to hosts *and* ordinary attendees. **Three of the four already existed and needed no work.** That is recorded here rather than quietly skipped, because the next person to read §2.6 is likely to arrive with the same mental model and should not spend the same time rediscovering it:

| Asked for | Status before this pass | Evidence |
|---|---|---|
| Public events joinable by any signed-in user, no invite or link needed | **Already true.** `can_see_event()`'s `visibility = 'public'` branch is true for every authenticated caller, so anyone signed in can already see a public event and call `request_event_rsvp` on it. There is no invite mechanism to build for public events and no link to mint — the absence of a gate *is* the feature. | The `events` SELECT policy (`20260809211300`) and its header's "one deliberate visible-to-any-authenticated-user in this schema" section |
| Waitlist auto-promotion when a seat frees | **Already true, and unconditional.** `private.promote_event_waitlist()` runs inside the same transaction as every seat-freeing event (withdrawal, answer change, capacity raise). There is no per-event opt-in flag and one was deliberately *not* added — it would only create events where a freed seat sits unclaimed. | `20260814051200`; the "Waitlist promotion" row of the previous subsection's table |
| Waitlist size visible to the host **and** to ordinary attendees | **Already true.** `event_attendance_counts()` returns `waitlist` to anyone who can see the event. Only the `pending` count is host-restricted, because queue depth for an approval gate is the host's business in a way that "how many people are waiting for a seat" is not. | `20260814051200`; `EventAttendanceCounts` in `events-service.ts` |
| An invite mechanism for private events | **Genuinely missing.** The subject of this amendment. | — |

**Why the fourth one was a real gap.** `can_see_event()` admitted the host plus anyone already holding an `event_rsvps` row, and since `20260814051200` an RSVP row can only be created by the person it describes. Those two facts close a circle: the only route to seeing a private event was a row you could only create once you could already see it. A private event was therefore visible to its host and, in practice, to nobody else ever. `event_invites` is the third branch that breaks the circle.

**The three decisions, and the reasoning behind each.**

| Decision | Call taken | Why, and what the alternative was |
|---|---|---|
| **Who may send an invite** | The host, or anyone currently holding a **`going`** RSVP | Host-only is not how people bring a friend to a thing, and the workaround it pushes users toward (the host passing something out of band) is worse than the mechanism it replaces. `going` and not `interested` draws the same line `shares_event_with()` does: an intention is not attendance. `pending`, `waitlist`, `denied` and `not_going` cannot invite — letting a `pending` request bring guests would route straight around the host's approval gate. The check is evaluated at insert time, so somebody who withdraws or is denied loses the ability immediately; and because only a host can grant `going` on an approval-gated event, on those events the host still transitively controls the whole guest list. |
| **Who an invite may reach** | Only an existing connection of the inviter (`private.are_connected`) | **This is the security decision in the pass.** An invite is not itself a connection, so it would be easy to conclude it needs no graph check. But an invite puts a person into an event's *population*, and an event's population feeds the `users` read policy the moment two people are both `going`. Without this check: create a private event, invite an arbitrary user id, both RSVP `going`, and two strangers are mutually readable profiles — no tap, no scan, nothing the other person had to recognise as a stranger's approach. That is precisely the shape **Q20** closed for imported guest lists, arriving through a different door. With the check, everyone who can be pulled into a private event is somebody the puller already verifiably met in person, so the mechanism rides on the connection graph rather than widening it. A useful side effect: since the invitee must already be a connection, this cannot be used to probe whether an arbitrary user id exists — an unconnected id is refused identically whether it is real or invented. Public events carry no such restriction and need none; an invite to one is redundant rather than dangerous, so the CHECK does not bother to forbid it. |
| **What an invite grants** | **Visibility only — never an RSVP** | The invitee still calls `request_event_rsvp` themselves, and approval, capacity and waitlist then apply to them unchanged. The rejected shortcut was having the inviter write the invitee's RSVP row, which would have needed no new table at all: `status = 'going'` is a branch of the `users` read policy via `shares_event_with()`, so **an RSVP row written by somebody other than its subject is a profile-visibility grant written by somebody else.** Keeping every `event_rsvps` row a deliberate act by the person it describes is the invariant that makes that policy branch safe to have; this pass spends none of it. |

**Deliberate scope cut: there is no un-invite.** No UPDATE or DELETE grant and no such policy — recorded in both migration headers so it reads as a decision. Beyond "nobody asked", there is a better reason not to ship the obvious version: revoking an invite from somebody who has already RSVP'd would not remove their visibility, because `can_see_event()`'s older RSVP branch still holds for them. A DELETE policy on this table alone would work exactly when it does not matter and fail silently when it does — a host clicking "uninvite" on somebody already attending and watching nothing happen. A real revoke is a decision about the RSVP too (an *eject*, which `20260814051200` already declined to build for the same reason), so it belongs to a reviewed pass of its own.

**One judgment call worth flagging for review**, in §3.6's style: the "host or `going` attendee" test is an **inline `exists` against `event_rsvps` rather than a new `private.*` helper**, which departs from this schema's habit of putting every cross-table access rule in a `security definer` function. The rule is asked from exactly one place, and §3.6's argument for the helpers is specifically about rules applied from *more than one* policy; a helper for a single call site adds an indirection and a second EXECUTE grant to keep in step without removing duplication. The mechanics were verified rather than assumed — an inline `exists` in a WITH CHECK does resolve the caller's own RSVP rows correctly, confirmed against the live database in a rolled-back transaction *before* the migration was written, which is the kind of thing `20260809211400` exists to remind everyone not to guess at. If a second call site appears, promote it to a helper.

**Verified against the live database**, as simulated authenticated users, in rolled-back transactions leaving no test data behind: a host still sees their own private event; an unconnected, uninvited user still **cannot** (the regression that matters most); an invited user can, and can then RSVP for themselves; a still-uninvited third party still cannot. Refusals confirmed for inviting a non-connection, setting `invited_by_user_id` to somebody else, inviting yourself (refused by the policy *and*, with RLS bypassed entirely, by the CHECK constraint), inviting as a non-attendee, and inviting while merely `interested`. Re-inviting is a no-op. UPDATE and DELETE are refused. Supabase's security advisors report exactly the same set as before this pass — no new findings.

#### Amendment (2026-08-14) — a verified meeting can now say which event it happened at, and this is metadata, never a gate

**Built**, in two parts that shipped together but sit at opposite ends of this codebase's risk spectrum.

**The gap.** `meetings.event_id` has existed since the original schema (`20260809210500`) and `create_verified_connection` has accepted and stored `p_event_id` since `20260813210300` — but until now nothing ever *computed* a value. Both verifiers hardcoded `eventId: null`, so every meeting ever recorded, regardless of where or when it physically happened, had no event on it. Two things asked for at once — "how many connections were made at this event, in total and per-attendee" and "does the feed say which event a meeting happened at" — both turned out to reduce to the same missing piece: nothing tags a meeting with its event.

**The matching rule (QR only — NFC is untouched by explicit product decision, see below), implemented in `packages/core/src/connect/event-tagging.ts`.** A verified QR meeting is tagged to event E iff **all** of:

1. **Both** the presenter and the scanner hold an `event_rsvps` row for E with `status = 'going'` — not `interested`, `waitlist`, `pending`, `denied` or `not_going`. Deliberately stricter than "was standing near the venue": two strangers who happen to meet on the pavement outside a conference did not meet at that conference. The same line `private.shares_event_with()` already draws for the same reason.
2. The verification's own clock is inside E's time window: `starts_at <= now <= (ends_at ?? starts_at + event_auto_tag_default_window_hours)`. Most events will never get an explicit `ends_at` set (nullable, and there's no product pressure to fill it), so this second `app_config` key — 4 hours by default — is what stops an event from matching forever.
3. E has non-null venue coordinates. An event created before its venue was confirmed simply can't be a candidate — skipped, never an error.
4. **Both** GPS fixes — the presenter's heartbeat, the scanner's scan-time fix, the *same two positions the GPS proximity gate already compared* — are within `event_geofence_radius_m` (150m by default) of E's coordinates, using the haversine helper already in `packages/core/src/geo/`.
5. **If more than one event satisfies all of the above at once, the meeting is left untagged.** Two concurrent events at one venue, both people going to both, is a real shape (parallel conference tracks; back-to-back events overlapping by ten minutes), and every tie-break available is a guess dressed as a rule. A wrong tag is a durable, visible, wrong claim about where someone was; an absent tag is a feature not firing. Declining costs nothing, because — the point of the next paragraph — this is not a security property.

**Why this is deliberately NOT fail-closed, and why that is correct rather than a violation of CLAUDE.md's rule.** Fail-closed means: when a check deciding whether two people may connect can't be completed, refuse. This isn't that check. Event tagging runs strictly *after* the nine-step GPS/graph/rate-limit gate in `qr-verifier.ts` has already returned `ok: true` — there is no `fail(...)` call anywhere after it, checked directly in the source rather than assumed — and it cannot throw: `resolveAutoTaggedEventId` catches everything, including the store's own query errors, and returns `null` on any failure, identical to "no match found." A verified, physically-earned connection must never be lost because a metadata lookup had a bad day. Proven, not asserted: a 12-scenario × 3-world test matrix (`packages/core/src/connect/__tests__/event-tagging.test.ts`) replays every refusal reason (`too_far`, `blocked`, `already_connected`, `rate_limited`, all nine others) against three event worlds — no events, a perfectly matching event staged, and an events lookup that throws — and asserts the refusal reason is identical in all three, *and* that the event lookup is never even called on a refusal path at all (an assertion on call count, not just on outcome).

**Why NFC stays untouched.** Card taps have no GPS gate and capture no location at all — there is nothing to match against a venue. The project owner chose automatic GPS-based tagging for QR with no manual fallback for NFC, accepting that card-tap connections (likely the majority at a real event, since tapping is faster than scanning) simply never get an event tag in this pass. A test asserts this stays true.

**Two new `app_config` keys, and the one thing worth saying about them:** `event_geofence_radius_m` (150) and `event_auto_tag_default_window_hours` (4) are the only rows in this table that are **not security thresholds** — nothing about accept/reject ever reads them, only what a meeting gets labelled with, and a broken or missing lookup degrades to "unlabelled," not to "refused." They sit three lines from `qr_max_distance_m` in the same table and are indistinguishable from it without reading the comment, which is why both the migration and `config.ts` say so explicitly. Operationally load-bearing regardless: `loadConfig()`'s closed-set check throws if *any* key is missing, so if code reading these two keys had shipped before the seeding migration, the entire connect flow — not just tagging — would have refused every request. Sequenced correctly here: the migration was applied to production and independently re-verified live before the code was merged.

**What this unlocks, now that a tag can actually exist.** `event_attendance_counts` (`20260814190000`) gained a `connections_made` field — a plain count of meetings tagged to the event, visible to **anyone who can see the event**, not host-gated like `pending`, because a headcount of meetings names nobody and pairs nobody with anybody (unlike the attendee list, which stays permanently unreadable per §3.3). A second, personal question — "how many people did *I* connect with at this event" — needed **no new grant, RPC or policy at all**: `getOwnConnectionsAtEvent` in `events-service.ts` answers it from rows the caller can already read (their own `connections`, their own `meetings`), verified live before trusting the RLS reading. That verification caught a real bug in the obvious version: counting *visible* meetings at an event over-counts, because `can_see_meeting()`'s triadic branch lets a mutual-of-both read someone else's meeting row too — a user who personally made one connection at an event could see two meetings tagged to it. The fix anchors on the caller's own `connections` rows first and uses `meetings` only to look up `event_id`, which is why this number and `connections_made` can legitimately disagree (one counts durable meetings, the other counts currently-active connections and falls if one is later removed) — expected, not a bug in either. The feed (`feed-service.ts`) now carries an optional `event: { id, title } | null` on every post, batched the same way `meeting_locations` already is; `null` covers both an untagged meeting and a tagged-but-invisible one (a private event the viewer isn't part of) without distinguishing them — the post still renders, just without an event line.

> **Amendment 2026-08-27 — "permanently unreadable" is no longer accurate as written.** By owner decision, attendees of an event who have each opted in may now see each other on that event's page (view and save contact details; never connect — the §4 connection rule is untouched). Worth recording here because this document is where "the attendee list stays permanently unreadable" lives: a close read while amending found that `private.shares_event_with` has been a branch of the `users` read policy since 20260809210900, so *pairwise* co-attendee visibility — including `phone_number` and `email` under the 20260814230000 column grant — existed all along; what §3.3-adjacent prose refused was enumeration. The amendment adds the enumeration surface **and** the opt-in gate the pairwise grant never had (a `hidden` choice now hides a person from `shares_event_with` too, which narrows the original grant). Design, invariants and threat-model deltas: `docs/architecture/2026-08-27-event-attendee-roster.md`.

**Verified**, independently, before any of this was trusted: the whole `packages/core` suite (284 tests) unmodified and green, full monorepo type-check/lint/test, the new migration's function body hash-compared against the applied database rather than assumed identical, both `app_config` rows confirmed live with correct values, and security advisors compared before/after with zero new findings.

### 2.7 Contacts import

**`contact_import_matches`** — 🔒 `id` (PK), `owner_user_id` (FK), `matched_user_id` (FK, nullable), `contact_hash` (🔒 hashed phone/email), `display_name_snapshot` (🔒), `matched_at`, `dismissed_at`. `UNIQUE (owner_user_id, contact_hash)`. Salted hashes only, never raw contacts — a database breach doesn't hand an attacker anyone's address book. This table has no code path to `connections`.

### 2.8 Deferred: pending connections (schema slot only)

**`pending_connections`** — designed now, built later. `id` (PK), `initiator_user_id` (FK), `session_id` (FK → connection_sessions), `contact_name`, `contact_email` 🔒, `contact_phone` 🔒, `place_label` 🔒, `latitude`/`longitude` 🔒, `occurred_at`, `claimed_by_user_id` (FK, nullable), `claimed_at`, `status`. Hangs off `connection_sessions` — the same table QR/NFC already use — so the non-user flow slots in later without touching connection or graph tables.

#### Amendment (2026-08-15) — half of "the non-user flow" is now built, and it is the half pointing the *other* way

**`pending_connections` is still a schema slot with no table and no code path.** Nothing in this amendment changes that, and the deferral above stands exactly as written.

What has been built shares the words "non-user flow" with it and is a different thing, so the distinction is recorded here rather than left for a reader to trip over:

| | §2.8's `pending_connections` (still deferred) | The card preview (built 2026-08-15) |
|---|---|---|
| Direction | **Inbound.** Captures the *non-user's* details, so a member gets something out of meeting somebody not on the app | **Outbound.** Shows the *cardholder's* details to the non-user |
| Whose data moves | The stranger's, into our database | The member's, out to the stranger |
| Writes | A `pending_connections` row waiting to be claimed | Nothing but an audit row about the disclosure |
| Creates a connection | Later, when the non-user signs up and claims it | Never, by construction |

They are complements, not two stages of one feature, and building the outbound half brings the inbound half no closer to existing. The threat-model item that hangs off §2.8 — **§4.7 threat 3, "forwarding the share-your-contact-back link"** — is about the inbound half, so it remains unbuilt and untested; `threats.test.ts` still skips it and still says why.

**What was actually built** (`apps/web/src/app/card/[code]/`, `apps/web/src/app/c/[token]/`, `apps/web/src/server/cards/card-preview-service.ts`, migrations `2026081512*`): a signed-out visitor who taps a card, or points a phone camera at a presenter's QR, sees the cardholder's name, company, role, bio, phone, email, photo, social links and connection/event counts, can download a vCard with the photo embedded, and can sign in. That is the entire surface — there is no "connect" affordance on either page and there must never be one, because a card URL is permanent and forwardable and CLAUDE.md's non-negotiable rule forbids exactly that.

*(The links and counts were added later the same day, widening the disclosure the morning's build made. What that costs is in §4.7 threat 1's second amendment; why exposing `social_links` to an unauthenticated reader is permitted at all, when `20260809211100` says it is not, is recorded as an amendment on that migration.)*

**One new table, `card_preview_views`** (20260815120100) — service-role writes, subject-only reads, surfaced on `/activity`. It is not `pending_connections` and does not pre-empt it: it records disclosures the product made, not people a member met. Full build note in §4.5's 2026-08-15 amendment; what it costs is in §4.7 threat 1's.

> **Amendment 2026-08-21 — blank stock can now be claimed, which is the first way a card has ever been assigned outside the legacy import** (`supabase/migrations/20260821120000`, `apps/web/src/server/cards/card-claim-service.ts`, `apps/web/src/components/blank-card-claim.tsx`). **Applied to project `crpsbnbegeoqtlgshltt` on 2026-08-21 and verified against the live database**, in a rolled-back transaction as a real migrated user with `request.jwt.claims` set the way PostgREST sets it. Eight behaviours confirmed: a blank card claims and lands `assigned` with the caller as `owner_user_id`; a second claim of it refuses; another member's assigned card refuses with its owner unchanged; **a `revoked` card refuses and remains revoked**; an unknown code, a malformed code and a caller with no JWT each refuse; and the sixth attempt within the hour is refused by the per-user budget, leaving a genuinely claimable card untouched. Two intermediate refusals are themselves evidence the role switch was real — as `authenticated` the session could not UPDATE `cards` or SELECT `rate_limit_events` for its own test setup, which is §3.5's posture holding. Counts were 6,809 unassigned / 333 assigned / 0 revoked before and after, with zero `card_claim` rows surviving, so the transaction rolled back clean. `get_advisors(security)` returns no new class of finding: the single new WARN is `authenticated_security_definer_function_executable`, which is the intended posture and joins seven pre-existing identical entries for the RSVP RPCs and `soft_delete_own_account`.
>
> *(Bookkeeping note: the tooling recorded the migration under its own timestamp, `20260821221148`. That was corrected in place to `20260821120000` to match the committed filename, because a repo and a production history that disagree about when a migration ran is precisely the drift that produced the duplicated grant migration on 2026-08-14.)*
>
> **The gap this closes.** 6,809 of the 7,142 imported cards are `unassigned`, and `cards.status` had exactly one writer ever: the 2026-08-13 import. A person handed a blank card was told "Nothing here" signed out, and "that card isn't set up yet" signed in, with no way to set it up. The physical inventory was unusable to anybody who was not already in the legacy export — which is most of the stock, and all of its intended future owners.
>
> **`public.claim_unassigned_card(text)`, a `security definer` RPC.** A policy cannot serve this: claiming means finding a card BY CODE, and 20260809210200 forbids any client lookup-by-code because `card_code` is the security-bearing secret. The service role could have, and is the wrong tool — it would have taken an eighth caller for something the database does better, and it could not have been atomic. Two people racing to claim the same blank card through a read-then-write is a time-of-check/time-of-use bug with a physical consequence, and `UPDATE ... WHERE status = 'unassigned'` cannot have it. This sits on the permitted side of the line `onboarding-service.ts` draws: the caller's code is *evidence the database weighs*, not a conclusion the client asserts. The owner is taken from the JWT and there is no parameter for it, so "claimed it for the wrong person" is not a bug this can have.
>
> **Both rate limits live inside the function**, not in the calling TypeScript, because the function is granted to `authenticated` and is therefore reachable directly over PostgREST — a limit in the app would be bypassed by one `rpc()` call. Five per user per hour and five per card per hour, seeded in `app_config`, consumed by failed attempts too, and **refusing when a config row is missing** rather than defaulting.
>
> **`revoked` is refused, and that is the sharpest line in the feature.** A revoked card is the kill switch for a card somebody lost; letting the finder claim it would take the one control the victim has and hand it to the person holding their property. It is refused by the same `WHERE status = 'unassigned'` that refuses `assigned`, and the ordering that protects it in the landing resolver is pinned by a test verified capable of failing.
>
> **What the disclosure costs — see §4.7 threat 1's third amendment.** The signed-out page now tells an anonymous visitor that a code names a real, unclaimed card, which splits one case out of a refusal set this project deliberately kept indivisible.
>
> **The residual, stated as it is.** Possession of the code is the whole of the evidence, so anyone who has *seen* blank stock can claim it without holding it, and the person who later receives that card cannot claim it and cannot prove they should have been able to — after which every tap of it connects a stranger to the claimant. The project owner accepted this on 2026-08-21. One argument raised in that discussion is explicitly **not** part of the justification: "they would still have to sign up" is not a control, because signup is free and self-serve. What actually bounds it is that codes exist only on the physical cards, that the operator controls the stock, and the per-user budget. An operator "release" gate was considered and deferred, not overlooked.

### 2.9 Feed

No feed table for the pilot. Both post types ("You met X" / "A met B") derive on read from `meetings` + `meeting_participants` + `connections` — simpler and always consistent at ~337 users, and avoids fan-out bugs when a meeting's visibility changes. Indexes needed: `connections(user_a_id)`, `connections(user_b_id)`, `meeting_participants(user_id)`, `meetings(occurred_at desc)`.

#### Amendment (2026-08-13) — built as designed, no schema change

**Built on web** (README build order item 4; `apps/web/src/app/feed/`, `apps/web/src/server/feed/feed-service.ts`). The design above held exactly as written: no feed table was added, both post types are computed on every read, and the four indexes this section already asked for were already in place from the original migrations — nothing new was needed at the database layer.

One thing worth recording that this section's original text left implicit: the "derive on read" query is deliberately capped (`limit(50)` in `feed-service.ts`), not paginated. §2.9's own "~337 users" framing, and the build task's more specific sizing note — pilot users have a single-digit number of meetings on day one — both point the same direction, so a plain reverse-chronological list with a generous fixed cap is proportionate; real cursor-based pagination is a deliberate addition to make later, once usage approaches the cap, not a gap in this pass.

---

## 3. Row Level Security strategy

### 3.1 The pattern

RLS is Postgres refusing to return rows the caller isn't entitled to, enforced underneath application code — a second lock behind the application's lock. **Default deny on every table:**

```sql
alter table public.<t> enable row level security;
alter table public.<t> force row level security;
revoke all on public.<t> from anon, authenticated;
```

Graph-position checks go in `security definer` helper functions in a private schema, each declared `stable security definer set search_path = ''` (the `search_path` pin prevents a known privilege-escalation trick). Helpers: `private.current_user_id()`, `private.are_connected(a, b)`, `private.is_mutual_of_both(viewer, a, b)`, `private.shares_event_with(viewer, other)`. Policies wrap calls as `(select private.fn(...))` so Postgres evaluates once per query, not once per row.

### 3.2 Example — `meeting_locations` (highest stakes)

```sql
create policy "location visible to participants, or to mutuals only with full consent"
on public.meeting_locations for select using (
  -- Path A: you were there.
  exists (
    select 1 from public.meeting_participants mp
    where mp.meeting_id = meeting_locations.meeting_id
      and mp.user_id = (select private.current_user_id())
  )
  or
  -- Path B: you are a mutual of BOTH, meeting is not private,
  -- it is marked shareable, and EVERY participant consented.
  (
    exists (
      select 1 from public.meetings m
      where m.id = meeting_locations.meeting_id
        and m.is_private = false
        and m.location_visibility = 'mutuals'
    )
    and not exists (
      select 1 from public.meeting_participants mp
      where mp.meeting_id = meeting_locations.meeting_id
        and (mp.location_share_consent = false or mp.marked_private = true)
    )
    and (select private.is_mutual_of_both(
          private.current_user_id(),
          private.meeting_party(meeting_locations.meeting_id, 1),
          private.meeting_party(meeting_locations.meeting_id, 2)))
  )
);
```

Written as "prove nobody objected" (`not exists ... consent = false`) rather than "prove everybody agreed," so a missing or malformed participant row blocks sharing instead of permitting it. No `insert`/`update`/`delete` policy exists on this table — location rows are written only by the verification service.

### 3.3 Example — `connections`

```sql
create policy "you can read only your own edges"
on public.connections for select using (
  user_a_id = (select private.current_user_id())
  or user_b_id = (select private.current_user_id())
);
```

Deliberately narrow. "You know 4 people going" is answered by a `security definer` function (`private.connections_attending(event_id)`) that returns only people already in your graph — the database never hands over rows, it hands back a computed answer. This is also the degree-of-separation mechanism: it only ever operates inside a context the user is already in (an event, a feed post) — there is no function that answers "who is connected to this arbitrary person."

### 3.4 Example — `users` (this is what forbids global search)

```sql
create policy "read self, connections, and co-attendees only"
on public.users for select using (
  id = (select private.current_user_id())
  or (select private.are_connected(private.current_user_id(), users.id))
  or (select private.shares_event_with(private.current_user_id(), users.id))
);
```

Every readable row must be justified by a specific graph relationship — there's no branch true for an arbitrary user. **No-global-search is enforced by the database being structurally unable to answer the question, not by us declining to build a search screen.** A future change would have to consciously weaken this policy in a reviewed migration to reintroduce it.

> **Amendment 2026-08-15 — the policy above has been narrowed, and the sentence about "a reviewed migration" is the standard it was held to.** `20260815130200` drops and recreates it with one added condition: the `are_connected` and `shares_event_with` branches now also require `users.status <> 'deleted'`. The self branch is untouched. Nothing was widened — the amended policy returns a strict subset of what this one returns.
>
> **Why.** Self-serve account deletion is a *soft* delete, and a soft delete that leaves you readable by everyone you have met is a setting, not a deletion. Until this change `status` had no effect on RLS anywhere: `private.current_user_id()` is deliberately a thin wrapper over `auth.uid()` with no table access (20260809210900 gives two reasons and both still hold), and account status was enforced only where tokens are minted. That placement is right for *authentication* — a deleted account must never receive a Supabase JWT — and says nothing about whether third parties can still read the row. They could.
>
> **What was not done.** `current_user_id()` is unchanged, and no policy reads `users` to answer a question about another table; the filter is a plain column test inside the `users` policy itself, where the row is already in hand, so it costs nothing and cannot recurse. The self branch stays open whatever the status, so a screen that has to tell somebody something about their own deleted account can still read it. `are_connected()` and `shares_event_with()` are unchanged and still answer truthfully about deleted people — the edge and the RSVP rows are still there, deliberately, because that is what keeps the delete reversible; what changed is that being connected to somebody is no longer *sufficient* to read them.
>
> **`suspended` is deliberately still readable**, and that asymmetry is the decision most likely to be questioned later. A suspension is a hold on the account holder, usually temporary and often administrative; it is not a statement to the people they have met that they no longer exist, and blanking a suspended person out of a friend's list would leak a moderation action to third parties. The test therefore names the state it means rather than testing for `= 'active'`.
>
> **`social_links` was not narrowed to match**, although its own policy is written to mirror this one exactly. Nothing reads another person's links through RLS today (the card preview holds the service role and refuses a non-active owner before it gets there), and the mirror would not be a column test — `social_links` has no `status`, so the policy would join `users` on every row. The day a screen renders a connection's links, that exemption ends. Recorded at the policy in 20260815130200.

### 3.5 Service-role-only tables

`connection_attempts`, `app_config`, `pending_connections` have no user-facing read policy at all.

### 3.6 Implementation notes and judgment calls (added 2026-08-09, schema + RLS phase)

Recorded here rather than left implicit in a diff, per the documentation standard. The schema and all policies were implemented from §2/§3 and applied to project `crpsbnbegeoqtlgshltt`; migrations live in `supabase/migrations/`. Nothing below changes a signed-off decision — these are the places §2/§3 did not specify an answer and one had to be chosen, plus two corrections where implementation proved a stated assumption wrong.

**Two corrections to §3.1's pattern.**

1. *The revoke needs a matching grant.* §3.1 shows `revoke all on public.<t> from anon, authenticated` but not the other half. Supabase's default privileges grant ALL on every new `public` table to both roles, so the revoke is essential — but a policy alone cannot make a table readable, because RLS filters rows while GRANT decides verbs. Every table therefore also carries an explicit, narrow grant to `authenticated` (never to `anon`, which holds nothing anywhere in this schema), written next to the policy that constrains it. Column-level grants do real work: `users.is_admin`, `users.status`, `users.kinde_user_id`, `cards.owner_user_id` and `connections.origin_meeting_id` are outside the update grants, because RLS cannot express "this row but not that column".

2. *Policy expressions do re-check function EXECUTE.* The helper functions were initially locked away from `authenticated` entirely, on the assumption that a policy expression runs with the table owner's rights. It does not — that rule covers *tables* referenced in a policy, not *functions* — and the result was every policy failing with `permission denied for function current_user_id`. Caught by exercising the policies against a simulated JWT, not by reading the catalog. `20260809211400_rls_helper_function_grants.sql` grants EXECUTE to `authenticated` on the seven policy-referenced helpers. This does **not** reopen the graph oracle §3.3 forbids: USAGE on schema `private` stays revoked, so the functions still cannot be *named* in a query (verified: a direct call is refused with `permission denied for schema private`), and PostgREST cannot reach a non-exposed schema at any grant level.

**Helpers added beyond §3.1's list.** `private.meeting_party(meeting_id, n)` is spec'd as §3.2 references it: the nth participant, **ordered by `user_id`** so the two calls inside one policy evaluation cannot return the same person, returning null past the end so callers fail closed. `private.can_see_meeting()` and `private.can_see_event()` exist because the same visibility rule is applied from two tables each (`meetings` + `meeting_participants`, `events` + the RSVP insert check) and two copies of an access rule is a disclosure waiting to happen.

**Where §2/§3 was silent and a call was made.**

| Decision | Call taken | Why, and what to watch |
|---|---|---|
| Nullability, generally | NOT NULL where the row is meaningless or unsafe without the column; nullable otherwise | §2 gives types, not nullability. "Everything required" would block the 337-user import; "everything optional" would let a meeting exist with no timestamp. |
| `users.email` | NOT NULL | §2.1 marks `username` nullable explicitly and `email` not; every account starts from a Kinde signup carrying an email. If the import turns up emailless rows this is one reviewed `alter column`. |
| `meetings.verification_session_id` | NOT NULL **and** UNIQUE | NOT NULL makes "every meeting traces to a verification" structural. UNIQUE means one session cannot produce two meetings, i.e. a replay is unrepresentable. **Watch:** this assumes the NFC redeem path creates a session row, which §2.5's `method` enum and §2.8 both imply. If it is later built without one, create the session — do not drop the constraint. |
| `connections.origin_meeting_id` | NOT NULL | An edge with no origin is an edge nobody can account for. |
| Meeting visibility (feed post) | Mutual of **both** parties | §3.2's only worked example uses mutual-of-both. "Connected to either" would surface the existence and identity of someone the viewer has no relationship with. If the feed phase wants the looser rule, that is a reviewed migration. |
| `shares_event_with` | Both sides must be `going` | `interested` is an intention, not attendance; counting it would make two strangers at a large public event mutually visible. This is still the widest branch of the `users` policy and the first thing to re-examine if events outgrow the pilot. |
| `events.visibility` values | `public` \| `private`, defaulting to `private` | Smallest set that supports §2.6's reasoning. Fail-closed default: broad visibility is an explicit choice. |
| Event creation | No INSERT policy or grant at all | Q5 is open. The fail-closed reading of an open question is "nobody". Opening it up once Q5 lands is one policy + one grant. |
| `connection_attempts.outcome` | `success` \| `rejected` | §4.2 describes only these two. Friction on adding a third is a feature for an audit table whose value is cross-row comparability. |
| `pending_connections.status` | `pending` \| `claimed` \| `expired` \| `cancelled` | Minimum the deferred flow needs; expect §2.8's build phase to revisit. |
| `app_config.updated_by` | `uuid` FK → `users`, ON DELETE SET NULL | Type unspecified in §2.5. A real identity beats an unverifiable string; SET NULL so the config outlives the admin. |
| Connection removal | UPDATE policy allowing `active` → `removed` **only** | `removed` exists in §2.3's enum, so users can remove. The one-way constraint matters: re-activating would produce a live edge with no fresh verification — an INSERT by another verb. |
| FK delete behaviour | CASCADE for personal data and edges; RESTRICT for shared history and physical inventory (cards, hosted events, origin meetings); SET NULL for audit rows | Users are soft-deleted; a hard delete is an administrative act, and these rules decide what that act may destroy silently. |
| `blocks` in the `users` policy | Not included | §3.4's policy has no block branch, and blocks are enforced at connection time. Q4 is open; adding profile-hiding is a deliberate amendment, not a slip-in. |

**Observations for later phases, not changes.** (a) `private.connections_attending()` is implemented in `private` as §3.3 specifies and is therefore not callable by the apps — the events phase will need a thin `public` wrapper with an EXECUTE grant, which is where that decision belongs. (b) `meeting_locations` has no write policy at all, so nothing can write it until the verification service exists; that is §3.2's intent, not a gap. (c) `meeting_party()` only ever checks participants 1 and 2 — meetings are pairwise by construction, and introducing group meetings requires revisiting §3.2 rather than just the table.

---

## 4. Connection verification design

### 4.1 The abstraction

```ts
type VerificationOutcome =
  | {
      ok: true;
      initiatorUserId: string;      // the person who scanned/tapped
      counterpartUserId: string;    // the person who presented
      method: 'qr_gps' | 'nfc_card';
      profileRichness: 'full' | 'preview';
      location?: { latitude: number; longitude: number; accuracyM: number };
      evidence: Record<string, unknown>;   // what was logged to justify this
    }
  | {
      ok: false;
      reason: RejectionReason;
      evidence: Record<string, unknown>;
    };

interface VerificationMethod<TInput> {
  readonly id: 'qr_gps' | 'nfc_card';
  parse(raw: unknown): TInput;                              // Zod — shape only
  verify(ctx: RequestContext, input: TInput): Promise<VerificationOutcome>;
}
```

One function performs the graph write:

```ts
createVerifiedConnection(outcome: VerificationOutcome & { ok: true }): Promise<Connection>
```

It accepts only a successful outcome *produced by a verifier* — no API handler assembles a connection itself, making "connect these two users because the client asked me to" unrepresentable in the type system. A future verification method means one new `VerificationMethod` implementation; zero changes to connection, meeting, or feed logic. `profileRichness` carries the card-vs-QR asymmetry as data, never as branching logic, and never affects platform access — only outbound first-impression richness.

#### Amendment (2026-08-13) — built, and what "unrepresentable in the type system" had to mean to actually be true

**Built in `packages/core/src/connect/`.** The interface is as written above. Three things had to be decided to make the guarantee real rather than aspirational, and all three are recorded here because a reader who assumes the obvious implementation will get a weaker property than the one this section promises.

**1. A plain `{ ok: true }` object type does not deliver the guarantee.** Any handler can write that literal and hand it to the writer, and TypeScript is satisfied — so the sentence above would be true of the documentation and false of the code. `VerifiedOutcome` therefore carries a **brand**: a property whose key is a `unique symbol` that nothing exports. The only function that asserts it is `sealVerified()`, which lives in `connect/internal/seal.ts`, is not re-exported from the package index, and is unreachable by deep import because `packages/core/package.json` declares `"exports": { ".": "./src/index.ts" }`. Two call sites use it: the QR verifier and the NFC verifier. The practical effect is that `createVerifiedConnection(store, { ok: true, … })` written in an API route is a **compile error** — "Property `[verifiedBrand]` is missing" — and `pnpm turbo type-check` runs on every change. A test in `no-second-write-path.test.ts` asserts the call-site list, so a third one is a red build rather than a code-review catch.

**2. `evidence` is narrowed from `Record<string, unknown>` to a named shape** (with the index signature kept, so it is still a superset of what this section declares). The writer has to put these exact values into `connection_attempts` columns, and digging typed numbers out of an untyped bag is precisely the code that silently starts logging `undefined` — a defect nobody notices, because nothing reads an audit log until it matters.

**3. Judgment call — `profileRichness` for `qr_gps` is `preview`.** §4.5 step 5 fixes `nfc_card` at `full`; §4.2 never states the QR value and this section only says the two differ. `preview` was chosen on the reasoning that a card is a deliberate object its owner chose, branded and physically handed over, so it carries a fuller first impression, whereas a QR scan is incidental. Nothing consumes the field yet, so the choice costs nothing today — it is recorded now rather than discovered later by whoever builds the first screen that reads it.

**What did NOT need changing:** the interface's own shape, the two-method split, or anything downstream. The abstraction held.

### 4.2 QR generation and rotation — end to end

**Alice presents. Bob scans.**

1. **Alice opens "Connect."** `POST /api/connect/qr/session` creates a `connection_sessions` row (`status='active'`, `expires_at = now + 300s`, random `current_nonce`, Alice's `device_id`).
2. **Token issuance, every 30s.** Server generates a new nonce, moves the old one to `previous_nonce` (grace window for scans landing mid-rotation), signs:
   ```
   payload  = { sid, nonce, iat, exp: iat + 45 }
   token    = base64url(payload) + "." + base64url(HMAC-SHA256(secret, payload))
   QR shows = https://smartcard.app/c/<token>
   ```
   The QR contains no personal data — just a session id and nonce, meaningless without our server.
3. **Location heartbeat.** While displayed, Alice's app posts a fresh GPS fix every ~20s (`expo-keep-awake` prevents screen lock). **UX cost to test at pilot (Q8):** if she backgrounds the app, the heartbeat stops and scans fail on staleness — a direct, necessary consequence of defeating the video-relay threat.
4. **Bob scans**, requests a *fresh* high-accuracy GPS fix, posts `{ token, scannerLocation: { latitude, longitude, accuracyM, capturedAt }, deviceId }` with his auth token.
5. **Server validates, in this exact order:** (1) HMAC signature first, reject immediately on failure, never interpret unverified data; (2) `exp` not passed; (3) session exists, `status='active'`; (4) session `expires_at` not passed; (5) `nonce` matches `current_nonce` or `previous_nonce`; (6) presenter ≠ scanner; (7) not already connected, no block either direction; (8) **GPS gate — §4.3**; (9) rate limits — §4.6.
6. **Commit atomically:** insert `connections`, `meetings` + `meeting_participants` (+ `meeting_locations` if captured), mark session `consumed`, log success to `connection_attempts`. Single-use is enforced at the **session** level — once consumed, every outstanding token dies, including ones screenshotted seconds earlier.
7. **Rejections** write a `connection_attempts` row with the reason and numbers. The user sees only a plain message ("You need to be near each other to connect") — never the distance, radius, or the other party's location, which would let someone probe for a person's position by repeated scanning.

#### Amendment (2026-08-13) — built: the endpoints, where token issuance actually happens, and how step 6's "atomically" is achieved

**Endpoints built** (`apps/web/src/app/api/connect/`), all POST, all requiring a real signed-in caller through `getAuthenticatedContext()`; there is no anonymous path anywhere in this flow.

| Route | §4.2 step |
|---|---|
| `POST /api/connect/qr/session` | 1 |
| `POST /api/connect/qr/heartbeat` | 3, **and 2** — see below |
| `POST /api/connect/qr/redeem` | 4–7 |
| `POST /api/connect/nfc/redeem` | §4.5 |

**Decision — token rotation is folded into the heartbeat, not given an endpoint of its own.** Step 2 says tokens are issued "every 30s" without saying from where. Three options existed and the reasoning is recorded because the choice has a security consequence:

- *Hand the client a batch of future tokens* — disqualified outright. Rotation exists so a photograph of the screen is stale within seconds (threat 1); a batch in the client's memory is a photograph of the next several minutes.
- *A separate polled endpoint* — works, but adds a second request on the same cadence as one the presenter already makes.
- *Fold it into the heartbeat* — **chosen.** The session response carries the first token; every heartbeat carries the current one and rotates the nonce when `qr_rotation_seconds` has elapsed. This is not merely fewer requests: **the nonce only rotates when a fresh location arrives**, so a presenter cannot keep displaying current codes while their location goes stale. The two freshness properties the GPS gate depends on become one property that cannot be half-satisfied.

The accepted cost is that a presenter who backgrounds the app or loses location permission stops getting fresh codes and their session goes stale. That is the correct outcome — a scan against a stale-located session would be rejected by the §4.3 gate anyway, so the alternative is a screen that looks like it is working and is not. It is also exactly the UX cost step 3 already flags as Q8.

**Step 6's "commit atomically" is a `security invoker` plpgsql function, `public.create_verified_connection`** (`20260813210300`), called via `.rpc()` with the service role. `supabase-js` has no client-side multi-statement transaction, so six sequential PostgREST calls are six independent transactions — and the partial states that produces are security-relevant, not cosmetic. The worst of them leaves the meeting written and **the session still `active`**, i.e. threat 1 reopened by a dropped network connection, because single-use is enforced at the session level and the session survived. A plpgsql function runs inside one transaction by construction.

Three properties of that function are worth knowing:

- **The session consume is a compare-and-swap**, not a check followed by a write. `update … where id = ? and status = 'active' and expires_at > now() and presenter_user_id = ?` — exactly one of two concurrent scans updates a row. That is what makes "consuming the session kills every outstanding token" true *under concurrency* rather than merely usually.
- **It is `security invoker`, departing from every `private.*` helper.** Those are `definer` because a *policy* needs to see rows the *caller* may not; nothing of the kind is true here, since the only caller is the service role, which already bypasses RLS. As `definer` this would be a single grantable capability to manufacture arbitrary connections with the owner's rights — one mistaken `grant execute … to authenticated` from being exactly the second write path threat 4 forbids. As `invoker`, that same mistake lands on a role with no INSERT privilege on any graph table and the first insert fails. The absent INSERT policy stays the backstop it was designed to be.
- **Judgment call — a previously-`removed` edge is re-activated rather than refused.** `connections` has a UNIQUE constraint on the pair regardless of status, so a pair who removed a connection and later met again could otherwise never reconnect. The function updates the existing row back to `active` with the *new* `origin_meeting_id` and a reset `created_at`. This does not contradict §3.6's one-way RLS rule, which forbids **a client** doing it because a client doing it produces a live edge with no fresh verification behind it. Here there is fresh verification — a new session, a new meeting, and for QR a new pair of in-range fixes, all created moments earlier in the same transaction — and the edge continues to name the evidence that currently justifies it. Refusing instead would be a product bug, not a security property.

**Step 7 is implemented as one function, `userFacingMessage()`, and tested as a rule rather than as copy.** Messages may describe the *caller's own device* ("we couldn't pin down your location precisely enough") and may not describe the other party, the comparison, or any threshold. Automated tests assert that no message contains a digit, that none contains the words metre/radius/distance/accuracy/threshold, that a `blocked` rejection is byte-identical to an ordinary failure, that all three card refusals are identical so the endpoint is not a card-code oracle, and that too-far / imprecise / stale all collapse into one sentence so nobody learns which knob to turn.

### 4.3 GPS validation — end to end

Required for every QR connection, no exceptions.

**Checks, server-side:** (1) presenter freshness ≤ `presenter_location_max_age_seconds` (90s); (2) scanner freshness within tolerance; (3) accuracy floor — either reading worse than `qr_max_accuracy_m` (100m) rejects as imprecise; (4) Haversine distance computed server-side in `packages/core`; (5) compare against `qr_max_distance_m`, read live from `app_config`.

Every threshold is a config row, not a hardcoded constant — GPS is genuinely unreliable indoors (convention centers, ballrooms, basements), and tuning must not require a deploy or app store review.

**Fail closed, explicitly:**

| Situation | Behaviour |
|---|---|
| Location permission denied | Reject, explain why, offer to enable |
| GPS unavailable / no fix | Reject |
| Location fields missing from request | Reject |
| Presenter heartbeat stale | Reject |
| Accuracy worse than threshold | Reject |
| Any error inside the GPS check | Reject |

IP-based geolocation is logged as a signal only, never a substitute gate (trivially defeated by a VPN, typically city-level anyway).

#### Amendment (2026-08-13) — automatic radius relaxation after repeated failure by the same pair

**Resolved (Q18).** The problem this solves is the one real failure mode of a hard proximity gate: two people who are genuinely standing next to each other, in a basement ballroom or a steel-framed conference hall, whose phones cannot agree on where they are. Under §4.3 as originally written their only recourse is to keep trying and keep failing, and the product looks broken at precisely the moment it is meant to feel magic.

**The mechanism.** When the same **presenter + scanner pair** accumulates `qr_relaxation_failure_threshold` (2) distance-based rejections within `qr_relaxation_window_seconds` (600), the *next* attempt by that same pair is evaluated against `qr_relaxed_max_distance_m` (500) and `qr_relaxed_max_accuracy_m` (150) instead of the normal thresholds. Everything else about §4.3 and §4.2 is unchanged: same signature check, same freshness checks, same ordering, same server-side computation, same fail-closed table.

**What it is not.** There is no human override, no host approval, no "connect anyway" button, and nothing the client can ask for. Relaxation is decided entirely server-side from the audit log; the two phones cannot tell it happened and are never told. That last point is deliberate — see "why the user is never told" below.

**Eligibility, tightly scoped.** Relaxation is unlocked only by failures whose rejection reason was *distance or accuracy*. A failure for a bad HMAC, an expired token, a consumed session, a block, or an existing connection unlocks nothing. This matters: without it, an attacker could spend two junk requests to buy a wider radius. The failures must also be the same ordered pair of users, which means an attacker cannot pool failures across victims.

**The three properties that keep this from becoming a hole.**

1. **It does not escalate.** There are exactly two rungs on this ladder — normal and relaxed — and no third. Failing twice more at the relaxed radius does not widen it again. A mechanism that relaxed on every repeated failure would let anyone walk the radius up to citywide simply by being patient, which is the same attack as having no radius at all, executed slowly.
2. **It cools down.** After a pair's relaxed attempt resolves — success *or* failure — that pair reverts to normal thresholds and cannot re-trigger relaxation for `qr_relaxation_cooldown_seconds` (3600). Without a cooldown, a determined pair could hold themselves permanently in relaxed mode by failing on purpose every few minutes.
3. **The relaxed radius stays far larger than the relaxed accuracy floor.** 500m against a 150m floor keeps the ratio above 3:1. The accuracy floor exists (§4.7 threat 2) so that a deliberately vague fix cannot fuzz its way inside the radius; if the floor ever approached the radius, the check would be satisfiable by imprecision alone and would stop meaning anything. **Anyone tuning these two numbers must tune them together and preserve that ratio** — this is the single most important constraint on the relaxed values, and it is the reason the accuracy floor is loosened only from 100m to 150m while the distance moves from 150m to 500m.

**This mechanism is deliberately attacker-triggerable, and that is survivable.** Anyone can fail twice on purpose. Two colluding remote users can therefore reach the 500m radius whenever they like. The honest framing is that relaxation does not defend a boundary — it *moves* one, from "same large room" to "same venue", for one attempt, for one pair, once an hour. §4.7 already accepts deliberate collusion as a residual risk (two real people who both want a fake connection can simply meet), and a 500m ceiling remains a real proximity claim: it does not connect two people in different neighbourhoods, let alone different cities. What would be unsurvivable is escalation or persistence, which is exactly what properties 1 and 2 remove.

**Why the user is never told.** The rejection message stays the generic "You need to be near each other to connect" from §4.2 step 7, and a relaxed acceptance looks identical to a normal one. Telling a user "we widened the radius for you" teaches the attack in a single sentence — it announces that failing repeatedly is rewarded. The same reasoning that keeps the distance number out of a rejection keeps the relaxation out of a success.

**Judgment call — relaxation state is derived, not stored.** `connection_attempts` already records the pair, the rejection reason, and the timestamp for every failure, so the question "has this pair failed twice for distance in the last ten minutes?" is one indexed query against a table the service role already owns. A dedicated `relaxation_state` table would add a second source of truth that can disagree with the log, and disagreement between an audit log and a live security decision is the worst class of bug this design can have. The cost is one index (§2.5 amendment (b)). The product owner specified the behaviour, not the storage; this is the storage answer, chosen for one-source-of-truth rather than for speed.

#### Amendment (2026-08-13) — built, with three decisions §4.3 did not make

The gate is `evaluateGpsGate()` in `packages/core/src/connect/gps-gate.ts` — a pure function taking already-fetched values and returning a verdict, deliberately separated from the I/O that fetches them so that every row of the fail-closed table above can be tested exhaustively without a database per case. A gate whose failure modes are expensive to test is a gate whose failure modes are untested.

**1. Judgment call — scanner freshness reuses the presenter's bound.** §4.3 gives an explicit number for the presenter (90s) and says only "scanner freshness within tolerance" for the scanner, and §2.5's config table has no second key. Inventing an unspecified threshold would be a silent deviation *and* would put a security number where no operator can tune it, so the same `presenter_location_max_age_seconds` row bounds both sides. It errs generous: the scanner's fix is captured at the moment of the scan and posted immediately, so 90s is far more slack than a genuine scan needs. **Tightening it is the first knob to reach for** if pilot data ever suggests a relay is getting through on a stale scanner fix; that would be the point to add a second key.

**2. Added check — a fix timestamped in the future is refused, not treated as maximally fresh.** Not in the table above, and it closes a real hole in it. Freshness is `now − capturedAt`, so a `capturedAt` set forward by an hour yields a negative age that passes every staleness check for the next hour — a client that can set its own clock opts out of the bound threat 2 depends on. A 30-second tolerance absorbs ordinary phone/server skew; beyond it, the value is not a fix we can reason about.

**3. The relaxed-radius-to-accuracy ratio is enforced by code, not by advice.** This section states that the relaxed radius must stay far larger than the relaxed accuracy floor and calls it "the single most important constraint on the relaxed values" — but as written it is a sentence in a document, and the rows it constrains are edited in a hurry, mid-event, by someone tuning a threshold. `parseVerificationConfig()` therefore **refuses to start** on a configuration where `qr_relaxed_max_distance_m < 3 × qr_relaxed_max_accuracy_m`. Refusing disables connecting, which is a visible outage someone fixes in a minute; the alternative is a proximity gate that has quietly become satisfiable by imprecision alone, with no error anywhere. The normal pair (150/100, a ratio of 1.5) is deliberately **not** enforced — refusing it would refuse the configuration this architecture ships with — and stays a thing to watch in pilot data instead.

**One more fail-closed detail worth recording.** The final comparison is written `!(distance <= radius)` rather than `distance > radius`. Every comparison against `NaN` is false, so `NaN > radius` reads as "inside the radius" and opens the gate; `!(NaN <= radius)` rejects. The same reasoning makes `haversineDistanceM` return `null` rather than `NaN` for unusable input. On the one comparison that decides whether two people were in the same place, there should be no value of the input for which the expression silently accepts.

### 4.4 Tuning from pilot data

`connection_attempts` records distance, both accuracies, radius in force, method, and time per rejection — enough to answer "what radius would have accepted 99% of genuine attempts at this venue?" from data after the pilot. Recommendation: start at 150m, watch logs live on day one, adjust `app_config` in real time.

#### Amendment (2026-08-13) — keeping relaxed acceptances separable in the pilot data

Relaxation (§4.3) would quietly corrupt the tuning dataset if it were not marked. A connection accepted at 400m because relaxation was in force is evidence that *the normal radius was too tight for that venue* — it is not evidence that 400m was acceptable at full precision. Averaged in unlabelled, relaxed successes would drag the recommended radius upward and hide the very problem they were caused by.

So every row records `radius_mode` (`normal` | `relaxed`), the accuracy floor actually applied (`accuracy_config_used_m`), and, for a relaxed attempt, the earlier failure that unlocked it (`relaxation_source_attempt_id`) — all three specified in the §2.5 amendment, none applied yet.

**The four questions the pilot data must be able to answer, which is the test of whether those columns are the right ones:**

1. *How often was relaxation needed at all?* — relaxed attempts ÷ total attempts. If it is near zero, the normal radius is fine and the mechanism is dead weight worth reconsidering. If it is large, the mechanism is propping up a threshold that should simply be raised.
2. *What radius would have accepted 99% of genuine attempts at full precision?* — the original §4.4 question, now asked over `radius_mode = 'normal'` rows only, so it stays a clean measurement.
3. *Did relaxation actually rescue people, or just delay a failure?* — of the pairs that unlocked relaxation, how many then connected. A low rate means the failures were not distance-marginal and relaxation is not the right remedy.
4. *Is relaxation being abused?* — pairs hitting the cooldown repeatedly, or relaxed attempts arriving at distances near the 500m ceiling rather than clustered just past 150m. Genuine indoor failures cluster near the normal radius; deliberate ones do not.

Question 4 is the one to check *during* the first event, not after it.

### 4.5 NFC — end to end

Two in-scope cases (card tap, passive NDEF tag read), one code path — both are "the app receives a URL containing a code."

1. Tag contains `https://smartcard.tech/card/<code>` — this is the real, physically-fixed format (confirmed by tapping a production card — see §2.2), where `<code>` is `<cosmetic-prefix>-<12-hex-char-suffix>`. The suffix's 48 bits of randomness is what makes this unguessable; the prefix is cosmetic only.
2. Phone opens the URL via universal/app links (§7.3 — note `smartcard.tech`, not a new domain, must serve the link files); no app installed → web preview page.
3. App calls `POST /api/connect/nfc/redeem { code }` with the scanner's auth.
4. Server looks up `cards` by `card_code`; requires `status='assigned'`, owner not null, owner ≠ scanner, no block, not already connected.
5. Commits connection + meeting, `verification_method='nfc_card'`, `profileRichness='full'`.

The client's claimed owner is never trusted — identity is resolved server-side from the code alone. No GPS gate for NFC: physical range (a few centimeters) *is* the proximity proof. Rate limiting on redeem velocity per card matters here, since a stolen physical card is a real risk; an owner can set `status='revoked'` to instantly kill a lost card.

#### Amendment (2026-08-13) — the tap stays instant, and the owner is notified the moment it happens

**Resolved (Q17):** a card tap forms the connection **instantly**, with no confirmation step by the card owner — and fires a push notification to the owner the moment it commits: *"Sam Rivera just tapped your card."*

**Why instant, and why the question was worth asking.** The alternative — the owner must approve each tap — was rejected because it breaks the only thing a physical card is actually good at. A card works when it is handed over, left on a table, or tapped while its owner is mid-conversation with someone else; that is the existing behaviour of the product and the reason cards exist at all. Requiring the owner to look at a phone converts a two-second physical gesture into a two-party synchronous dance that fails whenever the owner's phone is in a pocket. It would also add little against the real threat: an owner glancing at a prompt saying "someone tapped your card" cannot tell a legitimate tap from a stolen-card tap much better in the moment than afterwards.

**The notification is the compensating control, and this is the key security reasoning.** Declining to add a confirmation step means there is no preventive control on this path at all, so the design leans on a **detective** one with a fast remediation path. The threat is a lost or stolen card: whoever holds the physical card can connect to its owner. §4.5 already gives the owner the kill switch (`cards.status = 'revoked'`), but a kill switch is worthless if the owner does not know to reach for it — before this decision, a stolen card could be tapped for weeks and the owner would find out only by noticing unfamiliar names in a connection list. **Real-time notification is what converts an existing capability into an actual defence:** the owner learns within seconds, and one tap from the notification revokes the card. Detection latency, not prevention, is the property that changed.

**What the notification may contain, and what it may not.** The tapper's display name and the time, nothing more. Two constraints drive that:

- **No location, ever.** Card taps have no GPS gate and therefore no location to send, but the rule is stated here so that a later "helpful" addition — pulling a coarse position from the tapping device — is recognised as the change it would be: it would put a third party's position into a push payload, and §7.5 explains why payloads are the wrong place for anything sensitive.
- **The name is not a leak**, because by the time the notification sends, the connection already exists and the owner can see that person's profile anyway. The notification tells the owner nothing they were not already entitled to; it just tells them *now*.

**The one place this path deliberately does not fail closed.** §0 and CLAUDE.md both say connection logic fails closed. Notification delivery is the exception, and the reason is worth being explicit about: **a failed or delayed push must never block, delay, or reverse the connection.** Physical possession of the card is the proof, and it is already complete at that point. Refusing a connection because a push vendor was having an outage would break the product for a reason unrelated to whether the meeting happened. Failing closed protects *verification*; there is nothing left to verify here. What must not happen is silent breakage, so a send failure is logged and monitored — a notification pipeline that has been dead for a week is a security regression even though no single connection was affected.

**In-app surface as well as push, for the same reason.** Push delivery is best-effort on both platforms and users disable notifications. The card-tap awareness feature therefore also needs a visible in-app record — a recent-activity or connection list showing "tapped your card" with the same revoke action — so that a user who never receives a push is not a user with no path to detection. Push is the fast path, not the only one.

**Practical details for the build phase.**

- Enqueued **after** the connection commits, server-side, in the same service function — never triggered by the scanner's client, which would let the tapper suppress the owner's alert by dropping the call.
- **Coalesced.** A card left on a table at a conference can be tapped repeatedly; thirty pushes in a minute trains the owner to ignore the alert that matters. One notification, then a rolled-up "and 4 others tapped your card" within `nfc_tap_notification_coalesce_seconds` (300, §2.5 amendment (d)).
- Deep-links to the new connection with **revoke card** and **remove connection** available inline. The entire value of the notification is remediation speed; making the owner navigate to find the revoke button spends that value.
- A tap by someone the owner has blocked never reaches this point — it is rejected at step 4 — so the notification cannot be used as a channel to reach someone who blocked you.

**Schema sketch — `user_push_tokens` (Connect Flow phase, not applied).** Sending a push requires knowing where to send it, and nothing in the applied schema stores that. Descriptive sketch only, in §2's style:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → users, cascade delete — a deleted user's devices must stop being addressable |
| `expo_push_token` | text | 🔒 unique. The Expo push token for one installation (§7.5) |
| `platform` | text | `ios` / `android` / `web` |
| `device_id` | text | Which installation, so a re-registered device replaces its own row rather than accumulating |
| `last_seen_at` | timestamptz | Refreshed on app launch; stale rows get pruned |
| `disabled_at` | timestamptz | Set when Expo reports the token is dead — see below |
| `created_at` | timestamptz | |

**What its RLS will need to grant and forbid, in plain language.** A user may insert, update, and delete **only rows carrying their own `user_id`** — that is how the app registers its token on launch and clears it on logout. A user may read their own rows and **nobody else's, under any relationship**: not a connection's, not a co-attendee's. This table is unusual in that the danger is not what the token *reveals* but what it *enables* — a push token is a capability to deliver arbitrary notification content to a specific person's lock screen. A leaked token is an impersonation channel: someone could push "Your connection request was accepted" to a user who never made one. So the read rule is self-only, with no graph branch to argue about, and sending happens exclusively server-side with the service role. The `authenticated` grant should exclude `disabled_at` — that column is the server's bookkeeping, not the client's — using the same column-level grant technique §3.6 already relies on for `users.is_admin`.

**One operational rule that belongs with the table:** Expo returns `DeviceNotRegistered` for tokens whose app was uninstalled or whose token rotated. Those rows must be marked `disabled_at` rather than retried forever, or the send path slowly becomes mostly failures and real failures stop being visible.

#### Amendment (2026-08-13) — built, including the sending mechanism, and one deviation on coalescing

**The NFC redeem path is built** (`POST /api/connect/nfc/redeem`, `packages/core/src/connect/nfc-verifier.ts`) exactly as steps 1–5 describe: the code is resolved server-side against `cards.card_code`, the request schema has no field for an owner id at all, and status/owner/no-self/no-block/not-already-connected are all checked before the commit. `revoked` is checked before `assigned`, so the audit log records the honest reason while the user-facing message stays identical to "no such card" — telling a tapper "this card was revoked" confirms they are holding somebody's lost property and are being watched, which helps them and not the owner.

**The session row §3.6 insisted on is created inside the atomic write.** §3.6's judgment call on `meetings.verification_session_id` being NOT NULL says: "if the NFC redeem path is later built without creating a session, create the session — do not drop the constraint." It does. `create_verified_connection` inserts a `connection_sessions` row already in its terminal state — born `consumed`, `expires_at` already past — in the same transaction, so there is no instant at which anything could redeem it.

**Rate limiting is ordered differently from the QR path, deliberately.** §4.5 specifies no validation order, so this is a difference rather than a deviation, but it is a difference worth stating. The QR path can safely leave limits until step 9 because checks (1) and (2) are an HMAC and an integer comparison with no database access — a cheap cryptographic gate stands in front of all I/O. The NFC path has no such gate, because **the card code *is* the credential** and the first thing the path does is a lookup. So the per-user and per-IP limits are enforced *before* the lookup, and the per-card limit immediately after it (it cannot be evaluated until the code resolves to a card). The per-card budget is consumed even by taps that then fail a later check, so "tap a revoked card repeatedly" is not free.

**The sending mechanism is real and correct, and there are currently zero registered tokens for anybody** — expected, since mobile Kinde auth and token registration are not built (they need the EAS dev build, §7.2). `apps/web/src/server/connect/push.ts` posts to Expo's push API with `EXPO_ACCESS_TOKEN`, handles `DeviceNotRegistered` by setting `disabled_at`, bounds the request with a 5-second timeout, and **resolves rather than throws on every failure path**, including the two states this project is actually in ("no live tokens for this user", "no Expo credential configured"). Both of those are logged at info/warn rather than passed over silently, because §4.5's stated failure mode to avoid is not an undelivered notification — it is a pipeline that has been dead for a week without anyone knowing. `EXPO_ACCESS_TOKEN` is the one secret in `apps/web/src/server/env.ts` that is deliberately **optional**: making it required would mean a missing environment variable stops people connecting, i.e. failing closed on the one part of this path where failing closed is the wrong answer.

**Deviation, recorded rather than glossed — coalescing is "fold into the next notification", not "send a rollup at the end of the window".** This section describes "one notification, then a rolled-up 'and 4 others tapped your card' within 300s", which implies a deferred send when the window closes. This project has no scheduler or job queue (pg_cron is not enabled, and enabling an extension is its own decision with its own review). What is built is the closest form needing neither: the first tap in a window notifies immediately, further taps inside the window do not push again, and the next notification after the window carries the rolled-up count. **The property that matters holds** — an owner is never trained to ignore the alert by thirty pushes in a minute. **The property that does not hold** is that the rollup arrives promptly rather than on the next tap. Worth revisiting the moment anything else in the product needs a scheduler. The count itself is derived from `connection_sessions` (every tap creates one `nfc_card` session for the owner), so there is no new counter and no second source of truth.

**Not built, and out of scope for this pass:** the in-app surface this section also requires ("a recent-activity or connection list showing 'tapped your card' with the same revoke action, so that a user who never receives a push is not a user with no path to detection"). That is a screen, and no connect screens were built in this pass. **It is a real gap in threat 7's defence, not a nicety** — push delivery is best-effort on both platforms and users disable notifications — and it belongs with whichever phase builds the connections list.

#### Amendment (2026-08-15) — step 2's "no app installed → web preview page" is now real, and it is the product's first unauthenticated read

Step 2 of this section has always ended with the words **"no app installed → web preview page"**. Until now that clause described nothing: a signed-out visitor got a static sign-in prompt, the page touched the database zero times, and the tap effectively landed on a wall. This amendment records that the preview is built, what it discloses, and — at more length, because it is the part that matters — what it costs.

**The project owner made four decisions and they are not up for re-litigation here.** They were made with the risks below written out in full:

1. **Preview is ON for every assigned, active card.** No per-user opt-in or opt-out column, so there is no setting to add, migrate or explain, and no user for whom a tapped card silently does nothing.
2. **The vCard includes phone number and email by default.** A contact card without contact details is not a contact card, and the whole point of a physical card is that handing it over shares those two things.
3. **Auto-connect after sign-in is unchanged.** A signed-in visitor still hits `CardRedeemFlow` on mount, exactly as Q17 decided.
4. **Both halves were built**: the card path (`/card/<code>`) and the QR path (`/c/<token>`).

**The QR half fixed a live bug nobody had reported.** `connect/lib/qr-url.ts` has always encoded `<origin>/c/<token>` per §4.2 step 2, and the in-app scanner parses that shape back out — a closed loop that works. But **no `/c/` route existed**, so the other way a QR gets read in the real world (a phone camera, which offers to open the URL) 404'd. The presenter's screen was displaying a link to nothing. `/c/<token>` now runs §4.2 step 5's first five checks — signature, `exp`, live session, session lifetime, nonce — and shows the presenter's preview only if all five pass.

**The nonce check is included even though nothing is being redeemed**, and that is a deliberate tightening rather than copy-paste. A preview does not strictly need a current nonce; the signature and the live session already prove the token is ours and the presenter is still displaying. It is checked anyway because dropping it would quietly reopen half of threat 1 on a brand-new surface: a photograph of somebody's QR would keep resolving to their phone number and email for the whole life of the session. Rotation exists so a screenshot goes stale in seconds, and it should go stale for every reader of the token, not only for the one trying to connect.

**Every refusal is the same refusal, and this matters more here than on the redeem endpoints.** An unknown code, unassigned stock, a revoked card, a suspended or deleted owner, a forged token, an expired token, a consumed session, an exhausted budget, a missing config row and any thrown error all produce one `null` and one identical rendered page. §4.5's existing rule ("telling a tapper 'this card was revoked' confirms they are holding somebody's lost property and are being watched") applies with more force to an anonymous caller than to a signed-in one, because any distinction between refusals turns the route into an oracle for which of the 7,142 printed codes are real and which are live. This is asserted as a set — the tests take every failure mode and check that the number of distinct results is exactly one — not reviewed as copy.

**Rate limiting had to be invented for this path, because §4.6's controls do not reach it.** Every limit that actually resists brute-forcing a card code is keyed to a user, and `nfc-verifier.ts` says so in as many words: it works "because a guesser has to be a signed-in user". There is no account to charge here. A new `card_preview` action was added with two budgets, both seeded as `app_config` rows (20260815120000) and both refusing rather than defaulting if the row is missing:

| Budget | Value | What it is actually for |
|---|---|---|
| per IP, per hour | 40 | Stopping **one host scraping**. The realistic attack is not guessing 48-bit suffixes — it is somebody who already holds a list of codes (a photo of a stack of stock, a leaked print run) turning it into a contact database in one pass. |
| per card, per hour | 20 | Capping what **one card** discloses before anyone notices. Consumed even by previews that are then refused, so probing a revoked card is not free. |

Both count the preview page and the vCard download separately, because both are disclosures — so read them as roughly 20 and 10 previews respectively. Both are deliberately on the tight side, which is the *opposite* of §4.6's sizing call, and the inversion is intentional: a connect limit that bites breaks the product in front of the pilot audience, whereas a preview limit that bites shows a stranger "nothing here" on a courtesy page and is fixed by one UPDATE. Erring tight makes the mistake a visible refusal; erring loose makes it a silent scrape.

**A new audit table, `card_preview_views`** (20260815120100 / 20260815120200), records every disclosure — never a refusal, because refusals already leave a row in `rate_limit_events` (which records before it counts) and adding a second unbounded, unpruned write reachable by an anonymous caller would be a worse trade than the signal is worth. The owner reads their own rows on `/activity`, through their own RLS-bound client, alongside the card-tap list. That surfacing is not decoration: a preview produces no tap, no connection and therefore **no push notification at all**, so without it the disclosure would be completely invisible to the person it is about — and detection is the whole of threat 7's defence on this path.

**Two deviations from existing rules, recorded where the rules live rather than only in code.**

- **`service-role-client.ts`'s "one caller" posture takes a sixth caller.** The check that file demands was made and a policy is impossible: every policy in this schema is a relationship between the reader and the row, evaluated against `auth.uid()`, and this reader has no account, no `users` row and no JWT. The only policy that could serve the page is one true for `anon` on `users`, which would open the table §3.4 exists to close. What replaces RLS is the TypeScript: two entry points, each taking only a credential, a hardcoded column list, no caller-supplied filter of any kind, no raw row ever returned, and **`social_links` never read at all** (20260809211100: exposing them "would be a searchable directory of people's off-platform handles"). The allowlist in `no-second-write-path.test.ts` was updated by hand with that reasoning attached.
- **`photo-url.ts`'s "never the service role" rule is deviated from, for this path only.** That file forbids service-role signing because Storage enforces RLS at signing time. There is no caller client to bind to here, and the alternative was widening the `profile-photos` policy to `anon` — which would let anyone who obtained or guessed *any* path fetch the bytes for *every* user, a blast radius far past this feature. The narrower option was taken: sign inside the preview module, for one path already resolved from a credential, at a **five-minute** TTL rather than the hour a signed-in session gets. `photo-url.ts` remains the only sanctioned route for every signed-in surface.

### 4.6 Rate limiting

| Endpoint | Limit |
|---|---|
| `qr/session` create | per user, per hour |
| `qr/redeem` | per user, per hour |
| `qr/redeem` per session | 5 failures → session burned |
| `nfc/redeem` per card | per hour |
| `nfc/redeem` per user | per hour |
| Contacts import | per user, per day |
| All connect endpoints | per IP |

All rejections logged, never silently dropped.

#### Amendment (2026-08-13) — built: the numbers, the mechanism, and the one thing that had to be separated

**Numbers and mechanism** are in the §2.5 amendment above (six `app_config` rows; `public.rate_limit_events` plus `rate_limit_consume()`). Contacts import is on §4.6's list and is not built, so it has no limit yet and needs one when it lands — the generic table takes it without a migration, which is why it is generic.

**Consumption and enforcement are separated, and that is what makes limits-last safe.** §4.2 step 5 puts rate limits at position (9), after everything else, and this build honours that ordering exactly. The obvious worry is that a flood failing at check (1) never reaches check (9) and is therefore never limited. Two things resolve it:

- Checks (1) and (2) are pure computation with no database access, so a flood without a valid signature cannot reach the database at all. The cheap crypto gate in front of all I/O is what makes the documented order defensible rather than something to "improve".
- **Budget is spent by trying, not by getting far enough to be checked.** Every connect request records its rate-limit event at the top of the handler; the *verdict* is acted on at the position §4.2 gives it. So an attacker cannot get free retries by ensuring their requests fail early. `rate_limit_consume()` records before it counts for the same reason, one level down.

The single exception is the per-IP limit on the redeem endpoints, which is enforced at the top rather than at step 9 — a per-IP flood is precisely what it exists to stop, and running the whole pipeline first would defeat it. The per-user redeem limit, which is the one §4.2 orders at step 9, is enforced there, inside the verifier.

**The five-failures-burns-the-session rule counts from `connection_attempts`,** not from a counter of its own — the same one-source-of-truth reasoning §4.3's amendment applies to relaxation state. Burning sets the session to `revoked` rather than `expired`, so the audit trail distinguishes "time ran out" from "we killed it"; every outstanding token then dies at §4.2 step 5.3.

**A request with no usable IP header is charged to the literal subject `"unknown"` rather than skipping the limit.** Skipping would make "send no `x-forwarded-for`" the way to opt out of the only limit not tied to an account.

**IPs are hashed before storage**, with a dedicated `CONNECT_IP_HASH_SALT` — deliberately not the same value as `CONTACT_HASH_SALT` (§2.7), since one salt across two datasets means one leak compromises both. That salt is **required**, not optional: an unsalted hash of an IP is reversible by enumerating the whole address space, i.e. it is storing raw IPs while believing you did not.

### 4.7 Threat → mechanism mapping

**Threat 1 — Screenshot the QR, forward to a remote person → Defeated.** Token `exp` (45s) + rotation (30s) + session-level single-use (any legitimate scan kills every outstanding token) + GPS gate as a second independent layer.

> **Amendment (2026-08-15) — the card path now has a residual this threat did not previously have, and it is consciously accepted.**
>
> This threat was written about the QR, where "screenshot and forward" is defeated by time: the code in the picture is dead within 45 seconds. **The card path was never in scope for it because there was nothing to forward** — `/card/<code>` rendered a static sign-in prompt, touched the database zero times, and returned byte-identical bytes for a real code and for garbage. Screenshotting it accomplished nothing, so nobody had to say so.
>
> **That is no longer true.** `/card/<code>` now resolves to the cardholder's name, company, role, bio, phone number, email, photo, **social links and connection/event counts** for anybody who opens it with no account. And unlike a QR token, **a card code has no expiry at all**: it is stamped permanently into physical inventory (§2.2), so the URL is permanent, forwardable, and screenshot-able to the same effect as the page itself. Forwarding one is now equivalent to handing over the card, minus the part where you notice the card is gone.
>
> > **Second amendment, later the same day — the disclosure was widened, and the list above is already the widened one.**
> >
> > The preview shipped that morning showing name, company, role, bio, phone, email and photo. The project owner then asked for it to show what Profile shows, on DESIGN.md §6's grounds ("Profile as a visitor sees it — identical fields (one identity, shown the same to everyone)"). Three things were added, and each moves this threat's residual by a different amount.
> >
> > - **Social links.** The largest of the three, and the one that reverses a written rule. `20260809211100` said exposing `social_links` outside the profile's own gate "would be a searchable directory of people's off-platform handles bolted onto a product whose premise is that strangers cannot find you"; the reasoning for permitting it anyway is recorded as an amendment on that migration, next to the rule, and the short version is that the objection is to *discovery* and this path has none — there is no query in the preview that takes a handle, a name or an id and returns a person, and a source scan now fails the build if one appears. **What it adds to this threat is correlation.** A name, a phone number, an email address and a set of social accounts gathered in one place is a better starting point for linking somebody's professional identity to their personal accounts than any of them alone. A member who deliberately kept an account off their SmartCard profile is unaffected — only links they added themselves are shown. A member who added one expecting only people they had met in person to see it would be surprised, and nothing in the app has told them otherwise.
> > - **Two counts** — active connections, and past events they RSVP'd `going` to. DESIGN.md §7 already holds that "counts are public, names are not", and these are computed with PostgREST's `head: true`, so the answer is a count header over an empty body: no row, no name, and no id of anybody counted ever crosses the wire. **What it adds is small, but it is a new *kind* of thing rather than more of the same.** Every other field on this page is static, so re-fetching a card URL previously told an observer nothing they did not have. These change over time. Somebody who polls a card URL can watch its owner's connection count rise and infer roughly how often they meet people, and can tell that they attended an event without being able to learn which one or with whom. That is an observation about behaviour rather than identity; it is bounded by the per-card budget (20 previews an hour), and every poll writes a `card_preview_views` row — so a card being watched over days produces exactly the "repeated previews from many distinct hashed IPs" pattern the last paragraph of this amendment already says to watch for.
> > - **The photo, embedded in the downloaded vCard.** Adds close to nothing: the same visitor is already shown the same image on the page and can save it from there. What the file changes is durability, not access — the same trade already accepted for the phone number. It is embedded rather than referenced by URL because a signed URL expires in five minutes and a saved contact does not, and lengthening that TTL to suit a file would hand every downloader a long-lived credential for a private-bucket object.
> >
> > **None of the defences below changed**, which is the part worth checking rather than assuming. No new RLS policy, no grant to `anon`, no anon-executable RPC, no widening of the `profile-photos` storage policy, and no second service-role caller: the same single module, the same hardcoded column lists, the same absence of any caller-supplied filter, the same two rate limits spent before anything resolves, and the same one audit row per disclosure. The four controls listed below remain the complete list.
> >
> > **So read the "consciously accepted residual" paragraph below as widened.** Where it says "phone number and email", read *phone number, email, and the set of accounts they link to from their profile* — plus, for anyone willing to watch over time, a rough sense of how socially active they are. The owner accepted the first version of this trade because a card handed to a non-user previously did nothing at all; the widening is a continuation of the same argument, since a card that shows less than the profile it stands for is a worse version of the thing that was just built.
>
> **What defends it, honestly listed, with what each one does *not* do:**
>
> - **48 bits of non-user-chosen entropy** in the code's suffix, unique across all 7,142 cards. This defeats *generating* codes. It does nothing about a code somebody already has.
> - **A per-IP and a per-card budget** (§4.5's 2026-08-15 amendment). These bound *bulk* use — a leaked list turned into a database in one pass. They do nothing about one code forwarded to one person, which is indistinguishable from the intended use.
> - **`cards.status = 'revoked'`**, the existing kill switch, which now also kills the preview. This is the only control that actually stops a forwarded URL, and it is reactive: it works once the owner knows.
> - **`card_preview_views`, surfaced on `/activity`.** The owner can see that somebody without an account opened their card link and whether they saved the contact file. There is no name on those rows and there cannot be — the viewer has no account — so this tells the owner *that* it happened, never *who*.
>
> **Consciously accepted residual, stated plainly.** A SmartCard member's phone number and email are now reachable by anyone holding their card's URL, for as long as the card stays unrevoked, with no notification at the moment it happens. The project owner was shown this and chose it, for a specific reason: a physical card handed to somebody who is not on the app previously did *nothing whatsoever*, which is a product that does not work, and the details being disclosed are exactly the details the owner hands over on purpose every time they give somebody a card. The trade is that the disclosure is no longer gated on the recipient still having the card in their hand.
>
> **Two things to watch, and one thing not to build.** Watch the shape of `card_preview_views` in pilot data — repeated previews of one card from many distinct hashed IPs is what a forwarded or leaked URL looks like, and it is the signal that would justify tightening the per-card budget or adding a preview notification (deliberately not built now: a push per preview would train owners to ignore the alert that matters, which is the trap §4.5's coalescing amendment already names). And do **not** respond to this by adding a per-user opt-out column without deciding what a tapped card should then do — a card that silently resolves to "nothing here" for its own owner's visitors is a worse product than either alternative.
>
> The QR half of this threat is unaffected and, if anything, slightly better tested: `/c/<token>` enforces the same nonce rotation the redeem path does, so a photographed QR goes stale on the preview surface too rather than only at redeem.

**Threat 2 — Live video relay (FaceTime, remote friend scans off the screen) → Defeated\*.** Rotation does *not* help — the code is genuinely current. Defeated only by GPS proximity, server-computed from both devices' independently-reported positions, with presenter freshness (90s) and an accuracy floor so a deliberately vague fix can't fuzz past the radius. **This is the entire reason GPS is mandatory.** (\*Except combined with GPS spoofing — accepted residual risk.)

**Threat 3 — Forwarding the "share your contact back" link (deferred flow) → Accommodated without rewrite.** Device-bound session, single-use, short expiry, high-entropy opaque token, tied to the same `connection_sessions` table QR/NFC already use.

**Threat 4 — Mass fake-account farming → Structurally defeated.** Every edge needs a live session + two fresh in-range GPS fixes, or a physical card; no global search means a fake account can't even find a target; contacts import creates zero edges; `createVerifiedConnection` is the only writer to `connections`. Protect by never adding a user-search/list endpoint and never adding a second path that writes connections.

**Threat 5 — Standard web/app attacks → Defeated.** Parameterized queries only (no string-concatenated SQL); React's default escaping + strict CSP for XSS; `SameSite`/`HttpOnly`/`Secure` cookies for web CSRF (mobile uses bearer tokens, not cookies, so CSRF doesn't apply); RLS default-deny plus service-layer checks as two independent access-control layers; UUID PKs against IDOR; short-lived tokens in `expo-secure-store` (never `AsyncStorage`) against session hijacking; Zod schemas stripping unknown fields against mass assignment; secrets server-side only, never in the Expo bundle.

#### Amendment (2026-08-13) — two threats introduced by this round's decisions

**Threat 6 — Deliberately failing twice to unlock the relaxed radius → Bounded, consciously accepted.** Automatic relaxation (§4.3) is triggerable by anyone willing to fail two attempts, so it must be assessed as an attacker capability rather than only as a user convenience. What it buys an attacker is one attempt at 500m instead of 150m, for one specific pair, once per hour, with no escalation beyond that rung. It does not connect people in different neighbourhoods and it cannot be walked wider. The residual is a slightly larger collusion envelope for two people who already have to be cooperating — a case §4.7 threat 2 already accepts. Defended by: eligibility restricted to distance/accuracy rejections only (junk requests unlock nothing), same-pair scoping (failures cannot be pooled across victims), a hard two-rung ladder, a one-hour cooldown after use, the relaxed radius staying >3× the relaxed accuracy floor, and never telling the client that relaxation exists. **The thing to watch in pilot data is the shape of relaxed attempts** (§4.4 question 4): genuine indoor failures cluster just past the normal radius, deliberate ones sit near the ceiling.

**Threat 7 — A lost or stolen card connecting to its owner → Detection, not prevention; mitigated.** Physical possession of a card is the entire proof for the NFC path, so a card in the wrong hands is a working credential until it is revoked. There is no confirmation step to stop it (§4.5 amendment explains why adding one would not have worked). The defence is time-to-detection: the owner is pushed a notification the instant any tap commits, with revoke-card and remove-connection one tap away, plus an in-app record for anyone whose notifications are off. Per-card redeem rate limiting (§4.6) caps how much damage a found card does before its owner reacts. **Consciously accepted residual:** connections created between the theft and the revocation are real connections and stay until removed — the owner has to remove them, and the notification history is what tells them which ones. A stolen card is a physical-security problem the app can shorten but not prevent.

#### Amendment (2026-08-13) — the threat model is now an automated test suite, and what it does and does not prove

A test runner did not exist anywhere in this monorepo before this build (checked in the Profile pass, recorded in the README). **Vitest is now set up at the root and wired into `turbo.json`, so `pnpm turbo test` runs everything.** That was a prerequisite rather than a nicety: the instruction for this phase was to write tests that attempt each threat-model attack and confirm it fails, and that cannot be honoured by one-off manual verification.

**193 tests, 176 of them in `packages/core`.** Coverage against this section, threat by threat:

| Threat | Where | What is asserted |
|---|---|---|
| 1 — screenshot and forward | `threats.test.ts` | A nonce two rotations old is refused; a token from **one** rotation ago is still accepted (the deliberate in-flight grace window, tested so the defence is not accidentally over-tight); consuming a session kills a second, byte-identically-valid token minted from it; the same verified outcome submitted twice is refused at the atomic write; a burned session refuses everything |
| 2 — live video relay | `threats.test.ts` | **The suite's centre.** A scan from London, and separately from 2 km across the same city, with a perfectly valid, current, correctly-signed token, is refused `too_far`; a relay is still refused after relaxation has widened the radius to 500m (and the test asserts relaxation actually fired, so it cannot pass for the wrong reason); a deliberately vague 5 km-accuracy fix claiming to be adjacent is refused; a backdated fix and a postdated fix are both refused |
| 3 — forwarded pending-connection link | — | **Deliberately skipped and explicitly marked as such in the suite.** The non-user flow is a schema slot with no code path (§2.8), deferred past the pilot. A test against it would assert something about code that does not exist, and a green suite claiming coverage the product does not have is worse than no test |
| 4 — mass fake-account farming | `threats.test.ts`, `no-second-write-path.test.ts`, **and the live database** | Forged, orphaned and junk tokens all refuse; a source scan asserts no code anywhere inserts or updates `connections`/`meetings`/`meeting_participants`/`meeting_locations`, that exactly one file calls the commit RPC, that exactly two files call `sealVerified`, and that the service-role client has exactly four importers. Separately, **verified against the live database by simulated session** (the §6.6 technique): as `authenticated`, direct INSERT into all five graph tables, `EXECUTE` on both new RPCs, and SELECT on `rate_limit_events`/`app_config` are **all refused with `42501`** |
| 5 — standard attacks | `threats.test.ts` | SQL-injection, PostgREST-filter-syntax, XSS and prototype-pollution shaped tokens all refuse before any lookup; a body carrying `presenterUserId` or `distanceM` is refused by `.strict()` schemas rather than ignored; out-of-range coordinates and non-ISO timestamps refuse at parse time |
| 6 — deliberate failure to relax | `relaxation.test.ts`, `threats.test.ts` | Two *junk* failures buy nothing; two genuine distance failures do rescue the pair; failures outside the window buy nothing; the cooldown holds however many further failures arrive; failures cannot be pooled across a different presenter **or** a different scanner; and the radius is identical after 2, 20 and 10,000 failures — the "rung, not a ladder" property, asserted rather than asserted-in-prose |
| 7 — lost or stolen card | `threats.test.ts`, `card-preview-service.test.ts` | A revoked card is refused; unassigned and unknown codes are refused **for connecting** (claiming a blank card is a separate, deliberate 2026-08-21 exception — but a **revoked** card stays unclaimable, asserted in `card-preview-service.test.ts` and verified capable of failing by letting `revoked` fall through to the claimable branch, 1 red); a blocked tapper is refused (so the notification cannot be a channel to someone who blocked you); self-tap is refused; the per-card hourly limit bites; a client-asserted owner is refused by the schema; the two legacy bare-hex codes from §6.3 still parse |

Plus §4.3's fail-closed table end to end (every row rejects), §4.2 step 7 as a rule rather than as copy, and `parseVerificationConfig` refusing a missing or malformed threshold rather than defaulting.

**The suite was verified capable of failing.** The distance comparison in `evaluateGpsGate` was temporarily replaced with a no-op; 11 tests went red, including all three threat-2 tests and five of the threat-6 bounds. The change was then reverted and the suite is green. A test that cannot fail proves nothing, and this one was checked rather than assumed.

**What the suite does not prove, stated plainly.** The verifiers, the gate, the relaxation logic, the token code and `createVerifiedConnection` are all exercised as production code, but the `ConnectStore` behind them is an in-memory fake — because this environment's egress policy blocks the project's Supabase host (the same restriction recorded against the §6.5 photo upload and the §6.6 spot-check), and because hostile world-states have to be cheap to construct or they do not get constructed. So the suite says nothing about whether Postgres enforces its half: that RLS refuses a direct client insert, that the function is atomic, that the compare-and-swap is a compare-and-swap. **Those were checked directly against the live database instead** — the RLS refusals above, plus a rolled-back end-to-end exercise of `create_verified_connection` confirming 1 connection / 2 participants / 1 location on the happy path and correct refusals for replay, self-connect, consumed session, expired session, presenter mismatch and block. Neither kind of check substitutes for the other, and the gap that remains is the same one §6.6 named: signature verification and HTTP transport, both Supabase's code, neither able to change which rows a policy returns.

#### Amendment (2026-08-15) — threat 5 was two-thirds true, found by a full audit

Threat 5 above claims "React's default escaping + **strict CSP** for XSS" and "**`SameSite`/`HttpOnly`/`Secure` cookies** for web CSRF". A ten-step security audit checked every clause of this section against what is actually deployed. Both of those two clauses described an intention that had never been implemented, and the gap is recorded here rather than in the audit's own notes because this is where the claim lives and where the next reader will look for it.

**There was no CSP.** Not a weak one — none. No `middleware.ts`, no `headers()` in `next.config.ts`, no `vercel.json`; verified against a real built server, not just by reading source. Nor were `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` or HSTS set. The most consequential of those for *this* product is not the CSP: it is `frame-ancestors`/`X-Frame-Options`, because `/connect` asks the browser for **camera and geolocation**, and because "remove connection" and "revoke card" are one-click destructive actions sitting behind an authenticated cookie. All of them are now set on every route (`apps/web/next.config.ts`), with `Permissions-Policy` denying every powerful feature except `camera=(self)` and `geolocation=(self)`.

**The CSP that now exists is not the "strict" one this section claimed, and calling it that would be the same error again.** `script-src` carries `'unsafe-inline'`, because the App Router streams hydration data as inline `<script>` tags and nonce-ing them requires a `middleware.ts` on every request — including the Kinde auth callbacks — which is a change to make deliberately, not to fold into a header pass. What the CSP does buy is real and worth naming precisely: `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`/`form-action 'self'`, and a genuinely complete `connect-src 'self'` — complete because the browser makes *no* cross-origin request in this app, Supabase being reached only server-side. It is an exfiltration and framing bound, not an XSS defence. That is tolerable only because there is no XSS sink to defend: zero uses of `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` across `apps/web` and `packages/`, and no user-supplied HTML rendered anywhere. **The day that stops being true, the nonce work stops being optional.**

**The CSRF clause was true about mobile and misleading about web.** "Mobile uses bearer tokens, not cookies, so CSRF doesn't apply" is correct and unchanged. But the web half named cookie flags as though they were *our* control. They are `@kinde-oss/kinde-auth-nextjs`'s defaults — confirmed in the installed SDK to be `{sameSite:"lax", httpOnly:true, secure:NODE_ENV==="production"}`, which is the right posture and did block the attack — while the `/api/connect/*` routes themselves checked neither `Origin` nor `Content-Type`. A cookie-authenticated POST forged from a third-party page arrives with a real session and satisfies every check downstream of it, because the victim genuinely is signed in. On `/api/connect/nfc/redeem`, whose whole body is a card code, that is a connection created with no tap, no scan and no proximity — a direct breach of the product's one non-negotiable rule, and, through the `users` policy's `are_connected` branch, a forged profile-visibility grant as well.

Resting that on a dependency's cookie default is the part this section got wrong. `checkSameOrigin` (`apps/web/src/server/connect/same-origin.ts`) now refuses cross-site requests **before** the session is read, rejecting `same-site` as well as `cross-site` — on `*.vercel.app`, "same site" includes every other tenant's deployment. A request carrying neither `Sec-Fetch-Site` nor `Origin` is deliberately allowed: both are forbidden header names that page script cannot suppress, so that shape is a non-browser client, which is exactly what §5.2's mobile path will be.

**What the rest of the audit found, so this amendment is not read as the whole of it.** Nothing Critical or High in the application. No secret in the tree or anywhere in git history; no IDOR; no injection sink; every one of the 20 tables RLS-enabled *and* forced with `anon` granted nothing, verified live rather than from the migrations. The other real findings were: raw PostgREST error text reaching the browser through the Server Actions' `messageOf` helper (including RLS-violation wording, which confirms a row exists and that a policy stopped you — the distinction the RSVP RPCs deliberately collapse), a `.gitignore` that would have committed a `.env.production`, `EXPO_ACCESS_TOKEN` missing from `turbo.json`'s env list (silently disabling threat 7's only remaining control), an over-broad table-level SELECT grant on `users` exposing `kinde_user_id`/`is_admin` by grant, and an Expo push token reachable in a log line. All fixed. Two were not: `image-size`'s parser DoS has no published patch (the advisory names a version npm has never shipped) and is build-time-only and absent from the web app's tree; and there is still no error monitoring, which needs a paid service and is the project owner's decision.

---

## 5. Auth flow

### 5.1 Web (Next.js) — confidential client

Uses `SmartCard Web` (has a client secret). Standard authorization-code flow: redirect to Kinde → callback with a code → **server-side** exchange for tokens → stored in encrypted `HttpOnly` cookies, never touched by browser JavaScript (so an XSS bug can't steal the session). Handled by `@kinde-oss/kinde-auth-nextjs`.

> **Amendment, 2026-08-14 — which credential the user actually presents, and why nobody should "fix" it.**
>
> The paragraph above specifies the *flow* and says nothing about the *credential*. In practice sign-in sends a one-time code to the user's email and asks for that; there is no password field. This surprised the project owner, who expected email + password, so it is recorded here rather than left to be rediscovered.
>
> **It is not configured anywhere in this repo.** `apps/web/src/app/api/auth/[kindeAuth]/route.ts` is a bare `handleAuth()`; both `LoginLink` call sites (`sign-in/page.tsx`, `card/[code]/page.tsx`) pass only `postLoginRedirectURL`; there is no middleware; and no `KINDE_*` variable selects an auth method. The authorization request we send carries no connection preference, so Kinde's own dashboard settings decide entirely. Email passwordless is **on by default in every new Kinde business**, and that default is simply what we inherited — it was never chosen, and never rejected either.
>
> This is passwordless, **not** MFA. The two are easy to confuse because both produce an emailed code. The tell: with passwordless there is no password field at all (the code *is* the factor); with MFA you enter a password first and the code only follows. MFA also lives on a different dashboard page (Settings → Environment → Multi-factor auth) and is a paid-plan feature.
>
> **Decision, 2026-08-14: keep the emailed code for the pilot.** Switching to passwords is a one-way door disguised as a toggle. Kinde does not permit passwordless and password auth on the same application at once, so enabling passwords immediately disables the only sign-in path that currently works — and **no user has a password to fall back on**: legacy bcrypt hashes were deliberately never imported (README, "Legacy passwords were never imported"), and all 337 migrated users hold Kinde ids created under passwordless. Flipping it locks out the entire pilot until every user completes a set-password flow. That is a user migration, not a settings change.
>
> If it is revisited later: change it at Kinde → Settings → Environment → Authentication → Password → Configure the Email tile for the `SmartCard Web` application, remembering that these settings are **per Kinde environment** (production is whichever environment `KINDE_ISSUER_URL` on the Vercel project points at, so changing the wrong one looks like nothing happened). Prove the set-password/reset email flow end-to-end on a non-production environment before cutting over. The trade being made in that direction is a phishing-resistant one-time code for a reusable secret, across a user base that has never had one — worth stating out loud, since the intuitive framing is that passwords are the more "normal" and therefore safer choice.

### 5.2 Mobile (Expo) — public client with PKCE

Uses `SmartCard Mobile` (no secret). App opens Kinde in a secure system browser (`expo-auth-session`) using PKCE: a random secret generated per login, only its hash sent to Kinde, the original used to redeem the code — since a value embedded in a mobile binary can be extracted, PKCE avoids storing a secret at all. Tokens in `expo-secure-store` (Keychain/Keystore), never `AsyncStorage`. Requests carry `Authorization: Bearer <access_token>`.

### 5.3 Both resolve to the same user record

Every authenticated request hits `ensureUser(kindeSub, claims)`: verify the Kinde token against Kinde's JWKS (signature, issuer, audience, expiry), look up `users` by `kinde_user_id = sub`, create if not found. `users.kinde_user_id` is the sole link to Kinde — since the legacy table already has `kindeuserid` populated, the 337 existing users land on their existing rows on first login. Web and mobile converge because they authenticate against the same Kinde business.

### 5.4 JWT strategy — being explicit

Supabase Auth (`auth.users`) is unused — Kinde is the only identity provider. This means `auth.uid()` (what RLS policies call) needs a Supabase-issued JWT, and Kinde is not on Supabase's Third-Party Auth provider list (Clerk, Firebase, Auth0, Cognito) — verified directly against the docs.

**Recommended — Option A: token exchange at the API boundary.** Client sends its Kinde token → our Next.js API verifies against Kinde's JWKS → resolves `users.id` → mints a short-lived (~5 min) Supabase JWT signed with the project's JWT secret (`{ sub: <users.id>, role: 'authenticated', aud: 'authenticated', exp }`) → per-request `supabase-js` client uses that token → `auth.uid()` now returns `users.id` and RLS works normally. (This is why `users.id` must be a UUID — `auth.uid()` casts `sub` to uuid.) The service-role key is used only for migrations/admin jobs, never the general request path, never shipped to a client.

**Must be re-verified against current Supabase docs on day one (Q7)** — Supabase is moving toward asymmetric signing keys, and while the JWT secret here never leaves our own backend (a different situation from the deprecated third-party-sharing pattern), the exact mechanism should be confirmed before building.

**Fallback — Option B:** server-side authorization only via the service role, with checks enforced in TypeScript. Simpler, but RLS becomes decorative since the service role bypasses it — loses the second lock. Option A is recommended; B is contingency only.

#### Amendment (2026-08-13) — Q7 resolved: Option A stands, for a better reason than the one originally given, and with a knowingly-legacy signing mechanism

**Resolved (Q7).** Option A is built as specified. Nothing above needs redesigning — but two of the paragraphs above were right for reasons that turned out not to be the real ones, and one of them is now materially out of date, so this amendment records what was actually checked rather than leaving the original text standing as if it were still the whole story. **No RLS policy, helper function or schema change was required** — the risk this exercise was meant to surface did not materialise.

**What was checked, and against what.** The original text says "verified directly against the docs", and the doc-list part of that has since drifted, so it was re-checked against Supabase's live documentation (via the Supabase MCP docs search, not from memory) alongside the live database itself.

| Claim checked | Finding |
|---|---|
| Supabase Third-Party Auth's provider list | **Clerk, Firebase Auth, Auth0, AWS Cognito, WorkOS.** The original list was indeed stale — but it grew by one *named* provider (WorkOS), not into a generic mechanism. Kinde is still not on it. |
| Does TPA accept an arbitrary OIDC issuer? | Not per the documented interface. The overview documents integrations per named provider, and its stated limitations are about the *provider's* key material: "The third-party provider must use asymmetrically signed JWTs (exposed as an OIDC Issuer Discovery URL…) … Using symmetrically signed JWTs is not possible at this time." |
| Is there a generic-OIDC feature that *does* take Kinde? | Yes, but it is a different feature — **Custom OAuth/OIDC Providers**, which registers any OIDC issuer as a *login provider for Supabase Auth* (`supabase.auth.signInWithOAuth({ provider: 'custom:…' })`). It creates `auth.users` rows and issues Supabase's own tokens. Rejected — see below. |
| Is the legacy JWT secret still supported? | Yes, but explicitly demoted: the JWT Signing Keys guide labels it "**No longer recommended.** Available for backward compatibility." The successor system supports asymmetric keys *and* a shared secret key, and states that a key held by Supabase "can't be extracted". |

**The two facts that decide this regardless of any provider list.** Both were verified against the live project (`crpsbnbegeoqtlgshltt`), and either one on its own rules out feeding Kinde's token straight to Supabase:

1. **`auth.uid()` is `(request.jwt.claims ->> 'sub')::uuid`** — read from the function definition in the live database, not assumed. **All 337 migrated `kinde_user_id` values are `kp_` + 32 hex characters; zero are uuid-shaped.** Simulating a raw Kinde `sub` in a policy evaluation does not merely deny, it *raises*: `ERROR: 22P02: invalid input syntax for type uuid: "kp_…" CONTEXT: SQL function "current_user_id"`. A native integration would therefore not fail closed and quietly — it would make every authenticated query error.
2. **Kinde tokens carry no `role: authenticated` claim.** Every named provider's TPA guide has a step for adding one (a Firebase custom claim, a Cognito pre-token-generation Lambda, a WorkOS JWT template) because Supabase reads `role` to pick the Postgres role. Without it the caller lands on `anon`, which holds no grant on any table in this schema (§3.6) — so even with the uuid problem solved, a raw Kinde token would see nothing.

**Why Custom OAuth/OIDC Providers was rejected even though it genuinely accepts Kinde.** It solves a different problem: it would make Kinde a login *source* for Supabase Auth, minting a parallel `auth.users` row per person and issuing Supabase's own token. `auth.uid()` would then be the `auth.users` id — still not `public.users.id`, which is what every policy in §3 compares against. Adopting it would mean either backfilling `auth.users` so its ids equal our 337 live `users.id` values (a second identity store to keep in sync forever, on live data, to save one signing call), or changing `private.current_user_id()` into a lookup against `public.users` — which that function's own header argues against at length, on both recursion and separation-of-concerns grounds. It would also duplicate the session layer §5.1/§5.2 already assign to Kinde's own SDK. The simplification is illusory: it moves the mapping from one small server module into the database and a second user table.

**So the mapping has to exist somewhere, and Option A is where it belongs.** `ensureUser()` is that mapping (§5.3), and it is the *only* thing that can perform it, because `users.id` is a value this system owns and Kinde has never heard of.

**The one thing that genuinely changed: the signing mechanism is now a legacy one.** The original text flagged asymmetric signing keys as something to confirm; that move has happened, and the shared JWT secret is now documented as backward-compatibility only. This is recorded as a **deliberate, dated choice, not an oversight**: the legacy secret is the only key material Supabase will hand us, and minting a token requires holding a key the project trusts. The implementation therefore signs HS256 with `SUPABASE_JWT_SECRET`, and the migration path is known in advance:

- **If the project later migrates to JWT signing keys and revokes the legacy secret**, the exchange must sign with a key the project trusts instead. Supabase's own current/standby keys cannot be exported, so the options are to *import* our own shared secret, or import our own asymmetric private key and sign RS256/ES256 with it.
- **Either way the blast radius is one file** — `apps/web/src/server/auth/supabase-token.ts`. `private.current_user_id()` and every policy in the schema are untouched, which is exactly the payoff that function's header predicted when it argued for the indirection.
- Before switching, re-read the signing-keys guide's rotation ordering: create the new key as *standby*, rotate, and only then revoke the old one, or in-flight tokens are rejected mid-request.

**Judgment call — `azp`, not `aud`, is what pins a token to our applications.** Both SmartCard apps live in one Kinde business and are signed with the same keys, so signature + issuer do not distinguish them from anything else in that business. Kinde only populates `aud` when an API audience is configured, which it is not. The verifier therefore requires the `azp` (authorized party) claim to be one of our two client ids, and **rejects a token with no `azp` at all** rather than treating its absence as benign. If a future Kinde configuration stops emitting `azp`, the correct fix is to configure an API audience in Kinde and check `aud` — not to delete the check.

**Consequence for mobile (§5.2), recorded now so the mobile pass does not rediscover it.** Nothing in §7.4's Expo variable list changes, and the app still holds no Supabase credentials — §7.4's "it talks to our API, never the database directly" survives intact, which means the mobile client never sees a Supabase token at all; the exchange happens per request on our server. Two things the mobile pass does need to know:

- **`KINDE_MOBILE_CLIENT_ID` is now a server-side concern too.** It was previously an Expo-only value; the token verifier's `azp` allow-list must include it or every mobile request is rejected with a message that will look like a Kinde misconfiguration. It is read server-side by `apps/web/src/server/env.ts`.
- **The web-only shortcut in the identity path must not be copied.** Where Kinde puts profile claims (`email`, `given_name`, `family_name`) in the ID token rather than the access token, the web path reads them from the SDK's session — safe there only because that session is an encrypted HttpOnly cookie written by a server-side code exchange. Mobile has no such cookie, so it must verify the ID token against Kinde's JWKS explicitly. The invariant either way: profile claims may only be attached to an identity that was actually verified, and only ever seed a *new* row.

**Where this lives.** `apps/web/src/server/env.ts` (fail-closed variable access), `auth/kinde-identity.ts` (JWKS verification), `auth/ensure-user.ts` (§5.3's identity bridge, service-role), `auth/supabase-token.ts` (the mint), `supabase/rls-client.ts` + `supabase/service-role-client.ts` (the two clients, and the note on why there are exactly two), `auth/current-user.ts` (the web glue), `app/api/auth/[kindeAuth]/route.ts` (§5.1's flow), and `app/auth-check/page.tsx` (the end-to-end proof, temporary — it belongs to this phase, not to the Profile screen).

#### Amendment (2026-08-13, later the same day) — Q27: off the deprecated shared secret, onto an ES256 signing key this app owns

**The problem this closes.** The amendment above chose HS256 with `SUPABASE_JWT_SECRET` as the *initial* signing mechanism and wrote down the migration path in advance. Q27 then found that the path was not hypothetical: the dashboard shows this project's **current** signing key as an asymmetric ECC (P-256) key, with the shared secret we sign with listed as the **previous** key, kept alive only to "verify tokens that are yet to expire". A key in that state can be revoked at any time, and the failure it produces is not graceful — every newly minted token stops verifying at once, for every user simultaneously, with nothing in the app able to detect it in advance. **The token-exchange design (Option A) is unchanged and still correct; only the signature changes**, exactly as the previous amendment predicted ("either way the blast radius is one file").

**The question that had to be answered first, and its answer.** When Supabase shows an asymmetric key as *current*, does that mean Supabase holds the private key — in which case a third-party minter like us categorically cannot use it — or is there a supported way to make the project trust a key **we** control? **Both halves have a definite documented answer, and they point in opposite directions**, which is why guessing would have produced the wrong design either way. Re-checked against Supabase's live documentation (Supabase MCP docs search, 2026-08-13), not from memory:

| Question | Finding, with the source's own words |
|---|---|
| Can we sign with the project's current ECC key? | **No, categorically.** JWT Signing Keys guide, FAQ *"Why is it not possible to extract the private key or shared secret from Supabase?"*: "You can only extract the legacy JWT secret. **Once you've moved to using the JWT signing keys feature extracting of the private key or shared secret from Supabase is not possible.**" Supabase holds that private half; only Supabase Auth (GoTrue) can sign with it. Any design that assumed otherwise was dead on arrival. |
| Is there a supported way for an app to mint tokens the project trusts? | **Yes, and it is documented for precisely this case.** Same guide, FAQ *"How to create (mint) JWTs if access to the private key or shared secret is not possible?"*: "If you wish to make your own JWTs or have access to the private key or shared secret used by Supabase, **you can create a new JWT signing key by importing a private key or setting a shared secret yourself**" — `supabase gen signing-key --algorithm ES256`, then "To import the generated private key to your project, create a **new standby key** from the dashboard", then "Once imported, click **Rotate key** to activate your new signing key." |
| Is that a supported arrangement or a workaround? | Named as first-class in the JWT guide: "In addition to creating JWTs, Supabase can also accept JWTs from other authentication servers via the Third-Party Auth feature **or ones that have been minted externally via an imported JWT Signing Key**." |
| What exactly must the token look like? | Signing-keys FAQ: header `{"alg":"ES256","kid":"<key id>","typ":"JWT"}` — "The `kid` header is used to identify your public key for verification. You must use the same value when importing on platform." Payload: "`sub` is an optional UUID…", "`role` **must be set to an existing Postgres role** in your database, such as `anon`, `authenticated`, or `service_role`", "`exp` … **Prefer shorter-lived tokens**." Also: "A separate `apikey` header is required to access your project's APIs" — we already send the publishable key (`rls-client.ts`), so nothing there changes. |
| Is it enough to import the key as a standby? | **No — it must be rotated in.** The guide's key-lifetime table gives, for *Create a new key*, accepted JWT signatures: "**Current key only**, new key has not created any JWTs yet." A standby key's public half is advertised in JWKS but its signatures are not accepted. The JWT guide adds the timing constraint: "**We recommend waiting at least 20 minutes when creating a standby signing key**" before rotating, because the discovery endpoint is cached at two levels. |
| Has Third-Party Auth grown a generic mechanism since the last check? | **No.** Re-read in full: the provider list is still exactly Clerk, Firebase Auth, Auth0, AWS Cognito, WorkOS — Kinde absent, as before. And its shape rules us out independently of the list: "The third-party provider must use asymmetrically signed JWTs (**exposed as an OIDC Issuer Discovery URL**…)" — TPA trusts an *issuer's* published key set, which is Kinde's, and a Kinde token still fails for the two reasons in the amendment above. |
| Is a verify-only (public-key) import possible? | **Not documented, and the import format says otherwise.** The example JSON to paste contains `"d"` — the private scalar. So importing means Supabase holds this key too. Recorded rather than glossed: see "what this does and does not improve" below. |

**The Custom Access Token hook is a dead end here, and this is worth stating explicitly rather than leaving as an unexplored option.** It is a real feature and it is genuinely the more modern-looking mechanism, but it solves a different problem. Its own guide: "The custom access token hook **runs before a token is issued**" — a token issued *by Supabase Auth*. Its input is a `user_id` from `auth.users`, and the claims it must return include `session_id`, `aal` and `is_anonymous`, which are artifacts of a GoTrue session. It can *decorate* a token GoTrue is already minting; it cannot cause one to exist for an identity GoTrue has never seen. **Live check against the project (`crpsbnbegeoqtlgshltt`): `select count(*) from auth.users` returns 0, against 337 rows in `public.users`** — Supabase Auth has never issued a session here and, per §5.3, never will, because Kinde is the sole IDP. Adopting the hook would first require making Supabase Auth issue sessions, i.e. the Custom OAuth/OIDC Providers route the previous amendment already rejected, for a reason unchanged by any of this: `auth.uid()` would then be an `auth.users` id, and every policy in §3 compares against `public.users.id`.

**What changed in the code.** One file's signing step, one env accessor, one new test file. Nothing else in the bridge was touched.

- `auth/supabase-token.ts` signs **ES256** with a P-256 private key we generated (`supabase gen signing-key --algorithm ES256`, Supabase's own tool for this), carrying its `kid` in the header.
- `env.ts` gains `supabaseJwtSigningKey()`, reading the private JWK from `SUPABASE_JWT_SIGNING_KEY`. **A key that is present but malformed throws; it never falls back to the legacy secret** — a truncated paste silently demoting the app back onto the deprecated key is the exact failure this whole amendment exists to prevent.
- **Everything the previous amendment reasoned through is preserved, and is now asserted by tests rather than by reading**: 5-minute lifetime, `sub` = `public.users.id`, `role: authenticated`, `aud`/`iss` unchanged, minted fresh per request, never stored, server-side only. The claims of a legacy-signed and a new-signed token are compared field-by-field in `supabase-token.test.ts` — the migration changes the signature and nothing else.

**One real bug the exercise caught, recorded because it is the kind that passes review.** The first implementation passed the generated JWK straight to `jose`'s `importJWK` and worked against a hand-built test key, then failed against the *real* one: `supabase gen signing-key` emits `"key_ops":["sign","verify"]`, and Web Crypto refuses to import an ECDSA private key claiming `verify` ("Unsupported key usage for a ECDSA key"). The loader now passes only the cryptographic members (`kty`, `crv`, `x`, `y`, `d`), and the CLI's exact output shape is a regression test. Had this shipped, the symptom would have appeared only at the moment of cutover.

**What was verified, and the one thing that could not be.** A real token was minted with the real new key for a real migrated user (`d6855416-…`, 4 social links, 11 cards) and its claims fed into the live database as a simulated session — the same technique §6.6's outcome used:

| Check | Result |
|---|---|
| Header | `{"alg":"ES256","kid":"805e8694-…","typ":"JWT"}`, 64-byte P-256 signature |
| `exp - iat` | **300 seconds**, unchanged |
| `auth.uid()` | `d6855416-…`, equal to the `public.users.id` the token was minted for |
| Own row / links / cards | **1 / 4 / 11** — visible |
| Every other user's row / links / cards | **0 / 0 / 0** — denied |
| Same role, no token at all | `auth.uid()` null; users, links, cards all **0** |

Identical to the numbers recorded when the bridge was first verified. **What cannot be verified from here: that the Supabase API gateway accepts the ES256 signature** — that requires the key to be imported and rotated in the dashboard (below), and this environment's egress policy blocks the project's Supabase host anyway (same restriction already recorded against the Storage API and the legacy photo import). The claim payload is proven; the signature acceptance is proven only by Supabase's documentation until the manual step is done.

**Blocked on one manual step, deliberately not worked around.** The Supabase MCP tooling exposes no signing-key operations — same wall as `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_JWT_SECRET`, which also had to be fetched by hand. The keypair is generated and sits in the gitignored `.env.local` with the JSON to paste and the ordering; the three steps are: **(1)** import the private JWK as a **standby** key (dashboard → Project Settings → JWT Keys, or `POST /v1/projects/{ref}/config/auth/signing-keys`); **(2)** wait ~20 minutes, then **Rotate keys**, because a standby key's signatures are not accepted; **(3)** uncomment `SUPABASE_JWT_SIGNING_KEY` and restart. Until step 3, the app keeps signing HS256 with the legacy secret and **logs a loud warning at the first mint of each process** saying so — a silent legacy path is how a project ends up depending on a revoked key without knowing it. That transitional branch mirrors Supabase's own zero-downtime ordering (import → rotate → switch the consumer → revoke), and **should be deleted, making `SUPABASE_JWT_SIGNING_KEY` required, once the rotation is confirmed.**

**A trap found next door, before anyone walks into it: do not revoke the legacy JWT secret yet.** It is tempting to finish the job by revoking the deprecated key. That would take the app down. `SUPABASE_SERVICE_ROLE_KEY` — the credential `ensureUser()` depends on, and the only service-role use in the app — is itself a legacy JWT signed with that secret (its value starts `eyJ`). Supabase states the coupling directly: "`anon` and `service_role` are **not just API keys, but are also valid JSON Web Tokens, signed by the legacy JWT secret**… before you revoke the legacy JWT secret, you must disable the `anon` and `service_role`", and the fix: "substitute the `service_role` JWT-based key with a new **secret key** which you can create in the **Settings > API Keys** section of the Dashboard. This prevents downtime." So revoking the legacy secret is a **separate, later step**, gated on swapping `SUPABASE_SERVICE_ROLE_KEY` for an `sb_secret_…` key. (The publishable side is already migrated — `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is an `sb_publishable_…` value.)

**What this does and does not improve, stated honestly.** It is not "now nobody but us can sign": the dashboard import takes a *private* JWK, so Supabase holds this key as well, just as it held the shared secret. Three things genuinely improve, and one is the whole point:

- **The key is not on a deprecation path.** That is the Q27 fix. The previous secret was scheduled to stop working; this one is a current, supported key.
- **Verification no longer needs the secret.** The project verifies with the public half from `/auth/v1/.well-known/jwks.json`. Nothing but this server needs the private half — and unlike the shared secret, that public half is safe to hand to anything that ever needs to check one of our tokens.
- **Revocation becomes a dashboard action rather than a redeploy.** If the key leaks, revoking it invalidates every token signed with it immediately; the guide notes Supabase's own products do not rely on the JWKS cache, so "revocation is instantaneous". The shared secret had no such property — its revocation was coupled to the API keys, which is the very trap described above.
- **Blast radius is narrower than the secret it replaces.** The old secret also signed the `anon` and `service_role` keys; this key signs nothing but our per-request user tokens.

**Nothing changes for mobile (§5.2), and that is worth one line.** The exchange still happens per request on our server, so the phone still never holds a Supabase credential of any kind — §7.4's "it talks to our API, never the database directly" survives this change untouched. The only thing a future mobile pass inherits is that the server it calls needs `SUPABASE_JWT_SIGNING_KEY` set wherever it runs, exactly as it needed `SUPABASE_JWT_SECRET`.

#### Completed (2026-08-14) — the manual rotation is done and the HS256 fallback is deleted

**The step the amendment above was blocked on has been performed.** The ES256 key was imported as a standby key, left for the recommended ~20 minutes, and rotated to in-use in the dashboard; `SUPABASE_JWT_SIGNING_KEY` is set both locally and on Vercel. **The condition that amendment set for deleting the transitional branch — "once the rotation is confirmed in front of real data" — was checked rather than assumed**: the deprecated path warned loudly at its first use in each process, and a full-text search for that warning across the current production deployment's runtime logs, over a window covering a real authenticated sign-in and loads of `/`, `/profile`, `/connect`, `/feed` and `/connections`, returned **zero** hits. So the HS256 branch is gone, `supabaseJwtSecret()` is deleted from `env.ts`, and `supabaseJwtSigningKey()` now throws a named `MissingEnvVarError` when unset instead of returning null. There is one signing path and no way back onto the deprecated key, including by accident.

**Unchanged, and deliberately so, at the time this was written:** `SUPABASE_JWT_SECRET` stayed set in the environment and was not revoked in the dashboard — the Q31 trap below was untouched by this cleanup, because `SUPABASE_SERVICE_ROLE_KEY` was still a legacy JWT signed with that secret. What changed at the time was only that no code read the variable any more. **Update 2026-08-14: Q31 is now resolved (see its row below) — the service-role key was swapped for an `sb_secret_…` key, the legacy `anon`/`service_role` JWTs were disabled, and this secret has since been revoked.**

---

## 6. Migration plan (outline)

### 6.1 Order

1. Provision the Supabase project in org `SmartCard.2.0` (region: US East — NYC pilot).
2. Apply schema + RLS migrations.
3. Dry-run the full migration on a Supabase branch first.
4. Load in dependency order: `users` → `cards` → `social_links` → photos.
5. Verify (§6.6), then run against production.

#### Amendment (2026-08-13) — the migration is complete, and it is next

**Resolved (Q23):** everything is imported in one pass — `users`, `cards`, `social_links`, and photos — **before the pilot**. Not a partial import, not a staged one, not "the users now and the cards later". **Resolved (Q16):** steps 1 and 2 are done; the project lives in the dedicated `SmartCard.2.0` org and the 15 schema/RLS migrations are applied. This section is now the immediate next piece of work, not a plan for later.

**Why partial import was rejected — the cards table is the sharp edge.** Half-importing is not half the risk; for `cards` it is a correctness hazard with a physical consequence. A card that exists in the legacy system as *assigned* but has not been imported reads as absent in the new database, so `POST /api/connect/nfc/redeem` (§4.5 step 4) either rejects a legitimate tap or — worse, if the inventory is loaded without owners — sees `status = 'unassigned'` and treats a card someone is carrying in their wallet as free stock to hand to somebody else. There is no way to detect that from inside the app: both systems look internally consistent. The physical inventory and the database have to agree completely or the NFC path cannot be trusted at all, and 6,809 of the 7,142 cards are unassigned stock whose whole purpose is to be assignable.

**Why the user import cannot lag either.** §5.3 resolves every login to a `users` row by `kinde_user_id`, creating one if absent. A legacy user who logs in before their row is imported gets a *new, empty* row — and then the import has two rows claiming the same Kinde identity, one with their history and one they are actually using. `kinde_user_id` is unique, so the import fails on that user rather than silently duplicating (good), but the recovery is manual reconciliation per affected person. Importing everything before anyone can log in avoids the race entirely rather than handling it. Q6 already confirmed all 337 rows have a clean `kindeuserid`, which is what makes the complete import straightforward.

**Two prerequisites that are now on the critical path, because of this.**

1. **Supabase Pro before the production run** (Q13 already decided this) — the moment real user data lands, it must not be sitting on a plan without backups. The migration is the event that makes that upgrade urgent.
2. **Q7 (the Supabase JWT approach, §5.4) must be settled first**, because §6.6's final check is "spot-check RLS as a real migrated user". Until the Kinde → Supabase token exchange exists, `auth.uid()` returns nothing and every policy denies every row — so that check cannot distinguish "RLS is correctly protecting this user's data" from "RLS is denying everything because auth is not wired up". Running the import without it means the verification step's most important line is unverifiable.

Nothing about the migration's content changes — §6.2 to §6.7 stand as written, including §6.7's decision that `contactexchange` is *not* migrated. "Import everything" means everything the plan already lists; it does not reopen the one table deliberately left behind.

#### Executed 2026-08-13 — and two deviations from this order

The import ran against production (`crpsbnbegeoqtlgshltt`) on 2026-08-13. Per-table outcomes are recorded in §6.2–§6.7; the verification results are in §6.6. Two departures from the order above:

1. **Step 3 (branch dry-run) was skipped; the load went straight to production.** What a dry-run buys is a rehearsal of statements that might fail. That risk was covered differently and, for this shape of import, more directly: every batch was a real transaction that either committed or errored visibly, the FK remapping was routed through a staging table so a bad id produces *no row* rather than a wrong row, and — the part a dry-run would not have caught at all — per-table content checksums proved the loaded values byte-identical to the source (§6.6). A branch rehearsal validates the SQL; the checksum validates the data, which was the actual exposure here. Worth reconsidering for any future migration that mutates existing rows rather than inserting into empty tables, where a mistake is not simply undone by deleting what was added.
2. **Step 4's photo load was deferred** — see the §6.5 deviation for the reasoning and for what was preserved to make the follow-up cheap.

The transformation logic, the judgement calls, and the verification queries are committed in `supabase/seed/2026-08-13_legacy_import.sql` and `supabase/seed/2026-08-13_legacy_import_generator.py`. The 9,757 rows themselves are **not** committed and must not be: they are real personal data, and git history cannot be un-published.

### 6.2 `users` (337 rows)

| Legacy | New | Note |
|---|---|---|
| `id` | `legacy_user_id` | traceability only |
| — | `id` | new UUID |
| `kindeuserid` | `kinde_user_id` | **the critical join key** |
| `firstname`/`lastname` | `first_name`/`last_name` | |
| `emailaddress` | `email` | |
| `loginpassword` | — | **dropped entirely, never imported** |
| `profilephoto` | `photo_path` | rewritten, see §6.5 |
| `personalbio`, `companyname`, `companyrole` | `bio`, `company_name`, `company_role` | |
| `isadminuser`, `userstatus`, `isemailverified`, `hascompletedsignup`, `emailoptin` | direct | |

Risk: rows with null/stale `kindeuserid` can't be matched to a Kinde identity and get a fresh empty profile on next login — count these before migrating (Q6) to decide if manual reconciliation is needed.

**Imported 2026-08-13 — 337/337 rows.** Two decisions this table left open, resolved against the data rather than by assumption:

- **`userstatus` → `status`:** the export contains exactly **one** distinct value, `'1'`, across all 337 rows, so `'1' → 'active'` and nothing else was inferred. Nobody was defaulted into `suspended` or `deleted`: both remove access, and inventing either from an unlabelled integer would lock a real person out of their own account. The import script asserts the single-value property, so a future export with a second value fails loudly instead of silently mapping it to `active`.
- **`''` → `NULL`** for `bio` (21 rows), `company_name` (15) and `company_role` (13). Empty string and NULL mean the same thing here — "not filled in" — and collapsing them means `coalesce` and the UI behave identically for every user rather than depending on which legacy form version they used.

`loginpassword` was dropped as specified: never read out of the export, never written to a generated file, never transmitted, never logged. Confirmed afterwards by a column-agnostic sweep over every text value in `public.users` (0 hits).

### 6.3 `cards` (7,142 rows)

`cardid` → `card_code` direct copy (no regeneration needed — see §2.2), `ownerid` → `owner_user_id` via the legacy→new UUID map; 333 assigned, 6,809 unassigned, all usable as-is. This was flagged as the largest migration risk in the original proposal (Q1) — resolved, and turned out simpler than expected: the physical inventory needs no re-encoding and nothing is dead stock. The remaining dependency is DNS/routing for `smartcard.tech` itself (Q15 in §9), not the card data.

**Imported 2026-08-13 — 7,142/7,142 rows (333 assigned, 6,809 unassigned), 7,142 distinct codes, 314 distinct owners, 0 unresolvable `ownerid`.** The `cardstatus` 0/1 → `unassigned`/`assigned` mapping was verified against the data, not taken from the column name: `cardstatus = '1'` holds if and only if `ownerid` is non-null, for all 7,142 rows. That is also a proof the import could not violate `cards_assigned_requires_owner`.

**Minor correction to §2.2's card-code survey.** §2.2 records "20 distinct cosmetic prefixes". That is right for 7,140 of the rows; legacy card ids **114 and 115** are bare 12-hex-character codes with **no cosmetic prefix and no dash** at all. This is cosmetic only and changes nothing about the security model — the property that matters is that every one of the 7,142 suffixes is exactly 12 hex characters and unique across all rows, which was re-verified before loading and holds for these two as well.

### 6.4 `social_links` (466 rows)

Straight copy, `userid` remapped; validate/normalize URLs on the way in.

**Imported 2026-08-13 — 465 of 466 rows, 0 orphans. One row skipped, deliberately:** legacy `sociallink` id **85** (legacy user 37, platform Instagram) holds free text containing two different http(s) URLs. There is no unambiguous profile URL to import, and picking one would publish a link to a real person's account on a coin flip — a missing link is a visibly missing link the owner can re-add, whereas a wrong link looks correct while pointing strangers at somebody else. Failing closed is the cheaper error.

Three normalisation decisions worth recording, since "validate/normalize" did not say how far to go:

- **Trailing free text after a single valid URL** (7 rows, all LinkedIn) → the URL token is taken. Whitespace terminates a URL in every parser, so the trailing words were never part of the link.
- **`Https://` → `https://`** (1 row). Schemes are case-insensitive and lowercase is the normal form (RFC 3986 §3.1), so this cannot change which resource is addressed.
- **`http://` was NOT upgraded to `https://`** (4 rows). Rewriting the scheme changes which resource is requested based on an assumption about a remote host we do not control — a guess wearing a normalisation's clothing.

Two data-shape notes: 58 rows had `updateddatetime = '-infinity'`, a Postgres sentinel that survives the column type but breaks JS `Date` parsing and would surface as a client-side crash on a profile page; each was replaced with that row's own `created_at`, the only substitute the row itself supports. The 132 ordinary rows where `updated < created` were left untouched — those are real timestamps that merely look odd. And 6 exact duplicate `(user, platform, url)` rows were imported faithfully rather than de-duplicated; there is no unique constraint on that triple, so the legacy state is representable, and silently dropping rows during a migration hides data the owner may want to clean up deliberately.

### 6.5 Photos (148 files, ~7MB)

New Supabase Storage bucket `profile-photos`, **private**, path convention `{user_id}/{uuid}.webp`, served via signed URLs. Photos are profile data and profiles are graph-gated — a public bucket would quietly undermine that. Many `profilephoto` values are null (no photo); report any non-null path whose file is missing rather than failing the run.

#### Deviation (2026-08-13) — photos were NOT part of the production import pass

**What happened:** the 2026-08-13 import loaded `users`, `cards`, `social_links` and the `contactexchange` archive, but left `photo_path` **NULL for all 337 users**. No bucket was created and no file was uploaded. This is a knowing, scoped deferral of one line of the §6.1 amendment's "everything in one pass", not an oversight.

**Why it is safe to split this one out, when splitting `cards` or `users` is not.** §6.1's argument against a partial import is specifically about *correctness hazards*: a half-imported `cards` table makes a card someone is carrying look like free stock, and a half-imported `users` table races §5.3's auto-create into duplicate identities. A missing photo has neither property. It is a visibly absent avatar with no security consequence and no ambiguity — nothing in the system can mistake "no photo" for something else, and backfilling it later cannot conflict with anything a user does in the meantime. The reasons partial import was rejected simply do not apply here.

**What was preserved so the follow-up pass is cheap:** `supabase/seed/2026-08-13_legacy_photo_paths.csv` — 148 rows of `legacy_user_id`, the **new** `user_id` UUID, the legacy path, and file presence/size. Deliberately narrow: no email, phone or bio, because unlike the row data that file is committed. The follow-up pass can upload and backfill `photo_path` from it without re-reading the legacy database.

**One correction to this section's premise, flagged rather than quietly worked around.** This pass was briefed on the understanding that the image files were unavailable. They are not: the export bundle **does** contain all 148 `.webp` files (~8.0 MB extracted), every one of the 148 non-null `profilephoto` paths resolves to a real file, with **0 missing and 0 orphans** — recorded per row in the CSV's `file_present_in_export` column. So §6.5's "report any non-null path whose file is missing" is already satisfied, with nothing to report. The instruction to leave `photo_path` NULL was followed as given; the point of recording this is that the follow-up pass does not need anyone to go and find the files.

#### Attempted follow-up run (2026-08-13, later same day) — bucket created; upload blocked by network policy, not attempted around

**What was done.** The private `profile-photos` bucket was created (`public = false`, `allowed_mime_types = {image/webp}`, `file_size_limit = 5 MiB`) via `supabase/migrations/20260813180355_create_profile_photos_bucket.sql`. Nothing else in this section changed: `photo_path` is still NULL for all 337 users, and zero objects exist in the bucket.

**Why the actual uploads did not happen, stated plainly rather than glossed over.** This environment has no `SUPABASE_SERVICE_ROLE_KEY` (by design — see the note already in `.env.local`), so the only credential available to write to Storage was the public anon/publishable key, gated by RLS on `storage.objects`. A migration (`20260813180402_temp_photo_migration_upload_policy.sql`) opened a narrow, bucket-scoped INSERT/SELECT policy for the `anon` role to make that key usable for the upload window — this is the "service-scoped upload path" the task anticipated needing. But the upload itself calls the Storage HTTP API directly, and **outbound HTTPS from this session to `crpsbnbegeoqtlgshltt.supabase.co` is blocked at the organization's egress-proxy level** (confirmed twice via the proxy's own status endpoint: `connect_rejected`, "gateway answered 403 to CONNECT"). This is a deliberate policy denial, not a flaky connection — the session's own operating rules require reporting a 403 policy denial rather than retrying it or routing around it (e.g. tunnelling the same HTTP call through `pg_net` from inside Postgres, or through a self-invoked Edge Function, would reach the same host by a side channel and defeat the point of the block, not satisfy it). No such workaround was attempted.

Because the upload could not happen, the temporary anon policy was revoked in the same pass (`20260813180755_revoke_temp_photo_migration_upload_policy.sql`) rather than left open with no working use for it — leaving a public-key write/read door open "for later" would be pure downside, and this schema's convention throughout is fail-closed. Verified after revoking: 0 policies on `storage.objects`, 0 objects in `profile-photos`, bucket still private.

**What is still needed to finish this pass.** Either (a) this session's egress policy allow-lists the project's Supabase host so the Storage HTTP API is reachable, or (b) a Storage-capable tool is made available (the current Supabase MCP toolset covers Postgres SQL/migrations only — `execute_sql`/`apply_migration`, which is how the bucket and policies above were created — but has no Storage upload tool), or (c) the upload is run from an environment with unrestricted network access, using `supabase/seed/2026-08-13_legacy_photo_upload.py` (committed, unstaged) against the temporary-policy migration pattern established here. All the inputs needed to finish cheaply are already in place: the bucket, the 148-row CSV, the local files, and a tested script — nothing about this pass needs repeating, only the one network-dependent step.

#### Amendment (2026-08-13, later same day) — `profile-photos` gets its first real, permanent access policy

The Profile feature build (README build order item 1) needed the bucket to actually be usable, not just present. `supabase/migrations/20260813191041_storage_rls_profile_photos.sql` adds four RLS policies on `storage.objects`, scoped to `bucket_id = 'profile-photos'` and `to authenticated` only: an authenticated user may INSERT/SELECT/UPDATE/DELETE an object **only when the object's path is prefixed with their own `public.users.id`** — `(storage.foldername(name))[1] = (select auth.uid())::text`, the standard Supabase pattern for this exact shape of requirement, checked against this project's live `storage` schema rather than assumed. Confirmed before writing it, by querying `pg_policies`, that zero policies existed on `storage.objects` beforehand — the only one ever added was the temporary legacy-import policy this same section documents, and it was already revoked.

**This is deliberately narrower than the `users`/`social_links` read policies.** Those let a caller read a connection's or co-attendee's row (§3.4); this policy has no such branch — a user can only read their *own* photo objects today. That is not an oversight, it is a scope boundary: there is no viewer-facing profile route yet for a wider read to serve (Connect Flow, which creates the graph a wider policy would key off of, has not been built), so widening the SELECT branch now would be access nobody can exercise, sitting untested until it is needed. When a viewer-facing profile screen is built, this policy's SELECT branch is the one to widen, using the same `private.are_connected`/`private.shares_event_with` helpers §3.4 already uses, so photo visibility tracks profile visibility instead of drifting from it independently.

**Photos are still never handed to the client as a raw Storage URL.** `apps/web/src/server/profile/photo-url.ts` mints a signed URL (1-hour TTL) through the caller's own RLS-bound client on every render — signing itself is subject to the same SELECT policy, so a request can only ever mint a signed URL for a path it could already read directly. The bucket stays `public = false`.

**Verified by simulated session** (the same `set local role authenticated; set local request.jwt.claims = '...'` technique §6.6 below uses, run against two real `public.users.id`s from this project): user A inserting/reading under their own prefix succeeds; user A inserting, reading, updating, or deleting under user B's known prefix is denied in every case (0 rows affected/returned, or an explicit `42501` RLS-violation error on insert); user A deleting their own object succeeds. One platform-level detail surfaced during this: Supabase's Storage extension additionally installs a `storage.protect_delete()` trigger that refuses **any** direct SQL `DELETE` on `storage.objects`, even a user's own row, unless `storage.allow_delete_query` is set for the session — this is unrelated to RLS (it fires identically for the object's own owner) and exists so accidental raw-SQL deletes don't bypass the Storage API's own bookkeeping; the DELETE policy was still verified correctly by setting that flag to isolate RLS's decision from the trigger's. All synthetic test rows were removed after verification; `get_advisors` shows no new findings from this migration.

#### Amendment (2026-08-17) — `profile-photos` widened from webp-only to the four common raster formats

**What changed and why.** `allowed_mime_types` on the bucket was `{image/webp}` because that was the only format the *legacy import* produced (§6.5 above) — not because webp was chosen as the safe format for the upload feature. Once real members started uploading their own photos, that inherited constraint became a product gap: an ordinary JPEG or PNG straight off a phone camera was rejected. `supabase/migrations/20260817120000_profile_photos_allow_common_image_types.sql` widens the column to `{image/webp, image/jpeg, image/png, image/gif}`. Nothing else about the bucket changed — still `public = false`, still 5 MiB, still no policy change (the `storage.objects` RLS above gates on the `{user_id}/` path prefix alone, never on extension or content type, so none of the four policies needed to move).

**Why this four and not `image/*`.** Two reasons, both about not turning "widen the format list" into "remove the format allowlist": (1) `image/svg+xml` is deliberately excluded — an SVG is XML that can carry a `<script>`/event-handler, and these objects are later served to a browser via a signed URL and read server-side by `card-preview-service.ts`'s `loadPhotoBytes` for vCard embedding, so an SVG "photo" would be a stored-XSS vector in the first path and a malformed contact file in the second; every other uncommon/vector/animated format is left out for the same narrow-allowlist reason the rest of this schema uses everywhere. (2) The four values chosen are exactly the four keys `EMBEDDABLE_PHOTO_TYPES` in `card-preview-service.ts` already recognised for the `.vcf` `PHOTO` property (added 2026-08-15, before this change) — kept in lock-step deliberately, so every format a member can upload is also a format the non-user card preview's contact-file download can embed, with no photo that uploads fine and then silently vanishes on export.

**What the application layer changed to match.** `apps/web/src/server/profile/photo-upload.ts`'s `assertUploadable` now maps the four allowed MIME types to their stored extension (mirroring the pattern `cover-upload.ts` already used for event covers) instead of hardcoding `.webp`; the extension is derived from the validated `file.type`, never from the client's filename. `photo-uploader.tsx`'s client-side check and `accept` attribute widened to match, for UX only — as before, the bucket's own `allowed_mime_types`/`file_size_limit` and the Storage RLS policy are what actually enforce this, and a client posting straight to the Storage API still hits both.

#### Completed (2026-08-14) — all 148 photos uploaded, `photo_path` backfilled, temporary access closed

The one thing §6.5's "Attempted follow-up run" said was still needed — network access to the Storage API from wherever the upload runs — was solved by moving *where* it ran rather than by changing this session's own egress policy: a temporary, admin-gated page (`apps/web/src/app/internal/photo-backfill/`, deleted after use) let the signed-in project owner upload the 148 files directly from their own browser, which has ordinary internet access. This session's own network policy was never worked around — it simply never sat on the upload's path this time.

**Narrower than the first attempt's temporary policy, because circumstances had changed.** The first attempt's `20260813180402` policy scoped only to `bucket_id = 'profile-photos'` — any path, because nothing was deployed yet and the anon key had no real audience. By 2026-08-14 the app was live and publicly reachable, and the anon/publishable key is, as always, public in every page's JS bundle — so `20260814000100_temp_photo_migration_upload_policy_v2.sql` additionally restricted the INSERT/SELECT grant to exactly the 148 already-known user ids this backfill needed (generated from the CSV, not hand-typed), closing off the rest of the bucket for the window's duration.

**Verified independently before trusting the browser upload's own "done" report** (this project's standing practice, not special-cased for this pass): `select count(*), sum((metadata->>'size')::bigint) from storage.objects where bucket_id = 'profile-photos'` returned exactly **148 objects, 7,370,556 bytes** — matching the CSV's expected totals exactly — and a row-level spot check across four objects spanning the file confirmed exact byte-size matches, not just an aggregate coincidence. Only after that independent confirmation was `public.users.photo_path` backfilled for all 148 rows (a plain `UPDATE ... FROM (VALUES ...)`, generated from the same CSV, run directly via the Supabase management API rather than the blocked HTTP path) — checked before running that zero users had a non-null `photo_path` already (nothing to accidentally overwrite), and checked after that all 148 new paths exactly match their owning user's own id prefix.

`20260814000200_revoke_temp_photo_migration_upload_policy_v2.sql` closed the temporary window immediately after, applied directly (this leg was never blocked — only the Storage HTTP API was). Confirmed via `pg_policies` afterward: exactly the four permanent, own-folder-only policies from §6.5's "first real, permanent access policy" amendment remain, nothing else. The temporary admin page, its generated data file, and both temporary migrations' matching pair are all that ever existed of this tool; the page itself is deleted from the codebase in the same commit that applies the revoke migration.

`public.users.photo_path` is no longer NULL for any of the 148 users who had a photo in the legacy export; it remains NULL, correctly, for the other 189 who never had one.

### 6.6 Verification checklist

Row counts match (337 / 7,142 / 466); every assigned card's `owner_user_id` resolves to a real user (333 expected); no orphaned `social_links`; no `users` row retains any password field; every photo path resolves to a real object; spot-check RLS as a real migrated user (can see own data, cannot see a stranger's).

#### Outcome (2026-08-13) — all checks pass, two deferred, one added

| Check | Result |
|---|---|
| Row counts | 337 users / 7,142 cards (333 assigned + 6,809 unassigned) / **465** social_links (466 − 1 documented skip, §6.4) / 1,813 `legacy.contactexchange` |
| Every assigned card's `owner_user_id` resolves | 333/333, 0 orphans, 314 distinct owners |
| No orphaned `social_links` | 0 |
| No `users` row retains any password field | 0 hits |
| Every photo path resolves to a real object | **Deferred** — no photo was imported (§6.5). The underlying check was still run against the export: 148/148 present, 0 missing. |
| Spot-check RLS as a real migrated user | **Deferred — blocked by Q7, exactly as the §6.1 amendment predicted.** Until the Kinde → Supabase token exchange exists, `auth.uid()` returns nothing and every policy denies every row, so this check cannot distinguish "RLS is protecting this user" from "auth is not wired up". It is the one line of this checklist that remains genuinely unverified and it must be run once Q7 lands. **Now run — see the outcome immediately below.** |

#### Outcome (2026-08-13, later) — the deferred RLS spot-check has been run and passes

The last outstanding line of §6.6 is closed. It was run as part of resolving Q7 (§5.4 amendment), against the live project and a **real migrated user** — one with 4 social links and 11 assigned cards, chosen so the check had something to *find* as well as something to deny. A user with no rows to see would have made every "cannot see a stranger's data" assertion pass for the wrong reason, which is the precise failure mode §6.6 was worried about.

The claim set used is the exact one `mintSupabaseAccessToken()` produces — `{ sub: <users.id>, role: "authenticated", aud: "authenticated", iss: "<project>/auth/v1", iat, exp }`, read back out of a token minted by the real code path — applied the way Supabase's API gateway applies it after verifying a signature.

| Assertion | Expected | Observed |
|---|---|---|
| `auth.uid()` resolves | the user's `public.users.id` | resolves to exactly that uuid |
| `auth.role()` | `authenticated` | `authenticated` |
| `users` rows visible | 1 of 337 | **1** |
| Any *other* user's row | 0 | **0** |
| Own `social_links` | 4 of 465 | **4** |
| Any other user's `social_links` | 0 | **0** |
| Own `cards` | 11 of 7,142 | **11** |
| Any other user's `cards` | 0 | **0** |
| No claims set at all (today's state for every client) | everything denied | `auth.uid()` null, 0 rows everywhere |
| `private.current_user_id()` called directly | refused | `42501: permission denied for schema private` — §3.3's oracle stays shut |
| `connection_attempts`, `app_config`, `pending_connections`, schemas `private` and `legacy` | no access for `authenticated` | no privilege on any of them (§3.5) |

#### Outcome (2026-08-14) — the deferred photo check is also closed

§6.6's "every photo path resolves to a real object" row above is no longer deferred. All 148 photos are uploaded and `photo_path` backfilled — see §6.5's "Completed (2026-08-14)" note for the full run, the independent verification against `storage.objects` (148 objects, 7,370,556 bytes, matching the CSV exactly), and the row-level spot check. Both of §6.6's originally-deferred lines are now resolved; nothing on this checklist remains outstanding.

Both halves matter. The positives prove `auth.uid()` genuinely resolved; the zeros prove the policies are doing the filtering rather than auth being absent. **That distinction is the entire reason this check was deferred rather than fudged.**

**What is still simulated, and why that is a smaller gap than it sounds.** The claims were set directly on the database session rather than arriving inside a signed JWT over HTTPS, because this environment's egress policy blocks the project's Supabase host (the same restriction that blocked the §6.5 photo upload) and the secrets needed to sign a real token were not available. The two unexercised legs are the signature check and the HTTP transport — both Supabase's code, neither ours, and neither able to change which rows a policy returns for a given `sub`. The leg that was genuinely in doubt — whether `auth.uid()` resolves to the right `public.users.id` and whether the policies then behave — is the leg that was run. `apps/web/src/app/auth-check/page.tsx` performs the same assertions over the real HTTP path for whoever finishes the run with the secrets in place.

**Added check — per-table content checksums.** The checklist as written is entirely structural: every line of it passes on data that loaded in the right *shape* but with a corrupted *value*. Because these 9,757 rows were hand-transmitted as SQL text, that was a live risk, so an order-independent digest of the actual column values was computed from the source export and recomputed identically in SQL after loading. All four tables matched byte-for-byte.

This was not theoretical. The checksum caught exactly one real corruption that every structural check above passed clean: a single user's `bio` in which 10 of 11 consecutive newlines survived transmission. Repairing it also surfaced a second-order bug worth remembering — the `UPDATE` fired the `users_set_updated_at` trigger and overwrote the migrated `updated_at` with `now()`, so the trigger had to be disabled for the correction and the original timestamp restored. **Any future data repair on a migrated table has the same trap.**

The checksum construction and the exact SQL are in `supabase/seed/2026-08-13_legacy_import.sql` (STEP 5c). Future data migrations should treat it as part of this checklist, not an extra.

### 6.7 `contactexchange` (1,813 rows) — not migrated

No mapping into the mutual-connections model, per spec. Preserved as a read-only archive in a separate `legacy` schema, not reachable from application code — one-directional capture data is exactly the shape that could accidentally seed follow-style edges.

**Implemented 2026-08-13 — all 1,813 rows archived.** The `legacy` schema and `legacy.contactexchange` were created by migration `20260813171953_legacy_schema_contactexchange_archive.sql`, whose header carries the full reasoning; the rows were loaded as one-time operational data, not by the migration. RLS is enabled **and** FORCEd with **zero policies**, and `anon`/`authenticated` hold no USAGE on the schema and no privileges on the table, so it is reachable only by the service role / dashboard — the same posture as `connection_attempts`, `app_config` and `pending_connections` (§3.5).

Legacy integer user ids are kept as-is with **no FK** to `public.users`, on purpose: a real FK would make the archive a live participant in the graph, which is precisely what this section forbids, and would tie user deletion to it. They remain joinable by hand through `public.users.legacy_user_id`, which is the right amount of friction. Checked at import time: all 1,813 owner ids and all 518 non-null sender ids do resolve, so the FK is omitted by choice, not because it would fail.

---

## 7. Deployment

### 7.1 Vercel (web)

One project, `smartcard-web`, team `SmartCard` (`smart-card1`), root directory `apps/web`, built through Turborepo. Preview deployment per PR, production on `main`. Confirm `front-end-playground` is a throwaway before standardizing production naming (Q12).

### 7.2 EAS (mobile)

| Profile | Purpose |
|---|---|
| `development` | Dev build with debugging — **required for NFC; Expo Go cannot do this** |
| `preview` | Internal distribution / TestFlight for pilot attendees |
| `production` | Store submissions |

**Native requirements to arrange early:**

| Platform | Needed |
|---|---|
| iOS | Apple Developer account (paid); NFC Tag Reading capability; `NFCReaderUsageDescription`; `NSLocationWhenInUseUsageDescription`; `NSCameraUsageDescription`; `NSContactsUsageDescription` |
| Android | Google Play Developer account; `android.permission.NFC`; `ACCESS_FINE_LOCATION`; `CAMERA`; `READ_CONTACTS` |

NFC requires an EAS development build, not Expo Go — slower dev loop, set up on day one. Apple Developer enrollment can take days — start early.

### 7.3 Deep links

For a tapped tag URL to open the app rather than the browser, **`smartcard.tech`** — not whatever domain the new Next.js app deploys to by default — must serve `/.well-known/apple-app-site-association` (iOS Universal Links) and `/.well-known/assetlinks.json` (Android App Links), because that's the exact domain physically baked into the existing card inventory (§2.2). This only works cleanly if `smartcard.tech` itself points at the new backend (or proxies `/card/*` and the `.well-known` files to it) — see Q15 in §9. Without this, NFC "works" but always lands in a browser at the wrong domain, which looks like a broken product.

### 7.4 Environment variable inventory

**Next.js / Vercel (server-side, secret):** `KINDE_DOMAIN`, `KINDE_CLIENT_ID`, `KINDE_CLIENT_SECRET` 🔒, `KINDE_ISSUER_URL`, `KINDE_SITE_URL`, `KINDE_POST_LOGIN_REDIRECT_URL`, `KINDE_POST_LOGOUT_REDIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 🔒, `SUPABASE_JWT_SECRET` 🔒, `QR_SIGNING_SECRET` 🔒, `CONTACT_HASH_SALT` 🔒, `UPSTASH_REDIS_*`, `SENTRY_DSN`.

**Next.js (public):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`.

**Expo / EAS (public):** `EXPO_PUBLIC_KINDE_DOMAIN`, `EXPO_PUBLIC_KINDE_CLIENT_ID` (mobile/PKCE client), `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SENTRY_DSN`.

Anything prefixed `NEXT_PUBLIC_`/`EXPO_PUBLIC_` is shipped to users and readable by anyone — no secret ever gets that prefix. The Expo app holds no Supabase credentials beyond the publishable key; it talks to our API, never the database directly.

#### Amendment (2026-08-13) — additions from this round's decisions

| Variable | Where | Why |
|---|---|---|
| `EXPO_ACCESS_TOKEN` 🔒 | Next.js / Vercel, server-side | Authenticates our server to Expo's push API (§7.5). Secret — it is the credential that lets something send notifications as us. |
| `GEOCODING_API_KEY` 🔒 | Next.js / Vercel, server-side | A Mapbox access token (Q25, resolved 2026-08-14) — reverse geocoding for `meeting_locations.place_label` (§2.4 amendment) and later §8's approximate-mode area names. Optional, like `EXPO_ACCESS_TOKEN`: unset means every meeting's `place_label` simply stays null. Server-side by necessity — §2.4 explains why the geocode must not happen on a phone. |
| `EXPO_PUBLIC_PROJECT_ID` | Expo / EAS, public | The EAS project id `getExpoPushTokenAsync()` requires to mint a push token. Public and harmless: a push token is only useful to whoever holds `EXPO_ACCESS_TOKEN`. |

#### Amendment (2026-08-13) — corrections from building the auth bridge (§5.4)

| Variable | Correction |
|---|---|
| `KINDE_MOBILE_CLIENT_ID` | **Also needed server-side**, not only in Expo. The token verifier pins a Kinde token to one of our two applications via its `azp` claim (see the §5.4 amendment's judgment call), so the mobile client id must be on the server's allow-list or every request from the phone is rejected — with an error that will read like a Kinde misconfiguration. Not a secret: a public client id. |
| `KINDE_ISSUER_URL` | Already listed, but its role has widened. It is no longer just the SDK's sign-in endpoint — it is the value `iss` is verified against. Deliberately the *same* variable for both: what we obtain tokens from must be what we verify them against, or a token from an unrelated Kinde business could pass. |
| `KINDE_SITE_URL`, `KINDE_POST_LOGIN_REDIRECT_URL`, `KINDE_POST_LOGOUT_REDIRECT_URL` | Already listed; recorded here because they are environment-specific and easy to miss at deploy time. On Vercel they must point at the deployed origin, and `<origin>/api/auth/kinde_callback` must be registered as an allowed callback for the SmartCard Web application in Kinde, or login fails at Kinde before it reaches us. |
| `SUPABASE_JWT_SECRET` | Still required, still 🔒, but now flagged as **legacy**: Supabase documents the shared JWT secret as backward-compatibility only. See the §5.4 amendment for the migration path and why the blast radius is one file. |

#### Amendment (2026-08-13) — variables the Connect Flow build added

| Variable | Where | Why, and whether it is required |
|---|---|---|
| `QR_SIGNING_SECRET` 🔒 | Next.js / Vercel, server-side | Already listed in §7.4's inventory but never described. It is the HMAC key for the signed QR token (§4.2 step 2), i.e. check (1) of the nine in §4.2 step 5 — anyone holding it can mint a valid token for any session id and nonce. **Required**; the app refuses to mint with an empty value rather than producing a forgeable token. Deliberately not derived from any other secret: one key, one purpose, bounded blast radius. Generate with `openssl rand -base64 48`, and use a *different* value in Vercel from the local one. |
| `CONNECT_IP_HASH_SALT` 🔒 | Next.js / Vercel, server-side | **New.** Salts the IP hash stored in `connection_attempts.ip_hash` and `rate_limit_events.subject_key`. **Required, and deliberately so** — an unsalted hash of an IP is reversible by enumerating the whole address space, which is storing raw IPs while believing you did not; the honest third option to that and to silently dropping the §4.6 per-IP limit is refusing to start. **Must differ from `CONTACT_HASH_SALT`**: one salt across two datasets means one leak compromises both. |
| `EXPO_ACCESS_TOKEN` 🔒 | Next.js / Vercel, server-side | Already added by the 2026-08-13 round; recorded here as the **one optional secret in the codebase**. §4.5's amendment requires that a failed or absent notification never blocks, delays or reverses a connection, so making it required would fail closed on the one part of this path where failing closed is wrong. Unset means taps still connect and the send path logs, loudly, that it could not notify. |

`QR_SIGNING_SECRET` and `CONNECT_IP_HASH_SALT` were generated and written into the local gitignored `.env.local` by the Connect Flow build, with the reasoning above inline. Neither is committed and neither should be; both need distinct production values set in Vercel before deploy.

#### Amendment (2026-08-13, later same day) — the signing key that replaces the legacy JWT secret (Q27)

| Variable | Where | Why, and whether it is required |
|---|---|---|
| `SUPABASE_JWT_SIGNING_KEY` 🔒 | Next.js / Vercel, server-side | **New, and it replaces `SUPABASE_JWT_SECRET` on the signing path.** The full **private** ES256 (P-256) JWK, as one line of JSON, that `mintSupabaseAccessToken` signs the 5-minute per-request token with — a key we generated (`supabase gen signing-key --algorithm ES256`) and imported into the project's JWT Signing Keys, because Supabase will not export the private half of the key it generated. As sensitive as the secret it replaces: anyone holding it can mint a token for any user, so server-side only, never a `NEXT_PUBLIC_` name. **Currently optional, transitionally**: unset means the app falls back to the legacy HS256 secret and warns loudly, which is what keeps it working in the window before the key is imported *and rotated to in-use* in the dashboard. Present-but-malformed **throws** rather than falling back. Becomes required — and the fallback gets deleted — once the rotation is confirmed. See the second §5.4 amendment. |
| `SUPABASE_JWT_SECRET` 🔒 | Next.js / Vercel, server-side | **Superseded, still required, do not delete yet.** It is the project's *previous* signing key (Q27) and is read only until `SUPABASE_JWT_SIGNING_KEY` is switched on. Two things not to do: don't remove it before that switch, and **don't revoke it in the dashboard at all yet** — `SUPABASE_SERVICE_ROLE_KEY` is a legacy JWT signed with it, so revoking it disables the service-role key `ensureUser()` depends on (Q31). |

**Correction (2026-08-14) — both rows above have moved on, now that the rotation is done** (see §5.4's "Completed (2026-08-14)" note). `SUPABASE_JWT_SIGNING_KEY` is no longer "currently optional, transitionally" — it is **required**, it is the only signing path, and unset now throws a named error rather than falling back. `SUPABASE_JWT_SECRET` is no longer read by any code at all and has been dropped from `turbo.json`'s build env list; it stays set in the environment for reference, and the "don't revoke it in the dashboard" warning stands unchanged and still gated on Q31.

### 7.5 Push notifications — Expo's push service

**Resolved (Q24):** notifications go through **Expo's push service** (`expo-notifications` on the device, Expo's push API from our server), which fans out to APNs for iOS and FCM for Android behind one endpoint. Not a direct per-platform integration.

**Why.** The alternative is integrating APNs and FCM separately: two credential formats, two payload shapes, two retry-and-error vocabularies, two sets of platform quirks, for a pilot whose entire notification surface is currently *one* message — the card-tap alert from §4.5 — with a small number of connection and proximity alerts likely to follow. Expo's service is already the natural fit for a codebase that is on Expo and EAS anyway (§1.1, §7.2), and it collapses that work to one integration. The per-platform route stays available later if the notification product grows enough to need what Expo abstracts away; nothing in this design makes that switch hard, because the only thing stored is a token and the only thing sent is a title and body.

**The trade-off, stated plainly, because it constrains what may be sent.** Routing through Expo puts a third party in the delivery path: notification content transits Expo's servers, and push notifications are in any case rendered on a lock screen where anyone holding the phone can read them without unlocking it. **Two independent reasons, therefore, why payloads carry no sensitive content** — no coordinates, no place labels, no tokens, no session identifiers, nothing from `meeting_locations`, and nothing from §8's proximity data. A display name and an event description ("just tapped your card") is the ceiling. Anything richer belongs behind the app's own auth, reached by tapping the notification, not inside it.

**Setup that must be arranged, and when.** Both pieces depend on the developer accounts §7.2 already says to start early, so they are the same lead-time problem:

| Platform | Needed |
|---|---|
| iOS | An APNs authentication key uploaded to Expo; Push Notifications capability and the `aps-environment` entitlement on the EAS build |
| Android | FCM server credentials configured in the EAS project (`google-services.json` delivered through EAS, not committed) |
| Server | `EXPO_ACCESS_TOKEN` for authenticated sends |

**One consequence for the dev loop, which is already true for another reason.** Remote push cannot be exercised in Expo Go — it needs the EAS development build. §7.2 already requires that build for NFC on day one, so this adds no new constraint; it does mean anyone testing notifications on the Expo Go path will see them silently not arrive and should check which build they are on before debugging anything else.

**Delivery is best-effort, and the design must not assume otherwise.** Expo's service, APNs and FCM are all best-effort: notifications are dropped for unregistered devices, throttled by the OS, and suppressed entirely by a user who turned them off. Anything whose correctness depends on a notification arriving is broken by design. This is why §4.5's card-tap awareness also has an in-app surface, and why §8 must not treat "we notified them" as consent, verification, or a security control. Token lifecycle (`DeviceNotRegistered` → mark the row disabled) is covered with the `user_push_tokens` sketch in §4.5.

---

## 8. Friend Proximity (Phase 3, post-pilot) — design only

**Nothing in this section is built. No table here exists, no migration has been written, and none should be until this design is signed off.** It is written now, at the same model and effort tier as §4, because this is the only feature in SmartCard that continuously broadcasts a person's real-time position to another person, and because the decisions that make it safe are schema-shaped — they are much cheaper to get right before there is a table than after.

### 8.0 The inversion that makes this different from every other proximity app

Typical "find people near me" products work outward from a location: *given this point, who is close to it?* That question, asked of a database, is a stranger-discovery engine — and it is precisely the thing this product is built not to have. SmartCard's version works outward from the graph instead: *of the specific people I have already met in person and have deliberately, mutually agreed to share location with, where are they?* The distance calculation is the last step, not the query.

This is not a stylistic preference. It is the design constraint everything below serves, and it produces one hard rule that any future change must be measured against:

> **There must be no query path that takes a location and returns users.** Every read starts from the viewer's own sharing grants and ends at a location; never the reverse.

A spatial index over positions, added innocently to make a screen faster, would reintroduce exactly the capability §4.7 threat 4 says the product must never have. The safeguards in §8.4 exist to make that structurally hard rather than merely discouraged.

### 8.1 What was specified, and what had to be decided

Specified by the product owner: mutual opt-in only, never one-directional, never default-on; operating exclusively over existing `connections`; **per-connection** control rather than a global toggle; user-defined protected zones with user-set radii; visibility modes exact / approximate / invisible; realistic background-location battery discipline.

Everything else below — the table shapes, how mutuality is evaluated, what "hidden or generalized" concretely resolves to, what "approximate" means numerically, and the retention rules — was not specified and is a judgment call. Each one is labelled and argued rather than presented as given, in the style of §3.6.

### 8.2 Schema sketch

Descriptive only, in §2's format. **Do not turn these into `CREATE TABLE` statements before sign-off.**

#### `proximity_shares` — one directed grant per row

The per-connection opt-in. One row means "*I* am willing to share my location with *you*, at this granularity". Sharing is live only when **both** directions exist and are enabled (§8.3).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `connection_id` | uuid | FK → `connections`, cascade delete. The grant is anchored to the verified edge, not floating beside it |
| `sharer_user_id` | uuid | FK → users. The person whose location this grant is about — and the sole owner of this row |
| `viewer_user_id` | uuid | FK → users. The person the grant is extended to |
| `mode` | text | `exact` / `approximate` / `invisible` — chosen by the sharer (§8.5) |
| `enabled` | boolean | Default **false**. Distinct from `mode` on purpose, see below |
| `expires_at` | timestamptz | Nullable. Time-boxed sharing; null means indefinite |
| `created_at`, `updated_at` | timestamptz | |

Constraints: `UNIQUE (sharer_user_id, viewer_user_id)`, `CHECK (sharer_user_id <> viewer_user_id)`, and — importantly — a constraint that the two users are exactly the endpoints of `connection_id`. Without that last one the row could name connection X while granting access between two people from connection Y, and the graph check would pass while pointing at the wrong evidence.

**Judgment call — two directed rows, not one row with two flags.** A single row per connection carrying `a_shares_with_b` and `b_shares_with_a` looks tidier and is the wrong shape, for a reason §3.6 already discovered the hard way: **RLS filters rows, and grants control columns per *role*, so "you may update this row but only your own column in it" is not expressible.** With a shared row, either party could flip the other party's flag unless a trigger or the service layer stopped them — putting the most safety-critical toggle in the product behind application logic instead of the database. With one row per direction, the rule is the simplest one RLS can express: *you may write only rows where `sharer_user_id` is you*. Each half of the agreement is solely owned, and revocation is a write to a row nobody else can touch.

**Judgment call — `enabled` and `mode` are separate columns.** `mode = 'invisible'` could have doubled as "off". Keeping them apart means a user can go invisible temporarily and come back to the granularity they had chosen, rather than the app having to remember it for them — and it makes "who did I ever share with?" answerable from a row that still exists. It also keeps the read-time predicate readable: the mutuality check tests `enabled`, and only afterwards does `mode` decide what is shown.

**Judgment call — `expires_at` exists and the UX should default to using it.** Not requested. It is included because indefinite sharing is the state that ages badly: the person you shared with at a conference last March is still watching you in November, and nobody revisits a settings screen. Time-boxing turns the safe outcome into the default outcome and makes the dangerous one a deliberate act. Recommended UX default: an 8-hour share, with indefinite available and clearly labelled.

**What its RLS will need to grant and forbid, in plain language.** A user may **insert, update, and delete only rows where they are the sharer** — this is the entire revocation mechanism, and it must not require anyone's cooperation. A user may **read** rows where they are the sharer (to see who they are sharing with) **or the viewer** (to see who has shared with them). Reading the viewer side is deliberate: a person is entitled to know who has offered them location access, and since a grant is only ever meaningful once they reciprocate, hiding it would make the mutual handshake impossible to complete. Nobody may read a row they are not named in — a third party must never be able to learn who shares location with whom, which is a map of who trusts whom. Insert must additionally be constrained to grants where an **active connection actually exists**; a grant referencing a removed connection should be impossible to create, and inert if one somehow survives (§8.3 checks this at read time regardless, so this is defence in depth, not the primary guard).

#### `protected_zones` — user-defined places that suppress sharing

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → users, cascade delete |
| `label` | text | 🔒 The user's own name for it — "Home", "Mum's" |
| `center_latitude`, `center_longitude` | double precision | 🔒 |
| `radius_m` | double precision | 🔒 User-set, bounded server-side (§8.4) |
| `is_active` | boolean | Default true — lets a zone be paused without being deleted and re-entered |
| `created_at`, `updated_at` | timestamptz | |

**What its RLS will need to grant and forbid, in plain language.** Full read and write **for the owner, and for absolutely nobody else** — no connection branch, no mutual branch, no co-attendee branch, not even for someone the owner actively shares location with. There is no relationship in this product that justifies reading another person's zone rows, and the policy should have no branch that could be widened by a well-meaning future edit. The reasoning is that a zone row is *strictly more dangerous than the thing it protects*: seeing someone's live location once tells you where they are now, whereas seeing their zone tells you their home address permanently, plus the radius they consider private. **The effect of a zone is applied server-side when computing what a viewer may see; the zone itself never leaves its owner's account.** A client that never receives zone data cannot leak it, and no viewer-facing response should contain a zone id, a zone label, or any field whose presence implies one exists (§8.6).

#### `live_locations` — last known position, one row per user, no history

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | **PK**, FK → users, cascade delete. One row per person, overwritten in place |
| `latitude`, `longitude` | double precision | 🔒 Nullable — deliberately, see below |
| `accuracy_m` | double precision | 🔒 |
| `captured_at` | timestamptz | When the device took the fix. Freshness is judged from this, not from arrival time |
| `reported_at` | timestamptz | When the server received it. The gap between the two is itself a signal |
| `in_protected_zone` | boolean | Computed server-side at write time (§8.4) |
| `device_id` | text | Which installation reported it |

**Judgment call — one row per user, overwritten, with no history table.** Nothing in the requirements said "do not keep a trail", and a trail is the natural thing to build: it makes debugging easier and enables features later. It is also, by a wide margin, the most dangerous artifact this product could hold. A breach of a last-known-position table exposes one point per person; a breach of a location history exposes every person's home, workplace, routine, and the places they went that they told nobody about. The feature as specified — *where are my friends right now* — needs exactly one point per person, so the history would be collected for hypothetical future value at a permanent, catastrophic downside. **If a later feature wants history, that is a deliberate amendment with its own threat model, not a schema convenience.** Rows are additionally deleted once they age past `proximity_location_retention_seconds`, so a dormant account stops holding a position at all.

**Judgment call — coordinates are nullable, and are null whenever the user is inside a protected zone.** The zone check happens at *ingest*: the server receives the fix, tests it against the sharer's own zones, and if it falls inside one, stores `in_protected_zone = true` and **does not store the coordinates at all.** The precise position transits the server and is discarded. This is the same reasoning §2.4 uses for splitting `meeting_locations` off `meetings`, applied one level further: a read-path bug cannot leak a protected position if the database does not contain one. Suppressing at read time instead would leave the sensitive value sitting in a column, protected only by every future query remembering to check a flag.

**What its RLS will need to grant and forbid, in plain language.** **No user-facing SELECT policy at all**, exactly like `meeting_locations` — reads happen only through a `security definer` function (§8.3). This is not caution for its own sake; it is forced by the design. RLS can decide whether a viewer may see a *row*, but "approximate" mode means a viewer is entitled to a **coarsened version of a value**, and no row policy can express that. Any policy permissive enough to let an approximate-mode viewer read the row hands them the exact coordinates. Writes are the user's own row only — or, better, service-role only through the ingest endpoint, since ingest must apply the zone check before storing and a direct client write would bypass it. Users get no direct read of their own row either; there is no product need, and every additional read path is another place the coarsening can be skipped.

#### `proximity_share_events` — an audit trail of grants (recommended, not requested)

`id`, `proximity_share_id` (nullable — the grant may since have been deleted), `sharer_user_id`, `viewer_user_id`, `action` (`enabled` / `disabled` / `mode_changed` / `expired` / `revoked_by_connection_removal`), `previous_mode`, `new_mode`, `created_at`.

**Judgment call — include this, and note carefully what it is not.** It records changes to *permissions*, never positions, so it carries none of the risk that ruled out location history. Its value is a question users of this kind of feature genuinely need answered — *when did I start sharing with this person, and was it me who turned it on?* — which matters most in exactly the device-compromise and coercion cases §8.6 covers. Readable by the sharer only; a viewer must not be able to see that someone toggled them off (§8.6 threat 4 explains why).

### 8.3 The permission model: how mutual opt-in is actually evaluated

One `security definer` helper is the sole authority, in the pattern §3.1 established:

```
private.proximity_effective_mode(sharer, viewer) → 'exact' | 'approximate' | 'invisible' | null
```

It returns non-null only when **every one of these holds**:

1. `private.are_connected(sharer, viewer)` — an **active** connection exists. This is the "verified graph only" requirement, and reusing the existing helper is what makes it true rather than merely intended.
2. No `blocks` row in **either** direction.
3. A `proximity_shares` row **sharer → viewer** exists, `enabled`, not past `expires_at`.
4. A `proximity_shares` row **viewer → sharer** exists, `enabled`, not past `expires_at`.
5. The sharer's mode from (3) is not `invisible`.

Null at any step, and the caller shows the single unavailable state (§8.6). Null arguments return null, so a malformed call denies.

**How this compares to how `connections` enforces mutuality, and why it had to differ.** `connections` makes mutuality *structural*: the ordered-pair CHECK plus the UNIQUE constraint mean a one-directional edge has no row shape that can express it (§2.3). That is the stronger technique and it was the first thing considered here. It cannot be used, because the two halves of a proximity agreement must be **independently owned and independently revocable** — that is the whole point — and a single shared row cannot give each party exclusive write access to their own half (the RLS/GRANT limitation in §8.2). So mutuality here is enforced by **conjunction at evaluation time** instead: two rows, both required, each owned by the person it speaks for.

That substitution has a cost that must be paid explicitly. An evaluation-time rule holds only if *every* read goes through the evaluation, whereas a structural rule holds even against a direct `psql` session. The design pays it in three ways, and all three are load-bearing:

- `live_locations` has **no SELECT policy**, so there is no path to a position that does not pass through the helper.
- There is exactly **one** helper and one thin `public` wrapper over it (the pattern §3.6 observation (a) describes for `connections_attending`). Not one per screen.
- The wrapper derives the viewer **from the JWT**, never from an argument. A `viewer` parameter would let anyone ask the question on someone else's behalf, which is the "who can see this arbitrary person?" oracle §3.3 forbids.

**Why viewing requires you to be sharing too, and the consequence users will notice.** Requirement: A's location is visible to B only if both have enabled sharing with each other. So turning your own sharing off does not just hide you — **it also blinds you to everyone you were watching.** This is worth stating in the product UI, because it will surprise people, and it is worth keeping, because it makes watch-only use impossible: nobody can observe without being observable. Symmetry of exposure is the feature.

**Granularity is the sharer's decision alone.** The effective mode comes from the sharer's row. The viewer's row is a gate, not a dial — it says whether they participate, never how precisely they get to see anyone.

**Removing a connection revokes proximity automatically**, because step 1 tests `are_connected`, which only counts `active` (and §3.6 made connection removal one-way). Blocking does the same via step 2. No separate cleanup is needed and none should be added — a second revocation path is a second thing that can fail to run.

### 8.4 Protected zones: what "hidden or generalized" concretely means

**Recommendation: hidden, completely — and indistinguishable from every other reason a location might be missing.** When a sharer is inside an active protected zone, viewers see the same "no current location" state they would see if that person were offline, stale, invisible, or not sharing at all. No coordinates, no coarse point, and — critically — **no label saying "in a protected zone"**.

The two alternatives were considered and both leak:

- **A "protected zone" label** hands over the answer. "He's in a protected zone right now" means *he is at home or at work*, which is the exact fact the zone exists to conceal, delivered on demand. Watch for a week and you have his schedule.
- **A coarsened point** is worse than it looks. Coarsening around a *fixed* location produces observations that cluster on that location, and every boundary crossing pins an edge of the zone. Enough samples and the zone centre — someone's home — is recoverable from data that felt safe because each individual reading was vague. Generalisation defends a *moving* person poorly and a *stationary* one hardly at all.

Deliberately fabricating a plausible false location was also rejected outright: a viewer may act on what they see — drive somewhere, expect to meet someone — and a product that lies about where a person is has done something worse than reveal too much.

So all four causes of absence collapse into **one indistinguishable state**, and the API never says which one applies. That single decision is what defends zone privacy, revocation privacy (§8.6 threat 4), and offline privacy at once — each would be weak alone, and together they are noise that hides each other.

**Supporting mechanics.**

- **Zone check at ingest, coordinates never stored while inside** (§8.2). The strongest form of "hidden" is "not in the database".
- **A boundary buffer.** Suppression starts at `radius_m + proximity_zone_exit_buffer_m` and lifts at the radius itself — hysteresis, so someone pacing near their zone edge does not flicker in and out, which would strobe the boundary's position to a watching viewer.
- **Server-enforced radius bounds.** The radius is user-set as required, within `proximity_zone_min_radius_m` and `proximity_zone_max_radius_m`. A minimum exists because a 10m zone protects nothing while *feeling* like protection — the most dangerous kind of privacy control. A maximum exists because a 50km zone silently disables the feature; better to tell the user that than to leave them wondering why nobody ever sees them.
- **A cap on zones per user.** Partly to bound work at ingest, mostly because iOS monitors at most 20 geofenced regions per app (§8.7) and the app needs headroom for its own uses.
- **Zones protect their owner, from everyone.** A zone applies to the owner's own position regardless of any per-connection mode, and can only ever reduce what is shown. There is deliberately no per-connection zone exception ("share my home with my partner"): it doubles the state a user must reason about, and the same effect is available by simply not enabling a zone.

### 8.5 What "exact" and "approximate" concretely mean

**Exact** — the stored fix as reported, with its accuracy, subject to freshness. What it is for: an event, a conference, a "I'm outside, where are you?" meet-up. Recommended as a time-boxed share, not a standing one.

**Approximate — recommendation: snap to a fixed grid of about 1 km and return the cell's centre point, plus a coarse area name from the same geocoding provider §2.4 introduces** ("Mission District, SF"). Adjustable via `proximity_approximate_grid_m`.

**The non-obvious part, and the reason it is a grid rather than jitter.** The instinctive way to coarsen is to add random offset to the true position. It is wrong here, because the reads repeat: **re-randomising per request lets a viewer average many samples back to the true point.** A patient observer defeats it entirely, and the feature would be advertising a protection it does not provide. A *deterministic* grid — the same true cell always yields the same returned point — gives an observer nothing further no matter how often they look. Repeated observation is the threat model that distinguishes real coarsening from theatre.

Two consequences to accept, both minor and both worth stating so they are not mistaken for bugs: a small real movement across a cell boundary looks like a ~1km jump, and the *timing* of a cell change leaks a little about movement. Hysteresis on cell changes is the tuning knob if that becomes annoying.

**Judgment call — 1 km, and why the number is genuinely uncertain.** It is not derivable from anything; it is a starting value in the same spirit as §4.3's 150m radius, and it is a row in `app_config` for the same reason. The tension is real in both directions: at a conference, 1km means everyone is in one cell and the feature says nothing useful; across a city it is about right, coarse enough to say "she's in the Mission" and not "she is at this address". **The resolution is not to split the difference but to use the right mode** — `exact`, time-boxed, is the event answer; `approximate` is the ambient-awareness answer. Expect to tune from real use, exactly like the GPS radius.

**All coarsening happens server-side, before the value leaves the database.** In approximate mode the exact point is never sent to the viewer's device in any form — not in a hidden field, not for a "more accurate" distance calculation. Any distance shown in the UI is computed from the coarsened point, so a client cannot be reverse-engineered into precision it was not granted. This is the same principle as §4.2 step 7's refusal to return the computed distance on a rejection.

**A note on end-to-end encryption, since it will be proposed.** E2E location sharing sounds strictly better and is rejected here for a specific reason: zone suppression and mode coarsening are enforcement, and enforcement on a device is enforcement the device's owner can remove. §0's convention — "a phone can be modified by its owner; our server can't" — applies with full force. Encrypting positions end-to-end would move the decision about what a viewer may see onto the viewer's client, which is precisely the party the rules exist to constrain. The server therefore holds plaintext positions, and §8.6 threat 5 states honestly what that costs.

### 8.6 Threat model

**Threat 1 — Inferring a protected zone by watching over time → Substantially mitigated, partially accepted.** A viewer with a long observation window tries to locate someone's home from the pattern of what they can and cannot see. Defended by: no zone label; the unified unavailable state (a disappearance could equally be a dead battery, a lost signal, a manual invisible, an expired share, or a revocation); coordinates not stored at all while inside a zone; the boundary buffer stopping edge-flicker from tracing the perimeter; and deterministic grid snapping outside the zone so approach paths cannot be averaged into precision. **Accepted residual:** someone who watches for long enough can observe that a person tends to become unavailable in the evenings and around a general part of the city. That is a schedule inference from absence, and no design that ever shows a real location can eliminate it without lying. The line drawn here is that the *coordinates* of a zone stay unrecoverable.

**Threat 2 — A connection that was legitimate once but should not have ongoing location → Defeated by default posture.** The conference-tap case, named explicitly in the requirements. Every proximity grant is **per connection and off by default**, including for connections created after the feature ships; there is deliberately no "share with all connections" bulk action, because one such tap would undo the entire per-connection design. `expires_at` and the recommended 8-hour default mean the common case self-heals. Removing the connection or blocking the person kills sharing through §8.3 steps 1 and 2 with no separate action.

**Threat 3 — Revocation must be unilateral and instant → Yes, by construction.** Either party disables the row **they** own; the §8.3 conjunction fails on the next evaluation; the other side sees the unavailable state immediately. No cooperation, no confirmation, no waiting period, no negotiation — and no cached position to keep serving, since the check runs at read time on a single overwritten row. This is the single most important property in the section and it is why the two-row shape was chosen over anything tidier.

**Threat 4 — Stalking or coercion by someone with a legitimate grant → Partially defeated; the residual is real and named.** The intended-use abuse case, which for a location feature is the one that actually hurts people. Defences: mutual-only, so a watcher must be watchable; per-connection and default-off; protected zones for home; instant unilateral revocation; blocks hard-killing it; and time-boxing to make grants lapse on their own.

**The specific call here: revocation is not announced.** A viewer is *never* told "X stopped sharing with you" — they see the same unavailable state as a flat battery. A revocation notification would be a coercion trigger in exactly the relationship where the feature is most dangerous, converting "quietly turn it off" into "explain yourself". Same reason `proximity_share_events` is readable by the sharer only. Two supporting product rules follow from this and should be treated as part of the design, not as polish: **proximity sharing must never be attached to any streak, score, or reciprocity mechanic** that penalises turning it off, and the app should periodically show a user who can currently see them, since the risk of a standing grant is that it becomes invisible through familiarity.

**Accepted residual, stated without softening:** a user who chooses to share exact location with someone who abuses it is not protected by any technical control in this design. What the design can do is make the safe state the default, make revocation instant, unilateral and unannounced, and make protected zones available for the places where being found matters most.

**Threat 5 — Server breach or a malicious insider → Reduced, honestly bounded.** The server holds plaintext positions (§8.5 explains why E2E is rejected). The blast radius is deliberately shrunk rather than eliminated: one row per user rather than a movement history, so a dump is a snapshot rather than everyone's life; no coordinates at all for anyone inside a protected zone at that moment; a retention TTL that removes positions for anyone not actively sharing; and only users with a live mutual grant reporting at all, so most of the user base has no row. **Accepted:** an attacker with the service role at a given instant learns where the actively-sharing subset of users was at that instant.

**Threat 6 — A compromised device → Bounded, with one gap worth closing.** A stolen unlocked *viewer* device shows only what that viewer was already entitled to, already coarsened — a compromised viewer gains no precision the account did not have. A stolen unlocked *sharer* device is a total loss for that user's own location, and it can also **enable new grants** to people the real user never chose. Mitigations to build with the feature: enabling a share is a sensitive action and should require fresh authentication (biometric/re-auth), it should notify the sharer's *own* devices ("you started sharing location with X" — a covert enable is then not silent), and the list of active grants should be prominent rather than buried in settings. `proximity_share_events` exists so the question "did I do this?" has an answer.

**Threat 7 — Reintroducing "nearby strangers" → Structurally prevented, and this is the one to guard in code review.** The read path starts from the viewer's own `proximity_shares` rows and ends at a location; `live_locations` has no SELECT policy; the helper takes no viewer argument. **Protect by never adding: a spatial index query over `live_locations` that is not first constrained by the caller's own grants; a "who is near this point" endpoint in any form; a `viewer` parameter to the evaluation helper; or a second read path that skips it.** The nearby screen is a list of the viewer's own sharing partners sorted by distance — not a search. This is the direct analogue of §4.7 threat 4's "never add a user-search endpoint", and it deserves the same reflex.

**Threat 8 — Proximity data leaking into connection verification → Must be prevented by an explicit invariant.** A user can lie about their own position with a rooted phone or a mock-location provider, and nothing here stops that. It stays harmless only while proximity data has no security consequence. **Invariant: `live_locations` must never be an input to `createVerifiedConnection`, to the §4.3 GPS gate, or to any part of §4.** Reusing a "recent" position to spare someone a fresh GPS fix would look like a sensible optimisation and would quietly convert a self-reported, long-lived, low-stakes value into the proof that a meeting happened — defeating §4.7 threat 2 (the video-relay defence) completely. §4's gate requires a fresh fix captured for that purpose, and §4.1's type-level rule that only a verifier can produce a connection is what keeps this from being a one-line mistake.

**Threat 9 — Correlating proximity with the meeting feed → No new exposure by construction.** Proximity data is never written to `meetings` or `meeting_locations`, never becomes feed content, and is never used to suggest connections ("you were near Alex — connect?" is a stranger-discovery feature in a friendly hat, and the non-negotiable product rule forbids it regardless of who it names).

### 8.7 Background location: what is actually achievable

Getting this wrong does not produce a subtly worse product; it produces one that drains a battery in four hours and gets uninstalled. The constraints below are platform realities, not preferences.

**Do not poll continuously.** The naive design — a location request every 30 seconds, always — is the single most common way these features fail. The alternatives cost far less:

- **OS geofencing for protected zones.** iOS region monitoring and Android's Geofencing API wake the app on a boundary crossing instead of asking the app to keep checking. Both are handled by the OS at very low power. **Hard limit: iOS monitors at most 20 regions per app**, Android around 100 — which is why `proximity_max_zones_per_user` exists, and why zone counts are a schema concern rather than a UI one.
- **iOS significant-location-change (~500m, cell/wifi-derived) as the baseline.** Cheap enough to run continuously. Upgrade to a high-accuracy fix only when the proximity screen is in the foreground or a share is actively being viewed.
- **Android foreground service** with a `location` service type and its mandatory persistent notification for anything continuous. `ACCESS_BACKGROUND_LOCATION` is a separate permission with its own prompt, and OEM battery managers (Xiaomi, Huawei, Samsung, others) kill background work aggressively regardless of what the API contract says. Assume gaps and design for them.
- In Expo terms: `expo-location`'s `startGeofencingAsync` / `startLocationUpdatesAsync` driven by `expo-task-manager` background tasks. Needs the EAS development build, which §7.2 already requires.

**Adaptive cadence, in priority order.** Each of these is a large multiplier, not a micro-optimisation:

1. **No active mutual share → no background location at all.** Not a slower interval: none. Collecting a position that nothing is entitled to read is pure risk with no product value, and this is data minimisation as much as battery management.
2. **Stationary → back off.** Wake on significant change or activity recognition rather than sampling a person who has not moved.
3. **Nobody plausibly nearby → back off.** The server already knows where a viewer's sharing partners roughly are; if the nearest is 40km away, minute-level precision serves nothing. This hint must be coarse and one-directional, and must never carry a position the client was not already entitled to.
4. **Low battery → significant-change only.** A location feature that contributes to a dead phone has made its user less safe, not more.

**Permissions will be refused and revoked, and that must be a first-class state.** iOS periodically re-prompts users about background location and shows them a map of where the app has tracked them — some will turn it off then and there, which is working as intended. Android requires a separate background-permission flow, and **Google Play requires a written justification and a demo video for background location access**, a real submission risk that belongs alongside Q9's App Store review question. When permission is missing, downgraded to when-in-use, or simply not producing fixes, the correct behaviour is the unavailable state from §8.4 — **never a stale last-known point presented as current**, which is the failure mode most likely to send someone to the wrong place. Fail closed, exactly as everywhere else in this document.

**Freshness is enforced server-side.** A fix older than `proximity_location_max_age_seconds` is not shown, regardless of what the client believes. Clients can be wrong about time; the server decides.

### 8.8 Configuration keys (Phase 3, none applied)

| Key | Starting value | Rationale |
|---|---|---|
| `proximity_enabled` | `false` | Master switch, off until the feature ships. |
| `proximity_location_max_age_seconds` | 180 | Older than this shows as unavailable. Longer than §4.3's 90s presenter freshness because nothing security-critical rests on it. |
| `proximity_location_retention_seconds` | 900 | Positions are deleted, not just hidden, once stale. |
| `proximity_approximate_grid_m` | 1000 | §8.5. Expect to tune. |
| `proximity_zone_min_radius_m` | 100 | Below this a zone gives the feeling of protection without the substance. |
| `proximity_zone_max_radius_m` | 5000 | Above this the feature is silently off. |
| `proximity_zone_exit_buffer_m` | 150 | Hysteresis so a zone edge cannot be traced by flicker. |
| `proximity_max_zones_per_user` | 10 | Headroom under iOS's 20-region cap. |
| `proximity_default_share_ttl_hours` | 8 | The recommended default time-box for a new grant. |

### 8.9 How this composes with what already exists

| Existing thing | How §8 uses it |
|---|---|
| `connections` | **The graph, reused directly.** `proximity_shares` FKs to it and §8.3 step 1 calls `private.are_connected`. No parallel graph concept is introduced, and removing a connection revokes proximity for free. |
| `blocks` | Checked in §8.3 step 2. |
| `private.*` helpers + a thin `public` wrapper | The same pattern as §3.1 and §3.6 observation (a), including the JWT-derived-viewer rule from `connections_attending`. |
| `meeting_locations`'s "sensitive table, no read policy, service-side only" shape | Reused wholesale for `live_locations`, for the same reason and with the same failure direction. |
| `app_config` | All thresholds are rows (§8.8), tunable without a deploy or an app-store review. |
| `connection_attempts` | Untouched. Proximity has its own audit concern (`proximity_share_events`) and the two must not be merged — one is a security log, the other is a user-facing transparency log. |
| `meetings` / `meeting_locations` / the feed | **Untouched, deliberately.** Nothing in §8 writes to them or reads from them. |
| §4's verification path | **Untouched, and must stay that way** — see §8.6 threat 8. |
| `user_push_tokens` (§4.5) | Reused if proximity ever notifies; no second token store. |

---

## 9. Open questions

Tracked here as they resolve — update this table in place rather than deleting rows, so the decision history stays visible. Rows keep their original numbers and their original order (resolved and open interleaved) for the same reason; new questions are appended with the next free number rather than slotted in beside related ones.

**2026-08-13 round.** Q16–Q24 were answered directly by the project owner and are recorded resolved below, each pointing at the section it amended. Q25 (geocoding provider) and Q26 (Friend Proximity sign-off) are new and deliberately open. **Q3, Q4, Q7, Q8, Q9 and Q10 were *not* answered by this round** and remain open — their rows now say so explicitly, and where this round changed their cost or urgency without answering them (Q7 moved onto the critical path; Q9 acquired a background-location dimension; Q4 became a hard prerequisite for §8) that is noted in the row rather than mistaken for a resolution. *(Q7 was subsequently resolved later on 2026-08-13, in the auth-bridge pass — its row records the outcome. This paragraph is left as written because it describes what that round did, and the tracker's whole convention is that history is not rewritten.)* Q5 is marked partially resolved, because the round settled where events come from without settling who may create one.

| # | Question | Status |
|---|---|---|
| Q1 | What is physically encoded on the 6,809 unassigned cards? (blocks `cards` schema — highest priority) | **Resolved 2026-08-09** — `https://smartcard.tech/card/<prefix>-<12-hex-char-suffix>`, confirmed by tapping a real card and cross-checked against all 7,142 rows in the production export. The suffix is a unique, auto-generated 48-bit random value; no re-encoding needed, full inventory usable as-is. See §2.2. Creates a new dependency: **Q15**, domain control for `smartcard.tech`. |
| Q15 | Do we control DNS/hosting for `smartcard.tech`? Does the new app deploy there directly, or does that domain just proxy `/card/*` + the universal-link files to wherever the new app lives? | **Resolved 2026-08-09** — yes, controlled, currently on Cloudflare DNS. `smartcard.tech` becomes the production domain for SmartCard 2.0 directly (not a separate proxy setup). DNS stays on Cloudflare — no registrar/nameserver transfer to Vercel needed; once the Vercel project exists (§7.1, created on first deploy), add `smartcard.tech` as a custom domain there and point Cloudflare's DNS record at it with the Cloudflare proxy ("orange cloud") turned **off** for that record — a proxied record can break Vercel's SSL issuance and domain verification. |
| Q2 | What's the pilot venue, and is it indoors? (drives starting GPS radius) | **Resolved 2026-08-09** — not known yet / varies by event. Defaulting to the recommended starting radius (150m), server-side config, tuned from `connection_attempts` rejection logs after the first pilot event. |
| Q3 | Do we still need `username`, given no global search? | Open — **not answered by the 2026-08-13 round**, despite being adjacent to it. Lands with the Profile build phase. |
| Q4 | Block/report in the pilot scope? | Open — **not answered by the 2026-08-13 round.** Note that §8 now depends on `blocks` existing and being enforced (§8.3 step 2), so Friend Proximity cannot ship without it; it is still optional for the pilot itself. |
| Q5 | Who can create events for the pilot — anyone, or hosts only? | **Partially resolved 2026-08-13** — the *source* is settled: events are created natively in SmartCard only, with no Luma/Eventbrite import (Q20). The *permission* half — whether any user or only designated hosts may create one — is still open, and §3.6's fail-closed reading stands until it lands: there is no INSERT policy or grant on `events` at all, so nobody can create one through the client path yet.<br /><br />**Fully resolved 2026-08-14 — any signed-in user may create an event**, as themselves, and it is built (`20260814051100`: one INSERT policy with `with check (host_user_id = private.current_user_id())`, one column-level grant, exactly as §3.6 predicted it would be). No host-approval-to-become-a-host step. The reasoning, because "open it up" deserves an argument rather than a shrug: creating an event grants the creator nothing over anybody else — it writes a row describing a place and a time, creates no edge, makes no profile readable, and offers no connect action, since connections still require an NFC tap or a GPS-verified scan. The blast radius of a spam event is that it appears in a city's browse list, which is a moderation problem with a moderation answer; the alternative is a whole approval surface (who approves, on what basis, with what appeal) that the pilot has no operator to staff. **What this does change, and it is named here rather than left implicit:** anyone can now create the *context* in which two `going` RSVPs make two strangers mutually readable via `shares_event_with()`. That was already reachable by RSVPing to somebody else's public event; what is new is not needing to find one. The branch itself is untouched, §3.6 still names it as the first thing to re-examine if events outgrow the pilot, and this pass narrowed it slightly by refusing new `going` RSVPs to events that have already ended. See the §2.6 "Completed (2026-08-14)" subsection.<br /><br />**Extended 2026-08-30 — `events.status` gains a third value, `draft`.** Owner request: a host should be able to save an in-progress event without it being live for anyone else. Same form, same required fields as publishing (`eventInsertSchema` is unchanged apart from the new field itself) — this is a visibility change, not a relaxed-validation one. `status` is client-settable at INSERT only (`draft` \| `scheduled`, via an ordinary column grant, the same shape `visibility` already has) and stays outside the UPDATE grant exactly as it always has been, so publishing goes through a dedicated RPC, `public.publish_event(uuid)`, not a PATCH. The one place this touched real security logic: `private.can_see_event`'s public branch read `status <> 'cancelled'`, which would have let any authenticated user read a `visibility = 'public'` draft the instant it was saved. Fixed by asking the branch's actual question — `status = 'scheduled'` — rather than adding a second exclusion; `import_event_attendees` and `list_own_import_links` had the identical gate and got the identical fix. Verified live in a rolled-back transaction across 14 scenarios (`20260830150000`), including that a public draft is invisible to a stranger but visible to its host, that publishing flips it and it becomes visible exactly like any other scheduled public event, and that a non-host cannot publish someone else's draft. |
| Q6 | How many of the 337 legacy users have a null/stale `kindeuserid`? | **Resolved 2026-08-09** — 0 of 337 users have a null or empty `kindeuserid`, and no duplicates exist. No manual reconciliation flow needed; every legacy user lands cleanly on their existing row via the Kinde join key. |
| Q7 | Confirm the Supabase JWT approach (§5.4) against current docs before building | **Resolved 2026-08-13 — Option A (token exchange) confirmed and built.** See the §5.4 amendment for the evidence. Short version: Third-Party Auth still takes only named providers (Clerk, Firebase, Auth0, Cognito, **WorkOS** — the list had grown, but by one name, not into a generic OIDC mechanism), and two facts about *our* data rule out a native integration regardless: `auth.uid()` casts `sub` to uuid while all 337 Kinde subs are `kp_<32 hex>` (a raw Kinde token makes policies **raise 22P02**, not deny), and Kinde tokens carry no `role: authenticated` claim so the caller would land on `anon`, which holds no grant anywhere. Supabase's generic **Custom OAuth/OIDC Providers** feature does accept Kinde but solves a different problem — it mints `auth.users` rows, so `auth.uid()` would still not be `public.users.id`. **No RLS policy, helper or schema change was needed.** One real change: the shared JWT secret is now documented as backward-compatibility only, so the HS256 mint is a knowingly-legacy choice with a one-file migration path recorded in the amendment. Unblocks §6.6's last line, **which has now been run and passes** (see the §6.6 outcome). |
| Q8 | Is "presenter must keep the app open" acceptable UX (heartbeat requirement)? | Open — **not answered by the 2026-08-13 round**, but its cost is now lower: automatic radius relaxation (§4.3) removes the worst version of the failure, where a genuine pair simply cannot connect. Still a pilot observation, not a decision anyone can make from a desk. |
| Q9 | App Store review risk — need a documented demo/reviewer test path? | Open — **not answered by the 2026-08-13 round, and its scope grew.** §8.7 adds a second review hazard: Google Play requires a written justification and a demo video for background location access, and iOS's "Always" location permission draws its own scrutiny. Whenever this is tackled, cover NFC, camera, location, *and* background location together. |
| Q10 | Contacts import: hash retention window, user delete control? | Open — **not answered by the 2026-08-13 round.** Unchanged; lands with whatever phase builds contacts import. |
| Q11 | Rate limiting backend — Upstash Redis vs. a Postgres table? | **Resolved 2026-08-09** — Postgres table. Zero extra cost/service at pilot scale; the check is a small, swappable piece if Upstash is needed later. |
| Q12 | Is the Vercel `front-end-playground` project disposable? | **Resolved 2026-08-09** — yes, disposable leftover from earlier experimentation. Left untouched; a fresh `smartcard-web` project is created alongside it, nothing built in this repo depends on it. |
| Q13 | Supabase plan/region/backups — Free vs. Pro with PITR? | **Resolved 2026-08-09** — start on Free while building with no real user data at stake; upgrade to Pro (backups, no auto-pause) before the production data migration / pilot go-live, so real data is never without a backup. |
| Q14 | Recurring events — one `events` row per occurrence (recommended), or a recurrence concept? | **Resolved 2026-08-14 — one `events` row per occurrence**, confirming this section's own original recommendation, and recurrence is explicitly **out of scope** for the Events build rather than merely unbuilt. There is no `recurrence_rule`, no parent/child link and no series concept anywhere in `20260814051000`. Recorded as a decision because the cost of the alternative is not a column: a recurrence concept touches capacity (is the cap per occurrence or per series?), RSVP identity ("am I going to this Tuesday, or every Tuesday?"), waitlist ordering across occurrences, and — the one that makes it an architecture question rather than a feature — `shares_event_with()`, since "we are both going to the same event" would need to mean the same occurrence, not the same series. That is a design pass of its own. A host who runs a weekly thing creates a row per week, which at pilot scale is a copy button, not a problem. See the §2.6 "Completed (2026-08-14)" subsection. |
| Q16 | Which Supabase org does the project live in? | **Resolved 2026-08-13** — confirmed staying in the dedicated `SmartCard.2.0` org (`xanznwmpptzuqffacexq`), project `crpsbnbegeoqtlgshltt`. No change; recorded so the question is closed rather than assumed. See §6.1. |
| Q17 | Does a card tap connect instantly, or does the card owner confirm it first? | **Resolved 2026-08-13** — **instantly**, matching existing card behaviour, with **a push notification to the card owner the moment it commits** ("X just tapped your card"), deep-linked to revoke-card and remove-connection. The notification is the compensating control for having no confirmation step: it shortens time-to-detection for a lost or stolen card from weeks to seconds. Notification failure never blocks or reverses the connection. See the §4.5 amendment and §4.7 threat 7. Implies `user_push_tokens` (sketched, not built) and Q24. |
| Q18 | Is there any fallback when two people who really are together keep failing the GPS proximity check? | **Resolved 2026-08-13** — **automatic, server-controlled radius relaxation.** After 2 distance/accuracy rejections by the same presenter+scanner pair within 10 minutes, that pair's next attempt is evaluated at 500m / 150m accuracy instead of 150m / 100m. No human override, no host approval, no manual step, and the client is never told. It does not escalate beyond that one rung and cools down for an hour after use. New `app_config` keys in §2.5 amendment (a); mechanism and reasoning in the §4.3 amendment; attacker analysis as §4.7 threat 6. |
| Q19 | How does `meeting_locations.place_label` get a value? | **Resolved 2026-08-13** — **automatic server-side reverse geocoding** of the GPS fix already captured for the proximity check. No user step, no client-supplied label. Runs after the connection commits so a slow geocoding vendor can never fail a connection; a failed geocode leaves the label null. Residential coordinates are generalised to neighbourhood + city rather than stored as a street address (judgment call). See the §2.4 amendment. Spawns Q25. |
| Q20 | Are pilot events created in SmartCard, or imported from Luma/Eventbrite? | **Resolved 2026-08-13** — **native creation only** for the pilot; no external import. Not merely a scope cut: `event_rsvps` is an input to `private.shares_event_with()`, which is a branch of the `users` read policy, so importing an external guest list would insert people who never made a SmartCard choice into the rules deciding who can read whose profile. See the §2.6 amendment. |
| Q21 | Should the "you know X going" hook combine going and interested into one number? | **Resolved 2026-08-13** — **two separately-labelled counts**, "3 going, 2 interested", over the viewer's own connections. Combining them would overstate attendance and make the hook untrustworthy. **This changes only the display hook** (`private.connections_attending`, which no RLS policy references). It explicitly does **not** change `private.shares_event_with()`, which still requires `going` on both sides per §3.6 — widening that would make two strangers who each tapped "interested" mutually readable profiles. See the §2.6 amendment. |
| Q22 | How big is the pilot? | **Resolved-as-a-default 2026-08-13** — **not confirmed**; size conservatively for **medium-to-large**, i.e. do not assume the everyone-in-one-room case. Real numbers tune `app_config` after the first event, the same treatment §4.4 already gives the GPS radius. Two places where this changes an answer rather than a number: **(a)** the per-IP rate limit (§4.6) must not be the binding constraint at a venue, since hundreds of attendees share one NAT IP on venue wifi — keep it generous and rely on per-user and per-session limits; **(b)** `shares_event_with()` scales worst of anything in the schema, so **if a single pilot event passes roughly 150 `going` RSVPs, re-examine that policy branch before the event, not after** — §3.6 already flags it as the first thing to revisit when events outgrow the pilot. |
| Q23 | Is the legacy data migration full or partial, and when? | **Resolved 2026-08-13** — **full import of users, cards, social_links and photos, in one pass, before the pilot.** Confirmed as the immediate next step, not deferred. A partial `cards` import is a correctness hazard, not just an incomplete one: a legacy-assigned card missing from the new database either rejects a legitimate tap or looks like free stock and gets reassigned to somebody else. A partial `users` import races §5.3's auto-create and produces duplicate identities. See the §6.1 amendment; makes Q13's Pro upgrade and Q7 prerequisites. |
| Q24 | What push notification infrastructure? | **Resolved 2026-08-13** — **Expo's push service** (`expo-notifications` + Expo's push API), routing to APNs and FCM through one endpoint, rather than native per-platform integration. One integration instead of two for a notification surface that is currently one message. Requires an APNs key and FCM credentials uploaded to Expo, `EXPO_ACCESS_TOKEN` 🔒 server-side, `EXPO_PUBLIC_PROJECT_ID` in the app, and the EAS dev build already required for NFC. **Constrains payload content**: notifications transit a third party and render on lock screens, so they carry a name and an event description and nothing sensitive — never coordinates, tokens, or anything from `meeting_locations` or §8. See §7.5. |
| Q25 | Which reverse-geocoding provider — Google Maps Geocoding, Mapbox, or OSM Nominatim? | **Resolved 2026-08-14 — Mapbox.** Checked the storage terms of each candidate first, per this row's own instruction, since the design retains `place_label` rather than displaying and discarding it: **Google's** Geocoding API terms permit indefinite storage of `place_id` only — not the formatted result — so storing `place_label` as designed would not be compliant without extra machinery. **OSM Nominatim's** usage policy doesn't address storage either way, and its public instance expects self-hosting past casual volume, which is a heavier operational commitment than this pilot needs to take on for one feature. **Mapbox** has an explicit `permanent=true` storage tier built for exactly this case — the only one of the three with a documented, compliant path to what §2.4 already committed to. Built as `apps/web/src/server/connect/geocode.ts`: reverse-geocodes the QR path's captured fix (the NFC path never has one) in one Mapbox call requesting `poi,neighborhood,place`, storing a POI/venue name when one is returned near the exact fix and falling back to `"neighborhood, city"` otherwise — never a street address, since `types` never includes `address` in the first place. Runs after `create_verified_connection` commits, awaited but never able to fail the redeem response, same contract as the card-tap notification in `push.ts`. `GEOCODING_API_KEY` is optional, exactly like `EXPO_ACCESS_TOKEN` — unset means every meeting simply keeps `place_label: null`, per §2.4's "a missing label is a cosmetic loss, not a security one." §8's approximate-mode area names are not wired to this yet; the same Mapbox key can serve that when §8 is built (still gated on Q26's sign-off). **Amended 2026-08-15 — two parts of this resolution do not hold as built.** Found while investigating a report that a connection "didn't confirm the location"; both need a decision from whoever holds the Mapbox account rather than a code change made blind, so both are flagged in `geocode.ts` and left as-is for now. (a) *The storage-rights argument that picked Mapbox is not actually being exercised.* `permanent=true` is a **Geocoding v6** parameter; this code calls **v5** (`/geocoding/v5/mapbox.places/…`), where permanent storage is a separate endpoint (`mapbox.places-permanent`) and that parameter is not part of the vocabulary. So `place_label` is being retained from results very likely obtained under Mapbox's *temporary* terms — precisely the compliance problem this row rejected Google over. Fixing it means either the v6 reverse endpoint (where `permanent=true` is real, and which needs `chooseLabel` rewritten for v6's `properties.feature_type` / `properties.name` response shape) or `mapbox.places-permanent` on v5 (which requires the account to have permanent geocoding enabled). It is also a candidate explanation for no label ever arriving, if Mapbox rejects the unrecognised parameter rather than ignoring it. (b) *The venue-name half of this rule is unreachable.* Mapbox has removed POI data from Geocoding v5 **and** v6, directing POI lookups to the Search Box API, so `types=poi` returns nothing and every label that does arrive is the `"neighborhood, city"` fallback. The code degrades correctly and needs no change for that, but "store a POI/venue name when the provider returns one" is a promise this API can no longer keep; honouring it means adding a second Mapbox product, not a parameter. Separately, and fixed in the same pass: the request sent `limit=1`, which caps the response at one feature *in total* and so contradicted the one-call-three-types design this row describes — removed, since Mapbox's default reverse behaviour is already one feature per requested type. |
| Q26 | Friend Proximity (§8) — sign-off on the design, before any schema work | **Open — this is the ask.** §8 is a design-only proposal at the same effort tier as §4. The parts most worth a second opinion because they are judgment calls rather than requirements: the two-directed-row shape of `proximity_shares` (§8.2), hiding protected zones completely rather than labelling or coarsening them (§8.4), the deterministic ~1km grid for approximate mode (§8.5), no location history at all (§8.2), and time-boxed grants by default (§8.2). Nothing is built; nothing should be until this is signed off. |
| Q28 | The in-app "tapped your card" surface — the non-push half of threat 7's detection control — is not built | **Resolved 2026-08-14 — built as a new Activity page** (`apps/web/src/app/(app)/activity/`, `apps/web/src/server/activity/activity-service.ts`). Lists every tap of the caller's own card(s), newest first, sourced from `connection_sessions` (the same table the push notification's coalescing count already reads — no second source of truth), each with an inline "remove connection" action; a separate "your cards" section lists the caller's assigned cards with an inline "revoke" action. Both actions require a second explicit click, matching the connections feature's existing confirm pattern.<br /><br />**Correction to this row's own premise, found while building it: "the same inline revoke-card... actions" did not already exist.** The RLS policy and grant for revoking a card (`20260809211100`, "owners may revoke or restore their own card") have existed since the legacy migration, but no Server Action, service function, or UI anywhere in the app ever called it — checked exhaustively (`grep -ri revok` across the repo) before assuming otherwise. `apps/web/src/server/cards/cards-service.ts` is new, built from scratch against the existing policy, exposing only the revoke half (not restore, which the policy also permits but nothing asked for) — scope kept to what Q28 actually needed. `remove-connection`, by contrast, already existed and is reused as designed (`removeConnection` in `connections-service.ts`), just called from a new local action so removing a connection here refreshes the Activity list in place rather than redirecting to `/connections`. |
| Q29 | The §4.6 contacts-import rate limit has no number and no call site | Open. `rate_limit_events` takes it without a migration (that is why the table is generic), but the limit does not exist until contacts import is built. Flagged so that phase does not ship without one — §4.6 lists it, and an endpoint that hashes and matches address books is not a good candidate for the one unlimited endpoint in the product. |
| Q30 | Should the scanner's location freshness get its own `app_config` key? | Open, low priority. The Connect Flow build applies `presenter_location_max_age_seconds` (90s) to both sides, because §4.3 gives a number only for the presenter and §2.5's table has no second key — inventing one would have been a silent deviation and would have put a security number where no operator could tune it. 90s is generous for a fix captured at the moment of the scan, so **tightening the scanner side is the first knob to reach for** if pilot data shows relays getting through on stale scanner fixes; that is the moment to add the key. See the §4.3 amendment. |
| Q27 | The Supabase JWT secret used to sign the per-request access token (§5.4) is a *previous*, deprecated key, not the project's current one | **Diagnosed 2026-08-13.** Confirmed 2026-08-13 in the Supabase dashboard (Project Settings → JWT Keys): this project's *current* signing key is an asymmetric ECC (P-256) JWT Signing Key; the HS256 shared secret this app signs with is listed as the *previous* key, rotated out 4 days prior to this check, and is "still used to verify tokens that are yet to expire" — Supabase's own wording for a key on the way out, not a stable long-term credential. It works today (verified directly against the live database with the real secret — see §5.4/§6.6), but it can be revoked at any time, at which point every newly-minted token fails to verify and the app goes down for every user simultaneously, not gracefully. **Needed:** migrate `mintSupabaseAccessToken` (`apps/web/src/server/auth/supabase-token.ts`) off the shared secret and onto the project's current asymmetric signing key — either by importing a signing key we control into Supabase's JWT Signing Keys as the trusted key, or by using whatever mechanism Supabase's current docs describe for a custom token issuer to sign with an asymmetric key Supabase already trusts. This is real work, not a config toggle — treat it as a follow-up pass, not a footnote, and do it before relying on this in front of real pilot users.<br /><br />**Answered 2026-08-13, built, and now blocked on one manual dashboard step — not fully closed until that step is done.** See the second §5.4 amendment for the evidence. The question it turned on has a definite documented answer, and it is two-sided: the project's *current* ECC key **cannot** be used by us ("Once you've moved to using the JWT signing keys feature extracting of the private key or shared secret from Supabase is not possible" — only Supabase Auth can sign with it), **but** importing a key we control is the documented, first-class mechanism for an app that mints its own tokens ("you can create a new JWT signing key by importing a private key… Once imported, click **Rotate key**"). Supabase's **Custom Access Token hook is a dead end here** and was checked rather than assumed: it decorates a token Supabase Auth is already issuing, and `auth.users` holds **0 rows** against `public.users`' 337 — Kinde is the sole IDP, so there is no issuance for it to hook. Third-Party Auth is still a named-provider list (Clerk, Firebase, Auth0, Cognito, WorkOS) and still excludes Kinde. **Built:** `mintSupabaseAccessToken` now signs **ES256** with a P-256 key generated by `supabase gen signing-key`, carrying its `kid`; a malformed key throws rather than falling back to the deprecated secret; every property of the old token is preserved and now tested (5-minute life, `sub` = `public.users.id`, `role: authenticated`, per-request, never stored, server-only), and a real token's claims were verified against the live database as a real migrated user with the same numbers as the original bridge check. **Remaining, and it is a person's job, not a code change:** import the generated private JWK as a standby key, wait ~20 minutes, **Rotate keys**, then uncomment `SUPABASE_JWT_SIGNING_KEY` — the JSON and the ordering are in `.env.local`. Until then the app still signs with the legacy secret and warns loudly at every process start. **Do not revoke the legacy secret as part of this**: `SUPABASE_SERVICE_ROLE_KEY` is itself a legacy JWT signed with it, so that revocation is gated on swapping it for an `sb_secret_…` key (spawns **Q31**). |
| Q31 | `SUPABASE_SERVICE_ROLE_KEY` is still a legacy JWT-based key, which keeps the deprecated JWT secret un-revokable | Spawned by the Q27 fix. The signing migration removes our *dependence* on the legacy shared secret, but the secret cannot actually be revoked while the service-role key exists in its current form: `anon` and `service_role` "are not just API keys, but are also valid JSON Web Tokens, signed by the legacy JWT secret", so revoking the secret disables them — and `ensureUser()` (§5.3, the one service-role call path in the app) would stop working. The fix Supabase gives is a straight swap: create a new secret key (`sb_secret_…`) in **Settings → API Keys** and put it in `SUPABASE_SERVICE_ROLE_KEY`, which "prevents downtime for your application". The publishable half was already migrated (`sb_publishable_…`) before this was opened.<br /><br />**Resolved 2026-08-14.** The service-role key was swapped: a new `sb_secret_…` key was created and put in `SUPABASE_SERVICE_ROLE_KEY` (`.env.local` and Vercel), production was redeployed, and only then was the swap trusted — verified by a real sign-in producing a clean `ensureUser()` call (`/api/auth/kinde_callback` → `/`, `/profile`, `/feed`, `/connect`, `/connections` all 200, zero runtime errors) against the new key alone, nothing else moved first. With that confirmed, the legacy `anon`/`service_role` JWTs were disabled in Settings → API Keys (confirmed independently: the legacy `anon` key now reports `disabled: true` via the Supabase API) and the deprecated JWT secret was revoked in Project Settings → JWT Keys — in that order, which is the order Supabase's own docs require. No code changed: `supabaseServiceRoleKey()` (`env.ts`) already read the variable as an opaque string with no format check. The revoked state of the secret itself has no API surface to check independently; everything else above was confirmed directly, not taken on report. |

---

## 10. The security posture, in one paragraph

Every connection in SmartCard requires either a physical card tap (proximity proven by NFC's few-centimetre range) or a QR scan where both phones independently report their location and our server — not either phone — computes whether they are actually near each other. QR codes rotate every 30 seconds, expire in 45, contain no personal data, and die permanently the instant anyone scans them. If location is unavailable, denied, stale, or imprecise, we refuse the connection rather than guess. The database itself is configured so that it cannot answer "list all users" — no-global-search is enforced by Postgres, not by us choosing not to build a search box. Meeting locations live in a separate table behind their own lock, so a coding mistake results in missing location data rather than leaked location data. The two attacks consciously accepted are two real people choosing to collude, and someone combining GPS spoofing with a live video relay — both require substantially more effort than the value of a single fraudulent connection in a private network with no strangers to defraud.

**Added 2026-08-13, on the two features designed since.** A card tap still connects instantly, because that is what a physical card is for — but its owner is now told the instant it happens, which is what turns the existing revoke button into a real defence against a stolen card rather than a button nobody knows to press. When two people who genuinely are standing together cannot convince their phones of it, the server, never the client, may widen the radius once for that pair — a rung, not a ladder, and it cools down. And Friend Proximity (§8), which is designed but not built, inverts the usual shape of a location feature: it never asks "who is near this point", only "where are the specific people I have met in person and mutually, deliberately agreed to share with" — each side owning its own revocation, granularity chosen by the person being seen, protected places hidden so completely that being at home is indistinguishable from a dead battery, and no history of anyone's movements kept at all. The residual risk it cannot engineer away is the one worth naming out loud: someone who chooses to share their exact location with a person who abuses it. Against that, the design makes the safe state the default, makes turning it off instant, unilateral, and unannounced, and never makes anyone explain why they did.
