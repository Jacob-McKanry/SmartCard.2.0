import "server-only";

/**
 * What a Server Action is allowed to tell the browser when something fails.
 *
 * THE PROBLEM THIS FIXES
 *
 * Every `actions.ts` in this app had the same helper:
 *
 *     function messageOf(error: unknown): string {
 *       return error instanceof Error ? error.message : "Something went wrong.";
 *     }
 *
 * and every service function throws in this shape:
 *
 *     throw new Error(`Failed to update the event: ${error.message}`, { cause: error });
 *
 * where the inner `error` is PostgREST's. So the string that reached
 * `{state.error}` in the browser was the database's own words — which name
 * tables, columns, constraints and policies:
 *
 *     new row violates row-level security policy for table "event_invites"
 *     duplicate key value violates unique constraint "users_email_key"
 *     permission denied for table users
 *
 * None of that is a message for a person. It is a map of the schema, handed to
 * anyone who can make an action fail — and failing one on purpose is easy,
 * because that is what a policy refusal IS. The RLS-violation case is the worst
 * of the three: it confirms a row exists and that a specific policy stopped
 * you, which is exactly the difference `getEventForViewer` and the RSVP RPCs go
 * out of their way to hide by answering identically for "no such row" and "not
 * yours".
 *
 * THIS IS THE RULE THE CONNECT PATH ALREADY FOLLOWS
 *
 * `route-helpers.ts`: "an exception's message can name a table, a column, a
 * constraint, or a user id, and none of that belongs in a response to somebody
 * who just failed a proximity check. Every unhandled error becomes the same
 * generic message, with the detail going to the server log." `user-messages.ts`
 * enforces the same thing for every rejection reason. The Server Actions are
 * simply the half of the app that never had it applied.
 *
 * HOW IT WORKS: OPT IN, NOT OPT OUT
 *
 * A message is shown to the user only if it was deliberately written for one —
 * i.e. only if it was thrown as a `UserFacingError`. Everything else becomes
 * one generic sentence, with the real error logged server-side where it is a
 * monitoring problem rather than a disclosure.
 *
 * The direction of that default is the entire point. An allow-list of "safe"
 * error substrings would fail open: every new service function, every new
 * PostgREST error string, and every dependency upgrade that reworded one would
 * be disclosed by default until somebody noticed. Requiring an explicit type
 * means a message a human did not write for a human cannot reach a browser by
 * accident, and adding a new one is a visible decision in a diff.
 */

/**
 * An error whose `message` was written to be read by the person who triggered
 * it, and which therefore may cross to the browser unchanged.
 *
 * BEFORE THROWING ONE, CHECK THE MESSAGE SAYS NOTHING THE CALLER HAS NOT
 * EARNED. The same rule `user-messages.ts` sets out applies here: it may
 * describe the caller's own action and their own data, never another user,
 * never a threshold, and never whether some row they named exists. "That event
 * couldn't be updated — you may not be its host" is fine, because the caller
 * already asserted the event id and learns nothing about it either way. "No
 * event with that id" would not be, because it answers a question about
 * somebody else's private event.
 */
export class UserFacingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UserFacingError";
  }
}

/**
 * The one sentence everything unrecognised collapses to. Deliberately says
 * nothing about what went wrong — matching `userFacingMessage("internal_error")`
 * on the connect path, for the same reason.
 */
export const GENERIC_ACTION_ERROR = "Something went wrong. Please try again.";

/**
 * Turns anything thrown inside a Server Action into a string safe to render.
 *
 * @param error Whatever was caught.
 * @param context A short, stable label for the action, used only in the server
 *   log so a report of "it says something went wrong" can be traced to the
 *   action that produced it. Never sent to the client.
 */
export function safeActionErrorMessage(error: unknown, context: string): string {
  if (error instanceof UserFacingError) {
    return error.message;
  }

  // Logged in full — including the `cause`, which is where the PostgREST error
  // with its code and constraint name lives. This is the half of the old
  // behaviour worth keeping: the detail still exists, it is just on the server
  // rather than on the user's screen.
  console.error(`[action] ${context} failed`, {
    error: error instanceof Error ? error.message : String(error),
    cause:
      error instanceof Error && error.cause !== undefined
        ? typeof error.cause === "object"
          ? JSON.stringify(error.cause)
          : String(error.cause)
        : undefined,
    stack: error instanceof Error ? error.stack : undefined,
  });

  return GENERIC_ACTION_ERROR;
}
