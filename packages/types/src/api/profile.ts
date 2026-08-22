/**
 * Wire shapes for `/api/v1/profile` and `/api/v1/profile/social-links*`.
 *
 * Request schemas are not duplicated here — `userProfileUpdateSchema`,
 * `socialLinkInsertSchema` and `socialLinkUpdateSchema` (`../db/users`,
 * `../db/social-links`) already are the request schemas, imported directly
 * by both the route and this package's client wrappers. A second copy here
 * would be exactly the drift `packages/api-client`'s own header warns about:
 * "every request/response is validated against the SAME Zod schemas that
 * mirror the routes themselves" means one schema per shape, not one per
 * consumer.
 *
 * Response schemas ARE new here, because the routes compose existing row
 * schemas into shapes nothing previously needed to validate at a boundary —
 * `getOwnProfile`'s `OwnProfile` type lives in `apps/web` as a bare
 * TypeScript `Pick<>`, which is correct for a function whose only caller was
 * a Server Component in the same process. A caller across an HTTP boundary
 * needs the same guarantee every other wire shape in this package gets: the
 * client should not trust an object merely because `fetch` returned 200 and
 * `JSON.parse` did not throw.
 */
import { z } from "zod";

import { socialLinkRowSchema } from "../db/social-links";
import { userRowSchema } from "../db/users";

/**
 * `apps/web/src/server/profile/profile-service.ts`'s `OwnProfile` —
 * `.pick()` off the same row schema that type is `Pick<UserRow, ...>` from,
 * so the two cannot drift on which columns are included without a
 * type-check failure on the `apps/web` side (that file's `PROFILE_COLUMNS`
 * constant lists the same set, checked by hand at the time of writing since
 * that file is a raw SQL column list, not a schema, and does not import this
 * one — see `.pick()`'s key list below for the column-level source of truth
 * this now defers to).
 */
export const ownProfileSchema = userRowSchema.pick({
  id: true,
  first_name: true,
  last_name: true,
  username: true,
  phone_number: true,
  bio: true,
  company_name: true,
  company_role: true,
  photo_path: true,
  email: true,
  email_opt_in: true,
});

export type OwnProfile = z.infer<typeof ownProfileSchema>;

export const profileGetResponseSchema = z.object({
  ok: z.literal(true),
  profile: ownProfileSchema,
  /** `null` for no photo, or a signing failure — `signedProfilePhotoUrl`'s own contract; never distinguished from the wire. */
  photoUrl: z.string().nullable(),
});

export const socialLinksListResponseSchema = z.object({
  ok: z.literal(true),
  links: z.array(socialLinkRowSchema),
});

export const socialLinkResponseSchema = z.object({
  ok: z.literal(true),
  link: socialLinkRowSchema,
});
