import { notFound, redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { isAdmin } from "@/server/hosting/host-application-service";
import { myEligibility } from "@/server/safety/eligibility-service";

import { GLASS } from "../../events/lib/surfaces";
import { GateForm } from "./gate-form";

/**
 * Preview of the 18+/terms gate (owner decision 11,
 * `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`). See
 * `/MapTest/page.tsx`'s header — admin-only, not wired into the real sign-in
 * flow yet.
 */
export const dynamic = "force-dynamic";

export default async function AgeGatePreviewPage() {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }

  if (!(await isAdmin(context.supabase))) {
    notFound();
  }

  const eligibility = await myEligibility(context.supabase);

  return (
    <main
      className="mx-auto flex w-full max-w-[480px] flex-col gap-4 px-[22px] pt-4 pb-6 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[27px] leading-[31px] font-semibold tracking-[-0.03em]">
          Age & terms gate
        </h1>
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-subtle)" }}>
          Your account&apos;s current gate state: {eligibility.needsAgeGate ? "gated" : "cleared"}
          {eligibility.age !== null ? ` · age ${eligibility.age}` : ""}.
        </p>
      </header>

      {eligibility.needsAgeGate ? (
        <GateForm />
      ) : (
        <div className="flex flex-col gap-2 rounded-[26px] p-[17px]" style={GLASS}>
          <h2 className="text-[15px] leading-5 font-semibold">Already cleared</h2>
          <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
            This account has already accepted the current terms version and
            is on file as 18+. There is no retry path after a failed
            submission — see the migration header for why.
          </p>
        </div>
      )}
    </main>
  );
}
