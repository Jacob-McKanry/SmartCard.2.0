"use client";

import { useActionState, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { CityRow } from "@smartcard/types";

import { createEventAction } from "../actions";
import { initialEventActionState } from "../action-state";
import { GLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../lib/surfaces";

/**
 * "Host an event" — the stacked glass form of `docs/design/DESIGN.md` §6 and the
 * prototype's `data-screen-label="Create event"` block.
 *
 * TWO PANELS, DELIBERATELY, BECAUSE THEY HOLD DIFFERENT KINDS OF FACT
 *
 * The first is what the event *is* (title, when, where). The second is what the
 * event *does to people* — who can find it, how many fit, whether answers need
 * approving. The prototype separates them and the separation is worth keeping:
 * the three settings in the second panel are the ones that change what a guest's
 * tap will be stored as, and they read as consequential when they are not mixed
 * in with the venue name.
 *
 * TIME IS CONVERTED IN THE BROWSER, AND THE ZONE IS STATED
 *
 * `<input type="datetime-local">` yields a wall-clock string with no offset —
 * "2026-08-22T19:00" pins nothing on its own. It is converted to a real instant
 * here, in the browser, and the browser's own IANA zone is submitted alongside
 * it in `timezone`. The visible label says which zone that is, because §7 forbids
 * implying a fact the app cannot back and "7:00 PM" with no zone is exactly that
 * — the same reasoning behind `lib/format.ts` labelling an unknown zone as UTC
 * rather than guessing.
 *
 * The honest limit, stated on the form: this is the *host's* zone, not
 * necessarily the venue's. Someone scheduling a New York dinner from London gets
 * London unless they change their device. A venue-zone picker is a real
 * improvement and a separate piece of work; what this must not do is quietly
 * record a zone it did not ask about.
 *
 * WHAT IS NOT ON THIS FORM
 *
 *  - **No cover photo — it is set on the event's own page, one step later.**
 *    `uploadEventCover` keys the object as `{event_id}/cover.{ext}` and the
 *    Storage policies parse that id back out to check the host
 *    (20260814051400), so a cover cannot exist before the event does: there is
 *    no id to key it under here and no host for a policy to check. The prototype
 *    draws a dropzone at this point in the flow; a dropzone that cannot work
 *    would be §7's "never invent a capability". Since 2026-08-15 the control
 *    exists on the host panel of `/events/[eventId]`, which this form navigates
 *    to on success, so adding a cover is the next thing a host sees rather than
 *    something they have to go looking for. `createEventAction` still sends
 *    `cover_image_path: null`, and an event with no cover renders §5's striped
 *    placeholder, which is a finished state and not a missing one.
 *  - **No latitude/longitude.** The columns exist and the action accepts them,
 *    but nothing in this app geocodes a venue address for an event, and a
 *    map-pin control that stores nothing would be theatre.
 */
export function CreateEventForm({ cities }: { cities: readonly CityRow[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createEventAction, initialEventActionState);

  const [cityId, setCityId] = useState<string>(cities[0]?.id ?? "");
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [startsLocal, setStartsLocal] = useState("");
  const [endsLocal, setEndsLocal] = useState("");

  /**
   * The browser's own IANA zone — a client-only fact, read through
   * `useSyncExternalStore` rather than in an effect.
   *
   * It cannot be read during render, because the server has no idea what zone
   * the browser is in and resolving it in the render body would hydrate into a
   * mismatch on every load with a non-UTC user. The effect-then-setState version
   * of this is a cascading render and the lint rules rightly reject it. This
   * hook is the shape React provides for exactly this case: a server snapshot
   * (empty) and a client snapshot (the real zone), with no subscription because
   * a device's time zone does not change mid-form.
   */
  const timezone = useSyncExternalStore(subscribeToNothing, readTimezone, readNoTimezone);

  const startsAtIso = useMemo(() => toInstant(startsLocal), [startsLocal]);
  const endsAtIso = useMemo(() => toInstant(endsLocal), [endsLocal]);

  // The action returns the new event's id; there is nowhere better to land than
  // the event itself, and staying on a form that has already been submitted
  // invites a second submission.
  useEffect(() => {
    if (state.success === true && state.eventId !== undefined) {
      router.push(`/events/${state.eventId}`);
    }
  }, [router, state.eventId, state.success]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="starts_at" value={startsAtIso} />
      <input type="hidden" name="ends_at" value={endsAtIso} />
      <input type="hidden" name="timezone" value={timezone} />
      <input type="hidden" name="city_id" value={cityId} />
      <input type="hidden" name="visibility" value={visibility} />

      <div className="flex flex-col gap-3.5 rounded-[26px] p-[18px]" style={GLASS}>
        <Field label="Title">
          <input
            name="title"
            required
            maxLength={200}
            placeholder="Rooftop supper club"
            className="h-[46px] rounded-2xl px-[15px] text-[15px] leading-5 font-medium outline-none"
            style={fieldStyle}
          />
        </Field>

        <Field label="Description" optional>
          <textarea
            name="description"
            rows={3}
            maxLength={5000}
            placeholder="What is it, and what should someone expect?"
            className="resize-y rounded-2xl px-[15px] py-3 text-[14px] leading-5 outline-none"
            style={fieldStyle}
          />
        </Field>

        <div className="flex flex-wrap gap-2.5">
          <Field label="Starts" className="min-w-[150px] flex-1">
            <input
              type="datetime-local"
              required
              value={startsLocal}
              onChange={(event) => setStartsLocal(event.target.value)}
              className="h-[46px] rounded-2xl px-[15px] text-[14px] leading-5 outline-none"
              style={fieldStyle}
            />
          </Field>
          <Field label="Ends" optional className="min-w-[150px] flex-1">
            <input
              type="datetime-local"
              value={endsLocal}
              onChange={(event) => setEndsLocal(event.target.value)}
              className="h-[46px] rounded-2xl px-[15px] text-[14px] leading-5 outline-none"
              style={fieldStyle}
            />
          </Field>
        </div>

        <p className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-muted)" }}>
          {timezone === ""
            ? "Times are read from this device's clock."
            : `Times are in ${timezone} — this device's time zone, which may not be the venue's.`}
        </p>

        <Field label="Venue" optional>
          <input
            name="venue_name"
            maxLength={200}
            placeholder="Where is it?"
            className="h-[46px] rounded-2xl px-[15px] text-[14px] leading-5 outline-none"
            style={fieldStyle}
          />
        </Field>

        <Field label="Address" optional hint="Shown to everyone who can see the event.">
          <input
            name="venue_address"
            maxLength={500}
            className="h-[46px] rounded-2xl px-[15px] text-[14px] leading-5 outline-none"
            style={fieldStyle}
          />
        </Field>

        <fieldset className="flex flex-col gap-[7px]">
          <legend className="text-[12px] leading-4 font-semibold" style={{ color: "var(--sc-text-muted)" }}>
            City{" "}
            <span className="font-normal" style={{ color: "var(--sc-text-subtle)" }}>
              curated list, not free text
            </span>
          </legend>
          <div className="flex flex-wrap gap-[7px]">
            {cities.map((city) => {
              const on = city.id === cityId;
              return (
                <button
                  key={city.id}
                  type="button"
                  onClick={() => setCityId(city.id)}
                  aria-pressed={on}
                  className="min-h-11 rounded-full border px-[15px] text-[12px] leading-4 font-semibold"
                  style={{
                    borderColor: on ? "transparent" : "rgba(13,18,32,.1)",
                    background: on ? "var(--sc-accent)" : "rgba(255,255,255,.7)",
                    color: on ? "#ffffff" : "var(--sc-text-muted)",
                  }}
                >
                  {city.name}
                </button>
              );
            })}
          </div>
          {cities.length === 0 ? (
            <p className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-muted)" }}>
              No cities are open yet, so there is nowhere to host. This list is curated rather than
              typed in, so there is nothing to add here.
            </p>
          ) : null}
        </fieldset>
      </div>

      <div className="flex flex-col overflow-hidden rounded-[26px]" style={GLASS}>
        <SettingRow
          title="Who can find it"
          detail="Private events are invisible until someone is invited or has answered."
        >
          <div
            className="flex shrink-0 rounded-full p-[3px]"
            style={{ background: "rgba(13,18,32,.05)" }}
          >
            {(["public", "private"] as const).map((option) => {
              const on = option === visibility;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setVisibility(option)}
                  aria-pressed={on}
                  className="min-h-11 rounded-full px-3.5 text-[12px] leading-4 font-semibold"
                  style={{
                    background: on ? "#ffffff" : "transparent",
                    color: on ? "var(--sc-text)" : "var(--sc-text-subtle)",
                    boxShadow: on ? "0 1px 4px rgba(16,24,40,.12)" : undefined,
                  }}
                >
                  {option === "public" ? "Public" : "Private"}
                </button>
              );
            })}
          </div>
        </SettingRow>

        <SettingRow
          title="Capacity"
          detail="Past this, new answers are stored as waitlist places. Leave it empty for no cap."
          htmlFor="capacity"
        >
          <input
            id="capacity"
            name="capacity"
            type="number"
            min={1}
            inputMode="numeric"
            placeholder="—"
            className="h-11 w-[86px] shrink-0 rounded-[14px] text-center text-[15px] leading-5 font-semibold outline-none"
            style={fieldStyle}
          />
        </SettingRow>

        <SettingRow
          title="Approve each guest"
          detail="Answers arrive as pending requests for you to decide, instead of taking a seat."
          htmlFor="requires_approval"
          last
        >
          {/*
           * A real checkbox rather than the prototype's painted pill: it is a
           * form control the Server Action reads by name (`=== "on"`), it is
           * reachable by keyboard, and a screen reader announces its state
           * without any ARIA of ours. §8's floor beats a 40×24 knob.
           */}
          <input
            id="requires_approval"
            name="requires_approval"
            type="checkbox"
            className="size-6 shrink-0 accent-[var(--sc-accent)]"
          />
        </SettingRow>
      </div>

      <p className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}>
        A waitlist promotes itself: the moment a seat frees, the longest-waiting person takes it, in
        the same instant. There is no setting for that and nothing for you to do.
      </p>

      {state.error !== undefined ? (
        <p role="alert" className="text-[13px] leading-[18px]" style={{ color: "var(--sc-danger)" }}>
          {state.error}
        </p>
      ) : null}

      {/*
        TWO SUBMIT BUTTONS NAMING A VALUE, NOT A CHECKBOX. Owner request,
        2026-08-30: a host may save an in-progress event without it being live
        for anyone else yet. Same fields, same validation as publishing —
        `status` is the only thing that differs, and each button says which
        value it sends via `name="status" value="..."`, which is the ordinary
        HTML way to submit different data for different submit actions and
        needs no client-side state to track which button was pressed.

        A draft skips the confirm-before-leaving concern entirely: it is
        exactly as reversible as any other save, and `/events/[eventId]`'s
        host panel is where it gets a "Publish" button of its own — see that
        page for why publishing lives there and not here.
      */}
      <div className="flex flex-wrap gap-2.5 pb-2">
        <button
          type="submit"
          name="status"
          value="scheduled"
          disabled={pending || cityId === ""}
          className="min-h-[52px] flex-1 rounded-full px-4 text-[14px] leading-[18px] font-semibold disabled:opacity-60"
          style={PRIMARY_BUTTON}
        >
          {pending ? "Publishing…" : "Publish event"}
        </button>
        <button
          type="submit"
          name="status"
          value="draft"
          disabled={pending || cityId === ""}
          className="flex min-h-[52px] items-center rounded-full px-[18px] text-[14px] leading-[18px] font-semibold disabled:opacity-60"
          style={SECONDARY_BUTTON}
        >
          Save as draft
        </button>
        <Link
          href="/events"
          className="flex min-h-[52px] items-center rounded-full px-[22px] text-[14px] leading-[18px] font-semibold"
          style={SECONDARY_BUTTON}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- helpers */

const fieldStyle = {
  border: "1px solid rgba(13,18,32,.1)",
  background: "rgba(255,255,255,.8)",
  color: "var(--sc-text)",
} as const;

/** A device's time zone does not change while a form is open. Nothing to watch. */
function subscribeToNothing(): () => void {
  return () => {};
}

function readTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
}

/** The server snapshot: it genuinely does not know, and must not guess. */
function readNoTimezone(): string {
  return "";
}

/**
 * A `datetime-local` value ("2026-08-22T19:00") as a real instant.
 *
 * `new Date(value)` on a string with no offset is parsed in the *browser's* zone
 * — which is the zone this form also submits — so the two agree by construction.
 * An empty or unparseable value produces an empty string rather than an
 * "Invalid Date", so the action's own validation is what reports the problem
 * instead of a `RangeError` thrown mid-submit.
 */
function toInstant(localValue: string): string {
  if (localValue.trim() === "") return "";
  const parsed = new Date(localValue);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function Field({
  label,
  optional,
  hint,
  className,
  children,
}: {
  label: string;
  optional?: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <span className="text-[12px] leading-4 font-semibold" style={{ color: "var(--sc-text-muted)" }}>
        {label}
        {optional ? (
          <span className="font-normal" style={{ color: "var(--sc-text-subtle)" }}>
            {" "}
            optional
          </span>
        ) : null}
      </span>
      {children}
      {hint ? (
        <span className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-subtle)" }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function SettingRow({
  title,
  detail,
  htmlFor,
  last,
  children,
}: {
  title: string;
  detail: string;
  htmlFor?: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3.5 px-[18px] py-[15px]"
      style={{ borderBottom: last ? undefined : "1px solid rgba(13,18,32,.055)" }}
    >
      <div className="min-w-0">
        <label
          htmlFor={htmlFor}
          className="block text-[13px] leading-[17px] font-semibold"
        >
          {title}
        </label>
        <p
          className="text-[12px] leading-[17px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          {detail}
        </p>
      </div>
      {children}
    </div>
  );
}
