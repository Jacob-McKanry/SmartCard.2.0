"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import {
  eventInsertSchema,
  eventUpdateSchema,
  rsvpDecisionSchema,
  rsvpIntentSchema,
  uuidSchema,
} from "@smartcard/types";

import { getAuthenticatedContext, type AuthenticatedContext } from "@/server/auth/current-user";
import { safeActionErrorMessage, UserFacingError } from "@/server/errors";
import {
  createEvent,
  decideRsvp,
  inviteToEvent,
  requestRsvp,
  updateOwnEvent,
  withdrawRsvp,
  type RsvpMutationResult,
} from "@/server/events/events-service";
import {
  InvalidCoverError,
  removeEventCover,
  replaceEventCover,
} from "@/server/events/cover-upload";
import type { EventActionState } from "./action-state";

/**
 * Server Actions for the Events feature.
 *
 * SECURITY NOTE THAT APPLIES TO EVERY EXPORT IN THIS FILE — the same one
 * `apps/web/src/app/(app)/profile/actions.ts` and the connections feature's
 * actions carry, because the reasoning has not changed: a Server Action is a
 * POST endpoint reachable by anyone who can send the same request, not only by
 * somebody who loaded the page first
 * (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`,
 * "Security": "the route is reachable to anyone who can send the same POST.
 * Treat every action as an untrusted entry point"). Rendering a form on an
 * authenticated page is not a security boundary. Every action here therefore
 * re-derives the caller from a fresh `getAuthenticatedContext()` and performs
 * its work through that context's RLS-bound client — never the service role.
 *
 * AND FOR THIS FEATURE SPECIFICALLY, THE BOUNDARY IS EVEN FURTHER DOWN
 * Nothing in this file decides an RSVP's status, whether an event is full,
 * whether approval is needed, or whether the caller is a host. Those are all
 * decided inside `public.request_event_rsvp`, `public.withdraw_event_rsvp` and
 * `public.decide_event_rsvp` (20260814051200), which derive the caller from the
 * JWT and hold a lock on the event while they compute. This file's job is to
 * validate shapes, call one function, revalidate a path, and turn a refusal
 * into a sentence. If every line below were wrong, the database would still
 * refuse to approve anybody past a host's gate or seat anybody at a full event.
 *
 * `eventId` / `rsvpId` arrive as *bound* leading arguments
 * (`action.bind(null, eventId)`), the pattern the forms guide recommends for
 * "which row" arguments — so they come from server-rendered markup a previous
 * render produced rather than from a form field. They are still treated as
 * untrusted: ownership of whatever they name is re-derived from the session and
 * re-checked by the database on every call.
 */

async function requireContext(): Promise<AuthenticatedContext> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    // Fail closed (CLAUDE.md): an action invoked with no valid session is
    // refused outright, never treated as an anonymous request for nothing.
    throw new UserFacingError("You need to be signed in to do that.");
  }
  return context;
}

/**
 * Only a message deliberately written for a person crosses to the browser;
 * anything else becomes one generic sentence with the real error logged
 * server-side. See `@/server/errors` for why this is opt-in rather than a
 * filter over raw database text.
 */
function messageOf(error: unknown): string {
  return safeActionErrorMessage(error, "events");
}

function firstIssue(error: ZodError): string {
  return error.issues[0]?.message ?? "That value isn't valid.";
}

/** `null` for a blank field rather than `""`, matching the nullable columns. */
function textOrNull(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function numberOrNull(formData: FormData, field: string): number | null {
  const value = textOrNull(formData, field);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Turns the database's own refusal codes into something a person can read.
 *
 * The codes are deliberately not surfaced raw, and the messages deliberately
 * say no more than the caller is entitled to know. `rsvp_not_found` covers both
 * "no such RSVP" and "that is not your event" in the database, and it stays
 * merged here — splitting it into two friendlier messages would rebuild, in the
 * UI layer, exactly the probe the RPC refuses to be.
 */
function rsvpRefusalMessage(reason: string): string {
  switch (reason) {
    case "not_authenticated":
      return "You need to be signed in to do that.";
    case "event_not_visible":
    case "event_not_found":
      return "That event isn't available.";
    case "event_ended":
      return "That event has already ended.";
    case "invalid_intent":
      return "That isn't something you can choose — pick going, interested, or not going.";
    case "invalid_decision":
      return "That isn't a decision this event accepts.";
    case "rsvp_not_found":
      return "That request isn't available to decide on.";
    case "not_decidable":
      return "That request has already been settled and can't be changed here.";
    case "no_rsvp":
      return "You haven't answered for this event.";
    default:
      return "That didn't work. Please try again.";
  }
}

function stateFrom(result: RsvpMutationResult): EventActionState {
  if (!result.ok) {
    return { error: rsvpRefusalMessage(result.reason) };
  }
  return { success: true, status: result.status, promoted: result.promoted };
}

// -----------------------------------------------------------------------
// Hosting
// -----------------------------------------------------------------------

/**
 * Creates an event hosted by the caller — Q5, resolved: any signed-in user may.
 *
 * `host_user_id` is not read from the form. It comes from the session inside
 * `createEvent`, and the INSERT policy's `with check` refuses anything else, so
 * there is no field a request could edit to host an event as somebody else.
 */
export async function createEventAction(
  _prevState: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const context = await requireContext();

  const parsed = eventInsertSchema.safeParse({
    city_id: formData.get("city_id"),
    title: formData.get("title"),
    description: textOrNull(formData, "description"),
    starts_at: formData.get("starts_at"),
    ends_at: textOrNull(formData, "ends_at"),
    timezone: textOrNull(formData, "timezone"),
    venue_name: textOrNull(formData, "venue_name"),
    venue_address: textOrNull(formData, "venue_address"),
    latitude: numberOrNull(formData, "latitude"),
    longitude: numberOrNull(formData, "longitude"),
    visibility: formData.get("visibility") ?? "private",
    capacity: numberOrNull(formData, "capacity"),
    requires_approval: formData.get("requires_approval") === "on",
    cover_image_path: null,
  });

  if (!parsed.success) {
    return { error: firstIssue(parsed.error) };
  }

  let eventId: string;
  try {
    const created = await createEvent(context.supabase, context.userId, parsed.data);
    eventId = created.id;
  } catch (error) {
    return { error: messageOf(error) };
  }

  revalidatePath("/events");
  return { success: true, eventId };
}

/**
 * Edits an event the caller hosts.
 *
 * Every field is optional: this is a partial update, so a form that renders
 * only some fields does not blank out the rest. Raising `capacity` can promote
 * people off the waitlist — that happens in the database, in the same
 * transaction as the capacity change, and nothing here has to (or could
 * safely) orchestrate it.
 */
export async function updateEventAction(
  eventId: string,
  _prevState: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const context = await requireContext();

  const raw: Record<string, unknown> = {};
  for (const field of [
    "city_id",
    "title",
    "starts_at",
    "visibility",
  ] as const) {
    const value = formData.get(field);
    if (typeof value === "string" && value.trim() !== "") raw[field] = value;
  }
  for (const field of [
    "description",
    "ends_at",
    "timezone",
    "venue_name",
    "venue_address",
    "cover_image_path",
  ] as const) {
    if (formData.has(field)) raw[field] = textOrNull(formData, field);
  }
  for (const field of ["latitude", "longitude", "capacity"] as const) {
    if (formData.has(field)) raw[field] = numberOrNull(formData, field);
  }
  if (formData.has("requires_approval")) {
    raw.requires_approval = formData.get("requires_approval") === "on";
  }

  const parsed = eventUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: firstIssue(parsed.error) };
  }

  try {
    await updateOwnEvent(context.supabase, context.userId, eventId, parsed.data);
  } catch (error) {
    return { error: messageOf(error) };
  }

  revalidatePath("/events");
  revalidatePath(`/events/${eventId}`);
  return { success: true };
}

// -----------------------------------------------------------------------
// The cover image
// -----------------------------------------------------------------------

/**
 * Sets or replaces the cover of an event the caller hosts.
 *
 * WHY THIS IS ITS OWN ACTION AND NOT A FIELD ON `updateEventAction`
 *
 * A cover is two writes that have to agree — an object in Storage and the column
 * that points at it — with a rollback in between if the second fails.
 * `updateEventAction` is a partial column update and has no business owning
 * that; `replaceEventCover` does, and its header sets out the ordering and what
 * each failure leaves behind. It also means `cover_image_path` is never
 * something a *form field* supplies: the path is computed from the event id and
 * the file's media type inside the service, so no request can point an event's
 * cover at an arbitrary object key.
 *
 * WHY THE EVENT HAS TO EXIST FIRST, AND WHY THAT IS NOT A LIMITATION TO ROUTE
 * AROUND
 *
 * The Storage key is `{event_id}/cover.{ext}` and the policies parse the event
 * id back out of it to ask whether the caller is the host (20260814051400), so
 * there is nothing to authorise before the event row exists. The control
 * therefore lives on the host panel of `/events/[eventId]`, not on the create
 * form. `create-event-form.tsx` says so where a reader would otherwise wonder
 * why the prototype's dropzone is missing.
 *
 * Nothing here checks that the caller is the host. Three things already do, and
 * a fourth copy would only be a fourth place to get it wrong: the Storage
 * INSERT/UPDATE policies, the `events` UPDATE policy, and `updateOwnEvent`'s own
 * `host_user_id` filter.
 */
export async function uploadEventCoverAction(
  eventId: string,
  _prevState: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const context = await requireContext();

  const file = formData.get("cover");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image to use as the cover." };
  }

  try {
    await replaceEventCover(context.supabase, context.userId, eventId, file);
  } catch (error) {
    // `InvalidCoverError` is the one whose text is written for a person to read
    // — wrong format, too large. Everything else goes through `messageOf`.
    if (error instanceof InvalidCoverError) {
      return { error: error.message };
    }
    return { error: messageOf(error) };
  }

  revalidatePath("/events");
  revalidatePath(`/events/${eventId}`);
  return { success: true };
}

/**
 * Removes the cover from an event the caller hosts, returning it to §5's striped
 * placeholder.
 *
 * A cover is the only thing on an event a host can put on and take off again
 * (an invite cannot be taken back, an admitted guest is not un-admitted), so
 * unlike those this one gets a real undo. No confirmation step: nothing is lost
 * that cannot be re-uploaded from the file the host still has.
 */
export async function removeEventCoverAction(
  eventId: string,
  _prevState: EventActionState,
): Promise<EventActionState> {
  const context = await requireContext();

  try {
    await removeEventCover(context.supabase, context.userId, eventId);
  } catch (error) {
    return { error: messageOf(error) };
  }

  revalidatePath("/events");
  revalidatePath(`/events/${eventId}`);
  return { success: true };
}

// -----------------------------------------------------------------------
// Inviting somebody to a private event
// -----------------------------------------------------------------------

/**
 * Turns a refused invite into a sentence.
 *
 * A policy refusal arrives as a thrown `42501` rather than as one of the RPC
 * reason codes `rsvpRefusalMessage` handles, because inviting is an ordinary
 * RLS-checked insert rather than an RPC (see `inviteToEvent`).
 *
 * The message deliberately does not say *which* condition failed, and that is
 * the same reasoning `rsvp_not_found` gets above. Splitting it into "you aren't
 * connected to them" versus "you're not going to this event" would answer two
 * questions the caller has not earned an answer to — the first of which reports
 * whether a given user id exists and is connected to somebody, which is a probe
 * against the graph rather than a nicer error.
 */
function inviteFailureMessage(error: unknown): string {
  const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
  if (cause?.code === "42501") {
    return "You can only invite people you're connected to, to events you host or are going to.";
  }
  return messageOf(error);
}

/**
 * Invites one of the caller's connections to see a private event.
 *
 * `invited_by_user_id` is not read from the form — it comes from the session
 * inside `inviteToEvent`, and the INSERT policy's `with check` refuses anything
 * else, so there is no field a request could edit to invite as somebody else.
 * `invited_user_id` *is* client-supplied and is treated as untrusted: the
 * database independently requires it to be an active connection of the caller
 * (`private.are_connected`), so a forged or guessed id is refused rather than
 * merely unhelpful.
 *
 * Nothing here checks whether the caller is the host or holds a `going` RSVP,
 * deliberately. That is the policy's job, it is re-derived from the JWT on every
 * call, and a copy of it in this file would only be a second place to get it
 * wrong.
 *
 * Succeeding here grants the invitee *visibility* of the event. It does not RSVP
 * them — they still answer for themselves — so a UI built on this should say
 * "invited", never "added".
 */
export async function inviteToEventAction(
  eventId: string,
  _prevState: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const context = await requireContext();

  const parsed = uuidSchema.safeParse(textOrNull(formData, "invited_user_id"));
  if (!parsed.success) {
    return { error: "Choose somebody to invite." };
  }

  try {
    await inviteToEvent(context.supabase, eventId, context.userId, parsed.data);
  } catch (error) {
    return { error: inviteFailureMessage(error) };
  }

  revalidatePath(`/events/${eventId}`);
  return { success: true };
}

// -----------------------------------------------------------------------
// Answering for yourself
// -----------------------------------------------------------------------

/**
 * Records what the caller wants — `going`, `interested` or `not_going`.
 *
 * The intent is validated here as well as in the database, because a value the
 * schema does not know is a bug worth catching before a round trip. It is
 * validated *again* in the RPC, which is the one that matters: `pending`,
 * `waitlist` and `denied` are outcomes, and a caller asking for one directly
 * gets `invalid_intent` regardless of what this file did.
 *
 * The returned `status` is what was actually stored, which is frequently not
 * what was asked for. Callers should render that, not the intent.
 */
export async function requestRsvpAction(
  eventId: string,
  _prevState: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const context = await requireContext();

  const parsed = rsvpIntentSchema.safeParse(formData.get("intent"));
  if (!parsed.success) {
    return { error: "Choose going, interested, or not going." };
  }

  let result: RsvpMutationResult;
  try {
    result = await requestRsvp(context.supabase, eventId, parsed.data);
  } catch (error) {
    return { error: messageOf(error) };
  }

  revalidatePath("/events");
  revalidatePath(`/events/${eventId}`);
  return stateFrom(result);
}

/**
 * Removes the caller's answer entirely — not the same as answering "not going",
 * which is still an answer.
 *
 * Worth surfacing in the UI that calls this: for a *private* event, the RSVP
 * row is what made the event visible at all, so withdrawing also gives up the
 * ability to see it. And if this frees a seat, somebody else is promoted off
 * the waitlist in the same transaction — `promoted` in the returned state says
 * how many.
 */
export async function withdrawRsvpAction(
  eventId: string,
  _prevState: EventActionState,
): Promise<EventActionState> {
  const context = await requireContext();

  let result: RsvpMutationResult;
  try {
    result = await withdrawRsvp(context.supabase, eventId);
  } catch (error) {
    return { error: messageOf(error) };
  }

  revalidatePath("/events");
  revalidatePath(`/events/${eventId}`);
  return stateFrom(result);
}

// -----------------------------------------------------------------------
// Deciding, as a host
// -----------------------------------------------------------------------

/**
 * Approves or denies somebody's request for an event the caller hosts.
 *
 * Whether the caller is really that event's host is not checked here and must
 * not be: the RPC re-derives it from the JWT and refuses otherwise, and it
 * answers identically for "no such RSVP" and "not your event" so a caller
 * cannot use it to find out whether an id exists. A check in this file would
 * add nothing except a second place to get it wrong.
 *
 * `override` admits somebody past a full event's cap and is recorded on the row
 * as `capacity_override`, so an over-capacity event stays explainable later. It
 * is bound by the caller rather than read from a form field, so the "admit
 * anyway" affordance has to be a deliberate, separately-rendered control rather
 * than a hidden input any request could set.
 */
export async function decideRsvpAction(
  eventId: string,
  rsvpId: string,
  decision: "approve" | "deny",
  override: boolean,
  _prevState: EventActionState,
): Promise<EventActionState> {
  const context = await requireContext();

  const parsed = rsvpDecisionSchema.safeParse(decision);
  if (!parsed.success) {
    return { error: "That isn't a decision this event accepts." };
  }

  let result: RsvpMutationResult;
  try {
    result = await decideRsvp(context.supabase, rsvpId, parsed.data, override);
  } catch (error) {
    return { error: messageOf(error) };
  }

  revalidatePath(`/events/${eventId}`);
  return stateFrom(result);
}
