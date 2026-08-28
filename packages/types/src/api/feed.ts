/**
 * Wire shape for `/api/v1/feed`, mirroring `feed-service.ts`'s `FeedItem`
 * discriminated union field for field. See `./profile`'s header for why a
 * response schema is warranted here even though `FeedItem` already exists as
 * a TypeScript type in `apps/web`.
 */
import { z } from "zod";

import { meetingLocationRowSchema } from "../db/meeting-locations";
import { userRowSchema } from "../db/users";
import { eventRowSchema } from "../db/events";
import { verificationMethodSchema } from "../db/enums";
import { timestamptzSchema, uuidSchema } from "../db/scalars";

/** Just enough of a profile for a feed row — `feed-service.ts`'s `ProfileSummary`. */
const profileSummarySchema = userRowSchema.pick({
  id: true,
  first_name: true,
  last_name: true,
  username: true,
  photo_path: true,
});

/** Just enough of an event to say where a meeting happened — `feed-service.ts`'s `EventSummary`. */
const eventSummarySchema = eventRowSchema.pick({ id: true, title: true });

const participantFeedItemSchema = z.object({
  kind: z.literal("participant"),
  meetingId: uuidSchema,
  connectionId: uuidSchema,
  occurredAt: timestamptzSchema,
  verificationMethod: verificationMethodSchema,
  otherUser: profileSummarySchema,
  location: meetingLocationRowSchema.nullable(),
  event: eventSummarySchema.nullable(),
});

const mutualFeedItemSchema = z.object({
  kind: z.literal("mutual"),
  meetingId: uuidSchema,
  occurredAt: timestamptzSchema,
  userA: profileSummarySchema,
  userB: profileSummarySchema,
  location: meetingLocationRowSchema.nullable(),
  event: eventSummarySchema.nullable(),
});

export const feedItemSchema = z.discriminatedUnion("kind", [
  participantFeedItemSchema,
  mutualFeedItemSchema,
]);

export type FeedItem = z.infer<typeof feedItemSchema>;

export const feedResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(feedItemSchema),
});
