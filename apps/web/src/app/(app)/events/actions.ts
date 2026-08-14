"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import {
  eventInsertSchema,
  eventUpdateSchema,
  rsvpDecisionSchema,
  rsvpIntentSchema,
} from "@smartcard/types";

import { getAuthenticatedContext, type AuthenticatedContext } from "@/server/auth/current-user";
import {
  createEvent,
  decideRsvp,
  requestRsvp,
  updateOwnEvent,
  withdrawRsvp,
  type RsvpMutationResult,
} from "@/server/events/events-service";
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
    throw new Error("You need to be signed in to do that.");
  }
  return context;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
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
