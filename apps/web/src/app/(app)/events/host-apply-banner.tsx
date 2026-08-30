import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { HostApplicationRow } from "@smartcard/types";

import { GLASS_LIQUID } from "./lib/surfaces";

/**
 * The "APPLY TO BECOME A HOST" entry point on `/events`.
 *
 * WHY THIS LIVES ON THE BROWSE SCREEN AT ALL
 *
 * `/host/apply` existed with no link to it anywhere a first-time visitor would
 * see it — `NotVerifiedYet` on the import page only reaches somebody who
 * already tried to import, which is a step past where most hosts start. This
 * is the front door: anyone signed in may host an ordinary event with no
 * gate, but importing a guest list needs verification, and the events list is
 * where a host is already looking when they'd wonder about that.
 *
 * WHY IT DISAPPEARS FOR MOST VIEWERS, NOT JUST VERIFIED ONES
 *
 * Three states get no banner at all: already verified (nothing to apply for),
 * already pending (re-showing "apply" while a decision is in flight would read
 * as the app forgetting what you just did), and already approved-then-revoked
 * with a fresh pending resubmission — all covered by checking BOTH
 * `isVerifiedHost` and the application's own `status`, because §9.4's
 * revocation can leave `is_verified_host = false` while `status` still reads
 * `approved` from before. Only "never applied" or "rejected" show the banner —
 * the two states where applying is actually the next useful action.
 */
export function HostApplyBanner({
  verified,
  application,
}: {
  verified: boolean;
  application: HostApplicationRow | null;
}) {
  if (verified) {
    return null;
  }
  if (application !== null && application.status !== "rejected") {
    // `pending` — already applied, waiting on a decision. `approved` with
    // `verified === false` is the revoked case (§9.4); re-showing "apply"
    // there would be wrong too, since re-applying is not how revocation is
    // undone — only an admin decision is, and this screen has no business
    // implying otherwise.
    return null;
  }

  const wasRejected = application?.status === "rejected";

  return (
    <Link
      href="/host/apply"
      className="flex items-center gap-3 rounded-[22px] px-[17px] py-[14px] transition-transform duration-200 active:scale-[0.99]"
      style={GLASS_LIQUID}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[14px] leading-[19px] font-semibold">
          {wasRejected ? "Reapply to become a host" : "Apply to become a host"}
        </span>
        <span
          className="max-w-[46ch] text-[12px] leading-[17px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          {wasRejected
            ? "Your last application wasn't approved — you can try again."
            : "Verified hosts can import a guest list from Luma, Eventbrite or Partiful."}
        </span>
      </div>
      <ArrowRight size={16} strokeWidth={2.2} className="ml-auto shrink-0" aria-hidden />
    </Link>
  );
}
