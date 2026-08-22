/**
 * Wire shapes for `/api/v1/events*`, `/api/v1/cities`, mirroring
 * `events-service.ts`'s return types and the routes' response bodies. See
 * `./profile`'s header for why these are new even though the `apps/web`-only
 * types they mirror already exist.
 */
import { z } from "zod";

import { cityRowSchema } from "../db/cities";
import { eventInviteRowSchema } from "../db/event-invites";
import { eventRowSchema } from "../db/events";
import { eventRsvpRowSchema } from "../db/event-rsvps";
import { rsvpStatusSchema } from "../db/enums";
import { userRowSchema } from "../db/users";
import { timestamptzSchema, uuidSchema } from "../db/scalars";

export const citiesResponseSchema = z.object({
  ok: z.literal(true),
  cities: z.array(cityRowSchema),
});

/** `events-service.ts`'s `BrowseEventItem` — an event plus the city it is in. */
export const browseEventItemSchema = z.object({
  event: eventRowSchema,
  city: cityRowSchema.pick({ id: true, slug: true, name: true, state: true }),
});

export type BrowseEventItem = z.infer<typeof browseEventItemSchema>;

export const eventsListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(browseEventItemSchema),
});

export const createEventResponseSchema = z.object({
  ok: z.literal(true),
  event: eventRowSchema,
});

/** `events-service.ts`'s `AttendingEventItem` — a `BrowseEventItem` plus the caller's own RSVP. */
export const attendingEventItemSchema = z.object({
  event: eventRowSchema,
  city: cityRowSchema.pick({ id: true, slug: true, name: true, state: true }),
  rsvp: eventRsvpRowSchema,
});

export type AttendingEventItem = z.infer<typeof attendingEventItemSchema>;

export const attendingEventsResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(attendingEventItemSchema),
});

/** `event_attendance_counts()`'s answer, as `getEventAttendanceCounts` shapes it. */
export const eventAttendanceCountsSchema = z.object({
  going: z.number(),
  interested: z.number(),
  waitlist: z.number(),
  /** `null` for anyone but the host — queue depth is the host's business. */
  pending: z.number().nullable(),
  capacity: z.number().nullable(),
  seatsRemaining: z.number().nullable(),
  isFull: z.boolean(),
  connectionsMade: z.number(),
});

/** `connections_attending()`'s answer, split by Q21's two labelled buckets. */
export const connectionsAttendingSummarySchema = z.object({
  going: z.array(uuidSchema),
  interested: z.array(uuidSchema),
});

/**
 * `GET /api/v1/events/[eventId]`'s full assembly — the same eight values
 * `(app)/events/[eventId]/page.tsx` renders, per that route's own header on
 * why the assembly is reproduced rather than redesigned. `host` is `null`
 * for the ordinary case where the caller may not read the host's profile
 * (`getEventHostProfile`'s own contract — this is not an error state).
 */
export const eventDetailResponseSchema = z.object({
  ok: z.literal(true),
  event: eventRowSchema,
  city: cityRowSchema.pick({ id: true, slug: true, name: true, state: true }),
  ownRsvp: eventRsvpRowSchema.nullable(),
  counts: eventAttendanceCountsSchema,
  connectionsAttending: connectionsAttendingSummarySchema,
  host: userRowSchema.pick({ id: true, first_name: true, last_name: true, photo_path: true }).nullable(),
  hostPhotoUrl: z.string().nullable(),
  coverUrl: z.string().nullable(),
  ownConnectionsHere: z.number(),
});

export type EventDetailResponse = z.infer<typeof eventDetailResponseSchema>;

/**
 * `events-service.ts`'s `RsvpMutationResult` — the answer every RSVP RPC
 * gives, rendered at HTTP 200 whether the database said yes or no (see the
 * RSVP route's own header on why a refusal here is not an HTTP error).
 */
export const rsvpMutationResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    status: rsvpStatusSchema.nullable(),
    withdrewFromStatus: rsvpStatusSchema.nullable(),
    changed: z.boolean(),
    promoted: z.number(),
  }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export type RsvpMutationResult = z.infer<typeof rsvpMutationResultSchema>;

export const rsvpResponseSchema = z.object({
  ok: z.literal(true),
  result: rsvpMutationResultSchema,
});

/** `events-service.ts`'s `HostQueueEntry`. */
export const hostQueueEntrySchema = z.object({
  rsvpId: uuidSchema,
  userId: uuidSchema,
  status: rsvpStatusSchema,
  respondedAt: timestamptzSchema,
  decidedAt: timestamptzSchema.nullable(),
  decidedBy: uuidSchema.nullable(),
  capacityOverride: z.boolean(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  username: z.string().nullable(),
  photoPath: z.string().nullable(),
});

export type HostQueueEntry = z.infer<typeof hostQueueEntrySchema>;

export const hostQueueResponseSchema = z.object({
  ok: z.literal(true),
  entries: z.array(hostQueueEntrySchema),
});

export const eventInvitesResponseSchema = z.object({
  ok: z.literal(true),
  invites: z.array(eventInviteRowSchema),
});
