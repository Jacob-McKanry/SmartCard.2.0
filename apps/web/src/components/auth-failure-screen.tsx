import { LogoutLink } from "@kinde-oss/kinde-auth-nextjs/components";
import { CircleAlert, Lock, MailX, type LucideIcon } from "lucide-react";

import {
  EmailAlreadyBoundToAnotherIdentityError,
  MissingEmailClaimError,
  UserNotActiveError,
} from "@/server/auth/ensure-user";

/**
 * The three ways signing in can succeed at Kinde and still fail at SmartCard,
 * given a screen — `isError` in `docs/design/prototypes/Auth flow.dc.html`.
 *
 * WHY THESE THREE AND NOT THE PROTOTYPE'S FOUR
 *
 * Each of the three below is a class that `server/auth/ensure-user.ts` throws
 * today, from code that runs on every authenticated request. Until now none of
 * them had a screen: they surfaced as Next's unstyled error page, which tells a
 * person nothing and offers them nothing. The prototype's fourth state,
 * "Couldn't reach SmartCard", is a transport failure — there is no server to
 * render a server-rendered page when the server cannot be reached, so it is not
 * a screen this app can draw.
 *
 * WHY THE ONLY ACTION IS SIGN OUT
 *
 * The prototype's primary button on three of these is "Email support". There is
 * no support address anywhere in this product, and §7's "never invent a
 * capability" covers a contact channel as much as it covers a feature — a
 * mailto to an address nobody reads is worse than no button. Signing out is the
 * one thing that is real, and it is also the genuinely useful one: it clears
 * the Kinde session, which is what stops the app bouncing between the gate and
 * this screen, and it is what lets somebody try a different account.
 *
 * These screens are shown to a person who has *already* proved, through Kinde,
 * that they hold the email address in question, so naming their situation
 * reveals nothing to them that they did not already assert. Nothing here is
 * reachable signed-out, and nothing here takes an email address as input — the
 * gate's "failures reveal nothing" rule (§7) is about the signed-out surface
 * and is enforced there, by there being no email field at all.
 */

/**
 * AMENDMENT (2026-08-15) — THERE ARE FOUR KINDS NOW, BECAUSE `UserNotActiveError`
 * COVERS TWO VERY DIFFERENT SITUATIONS AND ONE SCREEN CANNOT BE TRUE FOR BOTH.
 *
 * `ensureUser()` throws `UserNotActiveError` for any status that is not
 * `active`, which until self-serve deletion shipped meant `suspended` in
 * practice. It no longer does. The `suspended` copy below says, in as many
 * words, "Nothing has been deleted" and "an administrator has to take the hold
 * off the account" — the first is flatly false for somebody who deleted their
 * own account thirty seconds ago, and the second describes a different
 * operation.
 *
 * That is precisely the failure `classifyAuthFailure`'s own header warns
 * about — "a real bug being displayed to a user as a tidy, reassuring,
 * completely incorrect explanation of their account status" — arriving from the
 * direction of a new feature rather than of a rename. So the error's `status`
 * now selects between two screens.
 */
export type AuthFailureKind = "suspended" | "deleted" | "emailBound" | "noEmail";

interface FailureCopy {
  icon: LucideIcon;
  title: string;
  body: string;
  /** What actually resolves it. Never a promise of a channel that does not exist. */
  nextTitle: string;
  nextBody: string;
  actionLabel: string;
}

const COPY: Record<AuthFailureKind, FailureCopy> = {
  suspended: {
    icon: Lock,
    title: "This account can't sign in",
    body: "This account is on hold, so it can't start a session right now. Nothing has been deleted.",
    nextTitle: "What unblocks it",
    nextBody:
      "An administrator has to take the hold off the account. Trying again won't change it.",
    actionLabel: "Sign out",
  },
  /*
   * Reached two ways: the tab that was open when the person tapped delete and
   * did not follow the sign-out redirect, and a fresh sign-in on a deleted
   * account. Both want the same page.
   *
   * The copy is held to the same standard as the confirmation that got them
   * here (`deleteAccountConsequences`), which is why it repeats the reversible
   * part rather than assuming they remember it. A person who reaches this screen
   * by accident — a bookmarked tab, a second device — needs to be told their
   * data is still there and how to get it back, and a person who meant it needs
   * confirmation that it worked. One page can say both, honestly, because both
   * are true.
   */
  deleted: {
    icon: Lock,
    title: "This account is deleted",
    body: "You deleted this SmartCard account, so it can't sign in. Your profile is hidden from everyone you've met and your cards are switched off.",
    nextTitle: "It isn't gone",
    nextBody:
      "Nothing was erased — your connections and meeting history are all still there, and an administrator can switch the account back on, along with any events this cancelled. Your cards stay off until you turn them back on yourself.",
    actionLabel: "Sign out",
  },
  emailBound: {
    icon: MailX,
    title: "That email is already on an account",
    body: "A SmartCard account already exists on this email address, created a different way. The two are never joined up automatically — that is how accounts get taken over.",
    nextTitle: "Why this isn't automatic",
    nextBody:
      "Merging on a matching email would mean anyone who can get a sign-in issued for an address inherits the account behind it. Joining them up is a deliberate, manual act.",
    actionLabel: "Sign out and try another account",
  },
  noEmail: {
    icon: CircleAlert,
    title: "We didn't get an email address",
    body: "Your sign-in came back without an email address, and an account can't be created without one. This one is on us, not you.",
    nextTitle: "Nothing for you to fix",
    nextBody: "Trying again will hit the same thing until the sign-in configuration is corrected.",
    actionLabel: "Sign out",
  },
};

/**
 * Maps a thrown error to a screen, or to `null` for "this is not an auth
 * failure, it is a bug — re-throw it".
 *
 * Deliberately `instanceof` rather than a check on `error.name`: the name is a
 * string that a rename would silently desynchronise, and the failure mode of
 * getting this wrong is a real bug being displayed to a user as a tidy,
 * reassuring, completely incorrect explanation of their account status.
 */
export function classifyAuthFailure(error: unknown): AuthFailureKind | null {
  if (error instanceof UserNotActiveError) {
    /*
     * The status is read off the error rather than inferred, and anything that
     * is not literally `deleted` falls through to the suspended screen. That
     * direction is deliberate: `suspended`'s copy is the conservative one ("this
     * account is on hold", "an administrator has to take the hold off"), which
     * stays roughly true for any future non-active status, whereas the deleted
     * copy makes specific promises about restoration and cards that would be
     * wrong for a status nobody has designed yet.
     */
    return error.status === "deleted" ? "deleted" : "suspended";
  }
  if (error instanceof EmailAlreadyBoundToAnotherIdentityError) return "emailBound";
  if (error instanceof MissingEmailClaimError) return "noEmail";
  return null;
}

export function AuthFailureScreen({ failure }: { failure: AuthFailureKind }) {
  const copy = COPY[failure];
  const Icon = copy.icon;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[402px] flex-col items-center justify-center gap-5 px-[26px] py-10 text-center">
      {/*
       * Neutral, not red. §2 reserves `--danger` for destructive *actions*, and
       * none of these screens is one — being told your account is on hold is
       * bad news, but nothing on this page destroys anything, and painting it
       * red would spend the one colour that means "this button deletes
       * something" on a message.
       */}
      <span
        aria-hidden
        className="flex size-[76px] items-center justify-center rounded-[26px] border"
        style={{
          background: "rgba(13,18,32,.05)",
          borderColor: "rgba(13,18,32,.09)",
          color: "var(--sc-text-muted)",
        }}
      >
        <Icon size={32} strokeWidth={1.9} />
      </span>

      <div className="flex flex-col gap-2.5">
        <h1 className="text-[23px] leading-7 font-semibold" style={{ letterSpacing: "-.03em" }}>
          {copy.title}
        </h1>
        <p
          className="text-[14px] leading-[21px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          {copy.body}
        </p>
      </div>

      <div
        className="flex w-full flex-col gap-[7px] rounded-[20px] border p-3.5 text-left"
        style={{ background: "rgba(255,255,255,.7)", borderColor: "rgba(13,18,32,.08)" }}
      >
        <span className="text-[11.5px] leading-4 font-semibold">{copy.nextTitle}</span>
        <span
          className="text-[11.5px] leading-[17px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          {copy.nextBody}
        </span>
      </div>

      {/*
       * §5's neutral primary (`#0d1220` solid) rather than the accent gradient:
       * the accent is the colour of the thing you came here to do, and this is
       * the colour of the only thing left.
       */}
      <LogoutLink
        className="flex min-h-11 w-full items-center justify-center rounded-full px-4 py-[15px] text-[14.5px] leading-[19px] font-semibold text-white"
        style={{ background: "var(--sc-text)" }}
      >
        {copy.actionLabel}
      </LogoutLink>
    </main>
  );
}
