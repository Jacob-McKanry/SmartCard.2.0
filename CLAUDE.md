# CLAUDE.md — SmartCard 2.0

Instructions for any Claude Code session working in this repo. Read this before making changes.

## What this project is

A from-scratch rebuild of SmartCard: a private social app where connections can **only** be created through verified in-person contact (NFC tap or GPS-verified QR scan). See `README.md` for the product summary and `docs/architecture/` for the signed-off technical design. The connection-verification layer (`docs/architecture/`, §4 of the initial proposal) is the single most security-critical part of this codebase — treat any change touching it with proportionate care.

## Non-negotiable product rule

A connection can only be created through NFC or a live, GPS-verified QR scan. Never add a global user search, a stranger directory, or any "connect" action reachable from a shareable profile URL. If a feature request conflicts with this, flag it — don't build a workaround.

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
