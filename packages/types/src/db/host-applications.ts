/**
 * `public.host_applications` — see 20260827120000_table_host_applications_and_verified_host.sql
 * and `public.admin_list_host_applications` — see 20260830120000.
 *
 * Applications to become a verified host, per §9 of
 * `docs/architecture/2026-08-22-event-attendee-import.md`. One row per
 * account; re-applying replaces the previous row rather than stacking a
 * history (`host_applications_one_per_user`).
 */
import { z } from "zod";

import { timestamptzSchema, uuidSchema } from "./scalars";

export const hostApplicationStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type HostApplicationStatus = z.infer<typeof hostApplicationStatusSchema>;

/**
 * One row of `public.host_applications`, as an applicant reads their own via
 * the ordinary `authenticated` SELECT grant (RLS: self, or an active admin —
 * see the migration's policy). This mirrors the table; it is not what the
 * admin queue reads, which additionally joins the applicant's profile — see
 * `adminHostApplicationSchema` below.
 */
export const hostApplicationRowSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  organization_name: z.string(),
  applicant_role: z.string(),
  past_event_link: z.string(),
  expected_event_size: z.string().nullable(),
  hosting_frequency: z.string().nullable(),
  status: hostApplicationStatusSchema,
  submitted_at: timestamptzSchema,
  decided_at: timestamptzSchema.nullable(),
  decided_by_user_id: uuidSchema.nullable(),
  /** Shown TO THE APPLICANT verbatim — see the table's own column comment. */
  rejection_note: z.string().nullable(),
});

export type HostApplicationRow = z.infer<typeof hostApplicationRowSchema>;

/**
 * `p_*` arguments for `public.submit_host_application`. `organization_name`,
 * `applicant_role` and `past_event_link` are required non-empty strings on the
 * database side (the RPC trims and refuses blank); the two optional fields are
 * free text a host describes their event scale/cadence in, by design (§9.2 —
 * "input to human judgment, not a machine gate").
 */
export const submitHostApplicationInputSchema = z.object({
  organizationName: z.string().trim().min(1).max(200),
  applicantRole: z.string().trim().min(1).max(200),
  pastEventLink: z.string().trim().min(1).max(500),
  expectedEventSize: z.string().trim().max(200).optional(),
  hostingFrequency: z.string().trim().max(200).optional(),
});

export type SubmitHostApplicationInput = z.infer<typeof submitHostApplicationInputSchema>;

/**
 * One row of `public.admin_list_host_applications` — the application plus the
 * applicant's name and photo, joined server-side because an admin has no
 * ordinary read access to a stranger's `users` row (see that migration's
 * header). `first_name`/`last_name`/`photo_path` are the ONLY profile fields
 * this ever carries; there is no path from this schema to a phone number, a
 * bio, or an email — the function that produces it does not select them.
 */
export const adminHostApplicationSchema = hostApplicationRowSchema
  .omit({ decided_by_user_id: true })
  .extend({
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    photo_path: z.string().nullable(),
  });

export type AdminHostApplication = z.infer<typeof adminHostApplicationSchema>;

export const adminHostApplicationListSchema = z.array(adminHostApplicationSchema);
