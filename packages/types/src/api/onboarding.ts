/**
 * Wire shapes for `/api/v1/onboarding*`, mirroring
 * `apps/web/src/app/api/v1/onboarding/**`'s request and response bodies.
 * See `./profile`'s header for why these are new even though the
 * `apps/web`-only types they mirror already exist.
 */
import { z } from "zod";

import { userProfileUpdateSchema } from "../db/users";

export const onboardingStatusResponseSchema = z.object({
  ok: z.literal(true),
  completed: z.boolean(),
});

/**
 * `POST /api/v1/onboarding/complete`'s request body — the same deliberate
 * subset of `userProfileUpdateSchema` the route itself picks (see that
 * route's own header for why `username` and `photo_path` are excluded).
 * Kept here, not re-derived at the call site, so the client and the route
 * cannot drift apart on which fields onboarding actually accepts.
 */
export const onboardingCompleteRequestSchema = userProfileUpdateSchema.pick({
  first_name: true,
  last_name: true,
  phone_number: true,
  bio: true,
  company_name: true,
  company_role: true,
  email_opt_in: true,
});

export type OnboardingCompleteRequest = z.infer<typeof onboardingCompleteRequestSchema>;
