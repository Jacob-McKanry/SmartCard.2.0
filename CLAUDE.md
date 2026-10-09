# CLAUDE.md — SmartCard 2.0

Instructions for any Claude Code session working in this repo. Read this before making changes.

## What this project is

A from-scratch rebuild of SmartCard: a private social app for people who meet — in person, at shared events, and (since 2026-10-09) through an opt-in live map for meeting nearby adults who are open to it. Networking and friendship, never dating. See `README.md` for the product summary and `docs/architecture/` for the signed-off technical design. The connection-verification layer (`docs/architecture/`, §4 of the initial proposal) and the live-map/meetup design (`docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`) are the two most security-critical parts of this codebase — treat any change touching either with proportionate care.

## Non-negotiable product rule

**Cumulatively amended twice since this rule was first written in these terms — read both amendments before touching anything near connection creation.**

A `connections` edge may be created by exactly three server-side, `service_role`-only Postgres functions, each with exactly one TypeScript caller (enforced by `no-second-write-path.test.ts`):

1. **`create_verified_connection`** — an NFC card tap, or a QR scan. Since 2026-09-26 the GPS proximity gate is still evaluated and logged, but a failed gate no longer rejects the connection (see amendment 2 below).
2. **`create_manual_connection`** — a card/badge scan (OCR, QR, or NFC) or plain manual entry, with no verification at all.
3. **`answer_meetup_connect_prompt`** — both people privately answered "yes" to a "want to connect?" prompt, at least 24 hours after both confirmed "On my way" to an in-person meetup arranged through the live map. Neither person ever sees the other's answer before both have given one.

A fourth path, or loosening or merging any of these three, is a new dated amendment — never a refactor and never a silent workaround. Never add a global user search (by name, handle, email, or phone) or any "connect" action reachable from a shareable profile URL.

**Amended 2026-09-26** (owner decision, `docs/architecture/2026-09-26-unverified-connections.md`): the original form of this rule — "a connection can only be created through NFC or a live, GPS-verified QR scan, no exceptions" — no longer describes the code. Typing in (or scanning) a name/email/phone that matches a real SmartCard user is enough, by itself, to create a live, mutual connection to them instantly and silently, with no notice on their side. Read that document for the full reasoning and the concrete new risk it accepted; CLAUDE.md itself was not updated when this was first built (see that document's §8) — it is now, as part of the 2026-10-09 amendment below.

**Amended 2026-08-27** (owner decision, `docs/architecture/2026-08-27-event-attendee-roster.md`): one bounded people-listing surface exists — attendees of an event who have each *opted in* may see each other on that event's page and view/save each other's contact details. It never creates a connection, is readable only by fellow attendees of that same event, and nobody appears on it without their own explicit choice (unanswered = hidden). Any widening of it (pre-event visibility, cross-event listing, non-attendee readers, a connect action) is a new amendment, not an extension.

**Amended 2026-10-09** (owner decision, `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`): a second, materially different people-discovery surface exists — an opt-in live map where any two 18+ adults who are **not** yet connected, and have never met, can see each other's approximate location and arrange to meet. This is a deliberate, conscious override of this project's own earlier (never-built, never-signed-off) "Friend Proximity" design in `docs/architecture/2026-08-09-initial-architecture-proposal.md` §8, which required mutual *existing* connections and held, as a hard rule, that "there must be no query path that takes a location and returns users." The live map keeps §8's actual mechanisms (approximate-only, grid-snapped location — never exact; mutual opt-in just to appear; ghost mode; protected zones) while overriding its conclusion that strangers must never be discoverable by location. On the map, opted-in adults see each other only as coarse, grid-snapped approximate pins, only within a configured radius, only while both are visible, never below the people-pin unlock threshold, and never through ghost mode, a protected zone, or a block. There is no list view, no search, and no zooming beyond the radius. Read that document before touching anything near map visibility, meetup requests, or connection path 3 above — it names, in plain language, exactly what changed and what a bad actor could do with it. Any widening (exact location, a list/search view, zooming beyond the radius, background location tracking, a stranger-readable branch added to the `users` table's own SELECT policy) is a new amendment, not an extension. As of 2026-10-09, nothing in this feature is reachable from the real app — it is built behind an isolated, admin-only `/MapTest` route until the owner explicitly says to bring it live.

If a feature request conflicts with any of this, flag it — don't build a workaround.

## Documentation standard

Follow `README.md`'s "Documentation standards" section on every change, no exceptions:
- Explain *why*, not just *what* — especially for security/data-access logic.
- Every migration gets a comment block: what it changes, why, and (for RLS) exactly what access it grants/forbids and to whom.
- Commit messages state the problem being solved, not just the action taken.
- Update `README.md` / `docs/architecture/` as part of the change that makes them stale, not as later cleanup.
- If implementation reveals a reason to deviate from a signed-off architecture decision, record the deviation and its reasoning where the original decision lives.

## Working style

- **Plan before building.** Propose the approach for a phase and get sign-off before implementing it — don't guess on ambiguous requirements.
- **Small, reviewable commits.** The project owner is a beginner developer relying on AI tooling and needs to follow what changed and why.
- **Explain security decisions in plain language**, not just in code comments — in commit messages / PR descriptions / chat, spell out what an attack would look like and how the change stops it.
- **Never commit secrets.** Environment variables only. `.env*` is gitignored from commit one — keep it that way.
- **Fail closed** on anything connection/verification-related: if a check can't be completed (GPS unavailable, permission denied, stale data), reject the action rather than let it through.
- **Ask clarifying questions as multiple choice**, via the AskUserQuestion tool — never as open-ended prose. If a question genuinely needs free text (e.g. "which cities"), still use AskUserQuestion with an "Other" — style option rather than asking in plain chat.
- **Independent verification before reporting done**, especially after delegating to a subagent: read the actual diff, re-run type-check/lint/test/build yourself, and check runtime logs / DB advisors / grants directly rather than trusting a self-reported summary. This project's owner expects this by default, not on request.

## Model and effort guidance

| Work | Model | Effort |
|---|---|---|
| Architecture, schema design, security model | Opus | xhigh |
| Connection security (QR rotation, GPS verification, anti-spoofing) | Opus | xhigh or max |
| Auth integration (Kinde), RLS policies, data migration | Opus | xhigh |
| Feature building (profile, feed, events UI) | Sonnet or Opus | high |
| Styling, copy, layout polish | Sonnet | medium |
| Test writing | Sonnet | high |
| Debugging something that already failed once | Opus | xhigh |

If something goes wrong because a file wasn't read, tests weren't run, or something wasn't double-checked — that's an effort problem, raise it. If the model had full context and still got it wrong — that's a model problem, use a stronger one.

## Explicitly out of scope

Do not build: open post/photo feed, business/venue directory, global search, rich messaging (media/groups/reactions), city-based signup caps, founding-member/scarcity mechanics, in-app payments, ads, or phone-to-phone NFC (HCE emulation) — see `docs/architecture/` for why the last one doesn't work cross-platform.

**Clarified 2026-10-09** (`docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`): plain 1:1 text messaging inside meetup threads and permanent connection threads is in scope — "rich messaging" above means media, groups, and reactions, which stay out. The live map's meeting-spot suggester and the hangouts feature are not a business/venue directory: one server-chosen public spot per meetup, no venue browsing. The hangouts "Free / Costs money" label is a label only — there are no in-app payments anywhere in this feature.
