# SECURITY-AUDIT — 2026-08

Full-codebase security audit, run step by step on branch `claude/security-audit-00fgc0`.
Each step's findings are appended as the step completes and committed with that step's fixes,
so completed work survives on disk. Severity definitions (used throughout, not intuition):

- **Critical** — an unauthenticated attacker gains other users' data, code execution, or admin access.
- **High** — an authenticated user reaches data or actions belonging to another user or tenant, or a leaked secret enables that.
- **Medium** — requires unusual preconditions, or a real defense-in-depth gap with no direct exploit path.
- **Low** — hardening or hygiene with no realistic exploit.

Findings are marked **[verified in code]** (claim confirmed by reading the referenced lines)
or **[inferred]** (from convention/naming/docs, not directly executed or read).

---

## Step 0 — Recon and mapping

### Stack

| Layer | What it is | Evidence |
|---|---|---|
| Languages | TypeScript (strict), SQL (Postgres), a little Python (one-time seed tooling) | `tsconfig.base.json`, `supabase/`, `package.json` |
| Monorepo | pnpm 11.21.0 workspaces + Turborepo 2.x; Node >= 22 | root `package.json`, `pnpm-workspace.yaml`, `turbo.json` |
| Web app | Next.js **16.3.0** (App Router, Server Components + Server Actions), React 19.2.8 | `apps/web/package.json` |
| Mobile app | Expo / React Native **scaffold only** — renders "under construction", no auth, no API calls, no secrets | `apps/mobile/src/app/index.tsx` [verified in code] |
| Shared packages | `packages/core` (verification logic), `packages/types` (Zod schemas), `packages/api-client` (typed fetch wrapper) | `pnpm-workspace.yaml` |
| Lockfile | `pnpm-lock.yaml` (single, root) | repo root |
| Database | Supabase Postgres (project ref `crpsbnbegeoqtlgshltt`), accessed via `@supabase/supabase-js` (PostgREST) — no raw SQL driver, no ORM. All schema/RLS in `supabase/migrations/` (33 files) | `apps/web/src/server/supabase/*` |
| AuthN | Kinde (`@kinde-oss/kinde-auth-nextjs` v2, confidential client, encrypted HttpOnly cookies) bridged to Supabase: server verifies the Kinde access token against Kinde's JWKS, resolves it to a `public.users` row, and mints a **5-minute ES256 Supabase JWT** per request (`sub` = users.id, `role: authenticated`) | `apps/web/src/server/auth/` [verified in code] |
| AuthZ | Postgres RLS on every table (default-deny, `force row level security`, all grants revoked from `anon`/`authenticated` then narrowly re-granted; column-scoped grants) + a small service layer | `supabase/migrations/20260809211000_rls_enable_default_deny.sql` [verified in code] |
| Hosting | Vercel (web, serverless), custom domain `smartcard.tech` behind Cloudflare proxy; Supabase for DB + Storage; Expo push service; Mapbox geocoding | README, `request-context.ts`, `geocode.ts`, `push.ts` [inferred from code comments — no infra config is in-repo] |
| CI/CD | **None in-repo.** No `.github/`, no `vercel.json`, no Dockerfiles. Deploys are Vercel's default git integration [inferred] | `git ls-files` |
| Config/secrets | Env vars only; `.env*` gitignored (deny-all + `!.env.example` allow-back); server-only access centralized in `apps/web/src/server/env.ts` (marked `server-only`, fail-closed on missing values) | `.gitignore`, `env.ts` [verified in code] |
| Test runner | Vitest at root; `pnpm turbo test` (3 packages with suites; adversarial threat-model tests in `packages/core`) | `turbo.json` |

**Baseline established before any change:** `pnpm turbo test` passes (3/3 tasks); `pnpm turbo build`
passes (web) when the required env vars are present (this sandbox has no real secrets, so builds
are run with dummy values for the vars named in `turbo.json`'s `env` list; the initial failure
without them is exactly the documented `KINDE_ISSUER_URL is required` collection failure, not a code defect).

### Entry-point inventory (the checklist Steps 2 and 5 must fully account for)

HTTP Route Handlers (`apps/web/src/app/**/route.ts`):

| # | Entry point | Method | Auth expectation |
|---|---|---|---|
| E1 | `/api/auth/[kindeAuth]` (login/register/logout/kinde_callback) | GET | Public by design (Kinde SDK `handleAuth()`) |
| E2 | `/api/connect/qr/session` | POST | Authenticated (same-origin check first) |
| E3 | `/api/connect/qr/heartbeat` | POST | Authenticated (same-origin check first) |
| E4 | `/api/connect/qr/redeem` | POST | Authenticated (same-origin check first) |
| E5 | `/api/connect/nfc/redeem` | POST | Authenticated (same-origin check first) |
| E6 | `/c/[token]/vcard` | GET | **Unauthenticated by design** (QR-token-gated) |
| E7 | `/card/[code]/vcard` | GET | **Unauthenticated by design** (card-code-gated) |

Server Actions (each an HTTP POST endpoint; 15 total across 7 `"use server"` files):

| # | Action | File |
|---|---|---|
| A1 | `completeOnboardingAction` | `app/onboarding/actions.ts` |
| A2 | `skipOnboardingAction` | `app/onboarding/actions.ts` |
| A3 | `updateProfileAction` | `app/(app)/profile/actions.ts` |
| A4 | `updateEmailOptInAction` | `app/(app)/profile/actions.ts` |
| A5 | `addSocialLinkAction` | `app/(app)/profile/actions.ts` |
| A6 | `updateSocialLinkAction` | `app/(app)/profile/actions.ts` |
| A7 | `deleteSocialLinkAction` | `app/(app)/profile/actions.ts` |
| A8 | `uploadPhotoAction` | `app/(app)/profile/actions.ts` |
| A9 | `removePhotoAction` | `app/(app)/profile/actions.ts` |
| A10 | `deleteAccountAction` | `app/(app)/settings/actions.ts` |
| A11 | `createEventAction` | `app/(app)/events/actions.ts` |
| A12 | `updateEventAction` | `app/(app)/events/actions.ts` |
| A13 | `uploadEventCoverAction` | `app/(app)/events/actions.ts` |
| A14 | `removeEventCoverAction` | `app/(app)/events/actions.ts` |
| A15 | `inviteToEventAction` | `app/(app)/events/actions.ts` |
| A16 | `requestRsvpAction` | `app/(app)/events/actions.ts` |
| A17 | `withdrawRsvpAction` | `app/(app)/events/actions.ts` |
| A18 | `decideRsvpAction` | `app/(app)/events/actions.ts` |
| A19 | `setLocationVisibilityAction` | `app/(app)/connections/[connectionId]/actions.ts` |
| A20 | `setLocationConsentAction` | `app/(app)/connections/[connectionId]/actions.ts` |
| A21 | `setMarkedPrivateAction` | `app/(app)/connections/[connectionId]/actions.ts` |
| A22 | `removeConnectionAction` | `app/(app)/connections/[connectionId]/actions.ts` |
| A23 | `loadConnectPayoff` | `app/(app)/connect/payoff-lookup.ts` |
| A24 | `removeConnectionFromActivityAction` | `app/(app)/activity/actions.ts` |
| A25 | `revokeCardAction` | `app/(app)/activity/actions.ts` |

Server-rendered pages performing data access (GET, RSC): `/` , `/feed`, `/connections`,
`/connections/[connectionId]`, `/profile`, `/profile/edit`, `/activity`, `/settings`,
`/events`, `/events/new`, `/events/[eventId]`, `/events/[eventId]/queue`, `/connect`,
`/onboarding`, `/sign-in`, and the **unauthenticated** `/card/[code]` and `/c/[token]` preview pages.

Database-exposed RPC surface reachable by client roles (PostgREST `public` schema, `authenticated`
role): `request_event_rsvp`, `withdraw_event_rsvp`, `decide_event_rsvp`,
`event_rsvp_queue`, `event_attendance`, `soft_delete_own_account` (audited in Steps 3–4).
Everything else (`create_verified_connection`, `rate_limit_consume`, `rate_limit_prune`,
`restore_deleted_user`, `private.*` helpers) is service-role-only or policy-internal.

Other triggerable surfaces: **none** — no webhooks, no cron/scheduled jobs (pg_cron deliberately
not enabled), no queues, no CLI entry points in the runtime. `supabase/seed/*` is one-time
operator tooling, out of runtime scope.

### Scope

In scope for manual review: `apps/web/src`, `packages/*/src`, `supabase/migrations`,
`supabase/seed` (as data-handling code), root config, `apps/mobile` (scaffold — confirmed
to contain no auth, no network calls, no secrets). Out of scope for manual review (covered by
the dependency step instead): `node_modules`, `pnpm-lock.yaml` contents, `.next`/`dist` build
output, `docs/design/prototypes/*` (static design artifacts, not served by the app — verified
not under `apps/web/public/`).

### Stack equivalents for each audit step

- Step 1 (secrets): env vars via `server/env.ts`; client-exposure convention is the `NEXT_PUBLIC_`/`EXPO_PUBLIC_` prefix; Turbo strips undeclared vars at build.
- Step 2 (authn): Kinde OAuth (cookie session) → JWKS verification → minted Supabase JWT. No passwords, no reset/MFA/magic-link flows in-app (all delegated to Kinde's hosted pages).
- Step 3 (authz): Postgres RLS policies + column-scoped grants; `security definer` helpers in `private` schema; service layer `.eq()` filters.
- Step 4 (data rules): Supabase RLS = the row/table permission system; service-role key = the admin credential to keep server-side.
- Step 5 (injection): PostgREST query builder (no raw SQL from app); React JSX escaping (XSS); vCard/Content-Disposition generation (header injection surface); no subprocesses; outbound fetches are fixed-URL vendor APIs (Mapbox, Expo).
- Step 6 (abuse): `rate_limit_events` + `rate_limit_consume` in Postgres; same-origin check for cookie-authenticated routes; Supabase Storage buckets for uploads.
- Step 7 (supply chain): `pnpm audit`; lockfile; no CI workflows to audit (noted).
- Step 8 (client): Next client components; one `NEXT_PUBLIC_` var; error redaction via `server/errors.ts`.
- Step 9 (transport/headers): `next.config.ts` `headers()`; Vercel/Cloudflare TLS; Supabase Storage buckets (both private).
- Step 10 (logging): `console.*` to Vercel runtime logs; `connection_attempts` / `card_preview_views` / `rate_limit_events` audit tables.

---

## Step 1 — Secrets and configuration

### What was searched, and how

- **Working tree:** every tracked file scanned for credential shapes — private-key PEM blocks,
  `sb_secret_`/`sk_live_`/`AKIA…`/`ghp_…`/`xox…`/`AIza…` prefixes, JWT-shaped `eyJ…` strings,
  high-entropy `"d"` JWK members, `password=`/`secret=` assignments. **Zero secret values found.**
  The only matches are variable *names* in docs, and one test fixture asserting that a
  PEM header is rejected as invalid JSON (`supabase-token.test.ts`). [verified in code]
- **Git history (mandatory):** all 120 commits, full patch text (`git log --all -p --full-history`,
  lockfile excluded, binary-safe re-run with `grep -a`), same patterns. **Zero secret values in
  history.** All matches are README/architecture prose describing key *migrations* (Q27/Q31),
  never the keys. Additionally `git log --all --diff-filter=A --name-only` confirms **no `.env*`
  file, keyfile, or PEM was ever committed at any point in history.** [verified]
- **Seed data:** `supabase/seed/` scripts confirmed to contain transformation logic only — the
  9,757 rows of production personal data were deliberately never committed, and legacy bcrypt
  password hashes were never imported (the generator actively scans for and excludes credential
  material; its output stayed local). [verified in code — `2026-08-13_legacy_import.sql` header,
  generator source]

### Client-bundle exposure

- Exactly **one** client-convention variable exists in the whole repo:
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`apps/web/src/server/env.ts:118`) — the Supabase
  publishable key, public by design (grants nothing; every table is default-deny for `anon`).
  It is in fact only ever read server-side. No `EXPO_PUBLIC_` variable exists anywhere. [verified]
- A production build was made with **sentinel values** in every secret variable and the emitted
  client bundle (`apps/web/.next/static`) grepped for them: none appear. The service-role key,
  QR signing secret, JWT signing key (including its private `d` member), and salts do not reach
  the browser. [verified by build + grep]
- All secret access is centralized in `server/env.ts`, which is `import "server-only"` — importing
  it from a client component is a build error, not a runtime leak. [verified in code]

### Environment separation and config precedence

- Separate prod/non-prod credentials **cannot be verified from the repository** — the values live
  in Vercel and `.env.local` (absent here by design). The README states production values are
  distinct and generated separately (`QR_SIGNING_SECRET`, `CONNECT_IP_HASH_SALT` "both need
  distinct production values in Vercel"). [inferred from docs; listed in Step 11 as unverifiable]
- Config precedence: no security-relevant setting can be overridden by an attacker-controlled
  env var, header, or query parameter. All verification thresholds come from the `app_config`
  table (service-role-only, no client read/write), parsed fail-closed — a missing/malformed row
  refuses the whole flow rather than defaulting (`packages/core/src/connect/config.ts`,
  `card-preview-service.ts:requirePositiveIntegerConfig`). [verified in code]
  Two header-derived values do influence behavior — the client IP (rate-limit subject) and
  `x-forwarded-host` (same-origin comparison) — assessed in Step 6, where the one real gap lives.

### Findings

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| S1-1 | Low | The live Supabase project ref (`crpsbnbegeoqtlgshltt`) was hardcoded as a test fixture in `apps/web/src/server/auth/supabase-token.test.ts:33` — the only place in `apps/`/`packages/` naming the production project, in a repo where every other fixture uses example values. Not a credential (project refs are discoverable), pure hygiene. | **Fixed**: fixture swapped for a fictional ref; all 12 tests still pass (assertions are relative to the constant). The ref also appears in `README.md`/`docs/` prose and `supabase/seed/` headers as operational history — left as-is, documentation is not an attack surface and rewriting history records was out of scope. |
| S1-2 | Low | `.gitignore` allow-backs `!.env.example` with a comment saying it must exist as a names-only template, but no `.env.example` was ever created — so a new environment gets assembled from prose in README/env.ts instead of a template, which is how a var ends up missing (`turbo.json` documents exactly this failure). | **Fixed**: added `.env.example` with variable names only (verified against `env.ts` and `turbo.json`'s build env list), no values. |
| S1-3 | — | No hardcoded credentials in tree; none in history; `.env*` never committed; no secret in the client bundle; no non-prod config pointing at prod visible in-repo. | No action needed. Rotation list: **empty** — nothing to rotate. |

**Build/test after step:** `pnpm turbo build` and `pnpm turbo test` pass (12/12 in the edited file).

---

## Step 2 — Authentication

Every entry point from Step 0 accounted for below. The core mechanism is strong: the app never
trusts a decoded token — `verifyKindeAccessToken` (`server/auth/kinde-identity.ts`) does full
JWKS signature verification with **algorithm pinning** (`algorithms: ["RS256"]`, closing
`alg:none`/HS-confusion), issuer check, `azp` (authorized-party) check against an allow-list of
Kinde client ids, and `exp`/`nbf` with 5s clock tolerance. An unreachable JWKS endpoint rejects
(fails closed), never allows. [verified in code]

### Entry-point-by-entry-point

- **E1 `/api/auth/[kindeAuth]`** — Kinde SDK `handleAuth()`. OAuth `state` and PKCE handled by the
  SDK (`callback.cjs.js` validates `state`; "State not found" → 500, not a silent pass). Open-redirect
  guard present: post-login redirect is regex-gated (`postLoginAllowedURLRegex`). Public by design. [verified in installed SDK]
- **E2–E5 `/api/connect/*`** — `readAuthenticatedRequest` runs the same-origin/CSRF check, then
  `getAuthenticatedContext()`; `null` → 401. Identity is taken only from the verified token, never
  from the body (no request schema has a caller-id field). [verified in code]
- **E6/E7 vCard routes** — unauthenticated by design; gated on a signed rotating QR token / a card
  code, resolved server-side. Assessed fully in Steps 4/6.
- **A1–A25 Server Actions** — every one re-derives identity via `getAuthenticatedContext()` and
  fails closed (throws, or returns null for the read-only `loadConnectPayoff`). None accepts a
  caller identity from input. Confirmed by direct read of all 7 `"use server"` files. [verified in code]
- **`(app)/*` route group** — a single auth gate in `app/(app)/layout.tsx` redirects to `/sign-in`
  on null context and renders a fail-closed error screen (re-throwing unrecognized errors) on the
  three `ensureUser` throw cases. This is UX convenience; the real per-request boundary is each
  page/action calling `getAuthenticatedContext()` itself. [verified in code]

### Token / session handling

- Minted Supabase token: 5-minute lifetime, `sub` = `public.users.id`, `role: authenticated`,
  ES256, per-request, **never stored, never sent to the browser** (verified: no client component
  references `supabase`/`accessToken`/`Bearer`; not in the built bundle, Step 1). No sensitive data
  in its payload. [verified in code + bundle grep]
- Kinde session cookies: `HttpOnly`, `SameSite=Lax`, `Secure` in production, `path=/`
  (`GLOBAL_COOKIE_OPTIONS` in the installed SDK). Logout (`/api/auth/logout`) destroys them.
  Revocation on password change is delegated to Kinde (passwordless — no in-app password). [verified in installed SDK]
- Nothing sensitive is stored in client-side storage: the only `localStorage` key is a random
  non-identity `deviceId` that plays no role in any verification check (Step 8). [verified]

### Auth-adjacent flows (the commonly-missed ones)

**Not applicable, with evidence.** Sign-in is Kinde **passwordless** (one-time emailed code);
there is no in-app password, password reset, email change, account recovery, magic-link
generation, MFA enrollment, or impersonation feature. Searched `apps/web/src` for
`reset|recover|magic|forgot|mfa|otp|impersonat|password` — the only matches are (a) Settings copy
that deliberately tells the user "there is no password to change" and its test
(`settings/page.tsx`, `settings-honesty.test.tsx`), and (b) unrelated words. All of these flows
live in Kinde's hosted pages, outside this codebase's trust boundary. The one auth-token-shaped
flow the app *does* implement — the per-request Kinde→Supabase mint — binds the minted token's
`sub` to the JWKS-verified identity and to nothing the caller supplied. [verified in code]

### Findings

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| S2-1 | Low | Four security-critical docstrings (`current-user.ts:20,83`, `kinde-identity.ts:14,23`, `same-origin.ts:8`, `api/auth/[kindeAuth]/route.ts:10`) assert the Kinde session cookies are **"encrypted with our client secret"** and treat that encryption as the reason cookie contents "cannot be authored by the browser." The installed `@kinde-oss/kinde-auth-nextjs` does **not** encrypt: it stores plaintext JWTs in `HttpOnly`+`SameSite=Lax` cookies (verified in `node_modules`). No vulnerability today — the real protections (`HttpOnly` blocks XSS reads; the SDK re-validates every token against Kinde's JWKS on read, and the app independently re-verifies the access token) are intact and stronger than encryption would be. But a maintainer trusting the false premise (e.g. reading a cookie claim without the JWKS/`sub` guard) could introduce one. | **Fixed**: all six comment sites corrected to describe the actual mechanism (HttpOnly + mandatory on-read JWKS validation), including the nuance that `HttpOnly` does not stop the account holder editing their own cookie, which is why the signature check is what matters. Comments only — no behavior change. |
| S2-2 | — | Token validation is signature-verified with alg pinning + issuer + azp + expiry; no decode-and-trust anywhere; fail-closed on JWKS outage; auth-adjacent flows delegated to Kinde. | No action needed. |

**Build/test after step:** comment-only changes; `pnpm turbo build` + `pnpm turbo test` re-run green (below).

---

## Step 3 — Authorization (IDOR, mass assignment, privilege, internal trust)

The authorization model is unusually strong: it is enforced in Postgres (RLS + column-scoped
grants + `security definer` helpers/RPCs) so an application bug returns *no* row rather than the
wrong one. I read every policy migration and every service-layer write path directly.

### IDOR — per-resource authorization

Every authenticated write was traced to the check that constrains it:

- **Two enforcement styles, both verified sound.** Most service functions apply belt-and-braces
  `.eq(owner_column, userId)` *and* rely on RLS (`revokeCard` → `.eq("owner_user_id", …)`;
  `updateOwnEvent` → `.eq("host_user_id", …)`; social-link edits → `.eq("user_id", …)`;
  participant consent → `.eq("user_id", …)`). Two functions rely on RLS **alone**
  (`removeConnection` → `.eq("id", connectionId).eq("status","active")` with no party filter;
  `setMeetingLocationVisibility` → `.eq("id", meetingId)`). I read the backing policies:
  `"either party may remove their own connection"` (USING requires caller ∈ {user_a,user_b} AND
  status active; WITH CHECK forces status→removed — a *one-way* transition, cannot re-activate)
  and `"participants may change meeting privacy flags"` (USING/WITH CHECK both require an
  `EXISTS` participant row for the caller). Both hold; the IDOR is closed at the database.
  Recorded as S3-3 (defense-in-depth observation, not a live bug). [verified in code]
- **IDs from client input** (connectionId, eventId, meetingId, cardId, rsvpId, invited_user_id)
  all land in an ANDed `.eq()` or an RPC that re-derives the actor from the JWT. Changing an id
  reaches only rows the RLS policy already admits for that caller. No IDOR found. [verified]
- **`connections`/`meetings`/`meeting_participants`/`meeting_locations`/`connection_sessions`
  have no INSERT policy or grant for any client role** — the social graph can be written *only*
  by `create_verified_connection` under the service role (§4.7 threat 4). A farmed account
  hitting PostgREST directly is refused by Postgres before any app code runs. [verified in code]

### Mass assignment

- **`users`**: UPDATE grant is column-scoped to 9 profile columns; `is_admin`, `status`,
  `email`, `email_verified`, `kinde_user_id`, `has_completed_signup` are all **outside** the
  grant, so a direct PostgREST write cannot set them. SELECT grant is *also* column-scoped
  (`is_admin`/`kinde_user_id`/`status` unreadable — 20260814230000). `ensureUser` inserts only
  5 columns; `is_admin`/`status` take DB defaults, so "new user" can never mean "admin". [verified]
- **`event_rsvps`**: all write verbs revoked from clients (20260814051200). Status is an
  *outcome* computed server-side from the event's own config; the client sends only an *intent*
  (`going`/`interested`/`not_going`), and asking directly for `pending`/`waitlist`/`denied` is
  refused `invalid_intent`. This specifically prevents a client self-approving a seat at a
  full/approval-gated event, and prevents forging the `going` value that feeds the `users`
  read policy via `shares_event_with`. [verified in code]
- **`events`**: INSERT forces `host_user_id = current_user_id()` (policy WITH CHECK);
  `host_user_id` is in the INSERT grant but *not* the UPDATE grant (cannot hand an event away).
  [verified]
- **`cards`**: UPDATE grant is `status` only, WITH CHECK confines it to `assigned|revoked`
  (cannot return a held card to `unassigned` stock, cannot rewrite `owner_user_id`). [verified]

### Privileged / admin actions

- `is_admin` is unreadable and unwritable by clients (see above). `restore_deleted_user` is
  `service_role`-only (no client EXECUTE). `soft_delete_own_account` takes **no arguments** —
  subject is read from the JWT, so it cannot be aimed at another account — and is `security
  definer` behind a two-tap confirmation. No role/permission is ever read from a client-supplied
  value. [verified in code]
- Host-only event operations: `decide_event_rsvp` joins the RSVP to its event on
  `host_user_id = caller` (answering `rsvp_not_found` for both "no such row" and "not your event",
  so it is not an existence oracle); `event_rsvp_queue` gates its entire result on
  `private.is_event_host(caller, event)` and returns a **minimal** profile set (name, username,
  photo_path — not email/phone) only to the host. [verified in code]

### Internal-trust / caller propagation

- No internal/service-to-service endpoints, no health/admin ports, no trusted-header or
  IP-allowlist authorization. The client IP is used only as a rate-limit subject and audit
  signal, explicitly "never a substitute gate" — its one spoofable-subject nuance is a rate-limit
  concern handled in Step 6, not an authz bypass. User identity never crosses a hop as an elevated
  context: the service role is used only where there is *no* user identity yet (`ensureUser`) or
  where RLS structurally cannot express the rule (the graph write, the anonymous card preview),
  each with the actor derived server-side. [verified in code]

### Findings

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| S3-1 | Low | `updateEventAction` (`app/(app)/events/actions.ts:225`) read `cover_image_path` from a form field, letting an event host set their own event's cover pointer to any `{uuid}/cover.{ext}` value — while the same file's comment (`:265-268`) asserts the path is "never something a form field supplies." **No disclosure**: the `event-covers` SELECT policy signs cover URLs through the *viewer's* own `can_see_event`, so a pointer at another event's object resolves only for viewers who could already see that event (everyone else gets a broken image). But it was an unnecessary client-controlled write to a security-relevant column that contradicted the code's own stated invariant. | **Fixed**: removed `cover_image_path` from the accepted fields (no UI form submits it — the cover is owned solely by `uploadEventCoverAction`/`removeEventCoverAction`; `eventUpdateSchema` is `.partial()` so omission is valid). Comment added explaining why. Typecheck passes. |
| S3-2 | Low→Step 8 | `completeOnboardingAction` (`app/onboarding/actions.ts:96-99`) returns raw `error.message` to the browser — the only action file not routed through `safeActionErrorMessage`, so a PostgREST error naming a table/column/policy could reach the client. Cross-referenced here because it is an authz-adjacent write; **fixed in Step 8** (error-handling), where the redaction helper lives. | Deferred to Step 8. |
| S3-3 | — | `removeConnection` and `setMeetingLocationVisibility` carry no application-layer ownership filter, unlike every sibling function. Verified the RLS policies fully close the IDOR today; noted as the one place a future switch to the service-role client (or a policy regression) would have no second layer. Not a live bug. | No code change — the belt-and-braces `.eq()` would be defensive-only and the existing tests + policies already assert the behavior. Documented for reviewers. |
| S3-4 | — | No IDOR, no mass-assignment, no client-settable role/privilege, no internal-trust bypass found across all 25 actions, 7 route handlers and 6 client-reachable RPCs. | No action needed. |

---

## Step 4 — Data access rules

### RLS coverage — every table

The datastore is Supabase Postgres; RLS is the row/table permission system. The default-deny
migration (20260809211000) enables **and forces** RLS and revokes all grants from `anon`/
`authenticated` on the original 15 `public` tables. I verified that **every table created after
it** repeats the same three lines (enable + force + revoke) before granting anything back:

| Table | RLS enabled+forced | Client grants |
|---|---|---|
| `user_push_tokens` | yes | owner-scoped select/insert/update/delete (policies on `user_id = current_user_id()`) |
| `cities` | yes | select-only, `using(true)` (a dropdown list; no person-data) |
| `rate_limit_events` | yes | **none** — service-role only |
| `card_preview_views` | yes | column-scoped insert only; no client read (audit log) |
| `event_invites` | yes | scoped select + 3-column insert with graph-check WITH CHECK |

Three tables (`connection_attempts`, `app_config`, `pending_connections`) are **deliberately
policy-less and grant-less** (RLS forced, so every row denies) — the service-role-only audit
log, the verification thresholds, and an unbuilt flow. This is the intended "RLS enabled, no
policy" state the linter flags; not a defect. The `legacy` schema (archived contact-exchange
PII) has **no schema USAGE** for client roles, RLS forced on its table, and no grants — it is
unreachable over PostgREST regardless of any table grant. **No table is in permissive/allow-all
mode; `anon` holds no grant anywhere in the schema.** [verified in code]

### Service-role / admin credential exposure

- The service-role key bypasses RLS and is used by exactly the enumerated server-only callers
  (`ensureUser`, the connect store, geocode, push, the connect service's notify, the anonymous
  card-preview store) — never reachable by any client. Confirmed in Step 1 it is unprefixed,
  `server-only`, and absent from the built client bundle. A source-scan test
  (`no-second-write-path.test.ts`) enforces the caller allow-list. [verified in code + bundle grep]

### Least privilege on DB credentials

- The request path connects as **`authenticated`** via the minted 5-minute JWT — narrow
  column-scoped grants, every row filtered by RLS. The app never connects as `postgres`/owner
  for request work. The service role (which carries BYPASSRLS, inherent to Supabase) is confined
  to the narrow caller set above; the graph-write and rate-limit functions it calls are
  `security invoker` specifically so a mis-granted EXECUTE lands on a privilege-less role and
  fails rather than bypassing RLS. This is least-privilege as far as Supabase's role model allows.
  [verified in code]

### Over-return of sensitive fields

- **No `select("*")` anywhere** in `apps/web/src` (the one textual match is a doc comment).
  Every read uses an explicit column list. **No raw database row is spread into a response**
  (`...row`/`...data` appears only in a comment asserting its own absence). [verified by grep]
- The high-risk surfaces each use a hardcoded, field-by-field projection: the anonymous card
  preview (`PREVIEW_COLUMNS` — 7 fields; `status`/`photo_path` used internally, never returned
  raw), the feed service (explicit `id, first_name, last_name, username, photo_path`), the host
  RSVP queue (name/username/photo_path only — no email/phone), and the vCard builder (6 named
  properties). The `users` SELECT *grant itself* is column-scoped so `is_admin`/`kinde_user_id`/
  `status`/`email_verified` cannot be read even by a direct PostgREST query. Password hashes do
  not exist in this system (Kinde is the sole IDP; legacy hashes were never imported). [verified in code]

### Storage buckets

- `profile-photos` and `event-covers` are both created with `public = false` (private), with
  MIME allow-lists and 5 MiB size caps at the bucket level, and per-object RLS policies scoped to
  owner (`{user_id}/` prefix) / host (`is_event_host` on the event id parsed from the key) /
  `can_see_event`. Nothing is publicly listable or readable; images are served only through
  short-lived signed URLs. [verified in code]

### Findings

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| S4-1 | — | RLS is enabled and forced on every table (public and legacy); no permissive/allow-all policy; `anon` granted nothing; service-role confined to enumerated server callers and absent from the client; least-privilege connection roles; no over-return (explicit column lists throughout, no row spreads); both Storage buckets private with scoped policies. | No action needed — no findings. |

---

## Step 5 — Input validation and injection

A dedicated deep sweep (all seven sub-categories) plus my own independent verification. **Zero
exploitable injection or validation vulnerabilities.** Category-by-category, with the patterns
searched:

- **SQL/NoSQL injection — none.** All data access is the parameterized PostgREST builder
  (`.from().select().eq().in()`); there is **no** `.or(`, `.ilike(`, `.like(`, `.textSearch(`,
  `.match(`, or raw-SQL string anywhere in `apps/web/src` or `packages` (a source-scan test,
  `no-second-write-path.test.ts`, actively *forbids* those shapes on `users`/`social_links`).
  `.rpc()` calls pass named bind parameters. The only interpolated dynamic SQL is the default-deny
  loop, which uses `format('… %I …', t)` — **`%I` identifier quoting over a hardcoded table-name
  array**, no user input. [verified in code]
- **XSS — one sink, safe.** `local-timestamp.tsx:149` is the only `dangerouslySetInnerHTML`; its
  interpolated values go through `JSON.stringify(...).replaceAll("<","\\u003c")` so they cannot
  close the `<script>` tag, and the inputs are a React `useId()` and a DB timestamp, not free
  text. Everything else renders through React's default escaping. (The CSP `'unsafe-inline'`
  interaction is a Step 9 item.) [verified in code]
- **Command injection — none.** No `child_process`/`exec`/`spawn`/`execFile`/shell-out anywhere;
  image handling is delegated entirely to Supabase Storage, no local subprocess. [verified by grep]
- **Path traversal — none.** Every Storage key is server-derived: `${userId}/${randomUUID()}.webp`
  (profile) and `${eventId}/cover.{ext}` where `ext` comes from a fixed media-type map, never the
  client filename. Reads (`createSignedUrl`/`download`) use `photo_path` read from the DB, not from
  request input. Backstopped by bucket RLS that re-parses and validates the key. [verified in code]
- **SSRF — none.** The only two server-side fetches target **fixed constant hosts**
  (`api.mapbox.com`, `exp.host`); the sole user-derived parts are two `z.number().min().max()`
  range-validated coordinates in the Mapbox URL path — they cannot alter the host or reach
  `169.254.169.254`/internal addresses. The JWKS `new URL` is built from a trusted env value.
  No user-controlled host reaches any fetch. [verified in code]
- **Deserialization / templating — none.** No `eval`/`new Function` in shipped code. `JSON.parse`
  is used on the request body (typed `unknown`, then run through a `.strict()` Zod schema; token
  length-capped at 4096 *before* any MAC) and on a trusted env var. QR-token base64 decode is
  length-bounded and happens only *after* signature verification. No template engine is fed user
  input; no LLM exists in the runtime (prompt injection N/A). [verified in code]
- **Server-side validation coverage — good.** Every connect request schema is `.strict()`;
  every Route Handler and Server Action runs request fields through a Zod schema before use;
  GPS coords, card codes, UUIDs, and RSVP intents are all validated. File uploads are validated
  by MIME + size at the app *and* enforced by the bucket; bound route ids reach only ANDed
  `.eq()`/RPCs that re-derive authorization from the JWT. [verified in code]

### Findings

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| S5-1 | Low (not applied) | The form-fed insert/update schemas (`userProfileUpdateSchema`, `socialLinkInsertSchema`/`Update`, `eventInsertSchema`/`Update`) are plain `z.object()` — they **strip** unknown keys rather than `.strict()`-rejecting them, unlike every connect request schema. Not exploitable (real callers build these objects from explicitly-named `formData.get()` fields, so no unknown key is ever present; the column-level grant + RLS are the actual mass-assignment boundary). | **Attempted `.strict()`, then reverted.** Applying it broke `onboarding.test.ts`, which *deliberately* asserts the schema **strips** `has_completed_signup`/`is_admin`/`status` (documenting the strip-not-reject contract as "convenience; the grant is the stop that actually holds"). Changing strip→reject alters a tested, intentional contract — outside "preserve existing behavior," and the audit rule is to stop rather than work around a broken test. **Left as a recommendation** for the owner (Step 11): if adopted, it is a schema change *and* a test update to make together, deliberately. |
| S5-2 | — | No SQL/NoSQL injection, no command injection, no path traversal, no SSRF, no unsafe deserialization; one XSS sink verified safe; comprehensive server-side validation. | No action needed. |

**Build/test after step:** the `.strict()` change was reverted; tree is back to the last green
state; `pnpm turbo test` passes (3/3).

---

## Step 6 — Endpoint hardening and abuse

### Rate limiting

- Enforced **server-side** in Postgres (`rate_limit_consume`): records-then-counts (so concurrent
  requests err toward rejection and a rejected attempt still spends budget), fail-closed (a limiter
  error throws → refusal). Keyed per user / IP / card / session. The connect endpoints
  (per-IP 600/hr generous for shared venue NAT, plus per-user/per-session), the NFC path
  (per-user 60/hr + per-card 20/hr), and the anonymous card preview (per-IP 40/hr + per-card
  20→10/hr) are all covered. Auth endpoints (login/register/reset) are Kinde-hosted — rate
  limiting is Kinde's responsibility; there is no in-app password endpoint to limit. There is no
  search feature. [verified in code]
- Non-connect authenticated mutations (profile, events, social links) are not individually
  rate-limited, but they only touch the caller's own RLS-scoped data and trigger no paid
  operation, so the abuse ceiling is self-directed. Acceptable. [verified in code]

### CORS

- **No CORS headers are set anywhere**, and the CSP is `connect-src 'self'` — the app makes no
  cross-origin browser requests. No wildcard `Access-Control-Allow-Origin`, no origin reflection.
  Cookie-authenticated routes are additionally protected by the `checkSameOrigin` CSRF gate
  (`Sec-Fetch-Site`/`Origin`, forbidden headers a page cannot forge) which runs *before* auth.
  [verified in code]

### Debug / test / admin surfaces

- **None reachable.** No `internal`/`debug`/`admin`/`test` route directories; the temporary
  `/auth-check` and `/internal/photo-backfill` pages are retired and absent. Errors are redacted
  in production (Step 8). No verbose-error/debug flag is on. [verified by directory scan]

### File uploads

- Type + size validated at the app *and* enforced by the bucket (`allowed_mime_types`,
  `file_size_limit` 5 MiB); filenames are server-derived (no traversal); objects live in **private**
  buckets served only via short-lived signed URLs, with `X-Content-Type-Options: nosniff`. One
  informational note: bucket MIME enforcement is by the **declared** `Content-Type`, not magic-byte
  sniffing — but with private non-executable buckets, `nosniff`, and signed-URL serving under the
  stored content-type, there is no execution/XSS path from a mislabeled upload. [verified in code]

### Business-logic abuse

- No negative/zero quantities (`capacity` is `.positive()`); no client-supplied price/amount
  (no payments in the product); RSVP status is computed server-side under a `FOR UPDATE` row lock
  so races for the last seat serialize; waitlist promotion runs in the same transaction that frees
  a seat (never observably unclaimed); re-request after denial lands in `pending` (grants nothing);
  the verification session is **single-use, enforced atomically** in `create_verified_connection`
  (`status='active'`→`consumed` in one transaction, `session_not_consumable` on race) which closes
  screenshot-replay; five failures burn a session. No coupon/credit/balance to reuse. [verified in code]

### Cost abuse

- The two paid/outbound operations (Mapbox geocode, Expo push) fire **only after a committed,
  physically-verified connection** — an unauthenticated caller cannot trigger either. The anonymous
  card-preview path performs no paid operation (DB read + URL signing; it does not call Mapbox).
  Both optional credentials fail safe. No LLM/SMS/email is reachable by an anonymous caller. [verified in code]

### Prompt injection

- **N/A** — no LLM anywhere in the runtime (confirmed: no `openai`/`anthropic`/`ai-sdk`/`langchain`
  dependency or call site). [verified by grep]

### Findings

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| S6-1 | **Medium** | The per-IP rate-limit **subject key is spoofable on any ingress not fronted by Cloudflare.** `clientIpFrom` (`request-context.ts`) prefers `cf-connecting-ip` (unforgeable behind Cloudflare) but falls back to the **left-most** `x-forwarded-for` entry, which is caller-supplied. On the production domain (`smartcard.tech`, behind Cloudflare) `cf-connecting-ip` is present and authoritative — safe. But the raw `*.vercel.app` deployment URL is not behind Cloudflare, so there `cf-connecting-ip` is absent and an attacker sending `X-Forwarded-For: <random>` gets a **fresh per-IP budget on every request**. **Exploit path:** an attacker holding a leaked list of valid card codes reaches the app via its `*.vercel.app` URL and rotates `X-Forwarded-For` to defeat the 40/hr per-IP cap, bulk-scraping cardholders' contact details (name, phone, email, social handles) from the anonymous `/card/<code>` + vCard endpoints — the product's only unauthenticated read path, whose per-IP budget the code itself documents as "the only thing bounding how much contact data one host can pull." The non-spoofable **per-card** limit (20→10/hr, keyed on the resolved card id) still bounds abuse of any *single* card, which caps the severity. | **Not fixed in code — the correct fix is infrastructure, and changing the header-trust logic blind would risk mis-attributing every real caller.** Deriving a trustworthy client IP depends on the exact proxy chain (how many hops, which platform header is authoritative), which is not knowable from the repo, and a wrong change (e.g. charging everyone to `"unknown"`) would break rate limiting for legitimate users — a design decision the audit rules say to log, not guess. **Manual actions (Step 11):** (a) make the `*.vercel.app` deployment URL unreachable by the public — enable Vercel **Deployment Protection** (or restrict origin access to Cloudflare only) so every request to the app transits Cloudflare and `cf-connecting-ip` is always present; and/or (b) if the app must serve non-Cloudflare ingress, replace the `x-forwarded-for` left-most fallback with the platform's own trusted client-IP header for that ingress (a deliberate, topology-specific change). |
| S6-2 | Low | Upload MIME is enforced by declared `Content-Type`, not magic bytes. | No action — private buckets + `nosniff` + signed-URL serving under the stored type leave no execution/XSS path; noted for awareness. |
| S6-3 | — | Server-side rate limiting (fail-closed), no CORS exposure + CSRF gate, no debug/admin endpoints, safe uploads, race-safe business logic with atomic single-use sessions, no anonymous cost-abuse path, no LLM. | No action needed. |

**Build/test after step:** no code change this step; tree remains green.

---

## Step 7 — Dependencies and supply chain

`pnpm audit` reports **2 high-severity advisories, both the same package** (`image-size`), and
**nothing critical**.

### The advisories

| Package | Installed | Advisory | Patched | Class |
|---|---|---|---|---|
| `image-size` | 1.2.1 | GHSA-5p2g-fcmc-qvqq / ICNS + JXL/HEIF parser infinite-loop **DoS** | `>=2.0.3` | **Build-time / dev tooling** |

- **Dependency chain:** `apps/mobile → expo → @expo/cli → @expo/metro → metro → image-size`.
  This is **Metro, the React Native bundler** — it runs at *build/bundle time*, not in any shipped
  runtime. (`npm audit` marks it `dev:false` only because Expo lists its CLI under `dependencies`;
  functionally it is build tooling.)
- **Not in the deployed runtime.** The **web app is the only deployed artifact** (Vercel
  serverless), and its `package.json` contains none of `expo`/`metro`/`react-native`/`image-size`
  — `next build` never bundles this package. The **mobile app is an unbuilt scaffold** ("under
  construction"), so its bundler is not run in any production pipeline either.
- **In-context severity: Low.** The DoS requires feeding a crafted image to Metro's bundler at
  build time (a developer's own machine or CI) — there is no production runtime attack surface.
  The advisory's own High rating is the generic CVSS for the DoS, not its reachability here.

### Why the upgrade is NOT applied

Installed `image-size@1.2.1` → patched `>=2.0.3` is a **major version bump (1.x → 2.x)**. The audit
rules forbid applying any cross-major upgrade or `audit fix --force`. Forcing `image-size@2.x`
via a `pnpm.overrides` entry would be exactly that cross-major change and could break Metro, which
is written against the 1.x API. **Proposed as a manual decision (Step 11):** upgrade the Expo SDK
/ Metro toolchain to a release whose own dependency range already pulls `image-size >=2.0.3` (a
framework upgrade with its own breaking-change review), or — only if the mobile bundler must be
pinned — add a tested `pnpm.overrides` for `image-size` and verify a full Metro bundle still
succeeds. Neither is safe to do blind in this pass, and neither affects the deployed web app.

### Other supply-chain checks

- **Runtime vs dev separation:** the two advisories are build-tooling only; **no runtime
  (web-app) dependency has a high/critical CVE.** [verified]
- **Pinning:** all direct dependencies use caret ranges resolved to exact versions by
  `pnpm-lock.yaml`; `pnpm install --frozen-lockfile` succeeds. The only `>`-range is
  `engines.node: ">=22"` (an engine constraint, not a package). No `*`/`latest`/`x` ranges. [verified]
- **Install/postinstall scripts:** none in any workspace `package.json`. [verified]
- **Typosquat / abandoned:** the direct dependency set is all well-known, actively-maintained
  packages (Kinde, Radix, Supabase, `jose`, `jsqr`, Next.js, React, Zod, Tailwind, `lucide-react`,
  `qrcode.react`, `clsx`, `class-variance-authority`, `tailwind-merge`, `server-only`). No
  name-confusable or abandoned direct dependency spotted. [verified by inspection]
- **CI/CD injection:** **N/A, with evidence** — there is no `.github/`, no `vercel.json`, no GitLab
  CI, no workflow file of any kind in the repo. Deploys use Vercel's default git integration, so
  there is no in-repo pipeline that could be triggered by untrusted input, leak secrets to a
  fork-originated run, or pin an unpinned third-party action. If GitHub Actions are added later,
  that config becomes a new audit surface. [verified by directory scan]
- **Unused dependencies:** a spot check of the web app's declared dependencies found each one
  imported in `apps/web/src`; no clearly-unused direct dependency was found. A full `depcheck`
  pass was not run (this environment's egress restrictions), so this is not exhaustive. [inferred]

### Findings

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| S7-1 | Low (High CVE, build-tooling context) | `image-size@1.2.1` DoS (2 advisories), transitive via Expo/Metro in the mobile scaffold; not in the deployed web runtime. | **Not fixed — patch is a forbidden major bump.** Listed as a manual action: upgrade Expo/Metro (major, own review) or add a tested override. No production runtime exposure. |
| S7-2 | — | No critical CVEs; no runtime-dep high CVE; all versions pinned via lockfile; no install scripts; no typosquat/abandoned direct deps; no CI config to be injected. | No action needed. |

---

## Step 8 — Client-side exposure and error handling

### What ships to the browser

- **One** client-convention variable exists (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) — public by
  design and, in practice, read only server-side. **No secret reaches the bundle** (verified in
  Step 1 by building with sentinel secrets and grepping `.next/static`). No `EXPO_PUBLIC_` var
  anywhere. [verified]
- No client component makes a direct `fetch()` (network goes through the same-origin
  `@smartcard/api-client`), no secret/token is passed as a prop, no internal hostname or endpoint
  is embedded in client code (URLs are derived from `window.location.origin`), and the minted
  Supabase token never leaves the server. [verified — client sweep]
- **Source maps:** `productionBrowserSourceMaps` is not enabled (defaults off). No commented-out
  credentials, no unused admin/debug code in client bundles. [verified]
- Client-side storage holds only a random, non-identity `deviceId` that participates in no
  verification check. No `document.cookie` usage; the session is the Kinde HttpOnly cookie handled
  server-side. [verified]

### Reliance on client-side checks

- No security decision rests on a client-side check. The two candidates both have server
  enforcement behind them: the event host-queue `role !== "host"` UI guard is backed by the
  `event_rsvp_queue` RPC's `is_event_host` gate, and the privileged `override` flag on the RSVP
  decision is a **bound** Server Action argument (not form data), so it cannot be flipped by a
  crafted POST. [verified in code]

### Error handling (the actionable fix)

- The connect path and 6 of 7 `"use server"` files already redact errors through
  `safeActionErrorMessage`/`userFacingMessage` (opt-in: only a `UserFacingError` message crosses
  to the browser; everything else becomes one generic sentence, the real error logged server-side).
- **`onboarding/actions.ts` was the exception** (S3-2): `completeOnboardingAction` *caught* service
  errors and *returned* `error.message` verbatim in its `ActionState`, which Next.js renders to the
  user unredacted (unlike an *uncaught* action error, which Next does redact in production). So a
  PostgREST failure inside `updateOwnProfile`/`assertSignupCompleted` — table/column/constraint/
  policy names, the exact schema map `server/errors.ts` was written to withhold — could reach the
  browser. (`deleteAccountAction` in settings was checked and is safe: it returns `void` and lets
  errors propagate *uncaught*, which Next redacts.)

### Findings

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| S8-1 | Low | `completeOnboardingAction` returned raw `error.message` to the browser (the only action file not using the redaction helper), leaking PostgREST schema detail on any DB failure during onboarding. Low because it requires triggering a DB error on your own onboarding write and discloses schema names, not another user's data. | **Fixed**: routed the catch through `safeActionErrorMessage(error, "onboarding")` and made the auth guard throw `UserFacingError`, matching every sibling action file. Full detail still logged server-side. Typecheck + tests green. |
| S8-2 | — | No secrets in the client bundle; no source maps; no client-side-only security checks; all other action error paths already redacted. | No action needed. |
