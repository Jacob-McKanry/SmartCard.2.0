import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import {
  adminListHostApplications,
  isAdmin,
} from "@/server/hosting/host-application-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";

import { GLASS } from "../../events/lib/surfaces";
import { QueueRow } from "./queue-row";

/**
 * `/admin/host-applications` — §9.3's review queue.
 *
 * THE SAME THREE-GATE SHAPE `/events/[eventId]/queue` USES, FOR THE SAME REASON
 *
 *  1. `public.admin_list_host_applications` returns nothing to a non-admin —
 *     that is the real enforcement, re-derived from the JWT via
 *     `private.is_admin()`, and it holds even if every line below were deleted.
 *  2. `isAdmin(...)` here decides ROUTING: a non-admin gets `notFound()`
 *     rather than an empty queue that reads as broken.
 *  3. `QueueRow` renders unconditionally once past gate 2 — there is no third
 *     component-level check here the way `QueueView` has one, because this
 *     page (unlike the RSVP queue) is admin-only end to end with no second
 *     role that reaches the same route.
 *
 * PHOTOS SIGN THROUGH THE ADMIN'S OWN RLS-BOUND CLIENT, NOT THE SERVICE ROLE.
 * `20260830130000` adds the storage policy that makes this succeed for an
 * applicant's path when the caller is an active admin — see that migration's
 * header for why the service role was rejected. A failed signing degrades to
 * initials (`signedProfilePhotoUrl`'s own contract), never an error.
 */
export const dynamic = "force-dynamic";

export default async function HostApplicationsQueuePage() {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }
  const { supabase } = context;

  if (!(await isAdmin(supabase))) {
    // Gate 2 — see the header. Same 404 a stranger gets for a route that does
    // not exist, so this does not confirm the page exists to somebody probing.
    notFound();
  }

  const applications = await adminListHostApplications(supabase, "pending");

  const photoEntries = await Promise.all(
    applications.map(
      async (app) => [app.id, await signedProfilePhotoUrl(supabase, app.photo_path)] as const,
    ),
  );
  const photoUrls = Object.fromEntries(photoEntries);

  return (
    <main
      className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-[22px] pt-4 pb-6 sm:px-7"
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

      <header className="flex flex-col gap-1.5">
        <h1 className="text-[27px] leading-[31px] font-semibold tracking-[-0.03em]">
          Host applications
        </h1>
        <p className="text-[13px] leading-[18px]" style={{ color: "var(--sc-text-subtle)" }}>
          {applications.length} pending
        </p>
      </header>

      {applications.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-[26px] p-[17px]" style={GLASS}>
          <h2 className="text-[15px] leading-5 font-semibold">Nothing to review</h2>
          <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
            New applications will show up here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {applications.map((app) => (
            <QueueRow key={app.id} application={app} photoUrl={photoUrls[app.id] ?? null} />
          ))}
        </ul>
      )}
    </main>
  );
}
