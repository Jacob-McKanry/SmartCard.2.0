import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { isVerifiedHost } from "@/server/events/attendee-import-service";
import { listActiveCities } from "@/server/events/events-service";

import { CreateEventForm } from "./create-event-form";

/**
 * `/events/new` — hosting an event.
 *
 * ANY SIGNED-IN USER MAY DRAFT. Q5 resolved that any signed-in user may host,
 * with no application or approval step, and drafting still works exactly that
 * way — this page has no gate beyond the layout's sign-in check, and the
 * `events` INSERT policy's `with check` still only requires
 * `host_user_id = current_user_id()` for a draft. `createEvent` fills that
 * host id from the session rather than the form, so there is no field here a
 * request could edit to create an event hosted by somebody else.
 *
 * PUBLISHING NARROWS THAT, AS OF 20260901130000. Creating an event directly as
 * `scheduled` — or publishing a saved draft — additionally requires
 * `public.is_verified_host()`, enforced in the database on both paths. This
 * page reads the same flag to decide which button `CreateEventForm` offers:
 * see that component's own header for why "Publish event" disappears entirely
 * for an unverified account rather than being shown and then refused.
 *
 * The cities come from the curated `cities` table, never free text. That is the
 * schema's rule (`events.city_id` is a NOT NULL FK) and it is also what keeps
 * browse from needing a search box.
 */
export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }

  const [cities, verified] = await Promise.all([
    listActiveCities(context.supabase),
    isVerifiedHost(context.supabase),
  ]);

  return (
    <main
      className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-[22px] pt-4 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <Link
        href="/events"
        className="-ml-1 flex min-h-11 items-center gap-1.5 self-start px-1 text-[13px] leading-[18px] font-medium"
        style={{ color: "var(--sc-text-muted)" }}
      >
        <ChevronLeft size={16} strokeWidth={2} aria-hidden />
        Events
      </Link>

      <h1 className="text-[27px] leading-[31px] font-semibold tracking-[-0.03em]">Host an event</h1>

      <CreateEventForm cities={cities} verifiedHost={verified} />
    </main>
  );
}
