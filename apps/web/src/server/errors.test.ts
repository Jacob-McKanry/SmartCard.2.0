import { afterEach, describe, expect, it, vi } from "vitest";

import { GENERIC_ACTION_ERROR, safeActionErrorMessage, UserFacingError } from "./errors";

/**
 * What a Server Action is allowed to tell the browser.
 *
 * The cases that matter are the ones with real PostgREST wording in them: those
 * strings used to reach `{state.error}` verbatim, which handed anyone who could
 * make an action fail a map of the schema — and failing one on purpose is easy,
 * because a policy refusal IS a failure.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function silenceConsole() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("safeActionErrorMessage — what must never reach the browser", () => {
  it("does not leak an RLS policy refusal", () => {
    silenceConsole();
    const error = new Error(
      'Failed to send the invite: new row violates row-level security policy for table "event_invites"',
    );
    const message = safeActionErrorMessage(error, "events");

    expect(message).toBe(GENERIC_ACTION_ERROR);
    // The specific things that must not survive: the table, the policy, and the
    // fact that a policy was what stopped it.
    expect(message).not.toContain("event_invites");
    expect(message).not.toContain("row-level security");
    expect(message).not.toContain("policy");
  });

  it("does not leak a constraint name", () => {
    silenceConsole();
    const message = safeActionErrorMessage(
      new Error('duplicate key value violates unique constraint "users_email_key"'),
      "profile",
    );
    expect(message).toBe(GENERIC_ACTION_ERROR);
    expect(message).not.toContain("users_email_key");
  });

  it("does not leak a table name from a permission error", () => {
    silenceConsole();
    const message = safeActionErrorMessage(new Error("permission denied for table users"), "profile");
    expect(message).toBe(GENERIC_ACTION_ERROR);
    expect(message).not.toContain("users");
  });

  it("does not leak a stack trace or internal file path", () => {
    silenceConsole();
    const error = new Error("boom");
    error.stack = "Error: boom\n    at /var/task/apps/web/.next/server/chunks/1234.js:5:11";
    const message = safeActionErrorMessage(error, "events");
    expect(message).toBe(GENERIC_ACTION_ERROR);
    expect(message).not.toContain("/var/task");
  });

  it("collapses a non-Error throw rather than stringifying it", () => {
    silenceConsole();
    expect(safeActionErrorMessage({ secret: "value" }, "events")).toBe(GENERIC_ACTION_ERROR);
    expect(safeActionErrorMessage("raw string", "events")).toBe(GENERIC_ACTION_ERROR);
  });

  it("is opt-in: a subclass of plain Error is still not trusted", () => {
    // The direction of the default is the whole point. An allow-list of "safe"
    // substrings would fail open on every new error string; requiring an
    // explicit type means a message no human wrote for a human cannot reach a
    // browser by accident.
    silenceConsole();
    class SomeOtherError extends Error {}
    expect(safeActionErrorMessage(new SomeOtherError("internal detail"), "events")).toBe(
      GENERIC_ACTION_ERROR,
    );
  });
});

describe("safeActionErrorMessage — what must still reach the browser", () => {
  it("passes a UserFacingError through unchanged", () => {
    expect(
      safeActionErrorMessage(
        new UserFacingError("That event couldn't be updated — you may not be its host."),
        "events",
      ),
    ).toBe("That event couldn't be updated — you may not be its host.");
  });

  it("passes a subclass of UserFacingError through — the InvalidPhotoError shape", () => {
    class InvalidPhotoError extends UserFacingError {}
    expect(
      safeActionErrorMessage(new InvalidPhotoError("That file is too large — the limit is 5MB."), "profile"),
    ).toBe("That file is too large — the limit is 5MB.");
  });

  it("does not log a UserFacingError as a server error", () => {
    // It is an expected outcome, not a fault. Logging it would make the real
    // failures harder to see, which is the same reasoning push.ts uses for
    // filtering dead tokens out of the send path.
    const spy = silenceConsole();
    safeActionErrorMessage(new UserFacingError("You need to be signed in to do that."), "profile");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("safeActionErrorMessage — the detail still exists, server-side", () => {
  it("logs the message, the cause and the context that were withheld", () => {
    const spy = silenceConsole();
    const cause = { code: "42501", details: "policy refused" };
    safeActionErrorMessage(new Error("Failed to send the invite: denied", { cause }), "events");

    expect(spy).toHaveBeenCalledTimes(1);
    const [label, payload] = spy.mock.calls[0] as [string, Record<string, unknown>];
    expect(label).toContain("events");
    expect(payload.error).toContain("Failed to send the invite");
    expect(String(payload.cause)).toContain("42501");
  });
});
