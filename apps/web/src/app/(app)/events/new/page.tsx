import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { listActiveCities } from "@/server/events/events-service";

import { CreateEventForm } from "./create-event-form";

/**
 * `/events/new` — hosting an event.
 *
 * ANY SIGNED-IN USER MAY HOST. That was Q5 and it is resolved: there is no host
 * role, no application, and no approval step, so this page has no gate beyond
 * the layout's sign-in check. The `events` INSERT policy's only condition is
 * `host_user_id = current_user_id()`, and `createEvent` fills that from the
 * session rather than the form — so there is no field on this page a request
 * could edit to create an event hosted by somebody else.
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

  const cities = await listActiveCities(context.supabase);

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

      <CreateEventForm cities={cities} />
    </main>
  );
}
