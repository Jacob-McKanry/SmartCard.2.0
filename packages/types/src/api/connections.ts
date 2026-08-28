/**
 * Wire shapes for `/api/v1/connections*`, mirroring
 * `apps/web/src/server/connections/connections-service.ts`'s return types
 * and `apps/web/src/app/api/v1/connections/**`'s response bodies field for
 * field. See `./profile`'s header for why these are new even though the
 * `apps/web`-only types they mirror already exist.
 */
import { z } from "zod";

import { connectionRowSchema } from "../db/connections";
import { meetingRowSchema } from "../db/meetings";
import { meetingParticipantRowSchema } from "../db/meeting-participants";
import { meetingLocationRowSchema } from "../db/meeting-locations";
import { userRowSchema } from "../db/users";
import { verificationMethodSchema } from "../db/enums";
import { timestamptzSchema, uuidSchema } from "../db/scalars";

/** `connections-service.ts`'s `ConnectionListItem`. */
export const connectionListItemSchema = z.object({
  connectionId: uuidSchema,
  otherUser: userRowSchema.pick({ id: true, first_name: true, last_name: true, username: true, photo_path: true }),
  occurredAt: timestamptzSchema,
  verificationMethod: verificationMethodSchema,
});

export type ConnectionListItem = z.infer<typeof connectionListItemSchema>;

export const connectionsListResponseSchema = z.object({
  ok: z.literal(true),
  connections: z.array(connectionListItemSchema),
});

/**
 * `GET /api/v1/connections/[connectionId]`'s full assembly — the same eight
 * values `(app)/connections/[connectionId]/page.tsx` renders, per that
 * route's own header on why the assembly is reproduced rather than
 * redesigned.
 */
export const connectionDetailResponseSchema = z.object({
  ok: z.literal(true),
  connection: connectionRowSchema,
  meeting: meetingRowSchema,
  viewerParticipant: meetingParticipantRowSchema,
  otherParticipant: meetingParticipantRowSchema,
  location: meetingLocationRowSchema.nullable(),
  otherUser: userRowSchema.pick({ id: true, first_name: true, last_name: true, username: true, photo_path: true }),
  photoUrl: z.string().nullable(),
});

export type ConnectionDetailResponse = z.infer<typeof connectionDetailResponseSchema>;
