/**
 * Typed HTTP client for `/api/v1/events*` and `/api/v1/cities`, matching
 * `apps/web/src/app/api/v1/events/**` and `.../cities/route.ts`.
 */
import {
  citiesResponseSchema,
  createEventResponseSchema,
  eventDetailResponseSchema,
  eventInsertSchema,
  eventInvitesResponseSchema,
  eventUpdateSchema,
  eventsListResponseSchema,
  attendingEventsResponseSchema,
  hostQueueResponseSchema,
  rsvpDecisionSchema,
  rsvpIntentSchema,
  rsvpResponseSchema,
  uuidSchema,
  type AttendingEventItem,
  type BrowseEventItem,
  type CityRow,
  type EventDetailResponse,
  type EventInsertInput,
  type EventInviteRow,
  type EventRow,
  type EventUpdate,
  type HostQueueEntry,
  type RsvpDecision,
  type RsvpIntent,
  type RsvpMutationResult,
} from "@smartcard/types";

import { ApiV1Error, parseOk, requestApiV1, type ApiV1Options } from "./http";

/** `GET /api/v1/cities`. */
export async function listCities(opts: ApiV1Options = {}): Promise<CityRow[]> {
  const result = await requestApiV1(
    "GET",
    "/api/v1/cities",
    undefined,
    (json) => citiesResponseSchema.parse(json),
    opts,
  );
  return result.cities;
}

export interface BrowseEventsOptions {
  cityId?: string;
  when?: "upcoming" | "past";
}

/** `GET /api/v1/events`. */
export async function browseEvents(
  options: BrowseEventsOptions = {},
  opts: ApiV1Options = {},
): Promise<BrowseEventItem[]> {
  const params = new URLSearchParams();
  if (options.cityId) params.set("city", options.cityId);
  if (options.when) params.set("when", options.when);
  const query = params.toString();

  const result = await requestApiV1(
    "GET",
    `/api/v1/events${query ? `?${query}` : ""}`,
    undefined,
    (json) => eventsListResponseSchema.parse(json),
    opts,
  );
  return result.items;
}

/** `POST /api/v1/events`. `host_user_id` is never a field — the server sets it from the session. */
export async function createEvent(input: EventInsertInput, opts: ApiV1Options = {}): Promise<EventRow> {
  const body = eventInsertSchema.parse(input);
  const result = await requestApiV1(
    "POST",
    "/api/v1/events",
    body,
    (json) => createEventResponseSchema.parse(json),
    opts,
  );
  return result.event;
}

/** `GET /api/v1/events/hosted`. */
export async function listHostedEvents(opts: ApiV1Options = {}): Promise<BrowseEventItem[]> {
  const result = await requestApiV1(
    "GET",
    "/api/v1/events/hosted",
    undefined,
    (json) => eventsListResponseSchema.parse(json),
    opts,
  );
  return result.items;
}

/** `GET /api/v1/events/attending`. */
export async function listAttendingEvents(opts: ApiV1Options = {}): Promise<AttendingEventItem[]> {
  const result = await requestApiV1(
    "GET",
    "/api/v1/events/attending",
    undefined,
    (json) => attendingEventsResponseSchema.parse(json),
    opts,
  );
  return result.items;
}

/** `GET /api/v1/events/invited`. */
export async function listInvitedEvents(opts: ApiV1Options = {}): Promise<BrowseEventItem[]> {
  const result = await requestApiV1(
    "GET",
    "/api/v1/events/invited",
    undefined,
    (json) => eventsListResponseSchema.parse(json),
    opts,
  );
  return result.items;
}

/**
 * `GET /api/v1/events/[eventId]`. Returns `null` for a 404, matching
 * `getConnection`'s posture in `./connections.ts` — `getEventForViewer`'s own
 * contract is that "no such event" and "not visible to you" are the same
 * answer, so this is not an exceptional case for a client either.
 */
export async function getEvent(
  eventId: string,
  opts: ApiV1Options = {},
): Promise<EventDetailResponse | null> {
  try {
    return await requestApiV1(
      "GET",
      `/api/v1/events/${encodeURIComponent(eventId)}`,
      undefined,
      (json) => eventDetailResponseSchema.parse(json),
      opts,
    );
  } catch (error) {
    if (error instanceof ApiV1Error && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/** `PATCH /api/v1/events/[eventId]`. Host-only — enforced by the server, not by this wrapper. */
export async function updateEvent(
  eventId: string,
  input: EventUpdate,
  opts: ApiV1Options = {},
): Promise<void> {
  const body = eventUpdateSchema.parse(input);
  await requestApiV1("PATCH", `/api/v1/events/${encodeURIComponent(eventId)}`, body, parseOk, opts);
}

/**
 * `POST /api/v1/events/[eventId]/rsvp`. Render the RETURNED `status`, not
 * `intent` — a full or approval-gated event legitimately stores something
 * else, and `events-service.ts`'s own header is explicit that this
 * disagreement is the normal case, not an error.
 */
export async function requestRsvp(
  eventId: string,
  intent: RsvpIntent,
  opts: ApiV1Options = {},
): Promise<RsvpMutationResult> {
  const parsedIntent = rsvpIntentSchema.parse(intent);
  const result = await requestApiV1(
    "POST",
    `/api/v1/events/${encodeURIComponent(eventId)}/rsvp`,
    { intent: parsedIntent },
    (json) => rsvpResponseSchema.parse(json),
    opts,
  );
  return result.result;
}

/** `DELETE /api/v1/events/[eventId]/rsvp`. */
export async function withdrawRsvp(eventId: string, opts: ApiV1Options = {}): Promise<RsvpMutationResult> {
  const result = await requestApiV1(
    "DELETE",
    `/api/v1/events/${encodeURIComponent(eventId)}/rsvp`,
    undefined,
    (json) => rsvpResponseSchema.parse(json),
    opts,
  );
  return result.result;
}

/** `GET /api/v1/events/[eventId]/queue`. Empty for anyone but the host — the RPC's own answer, passed through. */
export async function getHostQueue(eventId: string, opts: ApiV1Options = {}): Promise<HostQueueEntry[]> {
  const result = await requestApiV1(
    "GET",
    `/api/v1/events/${encodeURIComponent(eventId)}/queue`,
    undefined,
    (json) => hostQueueResponseSchema.parse(json),
    opts,
  );
  return result.entries;
}

/**
 * `PATCH /api/v1/events/[eventId]/queue/[rsvpId]` — a host approving or
 * denying one request. `eventId` is part of the URL for symmetry with
 * `getHostQueue`'s listing; the database, not this route or this wrapper,
 * is what actually checks the RSVP belongs to the caller's own event.
 */
export async function decideRsvp(
  eventId: string,
  rsvpId: string,
  decision: RsvpDecision,
  override = false,
  opts: ApiV1Options = {},
): Promise<RsvpMutationResult> {
  const parsedDecision = rsvpDecisionSchema.parse(decision);
  const result = await requestApiV1(
    "PATCH",
    `/api/v1/events/${encodeURIComponent(eventId)}/queue/${encodeURIComponent(rsvpId)}`,
    { decision: parsedDecision, override },
    (json) => rsvpResponseSchema.parse(json),
    opts,
  );
  return result.result;
}

/** `GET /api/v1/events/[eventId]/invites`. RLS-scoped — see the route's own header for who sees what. */
export async function listEventInvites(eventId: string, opts: ApiV1Options = {}): Promise<EventInviteRow[]> {
  const result = await requestApiV1(
    "GET",
    `/api/v1/events/${encodeURIComponent(eventId)}/invites`,
    undefined,
    (json) => eventInvitesResponseSchema.parse(json),
    opts,
  );
  return result.invites;
}

/** `POST /api/v1/events/[eventId]/invites`. `invitedByUserId` is never a field — the server sets it from the session. */
export async function inviteToEvent(
  eventId: string,
  invitedUserId: string,
  opts: ApiV1Options = {},
): Promise<void> {
  const parsedInvitedUserId = uuidSchema.parse(invitedUserId);
  await requestApiV1(
    "POST",
    `/api/v1/events/${encodeURIComponent(eventId)}/invites`,
    { invitedUserId: parsedInvitedUserId },
    parseOk,
    opts,
  );
}
