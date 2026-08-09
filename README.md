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

Pre-implementation. See the architecture proposal for the full stack, schema, RLS strategy, and connection-verification design. Build order for the first pilot:

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
