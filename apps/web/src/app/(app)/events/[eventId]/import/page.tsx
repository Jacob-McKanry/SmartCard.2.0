import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { isVerifiedHost } from "@/server/events/attendee-import-service";
import { getEventForViewer } from "@/server/events/events-service";

import { viewerRole } from "../../lib/access-rules";
import { GLASS, PRIMARY_BUTTON } from "../../lib/surfaces";
import { ImportWizard } from "./import-wizard";

/**
 * `/events/[eventId]/import` — where a verified host uploads a guest list.
 *
 * THE GATES, AND WHICH OF THEM IS THE REAL ONE
 *
 *  1. `public.import_event_attendees` refuses anybody who is not an active
 *     verified host of this specific non-cancelled event, derived from the JWT.
 *     **That is the enforcement.** It is the last thing to run and the only one
 *     that cannot be routed around: the Server Action behind this wizard is a
 *     POST endpoint reachable without ever loading this page.
 *  2. `viewerRole(...) !== "host"` → `notFound()` below. Routing, not access.
 *     404 is also this route's answer for an event that does not exist, so it
 *     does not confirm the id is real to somebody guessing.
 *  3. `isVerifiedHost` decides which of two screens a host sees. Also not
 *     access — it is the difference between explaining why the wizard is not
 *     available and letting somebody map thirty columns before the database
 *     refuses them.
 *
 * The same shape as `queue/page.tsx`, and for the same reason: a management
 * screen that renders empty or fails at the end is a screen that *looks*
 * broken, and somebody then goes looking for the bug.
 *
 * WHY THIS IS ONE ROUTE AND NOT FOUR
 *
 * The wizard has four steps — choose a file, map the columns, review and
 * attest, see the result — and they are steps in one client component rather
 * than four pages on purpose. The CSV is parsed in the browser and the parsed
 * rows have to survive from the mapping screen to the review screen to the
 * submit. Four routes would mean handing that between them, and every way of
 * doing that (re-parsing per step, stashing the text in session storage,
 * round-tripping to the server) reintroduces the exact problem §11.2 of the
 * import doc rules out: the preview and the write becoming two separate
 * interpretations of the same bytes. One component, one parse, one array —
 * what the host reviewed is the array that gets sent.
 */
export const dynamic = "force-dynamic";

export default async function EventImportPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }
  const { supabase, userId } = context;
  const { eventId } = await params;

  const item = await getEventForViewer(supabase, eventId);
  if (item === null) {
    notFound();
  }

  if (viewerRole(item.event.host_user_id, userId, null) !== "host") {
    // Gate 2. Same answer as a non-existent event — see the header.
    notFound();
  }

  // Read AFTER the host check, not before. There is no reason to ask the
  // database about the caller's standing until it is established that this is
  // their event to import into.
  const verified = await isVerifiedHost(supabase);

  return (
    <main
      className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-[22px] pt-4 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <Link
        href={`/events/${eventId}`}
        className="-ml-1 flex min-h-11 items-center gap-1.5 self-start px-1 text-[13px] leading-[18px] font-medium"
        style={{ color: "var(--sc-text-muted)" }}
      >
        <ChevronLeft size={16} strokeWidth={2} aria-hidden />
        {item.event.title}
      </Link>

      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[27px] leading-[31px] font-semibold tracking-[-0.03em]">
            Import a guest list
          </h1>
          <span
            className="rounded-full px-[11px] py-[5px] text-[10px] leading-[13px] font-semibold text-white"
            style={{ background: "var(--sc-text)" }}
          >
            Host only
          </span>
        </div>
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
          Upload the export from Luma, Eventbrite, Partiful or your own spreadsheet.
        </p>
      </header>

      {verified ? (
        <>
          <ImportWizard eventId={eventId} />
          {/*
            The way back to the links for an import the host ran days ago. The
            wizard's own last step links there too, but that step is gone as
            soon as they navigate away, and a host chasing the three guests who
            never claimed should not have to re-upload the file to find it.

            Shown to every verified host without asking whether this event has
            any pending links, for the same reason the import door itself is
            shown to every host (§11.1.1): counting first would mean this page
            reading rows it has no reason to hold, and a link that vanishes
            during an outage is worse than one that leads to an honest empty
            state.
          */}
          <Link
            href={`/events/${eventId}/import/links`}
            className="self-start text-[13px] leading-[18px] font-medium underline underline-offset-4"
            style={{ color: "var(--sc-text-muted)" }}
          >
            Claim links for guests who haven&rsquo;t claimed yet
          </Link>
        </>
      ) : (
        <NotVerifiedYet />
      )}
    </main>
  );
}

/**
 * What a host who is not verified sees.
 *
 * NOW LINKS TO `/host/apply` — §9.2's form, built 2026-08-30. This component's
 * header used to say there was no apply button because that screen did not
 * exist; §7's rule against inventing a capability cuts the other way now that
 * it does, and a sentence claiming applying "isn't open in the app yet" would
 * itself be the stale claim.
 *
 * It still does not say *why* the caller is unverified — never applied, waiting
 * on a decision, or turned down — because that screen has no way to know (the
 * application table is not read here) and `/host/apply` itself is the one place
 * that reads it and shows the real status.
 */
function NotVerifiedYet() {
  return (
    <div className="flex flex-col gap-2.5 rounded-[26px] p-[17px]" style={GLASS}>
      <h2 className="text-[15px] leading-5 font-semibold">Importing needs a verified host account</h2>
      <p
        className="max-w-[54ch] text-[13px] leading-[19px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        A guest list is other people&rsquo;s contact details, so uploading one is limited to hosts
        we&rsquo;ve checked by hand.
      </p>
      <Link
        href="/host/apply"
        className="flex min-h-11 w-fit items-center rounded-full px-[18px] text-[13px] leading-[17px] font-semibold"
        style={PRIMARY_BUTTON}
      >
        Apply to become a host
      </Link>
      <p className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-subtle)" }}>
        Everything else about hosting this event works as normal.
      </p>
    </div>
  );
}
