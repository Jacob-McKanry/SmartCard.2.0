# SmartCard 2.0 — Technical Architecture Proposal

**Status (updated 2026-08-13, Connect Flow pass):** §4 — the connection-verification layer, the most security-critical part of the product — **is now built on web** and its four new migrations are applied (`supabase/migrations/`, 24 files). Each subsection of §4 carries a "built" amendment recording the decisions the design left open; §2.5's amendment is applied and extended with the rate-limiting mechanism §4.6 needed. The threat model in §4.7 is now an automated Vitest suite (193 tests) that attempts each attack, and the suite was verified capable of failing before being called done. Not built in this pass, on purpose: the QR-display and camera-scan screens on either platform, mobile Kinde auth, push-token registration, and the reverse-geocoding job that would fill `place_label` (blocked on Q25).

**Status (updated 2026-08-13):** Schema and RLS for the tables in §2/§3 are implemented and applied to the live Supabase project (`supabase/migrations/`, originally 15 files) — do not redesign what is already built. §1.4 (no shared UI components between web/mobile) confirmed 2026-08-09. Q1, Q2, Q6, Q11, Q12, Q13, Q15 resolved 2026-08-09; Q16–Q24 recorded resolved 2026-08-13 (see §9). **Q7 resolved 2026-08-13** and the §5 auth bridge is built on web (§5.4 amendment); the last outstanding line of §6.6 has been run and passes. **Profile (README build order item 1) is built on web, also 2026-08-13** (§6.5 amendment below) — the `profile-photos` bucket now has its first real Storage RLS policy, and `/auth-check` is retired now that `/profile` exercises the same auth-bridge chain on every real load.

This revision adds **§8, the Friend Proximity design (Phase 3, post-pilot)** — designed now, deliberately, because it is the highest-sensitivity feature in the product and its constraints need to be settled while they can still shape the schema rather than fight it. Nothing in §8 is built or applied.

**The legacy data migration (§6) ran on 2026-08-13** — users, cards, social_links and the `contactexchange` archive are loaded and checksum-verified; photos alone are deferred to a follow-up pass (see the §6.5 deviation).

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
| 2 | Database schema | **Implemented and applied.** §2.4/§2.5/§2.6 amended 2026-08-13 (design notes only — no new migration) |
| 3 | Row Level Security strategy | **Implemented and applied.** §3.6 records the judgment calls made while building it |
| 4 | Connection verification design | **Built on web 2026-08-13** (`packages/core/src/connect/`, `apps/web/src/app/api/connect/`, `apps/web/src/server/connect/`). §4.1–§4.7 each carry a "built" amendment recording what was decided along the way. No QR-display or camera-scan UI on either platform yet — this pass is the verification logic and the API surface |
| 5 | Auth flow | **Built on web** (§5.1/§5.3/§5.4); mobile (§5.2) not started. §5.4 amended 2026-08-13 with Q7's answer |
| 6 | Migration plan | **Complete.** Amended 2026-08-13; §6.6's last deferred check now run and passing. §6.5 amended again 2026-08-13 — Profile's Storage RLS policy for `profile-photos` |
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

**Provider choice is deferred, on purpose (Q25, open).** Google Maps Geocoding, Mapbox, and OpenStreetMap Nominatim all satisfy the architecture; none of them changes any table, policy, or data flow above. Picking one now would be a decision made with less information than the person building Connect Flow will have. The criteria that actually matter when it is picked:

- **Terms of service on *storing* results.** This is the architecturally relevant one, because we retain the label in our own database rather than displaying it and discarding it. Provider terms differ materially on retention and caching, and one of them prohibiting what we do here would be a genuine constraint — check it first, not last.
- POI coverage quality in dense US urban areas (the pilot is NYC), since a provider that returns street addresses where a venue exists defeats the point.
- Rate limits and cost at pilot volume (low — one call per QR connection, not per request).
- **Whether the same provider can also serve §8's approximate-mode area names.** Friend Proximity needs coarse area labels from coordinates too. Choosing a provider that covers both avoids a second vendor, a second key, and a second set of terms to audit.

One environment variable is implied and added to §7.4: `GEOCODING_API_KEY` 🔒, server-side only, name to be finalised with the provider.

**`meeting_participants`** — `meeting_id` + `user_id` (composite PK), `location_share_consent` (boolean, default false), `marked_private` (boolean, default false).

Rules: mutuals see location only if **every** participant has consented; any participant marking a meeting private hides it from everyone but the two of them; consent defaults to false.

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

### 2.7 Contacts import

**`contact_import_matches`** — 🔒 `id` (PK), `owner_user_id` (FK), `matched_user_id` (FK, nullable), `contact_hash` (🔒 hashed phone/email), `display_name_snapshot` (🔒), `matched_at`, `dismissed_at`. `UNIQUE (owner_user_id, contact_hash)`. Salted hashes only, never raw contacts — a database breach doesn't hand an attacker anyone's address book. This table has no code path to `connections`.

### 2.8 Deferred: pending connections (schema slot only)

**`pending_connections`** — designed now, built later. `id` (PK), `initiator_user_id` (FK), `session_id` (FK → connection_sessions), `contact_name`, `contact_email` 🔒, `contact_phone` 🔒, `place_label` 🔒, `latitude`/`longitude` 🔒, `occurred_at`, `claimed_by_user_id` (FK, nullable), `claimed_at`, `status`. Hangs off `connection_sessions` — the same table QR/NFC already use — so the non-user flow slots in later without touching connection or graph tables.

### 2.9 Feed

No feed table for the pilot. Both post types ("You met X" / "A met B") derive on read from `meetings` + `meeting_participants` + `connections` — simpler and always consistent at ~337 users, and avoids fan-out bugs when a meeting's visibility changes. Indexes needed: `connections(user_a_id)`, `connections(user_b_id)`, `meeting_participants(user_id)`, `meetings(occurred_at desc)`.

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
| 7 — lost or stolen card | `threats.test.ts` | A revoked card is refused; unassigned and unknown codes are refused; a blocked tapper is refused (so the notification cannot be a channel to someone who blocked you); self-tap is refused; the per-card hourly limit bites; a client-asserted owner is refused by the schema; the two legacy bare-hex codes from §6.3 still parse |

Plus §4.3's fail-closed table end to end (every row rejects), §4.2 step 7 as a rule rather than as copy, and `parseVerificationConfig` refusing a missing or malformed threshold rather than defaulting.

**The suite was verified capable of failing.** The distance comparison in `evaluateGpsGate` was temporarily replaced with a no-op; 11 tests went red, including all three threat-2 tests and five of the threat-6 bounds. The change was then reverted and the suite is green. A test that cannot fail proves nothing, and this one was checked rather than assumed.

**What the suite does not prove, stated plainly.** The verifiers, the gate, the relaxation logic, the token code and `createVerifiedConnection` are all exercised as production code, but the `ConnectStore` behind them is an in-memory fake — because this environment's egress policy blocks the project's Supabase host (the same restriction recorded against the §6.5 photo upload and the §6.6 spot-check), and because hostile world-states have to be cheap to construct or they do not get constructed. So the suite says nothing about whether Postgres enforces its half: that RLS refuses a direct client insert, that the function is atomic, that the compare-and-swap is a compare-and-swap. **Those were checked directly against the live database instead** — the RLS refusals above, plus a rolled-back end-to-end exercise of `create_verified_connection` confirming 1 connection / 2 participants / 1 location on the happy path and correct refusals for replay, self-connect, consumed session, expired session, presenter mismatch and block. Neither kind of check substitutes for the other, and the gap that remains is the same one §6.6 named: signature verification and HTTP transport, both Supabase's code, neither able to change which rows a policy returns.

---

## 5. Auth flow

### 5.1 Web (Next.js) — confidential client

Uses `SmartCard Web` (has a client secret). Standard authorization-code flow: redirect to Kinde → callback with a code → **server-side** exchange for tokens → stored in encrypted `HttpOnly` cookies, never touched by browser JavaScript (so an XSS bug can't steal the session). Handled by `@kinde-oss/kinde-auth-nextjs`.

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
| `GEOCODING_API_KEY` 🔒 | Next.js / Vercel, server-side | Reverse geocoding for `meeting_locations.place_label` (§2.4 amendment) and later §8's approximate-mode area names. Exact name depends on the provider chosen (Q25). Server-side by necessity — §2.4 explains why the geocode must not happen on a phone. |
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
| Q5 | Who can create events for the pilot — anyone, or hosts only? | **Partially resolved 2026-08-13** — the *source* is settled: events are created natively in SmartCard only, with no Luma/Eventbrite import (Q20). The *permission* half — whether any user or only designated hosts may create one — is still open, and §3.6's fail-closed reading stands until it lands: there is no INSERT policy or grant on `events` at all, so nobody can create one through the client path yet. |
| Q6 | How many of the 337 legacy users have a null/stale `kindeuserid`? | **Resolved 2026-08-09** — 0 of 337 users have a null or empty `kindeuserid`, and no duplicates exist. No manual reconciliation flow needed; every legacy user lands cleanly on their existing row via the Kinde join key. |
| Q7 | Confirm the Supabase JWT approach (§5.4) against current docs before building | **Resolved 2026-08-13 — Option A (token exchange) confirmed and built.** See the §5.4 amendment for the evidence. Short version: Third-Party Auth still takes only named providers (Clerk, Firebase, Auth0, Cognito, **WorkOS** — the list had grown, but by one name, not into a generic OIDC mechanism), and two facts about *our* data rule out a native integration regardless: `auth.uid()` casts `sub` to uuid while all 337 Kinde subs are `kp_<32 hex>` (a raw Kinde token makes policies **raise 22P02**, not deny), and Kinde tokens carry no `role: authenticated` claim so the caller would land on `anon`, which holds no grant anywhere. Supabase's generic **Custom OAuth/OIDC Providers** feature does accept Kinde but solves a different problem — it mints `auth.users` rows, so `auth.uid()` would still not be `public.users.id`. **No RLS policy, helper or schema change was needed.** One real change: the shared JWT secret is now documented as backward-compatibility only, so the HS256 mint is a knowingly-legacy choice with a one-file migration path recorded in the amendment. Unblocks §6.6's last line, **which has now been run and passes** (see the §6.6 outcome). |
| Q8 | Is "presenter must keep the app open" acceptable UX (heartbeat requirement)? | Open — **not answered by the 2026-08-13 round**, but its cost is now lower: automatic radius relaxation (§4.3) removes the worst version of the failure, where a genuine pair simply cannot connect. Still a pilot observation, not a decision anyone can make from a desk. |
| Q9 | App Store review risk — need a documented demo/reviewer test path? | Open — **not answered by the 2026-08-13 round, and its scope grew.** §8.7 adds a second review hazard: Google Play requires a written justification and a demo video for background location access, and iOS's "Always" location permission draws its own scrutiny. Whenever this is tackled, cover NFC, camera, location, *and* background location together. |
| Q10 | Contacts import: hash retention window, user delete control? | Open — **not answered by the 2026-08-13 round.** Unchanged; lands with whatever phase builds contacts import. |
| Q11 | Rate limiting backend — Upstash Redis vs. a Postgres table? | **Resolved 2026-08-09** — Postgres table. Zero extra cost/service at pilot scale; the check is a small, swappable piece if Upstash is needed later. |
| Q12 | Is the Vercel `front-end-playground` project disposable? | **Resolved 2026-08-09** — yes, disposable leftover from earlier experimentation. Left untouched; a fresh `smartcard-web` project is created alongside it, nothing built in this repo depends on it. |
| Q13 | Supabase plan/region/backups — Free vs. Pro with PITR? | **Resolved 2026-08-09** — start on Free while building with no real user data at stake; upgrade to Pro (backups, no auto-pause) before the production data migration / pilot go-live, so real data is never without a backup. |
| Q14 | Recurring events — one `events` row per occurrence (recommended), or a recurrence concept? | Open |
| Q16 | Which Supabase org does the project live in? | **Resolved 2026-08-13** — confirmed staying in the dedicated `SmartCard.2.0` org (`xanznwmpptzuqffacexq`), project `crpsbnbegeoqtlgshltt`. No change; recorded so the question is closed rather than assumed. See §6.1. |
| Q17 | Does a card tap connect instantly, or does the card owner confirm it first? | **Resolved 2026-08-13** — **instantly**, matching existing card behaviour, with **a push notification to the card owner the moment it commits** ("X just tapped your card"), deep-linked to revoke-card and remove-connection. The notification is the compensating control for having no confirmation step: it shortens time-to-detection for a lost or stolen card from weeks to seconds. Notification failure never blocks or reverses the connection. See the §4.5 amendment and §4.7 threat 7. Implies `user_push_tokens` (sketched, not built) and Q24. |
| Q18 | Is there any fallback when two people who really are together keep failing the GPS proximity check? | **Resolved 2026-08-13** — **automatic, server-controlled radius relaxation.** After 2 distance/accuracy rejections by the same presenter+scanner pair within 10 minutes, that pair's next attempt is evaluated at 500m / 150m accuracy instead of 150m / 100m. No human override, no host approval, no manual step, and the client is never told. It does not escalate beyond that one rung and cools down for an hour after use. New `app_config` keys in §2.5 amendment (a); mechanism and reasoning in the §4.3 amendment; attacker analysis as §4.7 threat 6. |
| Q19 | How does `meeting_locations.place_label` get a value? | **Resolved 2026-08-13** — **automatic server-side reverse geocoding** of the GPS fix already captured for the proximity check. No user step, no client-supplied label. Runs after the connection commits so a slow geocoding vendor can never fail a connection; a failed geocode leaves the label null. Residential coordinates are generalised to neighbourhood + city rather than stored as a street address (judgment call). See the §2.4 amendment. Spawns Q25. |
| Q20 | Are pilot events created in SmartCard, or imported from Luma/Eventbrite? | **Resolved 2026-08-13** — **native creation only** for the pilot; no external import. Not merely a scope cut: `event_rsvps` is an input to `private.shares_event_with()`, which is a branch of the `users` read policy, so importing an external guest list would insert people who never made a SmartCard choice into the rules deciding who can read whose profile. See the §2.6 amendment. |
| Q21 | Should the "you know X going" hook combine going and interested into one number? | **Resolved 2026-08-13** — **two separately-labelled counts**, "3 going, 2 interested", over the viewer's own connections. Combining them would overstate attendance and make the hook untrustworthy. **This changes only the display hook** (`private.connections_attending`, which no RLS policy references). It explicitly does **not** change `private.shares_event_with()`, which still requires `going` on both sides per §3.6 — widening that would make two strangers who each tapped "interested" mutually readable profiles. See the §2.6 amendment. |
| Q22 | How big is the pilot? | **Resolved-as-a-default 2026-08-13** — **not confirmed**; size conservatively for **medium-to-large**, i.e. do not assume the everyone-in-one-room case. Real numbers tune `app_config` after the first event, the same treatment §4.4 already gives the GPS radius. Two places where this changes an answer rather than a number: **(a)** the per-IP rate limit (§4.6) must not be the binding constraint at a venue, since hundreds of attendees share one NAT IP on venue wifi — keep it generous and rely on per-user and per-session limits; **(b)** `shares_event_with()` scales worst of anything in the schema, so **if a single pilot event passes roughly 150 `going` RSVPs, re-examine that policy branch before the event, not after** — §3.6 already flags it as the first thing to revisit when events outgrow the pilot. |
| Q23 | Is the legacy data migration full or partial, and when? | **Resolved 2026-08-13** — **full import of users, cards, social_links and photos, in one pass, before the pilot.** Confirmed as the immediate next step, not deferred. A partial `cards` import is a correctness hazard, not just an incomplete one: a legacy-assigned card missing from the new database either rejects a legitimate tap or looks like free stock and gets reassigned to somebody else. A partial `users` import races §5.3's auto-create and produces duplicate identities. See the §6.1 amendment; makes Q13's Pro upgrade and Q7 prerequisites. |
| Q24 | What push notification infrastructure? | **Resolved 2026-08-13** — **Expo's push service** (`expo-notifications` + Expo's push API), routing to APNs and FCM through one endpoint, rather than native per-platform integration. One integration instead of two for a notification surface that is currently one message. Requires an APNs key and FCM credentials uploaded to Expo, `EXPO_ACCESS_TOKEN` 🔒 server-side, `EXPO_PUBLIC_PROJECT_ID` in the app, and the EAS dev build already required for NFC. **Constrains payload content**: notifications transit a third party and render on lock screens, so they carry a name and an event description and nothing sensitive — never coordinates, tokens, or anything from `meeting_locations` or §8. See §7.5. |
| Q25 | Which reverse-geocoding provider — Google Maps Geocoding, Mapbox, or OSM Nominatim? | **Still open after the Connect Flow build, and now blocking a feature rather than only a decision.** The QR path stores `meeting_locations` rows with `place_label` **null**, because the follow-up geocoding job §2.4's amendment describes was not built — it needs a provider, and picking one needs the terms-of-service check §2.4 says to do first. Nothing is broken by this: §2.4 already states that a failed geocode leaves the label null and the meeting is simply shown without a place name, which is the one place in the connection path where degrading rather than failing closed is correct. **Open, deliberately — implementation-phase choice, not an architecture blocker.** None of the three changes any table, policy, or data flow. Decide when Connect Flow is built, on: **terms of service around *storing* geocoded results** (the architecturally relevant one, since we retain the label rather than displaying and discarding it — check this first); POI coverage quality in dense US urban areas; rate limits and cost at pilot volume; and **whether the same provider can also serve §8's approximate-mode area names**, so there is one vendor, one key, and one set of terms to audit. Implies `GEOCODING_API_KEY` 🔒 in §7.4. |
| Q26 | Friend Proximity (§8) — sign-off on the design, before any schema work | **Open — this is the ask.** §8 is a design-only proposal at the same effort tier as §4. The parts most worth a second opinion because they are judgment calls rather than requirements: the two-directed-row shape of `proximity_shares` (§8.2), hiding protected zones completely rather than labelling or coarsening them (§8.4), the deterministic ~1km grid for approximate mode (§8.5), no location history at all (§8.2), and time-boxed grants by default (§8.2). Nothing is built; nothing should be until this is signed off. |
| Q28 | The in-app "tapped your card" surface — the non-push half of threat 7's detection control — is not built | **Open, and it is a real gap rather than polish.** §4.5's amendment requires it explicitly: "push delivery is best-effort on both platforms and users disable notifications … so that a user who never receives a push is not a user with no path to detection". The push mechanism is built and correct; the visible in-app record, with the same inline revoke-card and remove-connection actions, is not, because this pass built no connect screens at all. Belongs with whichever phase builds the connections list, and should not be allowed to slip past it — until it exists, threat 7's defence rests entirely on a best-effort channel. |
| Q29 | The §4.6 contacts-import rate limit has no number and no call site | Open. `rate_limit_events` takes it without a migration (that is why the table is generic), but the limit does not exist until contacts import is built. Flagged so that phase does not ship without one — §4.6 lists it, and an endpoint that hashes and matches address books is not a good candidate for the one unlimited endpoint in the product. |
| Q30 | Should the scanner's location freshness get its own `app_config` key? | Open, low priority. The Connect Flow build applies `presenter_location_max_age_seconds` (90s) to both sides, because §4.3 gives a number only for the presenter and §2.5's table has no second key — inventing one would have been a silent deviation and would have put a security number where no operator could tune it. 90s is generous for a fix captured at the moment of the scan, so **tightening the scanner side is the first knob to reach for** if pilot data shows relays getting through on stale scanner fixes; that is the moment to add the key. See the §4.3 amendment. |
| Q27 | The Supabase JWT secret used to sign the per-request access token (§5.4) is a *previous*, deprecated key, not the project's current one | **Open, real, and time-sensitive.** Confirmed 2026-08-13 in the Supabase dashboard (Project Settings → JWT Keys): this project's *current* signing key is an asymmetric ECC (P-256) JWT Signing Key; the HS256 shared secret this app signs with is listed as the *previous* key, rotated out 4 days prior to this check, and is "still used to verify tokens that are yet to expire" — Supabase's own wording for a key on the way out, not a stable long-term credential. It works today (verified directly against the live database with the real secret — see §5.4/§6.6), but it can be revoked at any time, at which point every newly-minted token fails to verify and the app goes down for every user simultaneously, not gracefully. **Needed:** migrate `mintSupabaseAccessToken` (`apps/web/src/server/auth/supabase-token.ts`) off the shared secret and onto the project's current asymmetric signing key — either by importing a signing key we control into Supabase's JWT Signing Keys as the trusted key, or by using whatever mechanism Supabase's current docs describe for a custom token issuer to sign with an asymmetric key Supabase already trusts. This is real work, not a config toggle — treat it as a follow-up pass, not a footnote, and do it before relying on this in front of real pilot users. |

---

## 10. The security posture, in one paragraph

Every connection in SmartCard requires either a physical card tap (proximity proven by NFC's few-centimetre range) or a QR scan where both phones independently report their location and our server — not either phone — computes whether they are actually near each other. QR codes rotate every 30 seconds, expire in 45, contain no personal data, and die permanently the instant anyone scans them. If location is unavailable, denied, stale, or imprecise, we refuse the connection rather than guess. The database itself is configured so that it cannot answer "list all users" — no-global-search is enforced by Postgres, not by us choosing not to build a search box. Meeting locations live in a separate table behind their own lock, so a coding mistake results in missing location data rather than leaked location data. The two attacks consciously accepted are two real people choosing to collude, and someone combining GPS spoofing with a live video relay — both require substantially more effort than the value of a single fraudulent connection in a private network with no strangers to defraud.

**Added 2026-08-13, on the two features designed since.** A card tap still connects instantly, because that is what a physical card is for — but its owner is now told the instant it happens, which is what turns the existing revoke button into a real defence against a stolen card rather than a button nobody knows to press. When two people who genuinely are standing together cannot convince their phones of it, the server, never the client, may widen the radius once for that pair — a rung, not a ladder, and it cools down. And Friend Proximity (§8), which is designed but not built, inverts the usual shape of a location feature: it never asks "who is near this point", only "where are the specific people I have met in person and mutually, deliberately agreed to share with" — each side owning its own revocation, granularity chosen by the person being seen, protected places hidden so completely that being at home is indistinguishable from a dead battery, and no history of anyone's movements kept at all. The residual risk it cannot engineer away is the one worth naming out loud: someone who chooses to share their exact location with a person who abuses it. Against that, the design makes the safe state the default, makes turning it off instant, unilateral, and unannounced, and never makes anyone explain why they did.
