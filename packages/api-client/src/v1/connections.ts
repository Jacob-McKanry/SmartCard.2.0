/**
 * Typed HTTP client for `/api/v1/connections*`, matching
 * `apps/web/src/app/api/v1/connections/**`.
 */
import {
  connectionDetailResponseSchema,
  connectionsListResponseSchema,
  meetingParticipantConsentUpdateSchema,
  meetingPrivacyUpdateSchema,
  type ConnectionDetailResponse,
  type ConnectionListItem,
  type MeetingParticipantConsentUpdate,
  type MeetingPrivacyUpdate,
} from "@smartcard/types";

import { ApiV1Error, parseOk, requestApiV1, type ApiV1Options } from "./http";

/** `GET /api/v1/connections`. */
export async function listConnections(opts: ApiV1Options = {}): Promise<ConnectionListItem[]> {
  const result = await requestApiV1(
    "GET",
    "/api/v1/connections",
    undefined,
    (json) => connectionsListResponseSchema.parse(json),
    opts,
  );
  return result.connections;
}

/**
 * `GET /api/v1/connections/[connectionId]`. Returns `null` for a 404 — "no
 * such connection" and "not yours" are indistinguishable by design (see the
 * route's own header), so this is the one wrapper in this package where a
 * refusal is a normal return value rather than a thrown `ApiV1Error`, the
 * same way `redeemQr` treats an ordinary rejection in `../connect.ts`.
 */
export async function getConnection(
  connectionId: string,
  opts: ApiV1Options = {},
): Promise<ConnectionDetailResponse | null> {
  try {
    return await requestApiV1(
      "GET",
      `/api/v1/connections/${encodeURIComponent(connectionId)}`,
      undefined,
      (json) => connectionDetailResponseSchema.parse(json),
      opts,
    );
  } catch (error) {
    if (error instanceof ApiV1Error && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/** `DELETE /api/v1/connections/[connectionId]`. */
export async function removeConnection(connectionId: string, opts: ApiV1Options = {}): Promise<void> {
  await requestApiV1(
    "DELETE",
    `/api/v1/connections/${encodeURIComponent(connectionId)}`,
    undefined,
    parseOk,
    opts,
  );
}

/** `PATCH /api/v1/connections/[connectionId]/sharing` — the "share with mutual connections" toggle. */
export async function updateMeetingSharing(
  connectionId: string,
  input: MeetingPrivacyUpdate,
  opts: ApiV1Options = {},
): Promise<void> {
  const body = meetingPrivacyUpdateSchema.parse(input);
  await requestApiV1(
    "PATCH",
    `/api/v1/connections/${encodeURIComponent(connectionId)}/sharing`,
    body,
    parseOk,
    opts,
  );
}

/** `PATCH /api/v1/connections/[connectionId]/participant-flags` — the caller's own consent/privacy flags. */
export async function updateParticipantFlags(
  connectionId: string,
  input: MeetingParticipantConsentUpdate,
  opts: ApiV1Options = {},
): Promise<void> {
  const body = meetingParticipantConsentUpdateSchema.parse(input);
  await requestApiV1(
    "PATCH",
    `/api/v1/connections/${encodeURIComponent(connectionId)}/participant-flags`,
    body,
    parseOk,
    opts,
  );
}
