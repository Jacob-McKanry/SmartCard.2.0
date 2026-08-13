/**
 * `public.social_links` — see 20260809210100_table_users_and_social_links.sql
 *
 * Off-platform handles shown on a profile, gated by exactly the same rule as
 * the profile itself. Anything looser would amount to a searchable handle
 * directory, which the product must not have.
 */
import { z } from "zod";

import { integerSchema, timestamptzSchema, uuidSchema } from "./scalars";

export const socialLinkRowSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  platform: z.string(),
  url: z.string(),
  /** Presentation order on the profile; defaults to 0 in the database. */
  display_order: integerSchema,
  created_at: timestamptzSchema,
  updated_at: timestamptzSchema,
});

export type SocialLinkRow = z.infer<typeof socialLinkRowSchema>;

/**
 * Input validation for a link a user is adding or editing themselves.
 *
 * `url` is deliberately stricter than `socialLinkRowSchema.url` (which is a
 * bare `z.string()`, because it has to accept whatever the legacy import
 * already wrote — see §6.4 of the architecture doc). New links come from a
 * person typing into a form, and §6.4 is explicit about what unvalidated
 * input into this column looked like in the wild: multiple URLs mashed into
 * one field with no way to tell which was real (one row skipped entirely for
 * exactly this reason), and trailing free text after a real URL. This schema
 * exists so the UI that lets people add *new* links does not reintroduce
 * that problem:
 *
 *  - `http`/`https` only. Blocks `javascript:`, `data:`, and similar schemes
 *    that would be actively dangerous to ever render as an `href` on a
 *    profile another person's browser opens.
 *  - No embedded whitespace. The cheapest, most reliable signal that a field
 *    contains more than one thing — a second URL, or trailing prose — is a
 *    space in the middle of it, exactly the shape §6.4 found.
 *  - `z.url()` for general well-formedness on top of both.
 *
 * This is "reasonable" validation, not exhaustive anti-phishing review — the
 * product doesn't try to verify a link actually belongs to the person, only
 * that it's a single well-formed http(s) URL.
 */
export const socialLinkUrlSchema = z
  .string()
  .trim()
  .min(1, "Enter a URL.")
  .max(2048, "That URL is too long.")
  .refine((value) => !/\s/.test(value), {
    message:
      "That looks like more than one link, or extra text after the link. Enter just the URL.",
  })
  .pipe(z.url({ error: "Enter a valid URL, starting with http:// or https://" }))
  .refine((value) => /^https?:\/\//i.test(value), {
    message: "Links must start with http:// or https://",
  });

/**
 * The exact set of fields a user may set when adding a link to their own
 * profile — mirrors the column-level INSERT grant in
 * 20260809211100_rls_policies_identity_and_cards.sql. `user_id` is part of
 * that grant (so the row can be attached to *a* user) but is deliberately not
 * collected from client input here: the service layer fills it in from the
 * authenticated caller's own id, never from anything the form submits, so a
 * request cannot attach a link to someone else's profile by editing form
 * data. The RLS `with check` on that same migration would refuse it anyway;
 * this is the same rule enforced one layer earlier, at validation time.
 */
export const socialLinkInsertSchema = z.object({
  platform: z.string().trim().min(1, "Choose a platform.").max(100),
  url: socialLinkUrlSchema,
  display_order: integerSchema.default(0),
});

export type SocialLinkInsert = z.infer<typeof socialLinkInsertSchema>;

/**
 * The exact set of fields a user may change about a link they already own —
 * mirrors the column-level UPDATE grant (`platform, url, display_order`).
 * `user_id` is excluded from that grant for the same reason described on
 * `socialLinkInsertSchema`: reassigning a link to another profile is not a
 * thing an edit is allowed to do.
 */
export const socialLinkUpdateSchema = socialLinkInsertSchema.partial();

export type SocialLinkUpdate = z.infer<typeof socialLinkUpdateSchema>;
