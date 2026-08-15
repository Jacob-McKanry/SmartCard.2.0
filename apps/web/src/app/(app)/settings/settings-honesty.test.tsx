import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LogoutLink, PortalLink } from "@kinde-oss/kinde-auth-nextjs/components";

import {
  AuthFailureScreen,
  classifyAuthFailure,
  type AuthFailureKind,
} from "@/components/auth-failure-screen";
import {
  EmailAlreadyBoundToAnotherIdentityError,
  MissingEmailClaimError,
  UserNotActiveError,
} from "@/server/auth/ensure-user";

/**
 * THE AUTH AND SETTINGS SURFACE, TESTED FOR THE TWO THINGS IT CAN GET WRONG.
 *
 * Neither of these is a UI test. They are the two failure modes this pass was
 * specifically at risk of, written so that the obvious future mistake turns
 * them red:
 *
 *  1. **Sign-out stops existing.** It did not exist at all before this pass —
 *     `/api/auth/logout` worked and nothing rendered a link to it — so the
 *     regression is not hypothetical, it is the status quo being restored.
 *
 *  2. **A capability gets described that the backend does not have.**
 *     `docs/design/DESIGN.md` §7: "Never invent a capability. Copy must not
 *     imply otherwise." The designed Settings screen carries four rows that
 *     have no backend (a password change on a passwordless account, an account
 *     deletion, a connections export, and two invented visibility switches).
 *     Each is a plausible, tidy-looking thing for a future pass to paste in
 *     from the prototype, and none of them would fail loudly — they would just
 *     lie. The source scan is the guard, because it catches the copy wherever
 *     it lands rather than only where a component test happens to look.
 */

/**
 * Lucide icons are stubbed for the same mechanical reason
 * `events/lib/access-rules.test.tsx` stubs them: pnpm installs
 * `lucide-react/node_modules/react` to satisfy its peer range, so in a plain
 * Node run the icon components hold a second React instance whose hook
 * dispatcher is null and any render containing one throws.
 *
 * Nothing under test is lost. Every icon on these screens is `aria-hidden`
 * decoration and §8 forbids an icon being the only signal — the words carry the
 * meaning, and the words are what these tests read.
 */
vi.mock("lucide-react", () => {
  const Stub = () => <svg aria-hidden />;
  // Named one by one rather than through a Proxy: a Proxy that answers every
  // key also answers `then`, which makes the module namespace thenable and
  // hangs the dynamic import Vitest uses to load it.
  return { CircleAlert: Stub, Lock: Stub, MailX: Stub };
});

const WEB_SRC = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Comments are stripped before scanning, and that is the point rather than a
 * loophole: the rule is about what a *user reads*, and the argument for why
 * each of these rows is absent has to be written down somewhere in the code
 * that would otherwise contain them. A test that forbade naming the feature at
 * all would forbid explaining the decision.
 *
 * `//` is only treated as a comment when it does not follow a colon or a word
 * character, so a `https://` inside a string does not swallow the rest of its
 * line.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\w])\/\/[^\n]*/g, "$1");
}

/** Every `.ts`/`.tsx` file under `apps/web/src`, comment-free, read once. */
function sourceFiles(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      // This file names every forbidden phrase by definition.
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push({ path: full, text: withoutComments(readFileSync(full, "utf8")) });
      }
    }
  };
  walk(WEB_SRC);
  return out;
}

describe("sign-out exists and points at the real endpoint", () => {
  it("renders an anchor to /api/auth/logout", () => {
    const markup = renderToStaticMarkup(<LogoutLink>Sign out</LogoutLink>);

    // The route `handleAuth()` dispatches `logout` on. Asserted against the
    // SDK's own rendering rather than a hardcoded string in our code, so an
    // SDK upgrade that changes the path fails here instead of in production.
    expect(markup).toContain('href="/api/auth/logout"');
  });

  it("is actually rendered by the Settings screen", () => {
    const settings = readFileSync(join(WEB_SRC, "app/(app)/settings/page.tsx"), "utf8");

    // Not a style check. Before this screen existed there was no way to end a
    // session from inside the app at all — on a borrowed or shared phone, the
    // only exit was clearing cookies.
    expect(settings).toContain("<LogoutLink");
  });

  it("is reachable from the failure screens, which are the other dead end", () => {
    const kinds: AuthFailureKind[] = ["suspended", "emailBound", "noEmail"];
    for (const kind of kinds) {
      const markup = renderToStaticMarkup(<AuthFailureScreen failure={kind} />);
      expect(markup, kind).toContain('href="/api/auth/logout"');
    }
  });
});

describe("the account portal link", () => {
  it("points at the route handleAuth dispatches, and carries an absolute returnUrl", () => {
    const markup = renderToStaticMarkup(
      <PortalLink returnUrl="https://smartcard.tech/settings">Manage</PortalLink>,
    );

    expect(markup).toContain("/api/auth/portal?");
    /*
     * Absolute, and this is the whole reason the assertion exists: the SDK's
     * portal handler passes `returnUrl` to `generatePortalUrl`, which throws on
     * anything `new URL()` cannot parse, and the handler's catch then redirects
     * home without a word. A relative value here would surface as the portal
     * silently bouncing the user to the home screen.
     */
    expect(markup).toContain("returnUrl=https%3A%2F%2Fsmartcard.tech%2Fsettings");
  });
});

describe("classifyAuthFailure only claims the failures it can actually explain", () => {
  it("maps each real error class to its screen", () => {
    expect(classifyAuthFailure(new UserNotActiveError("suspended"))).toBe("suspended");
    expect(classifyAuthFailure(new EmailAlreadyBoundToAnotherIdentityError())).toBe("emailBound");
    expect(classifyAuthFailure(new MissingEmailClaimError())).toBe("noEmail");
  });

  it("returns null for anything else, so a bug is never shown as an account problem", () => {
    // The (app) layout re-throws on null. A database outage, a JWKS fetch
    // failure or a typo in a query must surface as an error, not as a calm,
    // confident, wrong page telling somebody their account is on hold.
    expect(classifyAuthFailure(new Error("connection refused"))).toBeNull();
    expect(classifyAuthFailure(new TypeError("undefined is not a function"))).toBeNull();
    expect(classifyAuthFailure("not even an error")).toBeNull();
    expect(classifyAuthFailure(null)).toBeNull();
  });
});

describe("no screen describes a capability this backend does not have", () => {
  /**
   * Each entry is a phrase from the prototype whose feature does not exist,
   * paired with the reason — so a future reader who trips this test finds the
   * argument rather than just a failing regex.
   */
  const FORBIDDEN: { pattern: RegExp; why: string }[] = [
    {
      pattern: /change your password|reset your password|set a password|new password/i,
      why: "Sign-in is Kinde passwordless — an emailed one-time code. There is no password on any account to change, reset or set. See the §5.1 amendment in docs/architecture/2026-08-09-initial-architecture-proposal.md.",
    },
    {
      pattern: /delete your account|delete my account/i,
      why: "`users.status` has a 'deleted' value and nothing implements it. There is no policy, no action and no service function; 20260809211100 states deletion is an administrator's soft state change.",
    },
    {
      pattern: /download your connections|export your connections|download your data/i,
      why: "There is no export path anywhere in this codebase.",
    },
    {
      pattern: /profile visible to people you meet|city visible to/i,
      why: "Neither has a column behind it, and both would read as security controls. A switch that claims to hide your profile and does nothing is the worst thing on this list.",
    },
  ];

  const files = sourceFiles();

  it("reads a non-trivial number of files, so a broken walk cannot pass silently", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const { pattern, why } of FORBIDDEN) {
    it(`never says ${String(pattern)}`, () => {
      const hits = files
        .filter(({ text }) => pattern.test(text))
        .map(({ path }) => path.slice(WEB_SRC.length));

      expect(hits, `${hits.join(", ")} — ${why}`).toEqual([]);
    });
  }
});
