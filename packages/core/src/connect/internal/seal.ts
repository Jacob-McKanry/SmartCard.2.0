/**
 * The one function that can mint a `VerifiedOutcome`.
 *
 * READ `verification.ts`'s header before touching this file.
 *
 * `VerifiedOutcome` is `SuccessfulVerification` plus a brand keyed by a
 * `unique symbol` that nothing exports. `sealVerified` is the only place that
 * asserts the brand, and it is deliberately unreachable from outside this
 * package:
 *
 *   * it is not re-exported from `src/index.ts`, and
 *   * `packages/core/package.json` declares `"exports": { ".": "./src/index.ts" }`,
 *     so `@smartcard/core/src/connect/internal/seal` does not resolve for any
 *     consumer.
 *
 * That combination is what makes §4.1's rule real: an API handler in
 * `apps/web` cannot construct a value `createVerifiedConnection` will accept.
 * It has to pass one a verifier returned.
 *
 * THE ONLY LEGITIMATE CALLERS ARE THE VERIFIERS THEMSELVES. If a third call
 * site ever appears here, the question to ask is not "is this call correct?" —
 * it is "why is something other than a verification method producing proof that
 * a verification happened?". §4.7 threat 4's instruction is blunt about the
 * answer: never add a second path that writes connections.
 */

import type { SuccessfulVerification, VerifiedOutcome } from "../verification";

export function sealVerified(outcome: SuccessfulVerification): VerifiedOutcome {
  return outcome as VerifiedOutcome;
}
