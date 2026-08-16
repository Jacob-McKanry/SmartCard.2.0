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
