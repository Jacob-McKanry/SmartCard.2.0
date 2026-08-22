import { userProfileUpdateSchema } from "@smartcard/types";

import { apiErrorResponse, readJsonBody, requireApiContext, requireSameOrigin } from "@/server/api/route-context";
import { updateOwnProfile } from "@/server/profile/profile-service";
import { assertSignupCompleted } from "@/server/onboarding/onboarding-service";

/**
 * `POST /api/v1/onboarding/complete` — "Done": save what was filled in, then
 * record that setup is over. Mirrors `completeOnboardingAction`
 * (`app/onboarding/actions.ts`) field for field and step for step.
 *
 * THE FIELD LIST IS A DELIBERATE SUBSET OF `userProfileUpdateSchema`, NOT THE
 * WHOLE THING
 *
 * `username` and `photo_path` are both in the update grant and both absent
 * here, on purpose — the web action's own header explains why: there is no
 * global search or profile URL for a username to matter on yet (Q3 is
 * still open), so asking a brand-new member to choose a handle whose only
 * effect is a label is a question with no good answer, and it stays
 * available on the ordinary profile-edit screen instead. `photo_path` has no
 * upload mechanism in this flow on either platform. Accepting either field
 * here would let mobile onboarding do something the reviewed web flow
 * deliberately does not.
 *
 * ORDER MATTERS AND IT IS THE SAME ORDER THE WEB ACTION USES: profile write
 * first, completion flag second. If the profile write fails, the flag is
 * never set and the caller can simply try again with their answer still
 * theirs to resend. The reverse order would mark onboarding finished and
 * then risk losing what was submitted, with the layout gate now refusing to
 * send them back to a form they need.
 *
 * Every field is optional, so an empty body is a valid, complete request —
 * it writes nulls over nulls and finishes, exactly as an empty web form
 * does. That is functionally close to `skip`, and deliberately not merged
 * with it: the two remain separate endpoints because they are separate
 * proven behaviours (this one always calls `updateOwnProfile`; skip never
 * does) and collapsing them would mean re-deriving that equivalence instead
 * of relying on what is already shipped and tested.
 */
const onboardingProfileSchema = userProfileUpdateSchema.pick({
  first_name: true,
  last_name: true,
  phone_number: true,
  bio: true,
  company_name: true,
  company_role: true,
  email_opt_in: true,
});

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);

    const body = await readJsonBody(request);
    const parsed = onboardingProfileSchema.parse(body);

    await updateOwnProfile(context.supabase, context.userId, parsed);
    await assertSignupCompleted(context.userId);

    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "POST /api/v1/onboarding/complete");
  }
}
