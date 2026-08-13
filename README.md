# SmartCard 2.0

**"Instagram, but everyone in it is someone you've actually met in person."**

A private social app where every connection is created through verified physical, in-person contact — an NFC tap or a GPS-verified QR scan — and never any other way. No stranger search, no follow/following, no global directory. This is a from-scratch rebuild; nothing here shares code with the legacy SmartCard app.

Web (Next.js), iOS/Android (React Native + Expo), and a shared TypeScript core in one monorepo.

---

## Documentation standards (non-negotiable)

This project is built and maintained by AI coding agents on behalf of a non-specialist owner. That makes documentation quality a correctness requirement, not a nicety. Every contributor — human or agent — follows these rules with no exceptions:

- **Write for a senior engineer who wasn't in the room.** Every module, migration, RLS policy, and security-critical function needs documentation that explains the *why*, not a restatement of the code. If a reader would ask "why did they do it this way?", answer it in a comment or the adjoining doc — don't make them reverse-engineer intent.
- **Security and data-access decisions are documented in plain language**, not just in code. Anyone reading the repo should be able to understand *why* a check exists — what it defends against — without first understanding the implementation.
- **No decision silently diverges from the signed-off architecture.** The architecture proposal (see `docs/architecture/`) is the source of truth. If implementation reveals a reason to deviate, the deviation and its reasoning are written down where the original decision lived, not left implicit in a diff.
- **Commit messages explain why, not just what.** "Fix bug" or "update schema" are not acceptable; state the problem being solved.
- **Comments are precise and minimal, not decorative.** Don't narrate obvious code. Do capture non-obvious constraints, invariants, and the reasoning behind anything that would otherwise look arbitrary (a magic number, a specific ordering, a check that looks redundant but isn't).
- **Every database migration includes a comment block** stating what it changes, why, and — for RLS policies — exactly what access it grants or forbids and to whom.
- **README and phase docs are updated as part of the change that makes them stale**, not as cleanup work later.

Treat this as the standard a professional architect would hold a team to on a codebase that handles real people's location data and identity. Sloppy or absent documentation on this project is a defect, on par with a bug.

## Project structure

```
apps/
  web/          Next.js web app
  mobile/       Expo (React Native) app
packages/
  core/         Platform-independent business logic (connection verification, feed rules, etc.)
  types/        Shared Zod schemas + derived TypeScript types
  api-client/   Typed client for calling the API from both apps
docs/
  architecture/ Signed-off architecture decisions and their rationale
```

## Status

**Built and applied:** the database schema and Row Level Security policies (`supabase/migrations/`, mirrored as Zod schemas in `packages/types/src/db/`), **the legacy data import**, **the Kinde → Supabase auth bridge on web** (`apps/web/src/server/`), and — also as of 2026-08-13 — **the Profile feature on web** (`apps/web/src/app/profile/`, `apps/web/src/server/profile/`). The connection-verification logic (Connect Flow) is still to build.

**Legacy import completed 2026-08-13** (architecture §6; transformation logic and verification queries in `supabase/seed/`). 337 users, 7,142 cards (333 assigned / 6,809 unassigned), 465 social links, and 1,813 `contactexchange` rows archived into a service-role-only `legacy` schema. Every table was verified byte-identical to the source export by content checksum, not just by row count — which is what caught the one real corruption in the run (a mangled newline in a single bio). Three things a reader should know:

- **Legacy passwords were never imported.** Kinde is the sole identity provider, so the old bcrypt hashes have no role here; importing them would create a credential store nothing authenticates against and everything could leak.
- **Photos are not in yet** — `photo_path` is NULL for every user, pending a follow-up pass. The paths are preserved in `supabase/seed/2026-08-13_legacy_photo_paths.csv`. See the §6.5 deviation for why this one piece was safe to split out when the rest was not.
- **One social link was deliberately skipped** (of 466) because its stored value contained two different URLs with no way to tell which was the person's actual profile. Guessing would have published a link pointing strangers at somebody else's account.

**Architecture updated 2026-08-13** (`docs/architecture/`). Two things changed:

- A round of product decisions was recorded as amendments to the sections they affect (tracked as Q16–Q24): card taps connect instantly but now notify the card owner in real time so a lost card can be revoked immediately; the GPS proximity check automatically relaxes its radius once for a pair that has failed it repeatedly; meeting place names are filled by automatic server-side reverse geocoding; the "who's going" hook shows going and interested as two separate counts; push notifications go through Expo; and the legacy data migration is confirmed as a single complete import.
- A new **§8 designs Friend Proximity** (mutual per-connection location sharing, post-pilot Phase 3) — schema sketch, permission model, protected zones, and threat model. It is **design only**: no tables, no migration, nothing applied, and it is waiting on sign-off (Q26).

**Auth bridge landed 2026-08-13** (architecture §5, Q7 resolved — see the §5.4 amendment for the evidence and the reasoning). Until this existed, `auth.uid()` returned nothing and every RLS policy denied every row for every client: the schema failing closed exactly as designed, but also the reason the migration checklist's most important line — "spot-check RLS as a real migrated user" (§6.6) — could not be run, because it could not tell "RLS is correctly protecting this user's data" from "everything is denied because auth is not wired up". **That check has now been run against a real migrated user and passes**: their own row, social links and cards are visible; every other user's row, links and cards return zero; no session at all still returns nothing. Three things a reader should know:

- **Supabase cannot be pointed at Kinde directly, and this was checked rather than assumed.** Third-Party Auth still supports only a named list (Clerk, Firebase, Auth0, Cognito, WorkOS). More decisively, `auth.uid()` casts the token's `sub` to a uuid and every Kinde id is `kp_<32 hex>` — a raw Kinde token makes policies *error*, not deny. So our API verifies the Kinde token against Kinde's JWKS, resolves it to a `users` row, and mints a 5-minute Supabase token whose `sub` is that row's id.
- **New accounts are created server-side, never by the client.** A client able to insert its own `users` row is a client able to choose its own `kinde_user_id` — which is choosing which account it is. That one function is the only thing in the app that uses the service-role key; everything else queries through RLS.
- **Two secrets are still needed** before the flow can be exercised over real HTTP: `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_JWT_SECRET`, both from the Supabase dashboard. `.env.local` says exactly where.

**Profile landed 2026-08-13** (README build order item 1; `apps/web/src/app/profile/`). View + edit of the signed-in user's own identity — photo, name, bio, company, role, phone, username, email-opt-in, and social links (add/edit/remove) — one identity shown identically to everyone, no persona split, exactly the columns and CRUD the RLS grants in `20260809211100_rls_policies_identity_and_cards.sql` already allow. Every mutation is a Next.js Server Action going through the same RLS-bound Supabase client the auth bridge produces — never the service role. Three things a reader should know:

- **`/auth-check` is retired.** It was explicitly temporary — its one job was proving the auth bridge worked before any real feature existed to prove it by using it. Every `/profile` page load now exercises that exact chain (Kinde session → verified token → `public.users` row → minted Supabase JWT → RLS-bound query) on real production code, so the standalone diagnostic's job is done. Its negative checks ("a stranger's row returns zero rows") don't have an automated home yet — this repo has no test runner configured at all (checked: no `vitest`/`jest` anywhere in the workspace) — so a proper regression test is a real follow-up, not something folded in here.
- **The `profile-photos` Storage bucket got its first real access policy.** It existed since the legacy-import pass but had no policy at all — every read/write was denied to every role. `20260813191041_storage_rls_profile_photos.sql` grants an authenticated user INSERT/SELECT/UPDATE/DELETE on objects under their own `{user_id}/` prefix only, verified by simulated-session SQL (two real user ids, cross-user insert/update/delete all denied, own-prefix operations all succeed — this sandbox cannot reach the Storage HTTP API directly, same restriction already recorded against the legacy photo import). Photos are still never served as raw Storage URLs — a short-lived signed URL is minted per render (`apps/web/src/server/profile/photo-url.ts`).
- **shadcn/ui is initialized** (`apps/web/components.json`, `apps/web/src/components/ui/`) — zinc/new-york, restrained by design for a private, intimate product rather than a marketing site. `ui.shadcn.com` is blocked by this environment's egress policy (same restriction as the Storage API), so the CLI's own registry fetch couldn't run; the config and primitives (`button`, `input`, `textarea`, `label`, `avatar`) are hand-authored to match its standard output instead of generated by it.

**Next up, in order:** the photo backfill (deferred from the legacy import, §6.5), then the Connect Flow (§4) — NFC + QR/GPS, the highest security priority in the product. Mobile Kinde wiring is deliberately not started — it needs the EAS development build (§7.2) and the web proof should be reviewed first.

See the architecture proposal for the full stack, schema, RLS strategy, and connection-verification design; §3.6 records the judgment calls made while implementing the schema, and the 2026-08-13 amendments record theirs the same way. Build order for the first pilot:

1. Profile
2. Connect flow — NFC + QR/GPS (highest security priority)
3. Mutual connections + meeting record
4. Meeting feed, including the triadic "A met B" post
5. Events — RSVP + "who's going"

Messaging and the non-user landing/pending-connection flow are deferred past the first pilot.

## Getting started

**Prerequisites:** Node 22+, and [Corepack](https://nodejs.org/api/corepack.html) enabled (`corepack enable && corepack prepare pnpm@latest --activate`) — this repo uses pnpm workspaces + Turborepo, pinned via `packageManager` in `package.json`, so plain `npm`/`yarn` won't work correctly here.

```sh
pnpm install
```

**Web (Next.js):**

```sh
pnpm --filter web dev
```

**Mobile (Expo):**

```sh
pnpm --filter mobile start
```

NFC work later in the build order needs an EAS development build, not Expo Go — see `docs/architecture/` §7.2.

**Environment variables** come from a single `.env.local` at the repo root (gitignored — never committed). Both apps' dev scripts load it directly rather than keeping a per-app copy. If it's missing, ask the project owner for values.
