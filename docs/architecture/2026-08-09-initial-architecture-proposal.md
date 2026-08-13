# SmartCard 2.0 — Technical Architecture Proposal

**Status (updated 2026-08-13):** Schema and RLS for the tables in §2/§3 are implemented and applied to the live Supabase project (`supabase/migrations/`, 15 files) — do not redesign what is already built. §1.4 (no shared UI components between web/mobile) confirmed 2026-08-09. Q1, Q2, Q6, Q11, Q12, Q13, Q15 resolved 2026-08-09; Q16–Q24 recorded resolved 2026-08-13 (see §9).

This revision adds **§8, the Friend Proximity design (Phase 3, post-pilot)** — designed now, deliberately, because it is the highest-sensitivity feature in the product and its constraints need to be settled while they can still shape the schema rather than fight it. Nothing in §8 is built or applied.

**Confirmed next step:** the full legacy data migration (users, cards, social_links, photos — §6), as a single complete import before the pilot, not a partial or deferred one. **Still to build on top of the applied schema:** the Phase 1 features in the README's build order — Profile, then Connect Flow (§4), which is where most of §4's design finally becomes code. Q7 (Supabase JWT approach) remains a self-verify-against-docs task and gates the migration's RLS spot-check (§6.6).

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
| 4 | Connection verification design | Designed; **not yet built** — this is Phase 1's Connect Flow. §4.3/§4.4/§4.5/§4.7 amended 2026-08-13 |
| 5 | Auth flow | Designed; not yet built. Q7 to verify first |
| 6 | Migration plan | Designed; **confirmed as the next step**, amended 2026-08-13 |
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

### 4.7 Threat → mechanism mapping

**Threat 1 — Screenshot the QR, forward to a remote person → Defeated.** Token `exp` (45s) + rotation (30s) + session-level single-use (any legitimate scan kills every outstanding token) + GPS gate as a second independent layer.

**Threat 2 — Live video relay (FaceTime, remote friend scans off the screen) → Defeated\*.** Rotation does *not* help — the code is genuinely current. Defeated only by GPS proximity, server-computed from both devices' independently-reported positions, with presenter freshness (90s) and an accuracy floor so a deliberately vague fix can't fuzz past the radius. **This is the entire reason GPS is mandatory.** (\*Except combined with GPS spoofing — accepted residual risk.)

**Threat 3 — Forwarding the "share your contact back" link (deferred flow) → Accommodated without rewrite.** Device-bound session, single-use, short expiry, high-entropy opaque token, tied to the same `connection_sessions` table QR/NFC already use.

**Threat 4 — Mass fake-account farming → Structurally defeated.** Every edge needs a live session + two fresh in-range GPS fixes, or a physical card; no global search means a fake account can't even find a target; contacts import creates zero edges; `createVerifiedConnection` is the only writer to `connections`. Protect by never adding a user-search/list endpoint and never adding a second path that writes connections.

**Threat 5 — Standard web/app attacks → Defeated.** Parameterized queries only (no string-concatenated SQL); React's default escaping + strict CSP for XSS; `SameSite`/`HttpOnly`/`Secure` cookies for web CSRF (mobile uses bearer tokens, not cookies, so CSRF doesn't apply); RLS default-deny plus service-layer checks as two independent access-control layers; UUID PKs against IDOR; short-lived tokens in `expo-secure-store` (never `AsyncStorage`) against session hijacking; Zod schemas stripping unknown fields against mass assignment; secrets server-side only, never in the Expo bundle.

#### Amendment (2026-08-13) — two threats introduced by this round's decisions

**Threat 6 — Deliberately failing twice to unlock the relaxed radius → Bounded, consciously accepted.** Automatic relaxation (§4.3) is triggerable by anyone willing to fail two attempts, so it must be assessed as an attacker capability rather than only as a user convenience. What it buys an attacker is one attempt at 500m instead of 150m, for one specific pair, once per hour, with no escalation beyond that rung. It does not connect people in different neighbourhoods and it cannot be walked wider. The residual is a slightly larger collusion envelope for two people who already have to be cooperating — a case §4.7 threat 2 already accepts. Defended by: eligibility restricted to distance/accuracy rejections only (junk requests unlock nothing), same-pair scoping (failures cannot be pooled across victims), a hard two-rung ladder, a one-hour cooldown after use, the relaxed radius staying >3× the relaxed accuracy floor, and never telling the client that relaxation exists. **The thing to watch in pilot data is the shape of relaxed attempts** (§4.4 question 4): genuine indoor failures cluster just past the normal radius, deliberate ones sit near the ceiling.

**Threat 7 — A lost or stolen card connecting to its owner → Detection, not prevention; mitigated.** Physical possession of a card is the entire proof for the NFC path, so a card in the wrong hands is a working credential until it is revoked. There is no confirmation step to stop it (§4.5 amendment explains why adding one would not have worked). The defence is time-to-detection: the owner is pushed a notification the instant any tap commits, with revoke-card and remove-connection one tap away, plus an in-app record for anyone whose notifications are off. Per-card redeem rate limiting (§4.6) caps how much damage a found card does before its owner reacts. **Consciously accepted residual:** connections created between the theft and the revocation are real connections and stay until removed — the owner has to remove them, and the notification history is what tells them which ones. A stolen card is a physical-security problem the app can shorten but not prevent.

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

### 6.3 `cards` (7,142 rows)

`cardid` → `card_code` direct copy (no regeneration needed — see §2.2), `ownerid` → `owner_user_id` via the legacy→new UUID map; 333 assigned, 6,809 unassigned, all usable as-is. This was flagged as the largest migration risk in the original proposal (Q1) — resolved, and turned out simpler than expected: the physical inventory needs no re-encoding and nothing is dead stock. The remaining dependency is DNS/routing for `smartcard.tech` itself (Q15 in §9), not the card data.

### 6.4 `social_links` (466 rows)

Straight copy, `userid` remapped; validate/normalize URLs on the way in.

### 6.5 Photos (148 files, ~7MB)

New Supabase Storage bucket `profile-photos`, **private**, path convention `{user_id}/{uuid}.webp`, served via signed URLs. Photos are profile data and profiles are graph-gated — a public bucket would quietly undermine that. Many `profilephoto` values are null (no photo); report any non-null path whose file is missing rather than failing the run.

### 6.6 Verification checklist

Row counts match (337 / 7,142 / 466); every assigned card's `owner_user_id` resolves to a real user (333 expected); no orphaned `social_links`; no `users` row retains any password field; every photo path resolves to a real object; spot-check RLS as a real migrated user (can see own data, cannot see a stranger's).

### 6.7 `contactexchange` (1,813 rows) — not migrated

No mapping into the mutual-connections model, per spec. Preserved as a read-only archive in a separate `legacy` schema, not reachable from application code — one-directional capture data is exactly the shape that could accidentally seed follow-style edges.

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

**2026-08-13 round.** Q16–Q24 were answered directly by the project owner and are recorded resolved below, each pointing at the section it amended. Q25 (geocoding provider) and Q26 (Friend Proximity sign-off) are new and deliberately open. **Q3, Q4, Q7, Q8, Q9 and Q10 were *not* answered by this round** and remain open — their rows now say so explicitly, and where this round changed their cost or urgency without answering them (Q7 moved onto the critical path; Q9 acquired a background-location dimension; Q4 became a hard prerequisite for §8) that is noted in the row rather than mistaken for a resolution. Q5 is marked partially resolved, because the round settled where events come from without settling who may create one.

| # | Question | Status |
|---|---|---|
| Q1 | What is physically encoded on the 6,809 unassigned cards? (blocks `cards` schema — highest priority) | **Resolved 2026-08-09** — `https://smartcard.tech/card/<prefix>-<12-hex-char-suffix>`, confirmed by tapping a real card and cross-checked against all 7,142 rows in the production export. The suffix is a unique, auto-generated 48-bit random value; no re-encoding needed, full inventory usable as-is. See §2.2. Creates a new dependency: **Q15**, domain control for `smartcard.tech`. |
| Q15 | Do we control DNS/hosting for `smartcard.tech`? Does the new app deploy there directly, or does that domain just proxy `/card/*` + the universal-link files to wherever the new app lives? | **Resolved 2026-08-09** — yes, controlled, currently on Cloudflare DNS. `smartcard.tech` becomes the production domain for SmartCard 2.0 directly (not a separate proxy setup). DNS stays on Cloudflare — no registrar/nameserver transfer to Vercel needed; once the Vercel project exists (§7.1, created on first deploy), add `smartcard.tech` as a custom domain there and point Cloudflare's DNS record at it with the Cloudflare proxy ("orange cloud") turned **off** for that record — a proxied record can break Vercel's SSL issuance and domain verification. |
| Q2 | What's the pilot venue, and is it indoors? (drives starting GPS radius) | **Resolved 2026-08-09** — not known yet / varies by event. Defaulting to the recommended starting radius (150m), server-side config, tuned from `connection_attempts` rejection logs after the first pilot event. |
| Q3 | Do we still need `username`, given no global search? | Open — **not answered by the 2026-08-13 round**, despite being adjacent to it. Lands with the Profile build phase. |
| Q4 | Block/report in the pilot scope? | Open — **not answered by the 2026-08-13 round.** Note that §8 now depends on `blocks` existing and being enforced (§8.3 step 2), so Friend Proximity cannot ship without it; it is still optional for the pilot itself. |
| Q5 | Who can create events for the pilot — anyone, or hosts only? | **Partially resolved 2026-08-13** — the *source* is settled: events are created natively in SmartCard only, with no Luma/Eventbrite import (Q20). The *permission* half — whether any user or only designated hosts may create one — is still open, and §3.6's fail-closed reading stands until it lands: there is no INSERT policy or grant on `events` at all, so nobody can create one through the client path yet. |
| Q6 | How many of the 337 legacy users have a null/stale `kindeuserid`? | **Resolved 2026-08-09** — 0 of 337 users have a null or empty `kindeuserid`, and no duplicates exist. No manual reconciliation flow needed; every legacy user lands cleanly on their existing row via the Kinde join key. |
| Q7 | Confirm the Supabase JWT approach (§5.4) against current docs before building | Open — and **now on the critical path.** The §6.1 amendment explains why: §6.6's "spot-check RLS as a real migrated user" is not a meaningful check until `auth.uid()` resolves, so this must be settled before the production import, not after. |
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
| Q25 | Which reverse-geocoding provider — Google Maps Geocoding, Mapbox, or OSM Nominatim? | **Open, deliberately — implementation-phase choice, not an architecture blocker.** None of the three changes any table, policy, or data flow. Decide when Connect Flow is built, on: **terms of service around *storing* geocoded results** (the architecturally relevant one, since we retain the label rather than displaying and discarding it — check this first); POI coverage quality in dense US urban areas; rate limits and cost at pilot volume; and **whether the same provider can also serve §8's approximate-mode area names**, so there is one vendor, one key, and one set of terms to audit. Implies `GEOCODING_API_KEY` 🔒 in §7.4. |
| Q26 | Friend Proximity (§8) — sign-off on the design, before any schema work | **Open — this is the ask.** §8 is a design-only proposal at the same effort tier as §4. The parts most worth a second opinion because they are judgment calls rather than requirements: the two-directed-row shape of `proximity_shares` (§8.2), hiding protected zones completely rather than labelling or coarsening them (§8.4), the deterministic ~1km grid for approximate mode (§8.5), no location history at all (§8.2), and time-boxed grants by default (§8.2). Nothing is built; nothing should be until this is signed off. |

---

## 10. The security posture, in one paragraph

Every connection in SmartCard requires either a physical card tap (proximity proven by NFC's few-centimetre range) or a QR scan where both phones independently report their location and our server — not either phone — computes whether they are actually near each other. QR codes rotate every 30 seconds, expire in 45, contain no personal data, and die permanently the instant anyone scans them. If location is unavailable, denied, stale, or imprecise, we refuse the connection rather than guess. The database itself is configured so that it cannot answer "list all users" — no-global-search is enforced by Postgres, not by us choosing not to build a search box. Meeting locations live in a separate table behind their own lock, so a coding mistake results in missing location data rather than leaked location data. The two attacks consciously accepted are two real people choosing to collude, and someone combining GPS spoofing with a live video relay — both require substantially more effort than the value of a single fraudulent connection in a private network with no strangers to defraud.

**Added 2026-08-13, on the two features designed since.** A card tap still connects instantly, because that is what a physical card is for — but its owner is now told the instant it happens, which is what turns the existing revoke button into a real defence against a stolen card rather than a button nobody knows to press. When two people who genuinely are standing together cannot convince their phones of it, the server, never the client, may widen the radius once for that pair — a rung, not a ladder, and it cools down. And Friend Proximity (§8), which is designed but not built, inverts the usual shape of a location feature: it never asks "who is near this point", only "where are the specific people I have met in person and mutually, deliberately agreed to share with" — each side owning its own revocation, granularity chosen by the person being seen, protected places hidden so completely that being at home is indistinguishable from a dead battery, and no history of anyone's movements kept at all. The residual risk it cannot engineer away is the one worth naming out loud: someone who chooses to share their exact location with a person who abuses it. Against that, the design makes the safe state the default, makes turning it off instant, unilateral, and unannounced, and never makes anyone explain why they did.
