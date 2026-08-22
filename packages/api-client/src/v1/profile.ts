/**
 * Typed HTTP client for `/api/v1/profile*`, matching
 * `apps/web/src/app/api/v1/profile/**`.
 */
import {
  profileGetResponseSchema,
  socialLinkInsertSchema,
  socialLinkResponseSchema,
  socialLinkUpdateSchema,
  socialLinksListResponseSchema,
  userProfileUpdateSchema,
  type OwnProfile,
  type SocialLinkInsert,
  type SocialLinkRow,
  type SocialLinkUpdate,
  type UserProfileUpdate,
} from "@smartcard/types";

import { parseOk, requestApiV1, type ApiV1Options } from "./http";

export interface ProfileGetResponse {
  profile: OwnProfile;
  photoUrl: string | null;
}

/** `GET /api/v1/profile`. */
export async function getProfile(opts: ApiV1Options = {}): Promise<ProfileGetResponse> {
  const result = await requestApiV1(
    "GET",
    "/api/v1/profile",
    undefined,
    (json) => profileGetResponseSchema.parse(json),
    opts,
  );
  return { profile: result.profile, photoUrl: result.photoUrl };
}

/** `PATCH /api/v1/profile`. Every field is optional — send only what changed. */
export async function updateProfile(input: UserProfileUpdate, opts: ApiV1Options = {}): Promise<void> {
  const body = userProfileUpdateSchema.parse(input);
  await requestApiV1("PATCH", "/api/v1/profile", body, parseOk, opts);
}

/** `GET /api/v1/profile/social-links`. */
export async function listSocialLinks(opts: ApiV1Options = {}): Promise<SocialLinkRow[]> {
  const result = await requestApiV1(
    "GET",
    "/api/v1/profile/social-links",
    undefined,
    (json) => socialLinksListResponseSchema.parse(json),
    opts,
  );
  return result.links;
}

/** `POST /api/v1/profile/social-links`. `user_id` is never a field here — the server sets it from the session. */
export async function addSocialLink(
  input: SocialLinkInsert,
  opts: ApiV1Options = {},
): Promise<SocialLinkRow> {
  const body = socialLinkInsertSchema.parse(input);
  const result = await requestApiV1(
    "POST",
    "/api/v1/profile/social-links",
    body,
    (json) => socialLinkResponseSchema.parse(json),
    opts,
  );
  return result.link;
}

/** `PATCH /api/v1/profile/social-links/[linkId]`. */
export async function updateSocialLink(
  linkId: string,
  input: SocialLinkUpdate,
  opts: ApiV1Options = {},
): Promise<void> {
  const body = socialLinkUpdateSchema.parse(input);
  await requestApiV1(
    "PATCH",
    `/api/v1/profile/social-links/${encodeURIComponent(linkId)}`,
    body,
    parseOk,
    opts,
  );
}

/** `DELETE /api/v1/profile/social-links/[linkId]`. */
export async function deleteSocialLink(linkId: string, opts: ApiV1Options = {}): Promise<void> {
  await requestApiV1(
    "DELETE",
    `/api/v1/profile/social-links/${encodeURIComponent(linkId)}`,
    undefined,
    parseOk,
    opts,
  );
}
