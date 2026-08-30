import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import {
  IMPORT_LINKS_PAGE_SIZE,
  listOwnImportLinks,
} from "@/server/events/attendee-import-service";
import { getEventForViewer } from "@/server/events/events-service";

import { viewerRole } from "../../../lib/access-rules";
import { GLASS, SECONDARY_BUTTON } from "../../../lib/surfaces";
import { ClaimLinksList } from "./claim-links-list";

/**
 * `/events/[eventId]/import/links` — the interim hand-delivery screen.
 *
 * WHY THIS EXISTS AT ALL, GIVEN §3.8 SAYS IT SHOULD NOT
 *
 * `docs/architecture/2026-08-22-event-attendee-import.md` §3.8 rules out any
 * host read path into `event_attendee_imports`, and this is the one exception,
 * recorded as a deviation in §11.5 of that document and in
 * 20260829120000's own header rather than taken quietly.
 *
 * The short version: §5's email phase is not built, so a `lookup_token` is
 * written into a table nothing can read and there is no way for the claim link
 * to reach the person it belongs to. Every screen behind that link (C2-C5)
 * exists and is verified, and none of it can be reached by a real person. This
 * screen is the stopgap — the host copies one guest's link and sends it however
 * they already talk to that guest — and it is meant to be deleted when mail is
 * sent for them.
 *
 * WHAT IT STILL WILL NOT SHOW, WHICH IS THE PART WORTH CHECKING IN REVIEW
 *
 *  - Only rows THIS CALLER imported (`imported_by_user_id`, in the RPC, not
 *    here). A host who inherits the event later sees nothing, which is the
 *    exact scenario §3.8's objection was about.
 *  - Only UNCLAIMED rows. There is no "claimed ✓" and no way to derive one: a
 *    per-person claim status would tell the host which of their guests hold
 *    SmartCard accounts, which is §3.9's line and it has not moved.
 *  - Only name, email and the link. Phone numbers, employers and social handles
 *    stay in the host's own spreadsheet where they already are.
 *
 * THE GATES ARE THE RPC'S, NOT THIS PAGE'S. `viewerRole` below decides routing
 * and nothing else — the same posture `import/page.tsx` takes and for the same
 * reason: `list_own_import_links` re-derives verified-host standing, event
 * ownership and per-row authorship from the JWT, and it is reachable over
 * PostgREST without ever loading this route.
 */
export const dynamic = "force-dynamic";

export default async function ImportLinksPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ p?: string }>;
}) {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }
  const { supabase, userId } = context;
  const { eventId } = await params;
  const { p } = await searchParams;

  const item = await getEventForViewer(supabase, eventId);
  if (item === null) {
    notFound();
  }
  if (viewerRole(item.event.host_user_id, userId, null) !== "host") {
    // Same answer as a non-existent event, so this does not confirm an id is
    // real to somebody guessing.
    notFound();
  }

  // Page numbers are 1-based in the URL and clamped here. A junk `?p=` is a
  // typo or a probe, not a reason to error: it lands on page one. The RPC
  // clamps its own page size regardless of what this passes.
  const parsed = Number.parseInt(p ?? "1", 10);
  const pageNumber = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const offset = (pageNumber - 1) * IMPORT_LINKS_PAGE_SIZE;

  const page = await listOwnImportLinks(supabase, eventId, offset);
  const lastPage = Math.max(1, Math.ceil(page.unclaimed_total / IMPORT_LINKS_PAGE_SIZE));

  return (
    <main
      className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-[22px] pt-4 pb-6 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <Link
        href={`/events/${eventId}/import`}
        className="-ml-1 flex min-h-11 items-center gap-1.5 self-start px-1 text-[13px] leading-[18px] font-medium"
        style={{ color: "var(--sc-text-muted)" }}
      >
        <ChevronLeft size={16} strokeWidth={2} aria-hidden />
        Import a guest list
      </Link>

      <header className="flex flex-col gap-1.5">
        <h1 className="text-[27px] leading-[31px] font-semibold tracking-[-0.03em]">
          Send claim links
        </h1>
        <p
          className="max-w-[54ch] text-[13px] leading-[19px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          We can&rsquo;t email your guests yet, so this is how you get their link to them: copy it
          and send it however you normally would. Each link only works for the person it belongs
          to &mdash; they still have to sign in with that email address to claim anything.
        </p>
      </header>

      {page.unclaimed_total === 0 ? (
        <EmptyState />
      ) : (
        <>
          <p className="text-[13px] leading-[18px]" style={{ color: "var(--sc-text-subtle)" }}>
            {page.unclaimed_total} {page.unclaimed_total === 1 ? "guest hasn't" : "guests haven't"}{" "}
            claimed yet.
          </p>

          <ClaimLinksList links={page.links} />

          {lastPage > 1 ? (
            <nav className="flex items-center justify-between gap-3 pt-1">
              <PageLink
                eventId={eventId}
                page={pageNumber - 1}
                disabled={pageNumber <= 1}
                label="Previous"
              />
              <span className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-subtle)" }}>
                Page {pageNumber} of {lastPage}
              </span>
              <PageLink
                eventId={eventId}
                page={pageNumber + 1}
                disabled={pageNumber >= lastPage}
                label="Next"
              />
            </nav>
          ) : null}
        </>
      )}
    </main>
  );
}

/**
 * Two very different situations share this screen: nobody has been imported
 * yet, and everybody who was has already claimed. It deliberately does not try
 * to tell them apart. Saying "all 142 of your guests have claimed" would be an
 * aggregate this screen has no count for once the rows are gone — a claimed row
 * keeps no link to the host's import — and guessing would be worse than the
 * plain sentence.
 */
function EmptyState() {
  return (
    <div className="flex flex-col gap-2 rounded-[26px] p-[17px]" style={GLASS}>
      <h2 className="text-[15px] leading-5 font-semibold">No links to send</h2>
      <p
        className="max-w-[54ch] text-[13px] leading-[19px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        Either nobody&rsquo;s been imported into this event yet, or everyone you imported has
        already claimed their profile.
      </p>
    </div>
  );
}

function PageLink({
  eventId,
  page,
  disabled,
  label,
}: {
  eventId: string;
  page: number;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <span
        className="flex min-h-11 items-center rounded-full px-[18px] text-[13px] leading-[17px] font-semibold opacity-40"
        style={SECONDARY_BUTTON}
        aria-disabled
      >
        {label}
      </span>
    );
  }
  return (
    <Link
      href={`/events/${eventId}/import/links?p=${page}`}
      className="flex min-h-11 items-center rounded-full px-[18px] text-[13px] leading-[17px] font-semibold"
      style={SECONDARY_BUTTON}
    >
      {label}
    </Link>
  );
}
