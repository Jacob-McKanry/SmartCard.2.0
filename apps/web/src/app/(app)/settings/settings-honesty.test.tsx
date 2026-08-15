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
import { deleteAccountConsequences } from "./../connections/lib/removal-copy";

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
 *     imply otherwise." The designed Settings screen carries rows that have no
 *     backend (a password change on a passwordless account, a connections
 *     export, and two invented visibility switches). Each is a plausible,
 *     tidy-looking thing for a future pass to paste in from the prototype, and
 *     none of them would fail loudly — they would just lie. The source scan is
 *     the guard, because it catches the copy wherever it lands rather than only
 *     where a component test happens to look.
 *
 * AMENDMENT (2026-08-15) — "DELETE YOUR ACCOUNT" HAS LEFT THE FORBIDDEN LIST,
 * AND A DIFFERENT ASSERTION HAS TAKEN ITS PLACE.
 *
 * It was banned because `users.status` had a `'deleted'` value with no policy,
 * no action and no service function behind it. All three now exist
 * (20260815130300, `server/account/account-service.ts`,
 * `settings/actions.ts`), so the phrase is no longer a lie and banning it would
 * be banning the truth.
 *
 * §7 has a second edge, though, and this feature sits right on it: overstating
 * a limitation is describing the system inaccurately just as much as
 * overstating a capability. This is a SOFT delete that an administrator can
 * reverse, so the copy must not say "permanent" or "cannot be undone" — and
 * those are the words a confirmation dialog for account deletion attracts. The
 * ban is therefore replaced, not deleted, by `describe("the account-deletion
 * copy…")` below.
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
    const kinds: AuthFailureKind[] = ["suspended", "deleted", "emailBound", "noEmail"];
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

  it("tells a deleted account apart from a suspended one", () => {
    // One error class, two situations, and the `suspended` copy says "Nothing
    // has been deleted" in as many words — which is exactly wrong for somebody
    // who just deleted their own account and is the reason this split exists.
    expect(classifyAuthFailure(new UserNotActiveError("deleted"))).toBe("deleted");
  });

  it("falls back to the conservative screen for a status nobody has designed yet", () => {
    // The suspended copy stays roughly true for any future hold; the deleted
    // copy makes specific promises about restoration and cards that would not
    // be. So an unknown status gets the cautious one.
    expect(classifyAuthFailure(new UserNotActiveError("dormant"))).toBe("suspended");
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
      pattern: /download your connections|export your connections|download your data/i,
      why: "There is no export path anywhere in this codebase, and the project owner explicitly declined to build one on 2026-08-15. Still a capability this backend does not have.",
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

/**
 * THE OTHER EDGE OF §7, WHICH ACCOUNT DELETION IS THE FIRST FEATURE TO SIT ON.
 *
 * Everything above guards against claiming a capability the backend lacks. This
 * guards the opposite mistake, which `revokeCardConsequences` already records in
 * prose: claiming a LIMITATION the backend does not have is describing the
 * system inaccurately too, and here it would be worse than inaccurate. A person
 * told their deletion was permanent would never ask for the restore that
 * `public.restore_deleted_user` actually provides.
 *
 * The words below are the ones a confirmation dialog for account deletion
 * attracts, which is why they are asserted rather than trusted.
 */
describe("the account-deletion copy neither undersells nor oversells what happens", () => {
  const consequences = deleteAccountConsequences();
  const joined = consequences.join(" ");

  it("names each consequence on its own line, as §7 requires", () => {
    // Not a style preference: `ConfirmPanel` takes a list because "and your
    // meeting history stays" is the clause that gets skimmed past when it is
    // the fourth comma of a paragraph.
    expect(consequences.length).toBeGreaterThanOrEqual(4);
    for (const line of consequences) {
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it("never claims the delete is permanent or irreversible", () => {
    const forbidden = [
      /permanent/i,
      /cannot be undone/i,
      /can't be undone/i,
      /there is no undo/i,
      /forever/i,
      /wiped/i,
      /for good/i,
      // "erased" is allowed only in the negated form the copy actually uses
      // ("Nothing is erased"), which is a promise rather than a threat.
      /(?<!nothing is )erased/i,
    ];

    for (const pattern of forbidden) {
      expect(joined, `deleteAccountConsequences() matches ${String(pattern)}`).not.toMatch(pattern);
    }
  });

  it("says the reversible part explicitly, rather than merely not denying it", () => {
    // Absence of "permanent" is not the same as telling somebody they can get
    // their account back. This is the assertion that would fail if a future
    // copy edit trimmed the reassurance for length.
    expect(joined).toMatch(/administrator can restore/i);
    expect(joined).toMatch(/nothing is erased/i);
  });

  it("names the four things the transaction actually changes", () => {
    // Checked against `public.soft_delete_own_account()` (20260815130300): the
    // profile stops being visible, the cards are revoked, the QR stops working,
    // the hosted events are cancelled and stay visible to the people who
    // answered. A confirmation that omitted the cards would be the dangerous
    // one — that is the consequence a person cannot discover afterwards.
    expect(joined).toMatch(/card/i);
    expect(joined).toMatch(/QR/);
    expect(joined).toMatch(/cancelled/i);
    expect(joined).toMatch(/signed out/i);
    expect(joined).toMatch(/profile stops being visible/i);
  });

  it("does not promise the cards come back, because they do not", () => {
    // The one asymmetry in the restore path: `cards.status` records no reason,
    // so the database cannot tell a card this revoked from one the owner revoked
    // after losing it, and re-arming it automatically would be a guess on a
    // security kill switch. The copy has to carry that or the restore surprises
    // somebody.
    expect(joined).toMatch(/cards are the one thing that stays off|switch them back on/i);
  });
});
