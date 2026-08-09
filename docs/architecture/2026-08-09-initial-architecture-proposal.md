# SmartCard 2.0 — Technical Architecture Proposal

**Status:** §1.4 (no shared UI components between web/mobile) confirmed by project owner on 2026-08-09. Remaining sections pending sign-off. Open questions Q1, Q2, Q6, Q7, Q12, Q13 block implementation start — see §8 and track resolutions below as they land.
**Full rendered version:** https://claude.ai/code/artifact/b00877ac-2992-48bc-a511-f8ed1d3940c8
**Prepared:** 2026-08-09, by an Opus pass at xhigh reasoning effort per the project's model/effort guidance for architecture-and-security-critical design work.

---

## 0. How to read this document

The most important section is **§4 (Connection Verification)**. That is the section that makes SmartCard actually SmartCard — everything else is standard app plumbing that many teams could build. If you only carefully review one part, review §4 and §8 (open questions).

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

**`cards`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `card_code` | text | unique — legacy `StarterCard-<hex>` printed identifier |
| `card_token` | text | unique, high-entropy random — what's actually in the NFC tag URL |
| `status` | text | `unassigned` / `assigned` / `revoked` |
| `owner_user_id` | uuid | FK → users, nullable |
| `assigned_at`, `created_at` | timestamptz | |
| `legacy_card_id` | bigint | nullable |

Two identifiers on purpose: `card_code` is human-readable and structurally guessable; `card_token` is the actual secret in the tag URL. Whether new tokens can be written to the existing 6,809 unassigned cards is **open question Q1** — the single biggest unknown blocking this table's final design.

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

### 2.6 Events

**`events`** — `id` (PK), `host_user_id` (FK), `title`, `description`, `starts_at`, `ends_at`, `timezone`, `venue_name`, `venue_address`, `latitude`, `longitude`, `visibility`, `cover_image_path`, `created_at`. Event venue location is *not* sensitive the way meeting location is — a public event at a public venue is meant to be found; meeting location reveals where a specific person physically was. Different data, different policy.

**`event_rsvps`** — `id` (PK), `event_id` (FK), `user_id` (FK), `status` (`going`/`interested`/`not_going`/`waitlist`), `responded_at`. `UNIQUE (event_id, user_id)`. The "you know X people going" hook is the intersection of the viewer's connections with `going` RSVPs — see §3.3.

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

### 4.4 Tuning from pilot data

`connection_attempts` records distance, both accuracies, radius in force, method, and time per rejection — enough to answer "what radius would have accepted 99% of genuine attempts at this venue?" from data after the pilot. Recommendation: start at 150m, watch logs live on day one, adjust `app_config` in real time.

### 4.5 NFC — end to end

Two in-scope cases (card tap, passive NDEF tag read), one code path — both are "the app receives a URL containing a token."

1. Tag contains `https://smartcard.app/t/<card_token>` — the opaque random token, not the printed `StarterCard-<hex>` code.
2. Phone opens the URL via universal/app links (§7.3); no app installed → web preview page.
3. App calls `POST /api/connect/nfc/redeem { cardToken }` with the scanner's auth.
4. Server looks up `cards` by `card_token`; requires `status='assigned'`, owner not null, owner ≠ scanner, no block, not already connected.
5. Commits connection + meeting, `verification_method='nfc_card'`, `profileRichness='full'`.

The client's claimed card ID/owner is never trusted — identity is resolved server-side from the token alone. No GPS gate for NFC: physical range (a few centimeters) *is* the proximity proof. Rate limiting on redeem velocity per card matters here, since a stolen physical card is a real risk; an owner can set `status='revoked'` to instantly kill a lost card.

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

`cardid` → `card_code`, `ownerid` → `owner_user_id` via the legacy→new UUID map; generate a new random `card_token` per card; 333 assigned, 6,809 unassigned.

**Largest risk in the migration:** the new `card_token` only works if it can be written into the physical tags. If the 6,809 unassigned cards are already encoded with a fixed legacy URL, options are: (1) keep the legacy domain alive routing to the new backend using `card_code` as lookup (weaker — structured/guessable); (2) re-encode the inventory in bulk (physical work on 6,809 items); (3) treat as dead stock, print new cards. **Must be answered before implementation — Q1.**

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

For a tapped tag URL to open the app rather than the browser, the web app must serve `/.well-known/apple-app-site-association` (iOS Universal Links) and `/.well-known/assetlinks.json` (Android App Links) — static files on Vercel. Without these, NFC "works" but always lands in the browser, which looks like a broken product.

### 7.4 Environment variable inventory

**Next.js / Vercel (server-side, secret):** `KINDE_DOMAIN`, `KINDE_CLIENT_ID`, `KINDE_CLIENT_SECRET` 🔒, `KINDE_ISSUER_URL`, `KINDE_SITE_URL`, `KINDE_POST_LOGIN_REDIRECT_URL`, `KINDE_POST_LOGOUT_REDIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 🔒, `SUPABASE_JWT_SECRET` 🔒, `QR_SIGNING_SECRET` 🔒, `CONTACT_HASH_SALT` 🔒, `UPSTASH_REDIS_*`, `SENTRY_DSN`.

**Next.js (public):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`.

**Expo / EAS (public):** `EXPO_PUBLIC_KINDE_DOMAIN`, `EXPO_PUBLIC_KINDE_CLIENT_ID` (mobile/PKCE client), `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SENTRY_DSN`.

Anything prefixed `NEXT_PUBLIC_`/`EXPO_PUBLIC_` is shipped to users and readable by anyone — no secret ever gets that prefix. The Expo app holds no Supabase credentials beyond the publishable key; it talks to our API, never the database directly.

---

## 8. Open questions

Tracked here as they resolve — update this table in place rather than deleting rows, so the decision history stays visible.

| # | Question | Status |
|---|---|---|
| Q1 | What is physically encoded on the 6,809 unassigned cards? (blocks `cards` schema — highest priority) | Open |
| Q2 | What's the pilot venue, and is it indoors? (drives starting GPS radius) | Open |
| Q3 | Do we still need `username`, given no global search? | Open |
| Q4 | Block/report in the pilot scope? | Open |
| Q5 | Who can create events for the pilot — anyone, or hosts only? | Open |
| Q6 | How many of the 337 legacy users have a null/stale `kindeuserid`? | **Resolved 2026-08-09** — 0 of 337 users have a null or empty `kindeuserid`, and no duplicates exist. No manual reconciliation flow needed; every legacy user lands cleanly on their existing row via the Kinde join key. |
| Q7 | Confirm the Supabase JWT approach (§5.4) against current docs before building | Open |
| Q8 | Is "presenter must keep the app open" acceptable UX (heartbeat requirement)? | Open |
| Q9 | App Store review risk — need a documented demo/reviewer test path? | Open |
| Q10 | Contacts import: hash retention window, user delete control? | Open |
| Q11 | Rate limiting backend — Upstash Redis vs. a Postgres table? | Open |
| Q12 | Is the Vercel `front-end-playground` project disposable? | Open |
| Q13 | Supabase plan/region/backups — Free vs. Pro with PITR? | Open |
| Q14 | Recurring events — one `events` row per occurrence (recommended), or a recurrence concept? | Open |

---

## 9. The security posture, in one paragraph

Every connection in SmartCard requires either a physical card tap (proximity proven by NFC's few-centimetre range) or a QR scan where both phones independently report their location and our server — not either phone — computes whether they are actually near each other. QR codes rotate every 30 seconds, expire in 45, contain no personal data, and die permanently the instant anyone scans them. If location is unavailable, denied, stale, or imprecise, we refuse the connection rather than guess. The database itself is configured so that it cannot answer "list all users" — no-global-search is enforced by Postgres, not by us choosing not to build a search box. Meeting locations live in a separate table behind their own lock, so a coding mistake results in missing location data rather than leaked location data. The two attacks consciously accepted are two real people choosing to collude, and someone combining GPS spoofing with a live video relay — both require substantially more effort than the value of a single fraudulent connection in a private network with no strangers to defraud.
