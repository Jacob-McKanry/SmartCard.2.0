import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, CircleCheck, Clock } from "lucide-react";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { isVerifiedHost } from "@/server/events/attendee-import-service";
import { getOwnHostApplication } from "@/server/hosting/host-application-service";

import { GLASS, PRIMARY_BUTTON } from "../../events/lib/surfaces";
import { ApplyForm } from "./apply-form";

/**
 * `/host/apply` — §9.2's application form, and the screen `import/page.tsx`'s
 * `NotVerifiedYet` component pointed to as "a separate slice" until now.
 *
 * WHY isVerifiedHost, NOT JUST THE APPLICATION'S OWN status
 *
 * `is_verified_host` and `host_applications.status` can disagree, and both
 * directions are real: an admin can flip `is_verified_host` off (§9.4's
 * revocation) without touching the approved application row, and — the
 * happier case — an already-verified account has no reason to see an apply
 * form at all. Reading the flag directly, rather than inferring it from
 * `status === 'approved'`, is what keeps this screen honest in both cases.
 *
 * NO GATE HERE BEYOND SIGN-IN. Unlike the host-only screens under `/events`,
 * anyone signed in may apply — there is no "you must already be a host to ask
 * to become one" chicken-and-egg. `submit_host_application` re-derives its own
 * single requirement (an active account) from the session.
 */
export const dynamic = "force-dynamic";

export default async function HostApplyPage() {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }
  const { supabase } = context;

  const [verified, application] = await Promise.all([
    isVerifiedHost(supabase),
    getOwnHostApplication(supabase),
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

      <header className="flex flex-col gap-1.5">
        <h1 className="text-[27px] leading-[31px] font-semibold tracking-[-0.03em]">
          Become a verified host
        </h1>
        <p
          className="max-w-[54ch] text-[13px] leading-[19px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          A guest list is other people&rsquo;s contact details, so uploading one is limited to
          hosts we&rsquo;ve checked by hand. Anyone can host an event on SmartCard &mdash; this is
          only needed if you want to import a guest list from Luma, Eventbrite or Partiful.
        </p>
      </header>

      <Body verified={verified} application={application} />
    </main>
  );
}

function Body({
  verified,
  application,
}: {
  verified: boolean;
  application: Awaited<ReturnType<typeof getOwnHostApplication>>;
}) {
  if (verified) {
    return (
      <div className="flex flex-col gap-2.5 rounded-[26px] p-[17px]" style={GLASS}>
        <div className="flex items-center gap-2">
          <CircleCheck size={18} strokeWidth={2} style={{ color: "var(--sc-accent)" }} aria-hidden />
          <h2 className="text-[15px] leading-5 font-semibold">You&rsquo;re a verified host</h2>
        </div>
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
          You can import a guest list into any event you host.
        </p>
        <Link
          href="/events"
          className="mt-1 flex min-h-11 w-fit items-center rounded-full px-[18px] text-[13px] leading-[17px] font-semibold"
          style={PRIMARY_BUTTON}
        >
          Go to your events
        </Link>
      </div>
    );
  }

  if (application !== null && application.status === "pending") {
    return (
      <div className="flex flex-col gap-2 rounded-[26px] p-[17px]" style={GLASS}>
        <div className="flex items-center gap-2">
          <Clock size={18} strokeWidth={2} style={{ color: "var(--sc-text-muted)" }} aria-hidden />
          <h2 className="text-[15px] leading-5 font-semibold">Application pending</h2>
        </div>
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
          We have your application for {application.organization_name} and we&rsquo;ll let you know
          once it&rsquo;s been reviewed.
        </p>
      </div>
    );
  }

  // Never applied, or the previous application was rejected — both land on
  // the form. `application` (when rejected) seeds the fields so re-applying
  // does not mean retyping everything, and its `rejection_note` is shown
  // above the form as context — see `ApplyForm`'s own header for why that
  // note is read-only display, never resubmitted.
  return (
    <ApplyForm
      rejectionNote={application?.status === "rejected" ? application.rejection_note : undefined}
      defaultValues={
        application === null
          ? undefined
          : {
              organizationName: application.organization_name,
              applicantRole: application.applicant_role,
              pastEventLink: application.past_event_link,
              expectedEventSize: application.expected_event_size,
              hostingFrequency: application.hosting_frequency,
            }
      }
    />
  );
}
