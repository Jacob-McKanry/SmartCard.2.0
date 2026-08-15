# Mobile scoping — what exists, what is missing, and in what order to build it

**Date:** 2026-08-15
**Status:** Scoping only. Nothing in this document is built, and nothing in `apps/`, `packages/` or `supabase/` was changed to write it. It is a plan to be signed off, in the sense CLAUDE.md's "Plan before building" means — the phases below are proposals, not a queue that starts running.
**Scope:** `apps/mobile`, and the parts of `apps/web` and `packages/*` that mobile depends on.

---

## 0. Why this exists, and why it is not a convenience feature

Two things make mobile load-bearing rather than a second front-end.

**The card-tap push notification has never fired for anyone, because zero devices are registered.** §4.7 threat 7 is the lost-or-stolen-card threat, and Q17 deliberately removed the last *preventive* control from that path: a tap connects instantly, no owner confirmation. What replaced it is a *detective* control with two halves — a push the instant a tap commits, and an in-app record for anyone whose notifications are off. The second half was built on 2026-08-14 as `/activity` (Q28). **The first half has never worked**, not because it is broken but because there is nowhere to send to: `user_push_tokens` has no rows and no code path anywhere registers one. `apps/web/src/server/connect/push.ts:151` logs `no_registered_tokens` on every tap and always has. Mobile is what completes that control. Until it exists, threat 7's defence is running on one leg, and the leg it is running on is the slower one.

**§5.2 designs a mobile auth path that has never been built.** Expo, public client, PKCE, tokens in `expo-secure-store`, `Authorization: Bearer`. Parts of the server side were built ahead of it (§2.5 below) and parts were not (§2.6), and the split between those two is the single most misleading thing about the current state of this repo.

---

## 1. The verified starting point

Everything in this section was read, not inferred from the architecture doc's prose. File references are exact.

### 1.1 `apps/mobile/` is the Expo template, plus real monorepo wiring

It is a **bare Expo scaffold** — `explore.tsx`, the React logo, `reset-project.js`, an "under construction" home screen. 1,368 lines total across all TypeScript/JSON, most of it template. There are no SmartCard screens of any kind.

What is *not* template, and is genuinely valuable:

- **`apps/mobile/metro.config.js`** — the pnpm/Metro monorepo problem is solved. `watchFolders` points at the repo root and `resolver.nodeModulesPaths` includes the hoisted root `node_modules`, matching `pnpm-workspace.yaml`'s `nodeLinker: hoisted`. This is the setup that eats an afternoon when it is not done. It is done.
- **`apps/mobile/src/app/index.tsx`** — imports `placeholder` from `@smartcard/api-client` for the express purpose of proving `apps/mobile → packages/api-client → packages/types` resolves at build time. Its comment already states, correctly, why mobile does *not* import `@smartcard/core`'s verifiers (they hold the QR signing secret; §7.4 keeps the phone off the database).
- Dependencies already declared: `expo-auth-session`, `expo-secure-store`, `expo-linking`, `expo-web-browser`, `expo-device`, `@tanstack/react-query`, `zustand`, `nativewind`, `zod`. That is §5.2's shopping list, present but unused.

What is missing from `apps/mobile/app.json`, and each is a real task:

| Missing | Consequence |
|---|---|
| `name` / `slug` are both `"mobile"`; `scheme` is `"mobile"` | The EAS project is created from the slug. Renaming after the fact is fiddly. **Fix identity before creating the EAS project, not after.** |
| No `ios.bundleIdentifier`, no `android.package` | Cannot build anything. Both are effectively permanent once submitted to a store. |
| No `extra.eas.projectId` | `getExpoPushTokenAsync()` requires it (§7.4's `EXPO_PUBLIC_PROJECT_ID`). No push token can be minted without it. |
| No `ios.associatedDomains`, no Android `intentFilters` | Universal/App Links do not work. A tapped card opens a browser. |
| No usage-description strings (`NFCReaderUsageDescription`, `NSCameraUsageDescription`, `NSLocationWhenInUseUsageDescription`) | iOS terminates the app on first use of the capability. §7.2 lists these. |
| No `expo-notifications` config plugin | Reported as the specific reason iOS push silently fails on SDK 53+ even when everything else is right. |
| Not in the dependency list at all: `expo-notifications`, `expo-camera`, `expo-location`, any NFC library | The four native capabilities the product needs. None present. |
| No `eas.json` | No build profiles. §7.2's `development`/`preview`/`production` table describes a file that does not exist. |

Also worth knowing: `apps/mobile/package.json` declares no `build` and no `test` script, so `turbo run build` and `turbo run test` skip it entirely. `lint` and `type-check` do run. CI currently proves nothing about whether mobile compiles into an app.

### 1.2 `packages/api-client/` — right shape, two gaps

`packages/api-client/src/connect.ts` covers exactly four calls: `createQrSession`, `heartbeatQrSession`, `redeemQr`, `redeemNfc`. Its header already anticipates mobile ("mobile will call the exact same routes over HTTP later"), it validates every request and response against the same Zod schemas the routes use, and it takes an injectable `fetchImpl` and `baseUrl`. **It is pure `fetch` + `zod` with no DOM dependency — it works in React Native as written.**

Two gaps, both small and both real:

1. **No `Authorization` header.** `postConnect` sends `Content-Type` and nothing else (`connect.ts:126-130`). Web works because it is a same-origin fetch carrying the Kinde cookie. Mobile has no cookie. `ConnectApiOptions` needs a way to supply a bearer token — the natural shape is an async `getToken?: () => Promise<string | null>`, so a screen never handles a refresh race by hand.
2. **It covers connect and nothing else.** No profile, no connections, no activity, no events, no push registration. See §1.6.

### 1.3 `packages/core/` — reusable unchanged, and the reasons are already written down

This is the part of the monorepo that pays off. `packages/core` has two dependencies: `@smartcard/types` and `zod`. **No Node builtins anywhere** — `qr-token.ts` uses `globalThis.crypto.subtle` and its header says explicitly why: "§1.3 requires `packages/core` to be importable unchanged by both a server and a phone… `node:crypto` is not [available in React Native]".

What mobile will actually import:

- `haversineDistanceM`, `isUsableCoordinate`, `LatLng` — for showing a distance, never for deciding one.
- `userFacingMessage` — so a rejection reads identically on both platforms.
- `deriveDecidedRsvp` / `seatsRemaining` / the rest of `events/rsvp-rules` — display-side only, as the export comment says.
- Types throughout: `GpsFix`, `RejectionReason`, `VerificationMethod`.

What mobile must **not** import, and cannot: `sealVerified()` is deliberately not re-exported from `packages/core/src/index.ts`, and `package.json` declares `"exports": { ".": … }` so it cannot be deep-imported. That makes "no client assembles a connection itself" a compile error. Keep it that way. The verifiers (`createQrVerifier`, `createNfcVerifier`) and `createVerifiedConnection` are exported but useless to a client — they need the QR signing secret and a `ConnectStore`, both server-only.

**A concrete recommendation that falls out of reading these files.** Three modules in `apps/web` are pure TypeScript state machines with type-only imports and no React, no DOM:

- `apps/web/src/app/(app)/connect/present/presenter-state.ts`
- `apps/web/src/app/(app)/connect/scan/scanner-state.ts`
- `apps/web/src/app/(app)/connections/[connectionId]/location-sharing.ts`

Each already has an adversarial test file beside it. §1.4 forbids sharing *UI components* between web and mobile — it says nothing about state machines, and duplicating the presenter's rotation/heartbeat/consumed logic into a second hand-written copy is exactly the drift §1.7 exists to prevent. **Judgment call for sign-off: promote `presenter-state.ts` and `scanner-state.ts` into `packages/core/src/connect/` (with their tests) as part of the phase that builds the mobile Connect screens, rather than copying them.** The denial-reason unions they import (`LocationDenialReason`, `CameraDenialReason`) would move too; the web's `geolocation.ts` and `camera.ts` — which *are* browser-specific — stay where they are and keep producing those types. This is a deviation from nothing, but it is a change to a signed-off package boundary and should be agreed rather than done quietly.

### 1.4 The push send path is complete. Only the device half is missing.

`apps/web/src/server/connect/push.ts` is finished work: it posts to Expo's push API with `EXPO_ACCESS_TOKEN`, coalesces repeat taps, marks `DeviceNotRegistered` tokens `disabled_at`, bounds the call at 5 seconds, resolves rather than throws on every failure path, and logs the "nobody is registered" state at `info` specifically so it does not look like success. Payload content is constrained to the tapper's display name plus `data: { type: "card_tap", connectionId }`.

`user_push_tokens` (`supabase/migrations/20260813210100`) is applied, with self-only RLS, a `(user_id, device_id)` unique constraint for idempotent re-registration, a global unique on the token so a re-signed-in device takes it from the previous owner, and `disabled_at` excluded from the `authenticated` grants by column-level grant. `packages/types/src/db/user-push-tokens.ts` mirrors it and already exports `userPushTokenRegistrationSchema` — the exact request body a registration endpoint should accept, with `user_id` deliberately absent.

**So precisely four things are missing between here and a phone buzzing:**

1. `expo-notifications` in the app: permission request, `getExpoPushTokenAsync()`, `EXPO_PUBLIC_PROJECT_ID`, the config plugin, and a notification-response handler that deep-links to the connection.
2. A server endpoint the phone can POST the token to. It cannot write `user_push_tokens` directly — §7.4 forbids the phone holding a Supabase credential — so this is a new Route Handler, roughly `POST /api/push/register` (+ a delete on sign-out), validating with `userPushTokenRegistrationSchema` and upserting on `(user_id, device_id)` through the caller's own RLS-bound client.
3. **That endpoint needs bearer auth, which does not exist.** See §1.6.
4. EAS push credentials: an APNs key uploaded to Expo, FCM credentials for Android, and `EXPO_ACCESS_TOKEN` set on Vercel. All three are human tasks (§3).

### 1.5 The server already accepts a mobile token's `azp` — confirmed

`apps/web/src/server/env.ts:93-101`, `kindeAllowedClientIds()`, reads `KINDE_CLIENT_ID` (required) and `KINDE_MOBILE_CLIENT_ID` (optional, included when set). `apps/web/src/server/auth/kinde-identity.ts:128-139` rejects a token with no `azp` at all and rejects one whose `azp` is not on that list. `KINDE_MOBILE_CLIENT_ID` is declared in `turbo.json`'s build env list, so it survives the Vercel build. `verifyKindeAccessToken` pins RS256, pins the issuer, and fetches Kinde's JWKS remotely — none of that cares whether the token came from a browser or a phone.

**This is real and it is done.** A verified Kinde token minted for the SmartCard Mobile application will pass identity verification today, with no code change, as soon as `KINDE_MOBILE_CLIENT_ID` is set in the environment.

### 1.6 The thing that looks done but is not: nothing reads an `Authorization` header

This is the most important finding in this document, and it is easy to miss precisely *because* §1.5 is true.

`getAuthenticatedContext()` (`apps/web/src/server/auth/current-user.ts:55`) starts with `getKindeServerSession()` and `session.getAccessTokenRaw()` — the Kinde SDK's **encrypted HttpOnly cookie**. Grepping the whole of `apps/web/src` for a read of the `Authorization` header returns nothing but comments. There is no `middleware.ts`. All 29 files that call it — including `readAuthenticatedRequest()` in `apps/web/src/server/connect/route-helpers.ts:59`, which every `/api/connect/*` route goes through — resolve identity from that cookie and only that cookie.

**Consequence, stated plainly: a mobile app that does everything §5.2 specifies — PKCE, secure store, `Authorization: Bearer <token>` — gets a 401 from every endpoint in this codebase today.** The `azp` allow-list will never be consulted, because nothing extracts a token for it to check.

What is needed is small but is genuinely security-critical work, not plumbing: a sibling entry point (say `getAuthenticatedContextFromBearer(request)`) that reads the header, then reuses `verifyKindeAccessToken` → `ensureUser` → `mintSupabaseAccessToken` → `rlsClient` *unchanged*. Three constraints it must honour, all already written down in the code it would sit beside:

- **Read the token from the `Authorization` header only** — never a query parameter, never a body field. A token in a URL lands in logs and referrers.
- **Do not copy `withProfileClaimsFromSession()`.** Its own doc comment (`current-user.ts:76-92`) says why: it reads profile claims from the SDK's cookie session, which is trustworthy *because* it is an encrypted cookie written by a server-side exchange. Mobile has no such cookie. If the mobile path needs `email`/`given_name`/`family_name` to seed a new row, it must verify the **ID token** against Kinde's JWKS the same way, never trust a request body. The invariant is that profile claims attach only to an identity that was actually verified.
- **CSRF changes shape, and mostly in our favour.** §4.7 threat 5 already notes "mobile uses bearer tokens, not cookies, so CSRF doesn't apply". Accepting *both* a bearer header and a cookie on the same route is fine — the danger would be accepting a token from somewhere a cross-site page can plant it, which the header is not.

Because this is auth work touching the connect path, CLAUDE.md's model table puts it at Opus / xhigh. It is not a fifteen-minute change and should not be scoped as one.

### 1.7 The API surface is four routes. Everything else is Server Actions, which mobile cannot call.

`apps/web/src/app/api/` contains exactly five files: the Kinde catch-all, and the four connect routes. Every other feature in the product — profile view and edit, connections list and detail, the meeting feed, events browse/create/RSVP/invites, activity, revoke-card, remove-connection — is React Server Components plus `"use server"` Server Actions (nine files). **Server Actions are a Next.js-internal RPC protocol bound to a rendered page's action id. A React Native app cannot call them.**

This is the single largest hidden cost in mobile, and it is not visible from `apps/mobile`. Feature parity means writing Route Handlers for surfaces that currently have none. The good news is that the *service layer* is already separated and reusable — `apps/web/src/server/{profile,connections,feed,events,activity,cards}/…-service.ts` all take an RLS-bound client and return typed data, so a Route Handler is a thin authenticated wrapper, not a reimplementation. The bad news is that it is still N endpoints, N Zod contracts in `packages/types`, and N functions in `packages/api-client`, each of which is a place where web and mobile can drift.

**Judgment call: do not attempt parity.** The phases in §4 give mobile the surfaces that need to be native (push, tap, scan) and read-only versions of the rest, and leave editing on the web.

---

## 2. What mobile NFC can actually do — and what it cannot

People will assume the app "does NFC". Be precise about which part, because the gap between the two readings of that sentence is large and the wrong one is already excluded by CLAUDE.md.

**What it CAN do — read a physical SmartCard.** The tags are permanently encoded with `https://smartcard.tech/card/<code>` (§2.2, Q1, confirmed by tapping a production card). Reading an NDEF URL tag is supported on both platforms: Android broadly, iOS via Core NFC on iPhone 7 and later.

**And the surprise: for most of the pilot's phones, the app does not need to implement NFC reading at all.** On iPhone XS and later, iOS reads NDEF URL tags **in the background** with no app open, shows a notification banner, and — if the URL matches a domain in the app's `associatedDomains` entitlement — routes it into the app as a Universal Link rather than to Safari. Android does the same thing through App Links and the NDEF intent. So the primary card-tap flow is delivered by **§7.3's deep-link setup, not by an NFC library**:

1. `smartcard.tech` serves `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`. **Neither file exists today** — `apps/web/public/` contains five SVGs and nothing else, and the domain is not yet pointed at the Vercel project (Q15 is resolved as a decision, not as a completed action).
2. The app declares `associatedDomains: ["applinks:smartcard.tech"]` and matching Android intent filters.
3. The app owns a `/card/[code]` route that posts to `POST /api/connect/nfc/redeem` — the same call `apps/web/src/app/card/[code]/card-redeem-flow.tsx` already makes.

An in-app "Scan a card" button using Core NFC / `react-native-nfc-manager` is worth adding, but as a **secondary** path: it covers iPhone 7/8/X (no background reading), covers the case where the banner is dismissed, and gives a discoverable affordance. It requires the iOS **NFC Tag Reading** capability, which requires a paid Apple Developer account and a provisioning profile — it cannot be added later without a rebuild.

**What it CANNOT do — be the card.** Phone-to-phone NFC needs one device to emulate a tag (Host Card Emulation). Android supports HCE; **iOS does not expose general-purpose HCE to third-party apps** — the limited entitlement Apple has opened is restricted to specific wallet-style use cases and is granted case by case. So an iPhone cannot present itself to another phone as a SmartCard, which means the feature would work between two Androids and not at all otherwise. That is why CLAUDE.md lists it as out of scope, and nothing found in this pass changes it. **If someone asks "can I tap my phone against my friend's phone to connect?", the answer is no, and the substitute is the QR + GPS flow (§4.2/§4.3), which exists precisely because this does not.**

One more distinction that will come up: **the app cannot write tags into existence either** — and does not need to. All 7,142 cards are already encoded and no re-encoding is required (Q1).

---

## 3. The EAS development build: why nothing can be tested without it, and who has to do it

**Expo Go cannot run this app.** Not "will be limited" — cannot. Three of the four native capabilities are unavailable in it:

- **Push notifications** were removed from Expo Go for Android in SDK 53 (deprecated in 52) and Expo's own guidance is that a development build is required to test push. This repo is on **SDK 57**.
- **NFC** has never worked in Expo Go (§7.2 says so).
- **Universal/App Links** cannot resolve to Expo Go, because the association files name *our* app's team and bundle id.

So the very first phase produces nothing testable until a development build exists. **This is a hard gate on everything below, and it is the project owner's job, not an agent's** — every step needs a signed-in Apple/Google account, a browser, and in places a physical device in hand.

### What it needs

| Item | Cost | Lead time | Who |
|---|---|---|---|
| Apple Developer Program | ~$99/year | **This is the risk.** Individual enrolment can be same-day to about a week. **Organization enrolment (SmartCard Solutions LLC) requires a D-U-N-S number**, free but up to ~5 business days to issue and reportedly up to 30 days if D&B has no record of the entity, *then* Apple's own review. | Owner. An agent cannot enrol a legal entity. |
| Google Play Developer | $25 one-time | Hours to a few days | Owner |
| EAS account + `eas init` | Free tier is sufficient for a pilot; paid tiers buy queue priority and concurrency | Minutes | Owner runs `eas login` / `eas init`; an agent can write `eas.json` |
| APNs auth key (`.p8`) | Included with the Apple account | Minutes, once enrolled | Owner (download from Apple, upload to Expo) |
| FCM credentials | Free | Minutes | Owner |
| NFC Tag Reading capability | Included | Minutes, once enrolled | Owner (enable in the Apple developer portal) |
| A registered physical iPhone (`eas device:create`) or TestFlight | — | Minutes | Owner |
| A physical Android phone | — | — | Owner |

**Verify current pricing and enrolment terms before relying on the numbers above** — they are accurate as of this writing but Apple and Google both change them, and the Google Play closed-testing requirement (a minimum number of testers for a minimum period before production access) applies to *personal* accounts and has changed at least twice; an organization account is the way around it and is what an LLC should be using anyway.

**No simulator can substitute.** NFC, camera, push, and Universal Links all require real hardware. The iOS Simulator supports none of them.

**Two accounts and two phones are needed for a genuine end-to-end test**, because the card owner and the tapper must be different users.

### The one shortcut worth knowing

For testing **the notification specifically**, the tapper does not need the mobile app at all. `apps/web/src/app/card/[code]/card-redeem-flow.tsx` already auto-redeems on mount for a signed-in visitor. So: owner installs the dev build and registers a token; a second account opens `https://…/card/<code>` in a mobile browser, signs in, the redeem commits, and `push.ts` fires at the owner's phone. **The push half of threat 7's control can therefore be closed and verified before a single line of mobile NFC or camera code exists.** That is what makes the phase ordering in §4 possible.

---

## 4. Phased breakdown

Each phase is independently shippable and independently testable. Ordered by value, with the security-relevant one deliberately early.

### Phase 0 — Make the shell real (no user-visible change)

Rename the app (`name`, `slug`, `scheme`), set `ios.bundleIdentifier` and `android.package`, delete the Expo template screens and assets, write `eas.json` with the three §7.2 profiles, add usage-description strings, add a `type-check`-clean skeleton with the tab structure the web app already has. Convert `app.json` to `app.config.ts` if env-dependent config is wanted.

*Testable by:* `pnpm --filter mobile type-check` and `lint`, and a Metro bundle that starts. **Not** by running the app usefully.

*Blocked on:* nothing. **Do this before the EAS project is created** — the slug becomes the project identity.

*Sequencing note within the phase:* `apps/mobile/package.json` declares no `build` and no `test` script, so `turbo run build` and `turbo run test` skip mobile entirely today. Adding at least a `test` script (even with zero tests initially) keeps the app inside the same `pnpm turbo` gates the rest of the repo runs under.

### Phase 1 — EAS development build, empty app on real hardware

Owner-driven, per §3. Outcome: a signed development build installed on one iPhone and one Android, showing an empty SmartCard shell.

*Testable by:* the app launching on a physical device.

*Judgment call: do this as its own phase and do not merge it into Phase 2.* The failure modes here are credentials, provisioning profiles and enrolment queues, and diagnosing them at the same time as debugging an OAuth redirect is how a beginner developer loses a week. Get a boring build working first.

### Phase 2 — Bearer auth, both ends (§5.2 + §1.6)

Server: `getAuthenticatedContextFromBearer(request)`, with the three constraints in §1.6. Client: `expo-auth-session` PKCE against the `SmartCard Mobile` Kinde application, tokens in `expo-secure-store`, refresh handling, sign-out. `packages/api-client` gains a token provider on `ConnectApiOptions`. `KINDE_MOBILE_CLIENT_ID` set in Vercel; the mobile app's redirect URI registered in Kinde.

*Testable by:* a "signed in as…" screen on a real device, plus a server-side test that a token with the *web* `azp` and a token with a forged signature are both rejected on the bearer path exactly as they are on the cookie path.

*Model/effort:* Opus, xhigh — CLAUDE.md's "Auth integration (Kinde), RLS policies" row.

### Phase 3 — **Push registration. This is the phase that makes a card tap notify its owner.**

`expo-notifications` + config plugin + `EXPO_PUBLIC_PROJECT_ID`; permission request with a real explanation of what the notification is for; `getExpoPushTokenAsync()`; `POST /api/push/register` and `DELETE` on sign-out, validated with the existing `userPushTokenRegistrationSchema` and upserting on `(user_id, device_id)`; a notification-response handler that reads `data.connectionId` and deep-links to a screen offering **revoke card** and **remove connection** inline, because §4.5 is explicit that "making the owner navigate to find the revoke button spends [the notification's] value". APNs key and FCM credentials uploaded to Expo; `EXPO_ACCESS_TOKEN` set on Vercel.

*Testable by:* the §3 shortcut — owner on a dev build, tapper redeeming through the web card page. Verify in three places, per CLAUDE.md's independent-verification rule: the phone buzzes; `user_push_tokens` has exactly one row for that device (not two, on a second launch); and the Vercel runtime log shows a delivered ticket rather than `no_registered_tokens` or `no_expo_credential`.

**This phase closes the gap that §4.7 threat 7 has been living with since 2026-08-13.** It is the highest-value phase in this plan and it does not depend on NFC, the camera, GPS, or deep links.

*One thing to get right:* a token registered while signed in as user A must not keep delivering to user A after the device signs in as user B. The global unique on `expo_push_token` makes that a conflict the server must resolve rather than a silent duplicate — the migration's comment says so; the endpoint has to honour it.

### Phase 4 — Deep links and the card tap (§7.3)

Point `smartcard.tech` at the Vercel project (Cloudflare proxy **off** for that record, per Q15). Serve `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` from `apps/web`. Add `associatedDomains` and Android intent filters. Build the app's `/card/[code]` screen calling `redeemNfc` through the API client, and the `/c/[token]` QR-preview equivalent.

*Testable by:* tapping a real production card with the app installed and landing in the app; tapping it without the app installed and landing on the existing web preview.

*Risk:* association files are cached by Apple's CDN and by the OS. Changes can take a day to take effect, and a malformed file fails silently — the app simply does not open. Budget for a slow feedback loop. Note also that this phase depends on a DNS cutover that affects the live web app, so it should not be done casually mid-pilot.

*Optional add-on:* in-app Core NFC scanning (`react-native-nfc-manager`) for iPhone 7/8/X and for discoverability. Requires the NFC Tag Reading capability enabled before the build.

### Phase 5 — Connect: present and scan (§4.2, §4.3)

`expo-camera` for QR scanning, `expo-location` for the GPS fix (**foreground / when-in-use only** — see §6), the presenter screen with rotation and heartbeat, keep-awake while presenting. Promote `presenter-state.ts` / `scanner-state.ts` into `packages/core` per §1.3 rather than duplicating them.

*Testable by:* two devices in the same room connecting; two devices far apart being refused with the generic message and no distance disclosed.

*Why this is late:* the web already does this and does it well, the QR flow works in a mobile browser today, and the native version buys convenience rather than a missing capability. Phase 3 buys a missing security control. That is the whole ordering argument.

### Phase 6 — Read-only surfaces

Route Handlers wrapping the existing services for connections, activity, feed and profile-view; the corresponding `packages/api-client` functions and screens. Read-only, deliberately: editing stays on the web for the pilot.

### Explicitly not in this plan

Contacts import, events creation/RSVP from mobile, profile editing, Friend Proximity (§8 — design only, gated on Q26), and anything requiring background location.

---

## 5. What mobile must not do

Non-negotiable, from CLAUDE.md and §7.4. Any change that would breach one of these is out of bounds and should be flagged rather than worked around.

1. **The phone never holds a Supabase credential and never talks to the database.** §7.4: "The Expo app holds no Supabase credentials beyond the publishable key; it talks to our API, never the database directly." The token exchange (§5.4) happens per request on our server; the phone never sees a Supabase token at all. **`@supabase/supabase-js` is currently in `apps/mobile/package.json` and is unused — remove it in Phase 0**, so nobody later reaches for the obvious-looking shortcut. Every push-token write goes through a Route Handler for exactly this reason.
2. **No secret gets an `EXPO_PUBLIC_` prefix**, and everything in an Expo bundle is extractable whether prefixed or not. `QR_SIGNING_SECRET`, `SUPABASE_JWT_SIGNING_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `EXPO_ACCESS_TOKEN`, `CONNECT_IP_HASH_SALT`, `GEOCODING_API_KEY` are server-side only, forever. Mobile's variables are exactly `EXPO_PUBLIC_KINDE_DOMAIN`, `EXPO_PUBLIC_KINDE_CLIENT_ID`, `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_PROJECT_ID`, `EXPO_PUBLIC_SENTRY_DSN`.
3. **No verification decision on the device.** Distance, freshness, accuracy, nonce validity, relaxation — all server-side, all in `packages/core` behind the API. The client may *display* a distance; it may never *decide* one. §4.3's relaxation is deliberately invisible to the client and must stay so.
4. **Tokens in `expo-secure-store`, never `AsyncStorage`** (§5.2, §4.7 threat 5).
5. **No global search, no directory, no connect action from a shareable URL** (CLAUDE.md). A native contact picker or a "people you may know" list would be exactly this.
6. **Fail closed.** Location denied, no fix, stale fix, permission revoked mid-flow → refuse. Never a last-known position presented as current.
7. **Nothing sensitive in a notification payload** (§7.5, §4.5): a display name and an event description is the ceiling. No coordinates, no place labels, no tokens, no session ids. `data` carries ids the app resolves behind its own auth.
8. **No phone-to-phone NFC / HCE** (CLAUDE.md, §2 above).

---

## 6. Effort and risk, honestly

**Things that look routine and are not:**

- **The bearer-auth path (§1.6).** Reads like "add a header check". It is a second entry point into the identity bridge on a codebase where 29 call sites currently assume a cookie, and the one shortcut the web takes (`withProfileClaimsFromSession`) is explicitly unsafe to copy. Treat it as a security change with tests, at Opus/xhigh.
- **The Server Action wall (§1.7).** Nothing in `apps/mobile` hints at it. Any conversation that starts "just show the connections list on mobile" ends with a new Route Handler, a new Zod contract, and a new api-client function.
- **Universal Links (§7.3).** Two files, one DNS change, and a debugging loop measured in hours because of CDN and OS caching. A malformed association file produces silent failure with no error anywhere. Compounded here by the fact that the DNS cutover touches the live web app.
- **Apple organization enrolment.** The D-U-N-S dependency is the longest-lead item in the entire plan and the one most likely to be discovered late. **Start it the day mobile is approved, before any code.**
- **Push token lifecycle.** Re-installs, OS token rotation, device handover between accounts. The schema is designed for it; the endpoint has to actually implement the conflict resolution.

**Genuinely needs a human with an Apple Developer account** (no agent can do these): enrolling the organization and obtaining the D-U-N-S number; creating the App Store Connect record; downloading the APNs `.p8` and uploading it to Expo; enabling the NFC Tag Reading capability; registering test device UDIDs or managing TestFlight; every App Store and Play submission; and holding a physical phone against a physical card.

**App Store review (Q9, open).** Reviewers must be able to exercise the app. Ours refuses to connect anyone who is not physically near another user — a reviewer in Cupertino with one device cannot complete the core flow. **A written reviewer test path plus a demo video is close to mandatory, not optional**, and it must cover NFC, camera and location together. Q9's row already notes the scope grew; this scoping pass does not resolve it, but it does move it onto the critical path for any store submission. The pilot itself can run on internal distribution (TestFlight internal testers / Play internal testing) and avoid full review for a while — **recommend doing exactly that** and treating public store release as a post-pilot decision.

**Background location: not needed, and worth saying so loudly.** GPS verification (§4.3) happens with both apps in the foreground, during a connect flow. **When-in-use permission is sufficient for everything in this plan.** Background/"Always" location belongs only to §8 Friend Proximity, which is design-only and gated on Q26, and §8.7 already documents what it would cost — Google Play requires a written justification and a demo video for background location, and iOS periodically re-prompts users and shows them a map of where they have been tracked. **Do not request background location in the pilot app.** Adding it later is a permission prompt; having asked for it unnecessarily is a review risk and a trust cost that cannot be taken back.

**Physical-device testing is the real tax.** Two accounts, two phones, one production card, and for Phase 5 two people standing in the same room and then in different rooms. There is no CI substitute. Plan for the pilot venue to be tested at the pilot venue — §4.4 already assumes threshold tuning from live data.

**Uncertainties this pass could not resolve, flagged rather than glossed:**

- Whether `smartcard.tech` currently resolves to the Vercel project (Q15 is a decision, not a completed action; the deployment note in the README still cites the `*.vercel.app` URL).
- Whether a `SmartCard Mobile` application exists in the Kinde business yet, and therefore whether `KINDE_MOBILE_CLIENT_ID` has a value. The code path handles it being unset; the phase that needs it does not.
- Exact current Apple/Google/EAS pricing and Play closed-testing terms (§3).
- Whether Expo Go's iOS push behaviour differs from Android's on SDK 57. Immaterial — the dev build is required for NFC regardless — but do not let anyone "just test push in Expo Go" and conclude the pipeline is broken.

---

## 7. Recommendation on sequencing against the web pilot

**Split it. Phase 3 belongs *before* the pilot. Phases 4-6 belong *after* it. Nothing should be built *during* it.**

The reasoning:

**Phases 0-3 before the pilot, because the pilot is when threat 7 becomes real.** Right now the stolen-card threat is theoretical: 333 assigned cards exist, but nobody is carrying them into a room full of people and tapping them. A pilot event is precisely the situation §4.7 threat 7 describes — cards handed over, left on tables, tapped by strangers. Going into that with the detective control at half strength is a choice, and it is the wrong one when the missing half is reachable in three phases that do not require NFC, the camera, GPS, or a DNS change. The `/activity` page (Q28) is a real fallback, but it requires the owner to think to look; the push is the part that makes the revoke button a defence rather than a button. **The measurable goal is: before the first pilot event, at least the project owner and any staff carrying cards have the dev build installed with a registered push token.** That is a handful of TestFlight installs, not a store release.

**Phases 4-6 after the pilot, because the web app already covers them and the pilot generates the data that should shape them.** The QR flow works in a mobile browser today. A tapped card lands on the web preview today, which is a working experience for a non-user and an auto-redeem for a signed-in one. The native versions are better, not newly-possible. Meanwhile §4.4 is explicit that the GPS radius must be tuned from `connection_attempts` data after the first event — building the native scanner before that data exists means building against thresholds that are about to change. And §4.7 threat 1's 2026-08-15 amendment flags card-preview patterns as something to watch in pilot data, which may change what the card screen should do.

**Nothing during, because a pilot needs one thing being observed at a time.** §4.4's question 4 ("is relaxation being abused?") is explicitly a *during-the-event* check. Debugging a provisioning profile while watching a live rate limiter is how both jobs get done badly.

**The honest counter-argument, stated so it can be weighed rather than skipped:** Phases 0-3 have a hard external dependency — Apple enrolment — with a tail that could be a month. If that enrolment stalls, insisting on push-before-pilot delays the pilot. **The mitigation is Android-first.** Google Play enrolment is $25 and days, not weeks; Expo's push service fans out to FCM identically; and a single Android device with a registered token proves the entire pipeline and closes the control for whoever is carrying it. **So: start Apple enrolment immediately, build Phases 0-3 against Android, and let iOS follow whenever Apple clears.** That removes the schedule risk from the security argument, which is the only reason the security argument was on the critical path.

---

## 8. What this document does not decide

- Whether to build mobile at all, and when. That is the owner's call; this is the input to it.
- Q9 (App Store reviewer path) — surfaced and scoped, not resolved.
- Whether to promote the connect state machines into `packages/core` (§1.3) — proposed as a judgment call, needs sign-off because it moves a signed-off package boundary.
- Which read-only surfaces Phase 6 covers, and in what order.

If any phase above is approved, the phase's own plan gets proposed and signed off before it is implemented, per CLAUDE.md.
