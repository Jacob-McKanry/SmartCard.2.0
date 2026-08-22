/**
 * Wire shapes for `/api/v1/activity`, `/api/v1/cards/claim` and
 * `/api/v1/cards/[cardId]/revoke`, mirroring
 * `apps/web/src/server/activity/activity-service.ts`'s return types and the
 * routes' response bodies. See `./profile`'s header for why these are new
 * even though the `apps/web`-only types they mirror already exist.
 */
import { z } from "zod";

import { cardRowSchema } from "../db/cards";
import { userRowSchema } from "../db/users";
import { timestamptzSchema, uuidSchema } from "../db/scalars";

/** `activity-service.ts`'s `CardTapActivityItem`. */
export const cardTapActivityItemSchema = z.object({
  sessionId: uuidSchema,
  tapper: userRowSchema.pick({ id: true, first_name: true, last_name: true, username: true, photo_path: true }),
  consumedAt: timestamptzSchema,
  connectionId: uuidSchema.nullable(),
});

export type CardTapActivityItem = z.infer<typeof cardTapActivityItemSchema>;

/** `activity-service.ts`'s `CardPreviewActivityItem`. */
export const cardPreviewActivityItemSchema = z.object({
  id: z.number(),
  source: z.enum(["card_code", "qr_token"]),
  surface: z.enum(["preview", "vcard"]),
  viewedAt: timestamptzSchema,
});

export type CardPreviewActivityItem = z.infer<typeof cardPreviewActivityItemSchema>;

export const activityResponseSchema = z.object({
  ok: z.literal(true),
  taps: z.array(cardTapActivityItemSchema),
  previews: z.array(cardPreviewActivityItemSchema),
  cards: z.array(cardRowSchema.pick({ id: true, card_code: true })),
});

export type ActivityResponse = z.infer<typeof activityResponseSchema>;
