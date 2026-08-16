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
