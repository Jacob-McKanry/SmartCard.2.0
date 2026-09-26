import { redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";

import { AddContactFlow } from "./add-contact-flow";

/**
 * `/connections/add` — the unverified "add a contact" flow (2026-09-26,
 * docs/architecture/2026-09-26-unverified-connections.md).
 *
 * UNLIKE EVERY OTHER SCREEN IN THIS APP, THIS ONE NEEDS NO EXPLANATION OF
 * WHO CAN BE ADDED, BECAUSE THERE IS NO GATE TO EXPLAIN
 *
 * Every other write path in this app (RSVP, invite, claim) has a rule about
 * who is allowed to end up connected to whom, and the page copy usually
 * says so. This one does not — that absence is the point, and it is
 * recorded, not accidental: see the architecture doc for exactly what was
 * decided and why. The copy below says what happens plainly rather than
 * implying a safeguard that does not exist.
 */
export const dynamic = "force-dynamic";

export default async function AddContactPage() {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }

  return (
    <main
      className="mx-auto flex w-full max-w-[520px] flex-col gap-4 px-[22px] pt-6 pb-10 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <header className="flex flex-col gap-[5px] pt-1.5">
        <h1 className="text-[26px] leading-[30px] font-semibold tracking-[-0.03em]">Add a contact</h1>
        <p
          className="max-w-[54ch] text-[14px] leading-5"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          Scan a card or badge, or type in their details yourself. This adds them straight away — no tap,
          no scan-to-verify, and if they already have a SmartCard account you&rsquo;ll see each other&rsquo;s
          full profile right away.
        </p>
      </header>

      <AddContactFlow />
    </main>
  );
}
