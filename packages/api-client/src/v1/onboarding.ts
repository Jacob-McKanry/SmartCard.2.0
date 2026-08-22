/**
 * Typed HTTP client for `/api/v1/onboarding*` and `/api/v1/account`, matching
 * `apps/web/src/app/api/v1/onboarding/**` and `.../account/route.ts`.
 */
import {
  onboardingCompleteRequestSchema,
  onboardingStatusResponseSchema,
  type OnboardingCompleteRequest,
} from "@smartcard/types";

import { parseOk, requestApiV1, type ApiV1Options } from "./http";

/** `GET /api/v1/onboarding` — whether the caller has been through onboarding. */
export async function getOnboardingStatus(opts: ApiV1Options = {}): Promise<boolean> {
  const result = await requestApiV1(
    "GET",
    "/api/v1/onboarding",
    undefined,
    (json) => onboardingStatusResponseSchema.parse(json),
    opts,
  );
  return result.completed;
}

/**
 * `POST /api/v1/onboarding/complete` — "Done". `input` is deliberately typed
 * to the route's own field subset (`OnboardingCompleteRequest`), not the
 * full profile-update shape — see `onboardingCompleteRequestSchema`'s own
 * header for why `username`/`photo_path` are not onboarding's business.
 */
export async function completeOnboarding(
  input: OnboardingCompleteRequest = {},
  opts: ApiV1Options = {},
): Promise<void> {
  const body = onboardingCompleteRequestSchema.parse(input);
  await requestApiV1("POST", "/api/v1/onboarding/complete", body, parseOk, opts);
}

/** `POST /api/v1/onboarding/skip` — "Skip for now". */
export async function skipOnboarding(opts: ApiV1Options = {}): Promise<void> {
  await requestApiV1("POST", "/api/v1/onboarding/skip", undefined, parseOk, opts);
}

/**
 * `DELETE /api/v1/account` — self-serve account deletion. Matches the
 * route's own posture: no detail comes back beyond success, since the
 * per-resource counts are operational detail for server logs, not something
 * a caller about to lose their session needs (see the route's own header).
 */
export async function deleteOwnAccount(opts: ApiV1Options = {}): Promise<void> {
  await requestApiV1("DELETE", "/api/v1/account", undefined, parseOk, opts);
}
